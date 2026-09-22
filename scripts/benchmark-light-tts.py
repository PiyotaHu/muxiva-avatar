"""Opt-in, offline CPU TTS audition. Never imports a model at module import time.

Run explicitly with --backend; no Graph, Node, playback or production defaults
are changed. The parent watchdog remains independent of native model execution.
"""
from __future__ import annotations

import argparse
from collections import deque
import ctypes
from ctypes import wintypes
from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import wave

ROOT = Path(__file__).resolve().parents[1]
GIB = 1024 ** 3
MIB = 1024 ** 2
PREFIX = "::light-tts::"
DEFAULT_TEXT = "你好，我是你的数字人助手，很高兴认识你。"
DEFAULT_CASES = [DEFAULT_TEXT,
    "别着急，我会陪你一起把问题弄清楚。我们先从最简单的一步开始，好吗？",
    "哇，真的成功了！这个结果比我想象的还要好。",
    "今天是九月十四日，气温二十五摄氏度，电量百分之八十。",
    "重庆的银行今天正常营业。请把这份文件重新整理，再交给行长。"]


class MemoryStatus(ctypes.Structure):
    _fields_ = [("length", wintypes.DWORD), ("load", wintypes.DWORD)] + [
        (name, ctypes.c_ulonglong) for name in
        ("total_phys", "avail_phys", "total_page", "avail_page", "total_virtual", "avail_virtual", "avail_extended")]


class ProcessMemoryCounters(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("page_faults", wintypes.DWORD)] + [
        (name, ctypes.c_size_t) for name in
        ("peak_rss", "rss", "peak_paged_pool", "paged_pool", "peak_nonpaged_pool", "nonpaged_pool", "pagefile", "peak_pagefile", "private_bytes")]


class WindowsMemory:
    """Windows working-set counters, not Python tracemalloc or model-file sizes."""
    def __init__(self):
        if sys.platform != "win32":
            raise RuntimeError("This bounded audition uses Windows memory APIs")
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.psapi = ctypes.WinDLL("psapi", use_last_error=True)
        self.kernel.GlobalMemoryStatusEx.argtypes = [ctypes.POINTER(MemoryStatus)]
        self.kernel.GlobalMemoryStatusEx.restype = wintypes.BOOL
        self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL
        self.psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessMemoryCounters), wintypes.DWORD]
        self.psapi.GetProcessMemoryInfo.restype = wintypes.BOOL

    def available(self):
        value = MemoryStatus()
        value.length = ctypes.sizeof(value)
        if not self.kernel.GlobalMemoryStatusEx(ctypes.byref(value)):
            raise ctypes.WinError(ctypes.get_last_error())
        return int(value.avail_phys)

    def process(self, pid):
        # Only the explicitly spawned child (or the calling worker) is queried.
        handle = self.kernel.OpenProcess(0x0400 | 0x0010, False, pid)
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            value = ProcessMemoryCounters()
            value.cb = ctypes.sizeof(value)
            if not self.psapi.GetProcessMemoryInfo(handle, ctypes.byref(value), value.cb):
                raise ctypes.WinError(ctypes.get_last_error())
            return {"rss_bytes": int(value.rss), "peak_rss_bytes": int(value.peak_rss),
                    "private_bytes": int(value.private_bytes), "page_fault_count": int(value.page_faults)}
        finally:
            self.kernel.CloseHandle(handle)


@dataclass
class MemoryGuard:
    floor_bytes: int = 800 * MIB
    sustained_seconds: float = .5
    low_since: float | None = None

    def check(self, now, available, phase_started, timeout):
        if available < self.floor_bytes:
            if self.low_since is None:
                self.low_since = now
            if now - self.low_since >= self.sustained_seconds:
                return "available RAM remained below 800 MiB for at least 500 ms"
        else:
            self.low_since = None
        if now - phase_started >= timeout:
            return "audition phase exceeded its time limit"
        return None


def minimum_available(backend):
    return int((2.0 if backend == "zipvoice-int8" else 1.5) * GIB)


