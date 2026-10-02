"""Pure fake/guard tests: no Sherpa model, no child model process or audio device."""
from __future__ import annotations
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("light_tts_benchmark", Path(__file__).resolve().parents[1] / "scripts/benchmark-light-tts.py")
BENCH = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BENCH
SPEC.loader.exec_module(BENCH)


class FakeModel:
    def __init__(self, chunks):
        self.chunks = chunks
        self.returns = []

    def generate(self, text, config, callback):
        for samples in self.chunks:
            self.returns.append(callback(samples, .5))
        return SimpleNamespace(samples=[.1] * 20, sample_rate=10)


class LightTtsTests(unittest.TestCase):
    def test_json_output_survives_ascii_or_legacy_gbk_console_without_text_loss(self):
        import json
        received = []
        stream = SimpleNamespace(write=lambda value: received.append(value.encode("ascii")), flush=lambda: None)
        original = {"text": "别着急，你好吗？", "diagnostic": "\ufffd"}
        self.assertTrue(BENCH.print_json(original, stream=stream))
        self.assertEqual(json.loads(received[0].decode("ascii")), original)

    def test_console_write_failure_cannot_abort_watchdog_cleanup(self):
        for error in [BrokenPipeError("closed"), UnicodeEncodeError("gbk", "\ufffd", 0, 1, "unrepresentable")]:
            def fail(_line):
                raise error
            stream = SimpleNamespace(write=fail, flush=lambda: None)
            self.assertFalse(BENCH.print_json({"status": "stopped"}, stream=stream))

    def test_import_has_no_heavy_runtime_import(self):
        # This module is intentionally runnable in a stdlib-only interpreter.
        self.assertNotIn("sherpa_onnx", BENCH.__dict__)
        self.assertNotIn("numpy", BENCH.__dict__)

    def test_first_nonempty_callback_measures_native_pcm_not_empty_progress(self):
        times = iter([10.0, 10.25, 11.0])
        model = FakeModel([[], [.1, .2], [.3]])
        notices = []
        audio, row = BENCH.generate_measured(model, "test", object(), clock=lambda: next(times), on_first=notices.append)
        self.assertEqual(row["first_pcm_ms"], 250)
        self.assertEqual(row["generation_ms"], 1000)
        self.assertEqual(row["rtf"], .5)
        self.assertEqual(row["first_pcm_mode"], "callback")
        self.assertEqual(row["callback_count"], 2)
        self.assertEqual(row["callback_samples"], 3)
        self.assertEqual(notices, [250])
        self.assertEqual(model.returns, [1, 1, 1], "native callback contract must continue")

    def test_complete_return_is_explicitly_not_streaming_first_audio(self):
        times = iter([10., 12.])
        _, row = BENCH.generate_measured(FakeModel([]), "test", object(), clock=lambda: next(times))
        self.assertEqual(row["first_pcm_ms"], 2000)
        self.assertEqual(row["first_pcm_mode"], "whole_return")
        self.assertEqual(row["callback_count"], 0)
        self.assertIn("no nonempty callback", row["first_pcm_definition"])

    def test_empty_audio_fails(self):
        model = SimpleNamespace(generate=lambda *args, **kwargs: SimpleNamespace(samples=[], sample_rate=24000))
        with self.assertRaisesRegex(RuntimeError, "empty audio"):
            BENCH.generate_measured(model, "test", object())

    def test_sustained_low_memory_kills_only_after_half_a_second(self):
        guard = BENCH.MemoryGuard()
        low = 799 * BENCH.MIB
        self.assertIsNone(guard.check(1., low, 0, 60))
        self.assertIsNone(guard.check(1.49, low, 0, 60))
        self.assertIn("500 ms", guard.check(1.5, low, 0, 60))

    def test_memory_recovery_resets_sustained_pressure_clock(self):
        guard = BENCH.MemoryGuard()
        guard.check(1., 1, 0, 60)
        self.assertIsNone(guard.check(1.4, 800 * BENCH.MIB, 0, 60))
        self.assertIsNone(guard.check(1.5, 1, 0, 60))
        self.assertIsNone(guard.check(1.9, 1, 0, 60))
        self.assertIsNotNone(guard.check(2., 1, 0, 60))

    def test_timeout_is_independent_of_callback_or_ram(self):
        guard = BENCH.MemoryGuard()
        self.assertIsNone(guard.check(59.99, 3 * BENCH.GIB, 0, 60))
        self.assertIn("time limit", guard.check(60, 3 * BENCH.GIB, 0, 60))
        self.assertIsNone(guard.check(60, 3 * BENCH.GIB, 60, 60))

    def test_start_thresholds_leave_desktop_headroom(self):
        self.assertEqual(BENCH.minimum_available("zipvoice-int8"), 2 * BENCH.GIB)
        self.assertEqual(BENCH.minimum_available("matcha"), 1.5 * BENCH.GIB)
        self.assertEqual(BENCH.minimum_available("kokoro"), 1.5 * BENCH.GIB)
        self.assertEqual(BENCH.minimum_available("vits"), 1.5 * BENCH.GIB)

    def test_vits_requires_model_but_no_external_vocoder(self):
        base = ["--backend", "vits", "--model-dir", "missing"]
        with patch("sys.stderr"), self.assertRaises(SystemExit):
            BENCH.parse_args(base)
        args = BENCH.parse_args(base + ["--acoustic-model", "voice.onnx", "--speaker-id", "193"])
        self.assertIsNone(args.vocoder)
        self.assertEqual(args.speaker_id, 193)
        fake_sherpa = SimpleNamespace(OfflineTtsVitsModelConfig=SimpleNamespace,
                                     OfflineTtsModelConfig=SimpleNamespace,
                                     OfflineTtsConfig=SimpleNamespace)
        with patch.object(BENCH, "require_file", side_effect=lambda path: str(path)):
            config = BENCH.build_config(fake_sherpa, args)
        self.assertEqual(config.model.vits.model, "voice.onnx")
        self.assertEqual(config.model.vits.dict_dir, str(args.model_dir.resolve() / "dict"))
        self.assertEqual(config.model.provider, "cpu")
        self.assertEqual(config.rule_fsts, "")
        self.assertFalse(hasattr(config.model, "matcha"))

    def test_stop_targets_only_given_child(self):
        calls = []
        child = SimpleNamespace(poll=lambda: None, terminate=lambda: calls.append("terminate"),
                                wait=lambda timeout: calls.append(("wait", timeout)), kill=lambda: calls.append("kill"))
        BENCH.stop_own_child(child)
        self.assertEqual(calls, ["terminate", ("wait", 2)])

    def test_stopped_child_is_left_alone(self):
        BENCH.stop_own_child(SimpleNamespace(poll=lambda: 0))

    def test_cli_rejects_unsafe_cases_and_missing_reference(self):
        base = ["--backend", "kokoro", "--model-dir", ".models/kokoro-multi-lang-v1_1"]
        with patch("sys.stderr"):
            for more in (["--timeout", "61"], ["--text", "x" * 181], ["--speed", "nan"], ["--output-dir", str(BENCH.ROOT)]):
                with self.assertRaises(SystemExit): BENCH.parse_args(base + more)
            with self.assertRaises(SystemExit):
                BENCH.parse_args(["--backend", "zipvoice-int8", "--model-dir", "missing", "--vocoder", "missing"])
            with self.assertRaises(SystemExit):
                BENCH.parse_args(["--backend", "matcha", "--model-dir", "missing", "--vocoder", "missing"])
        args = BENCH.parse_args(base)
        self.assertEqual(args.num_threads, 4)
        self.assertEqual(args.timeout, 60)
        self.assertEqual(args.repeat, 1)
        self.assertFalse(args.worker)
        self.assertEqual(len(args.texts), 5)
        self.assertEqual(BENCH.parse_args(base + ["--text", "测试"]).texts, ["测试"])
        self.assertEqual(BENCH.parse_args(base + ["--text", "一", "--text", "二"]).texts, ["一", "二"])

    def test_json_cases_are_bounded_and_preserve_identical_input(self):
        base = ["--backend", "kokoro", "--model-dir", "missing", "--cases", "cases.json"]
        with patch.object(Path, "is_file", return_value=True), patch.object(Path, "stat", return_value=SimpleNamespace(st_size=40)), patch.object(Path, "read_text", return_value='["你好。", "今天怎么样？"]'):
            self.assertEqual(BENCH.parse_args(base).texts, ["你好。", "今天怎么样？"])
        with patch("sys.stderr"), patch.object(Path, "is_file", return_value=True), patch.object(Path, "stat", return_value=SimpleNamespace(st_size=40)), patch.object(Path, "read_text", return_value='["text", 3]'):
            with self.assertRaises(SystemExit): BENCH.parse_args(base)

    def test_low_start_memory_never_spawns_a_child(self):
        from unittest.mock import MagicMock
        args = BENCH.parse_args(["--backend", "kokoro", "--model-dir", "missing"])
        args.output_dir = MagicMock()
        args.output_dir.__truediv__.return_value.exists.return_value = False
        args.output_dir.glob.return_value = []
        with patch.object(BENCH.subprocess, "Popen") as spawn, patch.object(BENCH, "print_json"):
            result = BENCH.run_guarded(args, memory=SimpleNamespace(available=lambda: BENCH.GIB))
        self.assertEqual(result, 3)
        spawn.assert_not_called()


if __name__ == "__main__":
    unittest.main()
