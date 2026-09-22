"""Matcha configuration and worker regression; only fake models are loaded."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

from test_speech_nodes import Context, Model, TextFrame, pump
from muxiva_avatar_speech.synthesis import LocalTtsNode

ROOT = Path(__file__).resolve().parents[1]


class FakeConfig:
    def __init__(self, **values):
        self.__dict__.update(values)

    def validate(self):
        return True


FAKE_SHERPA = types.SimpleNamespace(
    OfflineTtsMatchaModelConfig=FakeConfig, OfflineTtsKokoroModelConfig=FakeConfig,
    OfflineTtsVitsModelConfig=FakeConfig, OfflineTtsModelConfig=FakeConfig,
    OfflineTtsConfig=FakeConfig, OfflineTts=lambda config: config,
)


class MatchaConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="muxiva-matcha-test-")
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        for name in ("acoustic.onnx", "vocoder.onnx", "tokens.txt", "lexicon.txt",
                     "phone.fst", "date.fst", "model.onnx", "model.int8.onnx"):
            (self.directory / name).touch()
        self.config = {"backend": "matcha", "model_dir": str(self.directory),
                       "acoustic_model": "acoustic.onnx", "vocoder": "vocoder.onnx"}

    def load(self, config=None):
        with patch.dict(sys.modules, {"sherpa_onnx": FAKE_SHERPA}):
            return LocalTtsNode(self.config if config is None else config)._load_model()

    def test_relative_files_and_rules_resolve_from_model_directory_without_mutation(self):
        self.config.update(rule_fsts=["phone.fst", "date.fst"], silence_scale=1.0)
        original = copy.deepcopy(self.config)
        result = self.load()
        self.assertEqual(self.config, original)
        self.assertEqual(result.model.matcha.acoustic_model, str(self.directory / "acoustic.onnx"))
        self.assertEqual(result.model.matcha.vocoder, str(self.directory / "vocoder.onnx"))
        self.assertEqual(result.rule_fsts, ",".join(str(self.directory / name) for name in original["rule_fsts"]))
        self.assertEqual((result.model.matcha.noise_scale, result.model.matcha.length_scale), (1.0, 1.0))
        self.assertEqual((result.silence_scale, result.max_num_sentences), (1.0, 1))
        self.assertEqual((result.model.provider, result.model.num_threads), ("cpu", 4))
        self.assertFalse(hasattr(result.model.matcha, "dict_dir"), "current Sherpa no longer requires Matcha dict_dir")

    def test_absolute_acoustic_and_vocoder_paths_are_preserved(self):
        self.config.update(acoustic_model=str(self.directory / "acoustic.onnx"),
                           vocoder=str(self.directory / "vocoder.onnx"))
        result = self.load()
        self.assertEqual(result.model.matcha.acoustic_model, self.config["acoustic_model"])
        self.assertEqual(result.model.matcha.vocoder, self.config["vocoder"])

    def test_matcha_requires_explicit_model_selection(self):
        for key in ("model_dir", "acoustic_model", "vocoder"):
            with self.subTest(key=key):
                config = dict(self.config)
                config.pop(key)
                with self.assertRaisesRegex(ValueError, key):
                    self.load(config)

    def test_missing_model_vocoder_tokens_lexicon_and_rules_fail_before_inference(self):
        for name in ("acoustic.onnx", "vocoder.onnx", "tokens.txt", "lexicon.txt", "phone.fst"):
            with self.subTest(name=name):
                config = {**self.config, "rule_fsts": ["phone.fst"]}
                with patch.object(Path, "is_file", lambda path: path.name != name):
                    with self.assertRaisesRegex(RuntimeError, "file is missing"):
                        self.load(config)

    def test_malformed_rules_and_silence_are_rejected(self):
        for rules in ("phone.fst", None, ["phone.fst"] * 17, ["phone.fst", "phone.fst"], [""], [12]):
            with self.subTest(rules=rules), self.assertRaises(ValueError):
                self.load({**self.config, "rule_fsts": rules})
        for scale in (True, None, "1", -1, 3, float("nan"), float("inf")):
            with self.subTest(scale=scale), self.assertRaises(ValueError):
                self.load({**self.config, "silence_scale": scale})
        with patch.object(Path, "is_file", return_value=True):
            with self.assertRaisesRegex(ValueError, "commas"):
                self.load({**self.config, "rule_fsts": ["rule,unsafe.fst"]})

    def test_all_previous_backends_keep_model_mapping_and_sherpa_defaults(self):
        for backend, kind, name in (("kokoro", "kokoro", "model.onnx"),
                                    ("kokoro-int8", "kokoro", "model.int8.onnx"),
                                    ("melo", "vits", "model.onnx")):
            with self.subTest(backend=backend):
                config = {"backend": backend, "model_dir": str(self.directory)}
                result = self.load(config)
                self.assertEqual(getattr(result.model, kind).model, str(self.directory / name))
                self.assertFalse(hasattr(result, "silence_scale"), "do not change old Sherpa default 0.2")
                self.assertFalse(hasattr(result, "rule_fsts"))
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            self.load({"backend": "unknown"})

    def test_project_graph_and_schema_select_matcha_without_changing_pcm_contract(self):
        graph = json.loads((ROOT / "graph.json").read_text(encoding="utf-8"))
        config = next(node["node_config"] for node in graph["nodes"] if node["id"] == "local-tts")
        manifest = json.loads((ROOT / ".muxiva/nodes/local_tts/muxiva.node.json").read_text(encoding="utf-8"))
        schema = manifest["config_schema"]
        self.assertEqual((config["backend"], config["speaker_id"], config["num_threads"]), ("matcha", 0, 4))
        self.assertLessEqual(set(config), set(schema["properties"]))
        self.assertEqual(set(schema["properties"]["backend"]["enum"]), {"kokoro", "kokoro-int8", "melo", "matcha"})
        ports = {port["name"]: port for port in manifest["ports"]}
        self.assertEqual(set(ports), {"text_in", "signal_in", "audio_out", "event_out"})
        self.assertEqual(ports["audio_out"]["schema"], {"encoding":"pcm_s16le", "sample_rate_hz":24000, "channels":1, "streaming":True})


class MatchaWorkerTests(unittest.TestCase):
    def test_single_speaker_defaults_and_explicit_overrides(self):
        for backend, expected in (("matcha", 0), ("melo", 0), ("kokoro", 3), ("kokoro-int8", 3)):
            for override in (None, 2):
                with self.subTest(backend=backend, override=override):
                    speakers = []
                    class Recording(Model):
                        def generate(self, text, sid, speed, callback):
                            speakers.append(sid)
                            return super().generate(text, sid, speed, callback)
                    config = {"backend": backend}
                    if override is not None:
                        config["speaker_id"] = override
                    node, ctx = LocalTtsNode(config, model_factory=Recording), Context()
                    node.on_prepare()
                    try:
                        node.on_process(TextFrame("你好。", 7), ctx)
                        pump(node, ctx)
                        self.assertEqual(speakers, [expected if override is None else override])
                    finally:
                        node.on_finish()

    def test_matcha_native_chunks_flush_once_and_preserve_clock_across_fragments(self):
        class Native22k(Model):
            sample_rate = 22050
            def generate(self, text, sid, speed, callback):
                import numpy as np
                samples = np.full(2205, .2, dtype=np.float32)
                for part in (samples[:111], samples[111:888], samples[888:]):
                    callback(part, .5)
                return types.SimpleNamespace(samples=samples)
        node, ctx = LocalTtsNode({"backend":"matcha"}, model_factory=Native22k), Context()
        node.on_prepare()
        try:
            node.on_process(TextFrame("你好。", 123), ctx)
            node.on_process(TextFrame("再见。", 123), ctx)
            pump(node, ctx)
            frames = [frame for port, frame in ctx.emissions if port == "audio_out"]
            offset = 0
            for frame in frames:
                self.assertEqual((frame.sequence, frame.sample_rate_hz, frame.channels, frame.stream_id), (123, 24000, 1, "assistant"))
                self.assertEqual(frame.timestamp_ns, offset * 1_000_000_000 // 24000)
                self.assertLessEqual(len(frame.data), 960 * 2)
                offset += len(frame.data) // 2
            self.assertEqual(offset, 4800, "returned PCM must not duplicate callback PCM or resampler tail")
            completed = [frame for port, frame in ctx.emissions if getattr(frame, "topic", "") == "muxiva.voice.tts.segment.completed"]
            self.assertEqual([json.loads(frame.payload)["samples"] for frame in completed], [2400, 2400])
        finally:
            node.on_finish()

    def test_cancel_drops_native_resampler_tail_and_accepts_boundary_sequence(self):
        entered, release = threading.Event(), threading.Event()
        class Gated22k(Model):
            sample_rate = 22050
            calls = 0
            def generate(self, text, sid, speed, callback):
                import numpy as np
                samples = np.full(2205, .2, dtype=np.float32)
                self.calls += 1
                if self.calls == 1:
                    callback(samples[:111], .05)
                    entered.set()
                    release.wait(2)
                    callback(samples[111:], 1.0)
                else:
                    callback(samples, 1.0)
                return types.SimpleNamespace(samples=samples)
        node, ctx = LocalTtsNode({"backend":"matcha", "max_audio_chunks":8}, model_factory=Gated22k), Context()
        node.on_prepare()
        try:
            node.on_process(TextFrame("旧句。", 100), ctx)
            self.assertTrue(entered.wait(1))
            node.on_signal(types.SimpleNamespace(name="muxiva.turn.cancelled", payload='{"turn_id":200}', sequence=0), ctx)
            after_cancel = len(ctx.emissions)
            node.on_process(TextFrame("迟到旧句。", 199), ctx)
            node.on_process(TextFrame("新句。", 200), ctx)
            release.set()
            pump(node, ctx)
            audio = [frame for port, frame in ctx.emissions[after_cancel:] if port == "audio_out"]
            self.assertTrue(audio)
            self.assertTrue(all(frame.sequence == 200 for frame in audio))
            self.assertEqual(audio[0].timestamp_ns, 0)
            self.assertEqual(sum(len(frame.data) // 2 for frame in audio), 2400)
        finally:
            release.set()
            node.on_finish()

    def test_backend_neutral_prepare_failure_releases_worker(self):
        def fail():
            raise RuntimeError("model unavailable")
        node = LocalTtsNode({"backend":"matcha"}, model_factory=fail)
        with self.assertRaisesRegex(RuntimeError, "Local TTS initialization failed"):
            node.on_prepare()
        node.on_finish()
        self.assertFalse(node.worker.is_alive())


if __name__ == "__main__":
    unittest.main()