def print_json(value, *, prefix="", stream=None):
    # JSON escaping preserves the text even when PowerShell supplies a legacy
    # GBK stream. A closed console must never bypass child cleanup/report I/O.
    target = stream if stream is not None else sys.stdout
    line = prefix + json.dumps(value, ensure_ascii=True) + "\n"
    try:
        target.write(line)
        target.flush()
        return True
    except (OSError, UnicodeError):
        return False


def emit(kind, **fields):
    print_json({"kind": kind, **fields}, prefix=PREFIX)


def require_file(path):
    path = Path(path).resolve()
    if not path.is_file():
        raise ValueError(f"Required local file is missing: {path}")
    return str(path)


def build_config(sherpa, args):
    """Only constructs configuration. OfflineTts construction is worker-only."""
    directory = args.model_dir.resolve()
    options = {"num_threads": args.num_threads, "provider": "cpu", "debug": False}
    if args.backend == "kokoro":
        options["kokoro"] = sherpa.OfflineTtsKokoroModelConfig(
            model=require_file(directory / "model.onnx"), voices=require_file(directory / "voices.bin"),
            tokens=require_file(directory / "tokens.txt"), data_dir=str(directory / "espeak-ng-data"),
            lexicon=",".join(require_file(directory / name) for name in ("lexicon-us-en.txt", "lexicon-zh.txt")))
    elif args.backend == "zipvoice-int8":
        options["zipvoice"] = sherpa.OfflineTtsZipvoiceModelConfig(
            encoder=require_file(args.encoder or directory / "encoder.int8.onnx"),
            decoder=require_file(args.decoder or directory / "decoder.int8.onnx"),
            vocoder=require_file(args.vocoder), tokens=require_file(directory / "tokens.txt"),
            lexicon=require_file(directory / "lexicon.txt"), data_dir=str(directory / "espeak-ng-data"),
            feat_scale=.1, t_shift=.5, target_rms=.1, guidance_scale=1.0)
    else:
        options["matcha"] = sherpa.OfflineTtsMatchaModelConfig(
            acoustic_model=require_file(args.acoustic_model), vocoder=require_file(args.vocoder),
            lexicon=require_file(directory / "lexicon.txt"), tokens=require_file(directory / "tokens.txt"),
            dict_dir=str(directory / "dict"), noise_scale=1.0, length_scale=1.0)
    # Match callback PCM and returned PCM: do not apply post-generation silence
    # scaling. This differs from the existing Host benchmark and is reported.
    rules = ""
    if args.backend == "matcha":
        rules = ",".join(str(directory / name) for name in ("phone.fst", "date.fst", "number.fst")
                         if (directory / name).is_file())
    return sherpa.OfflineTtsConfig(model=sherpa.OfflineTtsModelConfig(**options),
                                  rule_fsts=rules, max_num_sentences=1, silence_scale=1.0)


def read_reference(path, np):
    # A short mono PCM16 reference can be produced by the existing Kokoro test.
    # Reading bounds precede allocation; no downloaded voice or microphone used.
    with wave.open(require_file(path), "rb") as source:
        rate, count = source.getframerate(), source.getnframes()
        if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getcomptype() != "NONE":
            raise ValueError("Reference must be uncompressed mono PCM16 WAV")
        if not 8000 <= rate <= 48000 or not .5 <= count / rate <= 15:
            raise ValueError("Reference must contain 0.5–15 seconds at 8–48 kHz")
        samples = np.frombuffer(source.readframes(count), dtype="<i2").astype(np.float32) / 32768
    if len(samples) != count or not np.isfinite(samples).all() or float(np.max(np.abs(samples))) < .0001:
        raise ValueError("Reference audio is empty, truncated or silent")
    return samples, rate


