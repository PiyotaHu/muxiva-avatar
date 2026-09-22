"""Cancellable CPU Sherpa synthesis for Muxiva's project Python Host.

The worker never calls NodeContext. Short host ticks emit bounded PCM batches.
Cancellation advances a generation and prevents both queued and late audio.
Input text must be complete, speakable fragments from the Graph formatter.
"""
from __future__ import annotations

from contextlib import redirect_stdout
import json
from pathlib import Path
import queue
import sys
import threading
import time
from typing import Any

import muxiva
from .speech_text import normalize_for_speech


class LocalTtsNode:
    SAMPLE_RATE = 24_000

    def __init__(self, config: dict[str, Any] | None = None, model_factory=None):
        self.config = config or {}
        self.model_factory = model_factory
        self.jobs = queue.Queue(maxsize=int(self.config.get("max_pending_segments", 32)))
        self.results = queue.Queue(maxsize=int(self.config.get("max_audio_chunks", 64)))
        self.closing = threading.Event()
        self.ready = threading.Event()
        self.lock = threading.Lock()
        self.worker = None
        self.generation = 0
        self.cancelled_before = -1
        self.pending = 0
        self.startup_error = None
        self.offset_sequence = None
        self.sample_offset = 0
        self.np = None

    def _load_model(self):
        import sherpa_onnx
        backend = str(self.config.get("backend", "kokoro"))
        directories = {"kokoro-int8":"kokoro-int8-multi-lang-v1_1", "kokoro":"kokoro-multi-lang-v1_1", "melo":"vits-melo-tts-zh_en"}
        if backend not in {*directories, "matcha"}:
            raise ValueError(f"Unsupported local TTS backend: {backend}")
        model_dir = self.config.get("model_dir")
        if backend == "matcha" and not model_dir:
            raise ValueError("Matcha requires an explicit model_dir")
        directory = Path(str(model_dir or f".models/{directories[backend]}")).resolve()

        def model_file(value, label):
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"Local TTS requires {label}")
            path = Path(value)
            path = (directory / path).resolve() if not path.is_absolute() else path.resolve()
            if not path.is_file():
                raise RuntimeError(f"Local TTS {label} file is missing: {path}")
            return str(path)

        options = {"num_threads":int(self.config.get("num_threads", 4)), "provider":"cpu"}
        if backend == "matcha":
            # Model/vocoder selection belongs to project configuration, not the
            # reusable node. Diffusion steps are part of the acoustic ONNX file.
            options["matcha"] = sherpa_onnx.OfflineTtsMatchaModelConfig(
                acoustic_model=model_file(self.config.get("acoustic_model"), "acoustic_model"),
                vocoder=model_file(self.config.get("vocoder"), "vocoder"),
                lexicon=model_file("lexicon.txt", "lexicon"),
                tokens=model_file("tokens.txt", "tokens"),
                noise_scale=1.0, length_scale=1.0,
            )
        elif backend == "melo":
            options["vits"] = sherpa_onnx.OfflineTtsVitsModelConfig(
                model=model_file("model.onnx", "model"), lexicon=str(directory / "lexicon.txt"), tokens=str(directory / "tokens.txt"), dict_dir=str(directory / "dict"),
            )
        else:
            options["kokoro"] = sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=model_file("model.int8.onnx" if backend == "kokoro-int8" else "model.onnx", "model"), voices=str(directory / "voices.bin"),
                    tokens=str(directory / "tokens.txt"),
                    data_dir=str(directory / "espeak-ng-data"),
                    lexicon=f"{directory / 'lexicon-us-en.txt'},{directory / 'lexicon-zh.txt'}",
                )
        config_options = {}
        rules = self.config.get("rule_fsts", [])
        if not isinstance(rules, list) or len(rules) > 16:
            raise ValueError("Local TTS rule_fsts must be a list of at most 16 files")
        if rules:
            paths = [model_file(rule, "rule_fsts") for rule in rules]
            if len(set(paths)) != len(paths):
                raise ValueError("Local TTS rule_fsts paths must be unique")
            if any("," in path for path in paths):
                raise ValueError("Local TTS rule_fsts paths cannot contain commas")
            config_options["rule_fsts"] = ",".join(paths)
        if "silence_scale" in self.config:
            scale = self.config["silence_scale"]
            if isinstance(scale, bool) or not isinstance(scale, (int, float)) or not 0 <= scale <= 2:
                raise ValueError("Local TTS silence_scale must be finite and between 0 and 2")
            config_options["silence_scale"] = float(scale)
        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(**options),
            max_num_sentences=1, **config_options,
        )
        if not config.validate():
            raise RuntimeError("Local TTS model configuration is invalid")
        return sherpa_onnx.OfflineTts(config)

    def on_prepare(self, _ctx=None):
        import numpy as np
        self.np = np
        self.worker = threading.Thread(target=self._work, name="muxiva-local-tts-cpu", daemon=True)
        self.worker.start()
        if not self.ready.wait(timeout=30):
            self.closing.set()
            raise RuntimeError("Local TTS initialization exceeded 30 seconds")
        if self.startup_error is not None:
            raise RuntimeError(f"Local TTS initialization failed: {self.startup_error}")

    def on_process(self, frame, ctx):
        if frame is not None:
            if not hasattr(frame, "text"):
                raise ValueError("local_tts expects TextFrame input")
            text = normalize_for_speech(frame.text, language=str(self.config.get("language", "auto")))
            if not text:
                return
            if len(text) > int(self.config.get("max_segment_chars", 600)):
                raise ValueError("TTS fragment exceeds max_segment_chars; use the Graph sentence formatter")
            sequence = int(frame.sequence)
            with self.lock:
                if sequence < self.cancelled_before:
                    ctx.increment_counter("tts.stale_text_dropped")
                    return
                generation = self.generation
                self.pending += 1
            try:
                self.jobs.put_nowait((generation, sequence, text))
            except queue.Full:
                with self.lock:
                    self.pending -= 1
                raise RuntimeError("TTS pending text queue is full")
        self._drain(ctx)
        with self.lock:
            pending = self.pending
        if pending or not self.results.empty():
            ctx.schedule_next_tick(10)

    def on_signal(self, signal, ctx=None):
        if getattr(signal, "name", "") != "muxiva.turn.cancelled":
            return
        payload = getattr(signal, "payload", {})
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except (ValueError, TypeError):
                payload = {}
        if not isinstance(payload, dict):
            payload = {}
        boundary = int(payload.get("turn_id", getattr(signal, "sequence", 0)))
        with self.lock:
            self.cancelled_before = max(self.cancelled_before, boundary)
            self.generation += 1
            self.pending = 0
        self._clear(self.jobs)
        self._clear(self.results)
        self.offset_sequence = None
        self.sample_offset = 0
        if ctx:
            ctx.increment_counter("tts.cancellations")

    def _active(self, generation):
        with self.lock:
            return not self.closing.is_set() and generation == self.generation

    def _put(self, generation, sequence, kind, value):
        while self._active(generation):
            try:
                self.results.put((generation, sequence, kind, value), timeout=0.05)
                return True
            except queue.Full:
                pass
        return False

    def _work(self):
        try:
            # stdout is reserved for the Muxiva JSON host protocol.
            with redirect_stdout(sys.stderr):
                model = self.model_factory() if self.model_factory else self._load_model()
            native_rate = int(model.sample_rate)
            if native_rate != self.SAMPLE_RATE:
                import soxr
        except Exception as error:
            self.startup_error = error
            self.ready.set()
            return
        self.ready.set()
        while not self.closing.is_set():
            try:
                job = self.jobs.get(timeout=0.1)
            except queue.Empty:
                continue
            if job is None:
                return
            generation, sequence, text = job
            if not self._active(generation):
                continue
            started = time.perf_counter()
            emitted = False
            callback_seen = False
            count = 0
            resampler = soxr.ResampleStream(native_rate, self.SAMPLE_RATE, 1, dtype="float32", quality="HQ") if native_rate != self.SAMPLE_RATE else None
            def audio_callback(samples, _progress):
                nonlocal callback_seen
                callback_seen = True
                if resampler is not None:
                    samples = resampler.resample_chunk(self.np.asarray(samples, dtype=self.np.float32), last=False)
                return emit_samples(samples)
            def emit_samples(samples):
                nonlocal emitted, count
                if not self._active(generation):
                    return 0
                samples = self.np.asarray(samples, dtype=self.np.float32).reshape(-1)
                if not len(samples):
                    return 1
                if not emitted:
                    if not self._put(generation, sequence, "started", {"first_pcm_ms": round((time.perf_counter() - started) * 1000, 1)}):
                        return 0
                    emitted = True
                chunk_samples = self.SAMPLE_RATE * int(self.config.get("pcm_chunk_ms", 40)) // 1000
                for offset in range(0, len(samples), chunk_samples):
                    chunk = samples[offset:offset + chunk_samples]
                    pcm = (self.np.clip(chunk, -1, 1) * 32767).astype("<i2").tobytes()
                    if not self._put(generation, sequence, "audio", pcm):
                        return 0
                    count += len(chunk)
                return 1
            try:
                default_speaker = 0 if self.config.get("backend") in {"melo", "matcha"} else 3
                audio = model.generate(text, sid=int(self.config.get("speaker_id", default_speaker)), speed=float(self.config.get("speed", 1.0)), callback=audio_callback)
                # Test adapters and older Sherpa APIs may return without callbacks.
                if not callback_seen and self._active(generation):
                    audio_callback(audio.samples, 1.0)
                if resampler is not None and self._active(generation):
                    emit_samples(resampler.resample_chunk(self.np.empty(0, dtype=self.np.float32), last=True))
                self._put(generation, sequence, "done", {"samples": count, "synthesis_ms": round((time.perf_counter() - started) * 1000, 1)})
            except Exception as error:
                self._put(generation, sequence, "error", str(error))

    def _drain(self, ctx):
        # <= 8 * 40 ms audio per callback keeps the host response bounded.
        for _ in range(8):
            try:
                generation, sequence, kind, value = self.results.get_nowait()
            except queue.Empty:
                break
            if not self._active(generation):
                continue
            if kind == "audio":
                if self.offset_sequence != sequence:
                    self.offset_sequence, self.sample_offset = sequence, 0
                frame = muxiva.AudioFrame(value, self.SAMPLE_RATE, 1, sequence=sequence)
                frame.stream_id = "assistant"
                frame.timestamp_ns = self.sample_offset * 1_000_000_000 // self.SAMPLE_RATE
                frame.clock_domain = {"id":"assistant.audio", "kind":"media_relative"}
                self.sample_offset += len(value) // 2
                ctx.emit("audio_out", frame)
                ctx.increment_counter("tts.audio_chunks")
            elif kind == "started":
                self._event(ctx, "muxiva.voice.tts.started", sequence, value)
            else:
                with self.lock:
                    self.pending = max(0, self.pending - 1)
                topic = "muxiva.voice.tts.segment.completed" if kind == "done" else "muxiva.voice.tts.failed"
                self._event(ctx, topic, sequence, value if isinstance(value, dict) else {"error": value})
        ctx.set_gauge("tts.audio_queue_chunks", self.results.qsize())
        ctx.set_gauge("tts.pending_segments", self.pending)

    @staticmethod
    def _event(ctx, topic, sequence, payload):
        ctx.emit("event_out", muxiva.EventFrame(topic, json.dumps(payload, ensure_ascii=False), source="muxiva.local_tts", sequence=sequence))

    @staticmethod
    def _clear(target):
        while True:
            try:
                target.get_nowait()
            except queue.Empty:
                return

    def on_finish(self, _ctx=None):
        self.closing.set()
        self._clear(self.jobs)
        self._clear(self.results)
        if self.worker is not None:
            self.worker.join(timeout=5)
            if self.worker.is_alive():
                raise RuntimeError("Local TTS worker did not stop within 5 seconds")

    def on_abort(self, _reason, ctx=None):
        self.on_finish(ctx)
