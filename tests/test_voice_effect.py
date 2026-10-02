"""Real local DSP tests (no speech models or network); skip DSP if unavailable."""
import json
import shutil
import threading
import time
import types
import unittest
from unittest.mock import patch

from test_speech_nodes import Context, Model, TextFrame, pump
from muxiva_avatar_speech.synthesis import LocalTtsNode
from muxiva_avatar_speech.voice_effect import VoiceEffect, VoiceEffectStream


class VoiceEffectConfigTests(unittest.TestCase):
    def test_neutral_has_no_ffmpeg_dependency(self):
        for config in (None, {}, {"pitch_semitones": 0, "tempo": 1}):
            effect = VoiceEffect(config)
            with patch("shutil.which", side_effect=AssertionError("must bypass")):
                effect.prepare()
            self.assertFalse(effect.enabled)

    def test_invalid_configuration_is_not_silently_accepted(self):
        for config in ([], "2", {"filter": "anything"}, {"ffmpeg": ""},
                       *({key: value} for key in ("pitch_semitones", "tempo")
                         for value in (True, "1", float("nan"), float("inf"), -10, 10))):
            with self.subTest(config=config), self.assertRaises(ValueError):
                VoiceEffect(config)

    def test_dependency_error_is_explicit_before_model_loading(self):
        node = LocalTtsNode({"voice_effect": {"pitch_semitones": 2}}, model_factory=Model)
        with patch("shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "requires FFmpeg"):
                node.on_prepare()
        node.on_finish()


class VoiceEffectDSPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which("ffmpeg"):
            raise unittest.SkipTest("FFmpeg is not installed")
        cls.effect = VoiceEffect({"pitch_semitones": 2, "tempo": 1.04})
        try:
            cls.effect.prepare()
        except RuntimeError as error:
            raise unittest.SkipTest(str(error))

    def test_pitch_tempo_are_independent_streaming_and_tail_is_flushed(self):
        import numpy as np
        pcm = .15 * np.sin(2 * np.pi * 220 * np.arange(22050 * 4) / 22050)
        outputs, arrived = [], threading.Event()
        def emit(samples):
            outputs.append(samples.copy())
            arrived.set()
            return 1
        stream = self.effect.stream(22050, 24000, emit, lambda: True)
        try:
            for start in range(0, len(pcm) // 2, 777):
                stream.write(pcm[start:min(start + 777, len(pcm) // 2)])
            self.assertTrue(arrived.wait(2), "must emit before closing the segment input")
            for start in range(len(pcm) // 2, len(pcm), 777):
                stream.write(pcm[start:start + 777])
            stream.finish()
            output = np.concatenate(outputs)
            self.assertAlmostEqual(len(output) / 24000, 4 / 1.04, delta=.03)
            middle = output[24000:72000]
            bins = np.abs(np.fft.rfft(middle * np.hanning(len(middle))))
            peak = np.argmax(bins) * 24000 / len(middle)
            self.assertAlmostEqual(peak, 220 * 2 ** (2 / 12), delta=1)
        finally:
            stream.close()
        self.assertIsNotNone(stream.process.poll())
        self.assertFalse(stream.reader.is_alive())
        self.assertFalse(stream.watchdog.is_alive())

    def make_node(self, **config):
        class Native22k(Model):
            sample_rate = 22050
            def generate(self, text, sid, speed, callback):
                import numpy as np
                self.speed = speed
                samples = (.1 * np.sin(2 * np.pi * 220 * np.arange(44100) / 22050)).astype("float32")
                for start in range(0, len(samples), 999):
                    if not callback(samples[start:start + 999], .5):
                        break
                return types.SimpleNamespace(samples=samples)
        self.model = Native22k()
        return LocalTtsNode({"backend": "matcha", "voice_effect": {"pitch_semitones": 2, "tempo": 1.04}, **config}, model_factory=lambda: self.model)

    def test_node_frames_keep_actual_output_sample_clock_across_fragments(self):
        node, ctx = self.make_node(), Context()
        node.on_prepare()
        try:
            node.on_process(TextFrame("你好。", 7), ctx)
            node.on_process(TextFrame("再见。", 7), ctx)
            pump(node, ctx)
            self.assertEqual(node.pending, 0)
            self.assertEqual(self.model.speed, 1, "tempo must not be applied twice")
            frames = [frame for port, frame in ctx.emissions if port == "audio_out"]
            offset = 0
            for frame in frames:
                self.assertEqual((frame.sequence, frame.sample_rate_hz, frame.channels), (7, 24000, 1))
                self.assertEqual(frame.timestamp_ns, offset * 1_000_000_000 // 24000)
                self.assertLessEqual(len(frame.data), 1920)
                offset += len(frame.data) // 2
            self.assertAlmostEqual(offset / 24000, 4 / 1.04, delta=.04)
            done = [json.loads(frame.payload) for _, frame in ctx.emissions if getattr(frame, "topic", "").endswith("segment.completed")]
            self.assertEqual(sum(item["samples"] for item in done), offset)
            started = [json.loads(frame.payload) for _, frame in ctx.emissions if getattr(frame, "topic", "").endswith("tts.started")]
            self.assertEqual(len(started), 2)
            self.assertEqual(started[0]["voice_effect"], {"pitch_semitones": 2, "tempo": 1.04})
        finally:
            node.on_finish()

    def test_cancel_with_full_queue_drops_old_pcm_and_releases_process(self):
        node, ctx = self.make_node(max_audio_chunks=1), Context()
        node.on_prepare()
        try:
            node.on_process(TextFrame("旧句。", 10), ctx)
            deadline = time.monotonic() + 2
            while node.results.empty() and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertFalse(node.results.empty())
            node.on_signal(types.SimpleNamespace(name="muxiva.turn.cancelled", payload={"turn_id": 11}), ctx)
            after = len(ctx.emissions)
            node.on_process(TextFrame("新句。", 11), ctx)
            pump(node, ctx)
            frames = [frame for port, frame in ctx.emissions[after:] if port == "audio_out"]
            self.assertTrue(frames)
            self.assertTrue(all(frame.sequence == 11 for frame in frames))
            self.assertEqual(frames[0].timestamp_ns, 0)
        finally:
            node.on_finish()
        self.assertFalse(any(t.name.startswith("tts-voice-effect-") for t in threading.enumerate()))

    def test_finish_while_backpressured_stops_worker_and_owned_process(self):
        node, ctx = self.make_node(max_audio_chunks=1), Context()
        node.on_prepare()
        node.on_process(TextFrame("你好。", 1), ctx)
        deadline = time.monotonic() + 2
        while node.results.empty() and time.monotonic() < deadline:
            time.sleep(.01)
        node.on_finish()
        self.assertFalse(node.worker.is_alive())
        self.assertFalse(any(t.name.startswith("tts-voice-effect-") for t in threading.enumerate()))

    def test_stalled_fragment_is_bounded_and_process_reaped(self):
        stream = self.effect.stream(22050, 24000, lambda _: 1, lambda: True)
        stream.TIMEOUT = .05
        try:
            time.sleep(.15)
            with self.assertRaisesRegex(RuntimeError, "deadline"):
                stream.finish()
        finally:
            stream.close()
        self.assertIsNotNone(stream.process.poll())


if __name__ == "__main__":
    unittest.main()