def generate_measured(model, text, generation, *, clock=time.perf_counter, on_first=None):
    """No playback, resampling, WAV I/O or artificial chunking inside timing."""
    started = clock()
    first = None
    callbacks = 0
    callback_samples = 0

    def callback(samples, _progress):
        nonlocal first, callbacks, callback_samples
        if len(samples):
            callbacks += 1
            callback_samples += len(samples)
            if first is None:
                first = (clock() - started) * 1000
                if on_first:
                    on_first(first)
        # sherpa-onnx v1.13.5 native implementation: 1 continues, 0 stops.
        # Its Python docstring has the inverse wording; use the actual contract.
        return 1

    audio = model.generate(text, generation, callback=callback)
    elapsed = clock() - started
    count, rate = len(audio.samples), int(audio.sample_rate)
    if count <= 0 or rate <= 0 or not math.isfinite(elapsed):
        raise RuntimeError("TTS returned empty audio or an invalid sample rate")
    duration = count / rate
    return audio, {"first_pcm_ms": first if first is not None else elapsed * 1000,
                   "first_pcm_definition": "first nonempty native PCM callback" if first is not None else "complete returned PCM array; no nonempty callback",
                   "first_pcm_mode": "callback" if first is not None else "whole_return",
                   "callback_count": callbacks, "callback_samples": callback_samples,
                   "native_sample_rate_hz": rate, "sample_count": count,
                   "generation_ms": elapsed * 1000, "audio_seconds": duration, "rtf": elapsed / duration}


def worker(args):
    emit("loading")
    import numpy as np
    import sherpa_onnx as sherpa
    if sherpa.__version__ != "1.13.5":
        raise RuntimeError("This audition was audited against sherpa-onnx 1.13.5")
    memory = WindowsMemory()
    config = build_config(sherpa, args)
    if not config.validate():
        raise ValueError("Sherpa model configuration validation failed")
    generation = sherpa.GenerationConfig()
    generation.sid = args.speaker_id if args.speaker_id is not None else (3 if args.backend == "kokoro" else 0)
    generation.speed = args.speed
    generation.silence_scale = 1.0
    generation.num_steps = args.num_steps
    reference_info = None
    if args.backend == "zipvoice-int8":
        samples, rate = read_reference(args.reference_audio, np)
        generation.reference_audio = samples
        generation.reference_sample_rate = rate
        generation.reference_text = args.reference_text
        reference_info = {"path": str(args.reference_audio.resolve()), "text": args.reference_text,
                          "sample_rate_hz": rate, "audio_seconds": len(samples) / rate}
    # Explicit construction occurs only here, after the parent's memory check.
    started = time.perf_counter()
    model = sherpa.OfflineTts(config)
    load_ms = (time.perf_counter() - started) * 1000
    emit("loaded", model_load_ms=load_ms, native_sample_rate_hz=model.sample_rate,
         config=str(config), reference=reference_info, memory=memory.process(os.getpid()))
    for index, text in enumerate(args.texts * args.repeat, 1):
        emit("case_started", case=index, text=text)
        audio, row = generate_measured(model, text, generation,
            on_first=lambda ms: emit("first_pcm", case=index, first_pcm_ms=ms))
        samples = np.asarray(audio.samples, dtype=np.float32)
        if not np.isfinite(samples).all():
            raise RuntimeError("TTS generated non-finite PCM")
        destination = args.output_dir / f"{args.backend}-case-{index}.wav"
        with wave.open(str(destination), "wb") as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(int(audio.sample_rate))
            output.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
        emit("case_completed", case=index, thermal_state="first_generation" if index == 1 else "warm_repeat",
             text=text, repeat=(index - 1) // len(args.texts) + 1, wav=str(destination), **row,
             peak_amplitude=float(np.max(np.abs(samples))), rms=float(np.sqrt(np.mean(samples ** 2))),
             memory=memory.process(os.getpid()))
    emit("complete")
    return 0


def stop_own_child(process):
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=2)


def run_guarded(args, *, memory=None):
    memory = memory or WindowsMemory()
    available = memory.available()
    report = {"backend": args.backend, "runtime": "sherpa-onnx 1.13.5 CPU; direct offline API, not Muxiva Host",
              "model_dir": str(args.model_dir.resolve()), "num_threads": args.num_threads,
              "speed": args.speed, "num_steps": args.num_steps if args.backend == "zipvoice-int8" else None,
              "speaker_id": args.speaker_id if args.speaker_id is not None else (3 if args.backend == "kokoro" else 0),
              "silence_scale": 1.0, "actual_playback_measured": False, "cases": [],
              "input_texts": args.texts, "repeat": args.repeat,
              "measurement_notes": "First PCM is a native callback batch, or explicitly the whole return; not codec-token time or speaker playback. Generation includes frontend/reference conditioning but excludes model loading, WAV writing and resampling. Native callback batching differs by backend. RSS is Windows process peak working set, not total system or GPU memory.",
              "safety": {"minimum_start_available_bytes": minimum_available(args.backend),
                         "available_bytes_before": available, "runtime_floor_bytes": 800 * MIB,
                         "runtime_low_memory_seconds": .5, "poll_seconds": .1,
                         "case_timeout_seconds": args.timeout, "load_timeout_seconds": args.load_timeout}}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.output_dir / "report.json"
    if report_path.exists() or any(args.output_dir.glob("*.wav")):
        raise ValueError("Choose a fresh output directory; existing audition artifacts will not be overwritten")
    if available < minimum_available(args.backend):
        report.update(status="blocked_by_memory", reason="No model was loaded: insufficient available RAM")
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print_json(report)
        return 3
    command = [sys.executable, "-u", str(Path(__file__).resolve()), *sys.argv[1:], "--worker"]
    # CLI parsing assigns a timestamp by default; pass the exact parent path.
    command.extend(["--output-dir", str(args.output_dir)])
    environment = os.environ.copy()
    environment.update(OMP_NUM_THREADS=str(args.num_threads), OPENBLAS_NUM_THREADS=str(args.num_threads),
                       MKL_NUM_THREADS=str(args.num_threads), HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                       PYTHONIOENCODING="utf-8")
    process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, encoding="utf-8", errors="replace", creationflags=subprocess.BELOW_NORMAL_PRIORITY_CLASS)
    events = queue.SimpleQueue()
    diagnostics = deque(maxlen=40)

    def read_output():
        for line in process.stdout:
            if line.startswith(PREFIX):
                try:
                    events.put(json.loads(line[len(PREFIX):]))
                except ValueError:
                    diagnostics.append(line[:2000])
            else:
                diagnostics.append(line[:2000])

    reader = threading.Thread(target=read_output, daemon=True)
    reader.start()
    guard = MemoryGuard()
    started = phase_started = time.monotonic()
    phase_timeout = args.load_timeout
    minimum_seen, peak_rss = available, 0
    reason = None

    def consume_events():
        nonlocal phase_started, phase_timeout, peak_rss
        while not events.empty():
            event = events.get()
            kind = event.get("kind")
            if kind == "loaded":
                report["model_load_ms"] = event["model_load_ms"]
                report["model_config"] = event["config"]
                report["reference"] = event["reference"]
                report["loaded_memory"] = event["memory"]
                report["native_sample_rate_hz"] = event["native_sample_rate_hz"]
            elif kind == "case_started":
                phase_started, phase_timeout = time.monotonic(), args.timeout
            elif kind == "case_completed":
                report["cases"].append(event)
                peak_rss = max(peak_rss, event["memory"]["peak_rss_bytes"])
            elif kind == "complete":
                report["worker_completed"] = True
            print_json(event)

    try:
        while process.poll() is None:
            consume_events()
            now = time.monotonic()
            free = memory.available()
            minimum_seen = min(minimum_seen, free)
            try:
                peak_rss = max(peak_rss, memory.process(process.pid)["peak_rss_bytes"])
            except OSError:
                if process.poll() is None:
                    raise
            reason = guard.check(now, free, phase_started, phase_timeout)
            if now - started > args.load_timeout + len(args.texts) * args.repeat * (args.timeout + 5):
                reason = "whole audition exceeded the bounded deadline"
            if reason:
                stop_own_child(process)
                break
            time.sleep(.1)
        process.wait(timeout=2)
        reader.join(timeout=2)
        consume_events()
    except BaseException as error:
        reason = f"Watchdog stopped its child: {type(error).__name__}: {error}"
        stop_own_child(process)
    finally:
        if process.poll() is None:
            stop_own_child(process)
        reader.join(timeout=2)
        consume_events()
        report.update(status="completed" if process.returncode == 0 and report.get("worker_completed") and not reason else "stopped_or_failed",
                      reason=reason, returncode=process.returncode, elapsed_wall_seconds=time.monotonic() - started,
                      peak_child_rss_bytes=peak_rss, minimum_available_bytes_observed=minimum_seen,
                      diagnostic_tail=list(diagnostics))
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print_json({"report": str(report_path), "status": report["status"], "reason": reason})
    return 0 if report["status"] == "completed" else 4


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", choices=["zipvoice-int8", "matcha", "kokoro"], required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--vocoder", type=Path)
    parser.add_argument("--acoustic-model", type=Path, help="Matcha ONNX; diffusion steps are baked into this file")
    parser.add_argument("--encoder", type=Path)
    parser.add_argument("--decoder", type=Path)
    parser.add_argument("--reference-audio", type=Path)
    parser.add_argument("--reference-text")
    inputs = parser.add_mutually_exclusive_group()
    inputs.add_argument("--text", action="append", help="Repeat for several cases; one --text runs only that pilot")
    inputs.add_argument("--cases", type=Path, help="Local JSON array of 1–6 short strings")
    parser.add_argument("--num-threads", type=int, choices=range(1, 9), default=4)
    parser.add_argument("--speaker-id", type=int)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--num-steps", type=int, choices=[1, 2, 4, 8, 16], default=4)
    parser.add_argument("--repeat", type=int, choices=range(1, 4), default=1)
    parser.add_argument("--timeout", type=float, default=60, help="Maximum seconds per generated case, at most 60")
    parser.add_argument("--load-timeout", type=float, default=90, help="Bounded import/model-loading phase, at most 120 seconds")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.cases:
        if not args.cases.is_file() or args.cases.stat().st_size > 16_384:
            parser.error("--cases must be an existing JSON file of at most 16 KiB")
        try:
            args.texts = json.loads(args.cases.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as error:
            parser.error(f"Invalid cases JSON: {error}")
    else:
        args.texts = args.text or list(DEFAULT_CASES)
    if not isinstance(args.texts, list) or not 1 <= len(args.texts) <= 6 or any(
            not isinstance(text, str) or not text.strip() or len(text) > 180 for text in args.texts):
        parser.error("Provide 1–6 text cases, each with 1–180 characters")
    if not math.isfinite(args.speed) or not .5 <= args.speed <= 2:
        parser.error("--speed must be between 0.5 and 2")
    if not 0 < args.timeout <= 60 or not 0 < args.load_timeout <= 120:
        parser.error("Case timeout must be <=60 seconds; load timeout <=120 seconds")
    if args.speaker_id is not None and args.speaker_id < 0:
        parser.error("--speaker-id must be nonnegative")
    if args.backend != "kokoro" and args.vocoder is None:
        parser.error("--vocoder is required for Matcha and ZipVoice")
    if args.backend == "matcha" and args.acoustic_model is None:
        parser.error("Matcha requires an explicit --acoustic-model")
    if args.backend == "zipvoice-int8" and (args.reference_audio is None or not args.reference_text or not args.reference_text.strip()):
        parser.error("ZipVoice requires authorized --reference-audio and its exact --reference-text")
    if args.reference_text and len(args.reference_text) > 300:
        parser.error("Reference transcript is too long for the bounded reference")
    args.model_dir = args.model_dir.resolve()
    args.output_dir = (args.output_dir or ROOT / ".artifacts/light-tts" / f"{args.backend}-{time.time_ns()}").resolve()
    if not args.output_dir.is_relative_to(ROOT / ".artifacts"):
        parser.error("--output-dir must be under this application's .artifacts directory")
    return args


if __name__ == "__main__":
    # Keep JSON transcripts intact across Windows PowerShell/pipe code pages.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    arguments = parse_args()
    raise SystemExit(worker(arguments) if arguments.worker else run_guarded(arguments))
