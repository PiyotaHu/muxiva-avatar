"""Lifecycle/sequence regression tests; real-model coverage lives in benchmark-speech.py."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import threading
import time
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))


class TextFrame:
    def __init__(self, text, sequence=0):
        self.text, self.sequence = text, sequence


class AudioFrame:
    def __init__(self, data, sample_rate_hz, channels=1, sequence=0):
        self.data, self.sample_rate_hz, self.channels, self.sequence = data, sample_rate_hz, channels, sequence


class EventFrame:
    def __init__(self, topic, payload="", sequence=0, **kwargs):
        self.topic, self.payload, self.sequence = topic, payload, sequence


sys.modules["muxiva"] = types.SimpleNamespace(TextFrame=TextFrame, AudioFrame=AudioFrame, EventFrame=EventFrame)
from muxiva_avatar_speech.synthesis import LocalTtsNode
from muxiva_avatar_speech.recognition import LocalSpeechNode


class Context:
    def __init__(self):
        self.thread = threading.get_ident()
        self.emissions = []
        self.signals = []
        self.tick = None

    def emit(self, port, frame):
        assert threading.get_ident() == self.thread, "worker must not invoke NodeContext"
        self.emissions.append((port, frame))

    def schedule_next_tick(self, delay):
        self.tick = delay

    def emit_signal(self, *args):
        self.signals.append(args)

    def publish_notification(self, *args): pass
    def increment_counter(self, *args): pass
    def set_gauge(self, *args): pass


class Model:
    sample_rate = 24000

    def generate(self, text, sid, speed, callback):
        import numpy as np
        samples = np.zeros(960, dtype=np.float32)
        callback(samples, 1.0)
        return types.SimpleNamespace(samples=samples)


def pump(node, ctx):
    deadline = time.monotonic() + 3
    while node.pending or not node.results.empty():
        node.on_process(None, ctx)
        if time.monotonic() > deadline:
            raise AssertionError("worker did not drain")
        time.sleep(0.002)


class SpeechNodeTests(unittest.TestCase):
    def test_preview_never_makes_an_interruption_decision(self):
        node, ctx = LocalSpeechNode(), Context()
        node._preview(ctx, 15, "嗯嗯")
        node._preview(ctx, 15, "帮我查一下天气")
        self.assertEqual(ctx.signals, [])
        self.assertEqual([f.sequence for p,f in ctx.emissions if p == "transcript_preview_out"], [15,15])

    def test_asr_quality_gate_accepts_single_word_but_rejects_non_speech(self):
        node = LocalSpeechNode()
        self.assertIsNone(node._final_rejection(types.SimpleNamespace(lang="zh", event="speech"), "好"))
        self.assertEqual(node._final_rejection(types.SimpleNamespace(lang="zh", event="music"), "你好"), "non_speech_event")

    def test_two_text_fragments_preserve_response_clock(self):
        node, ctx = LocalTtsNode(model_factory=Model), Context()
        node.on_prepare()
        try:
            node.on_process(TextFrame("你好。", 10), ctx)
            node.on_process(TextFrame("再见。", 10), ctx)
            pump(node, ctx)
            frames = [frame for port,frame in ctx.emissions if port == "audio_out"]
            self.assertEqual([f.sequence for f in frames], [10,10])
            self.assertEqual([f.timestamp_ns for f in frames], [0,40_000_000])
            self.assertTrue(all(f.stream_id == "assistant" for f in frames))
            self.assertTrue(all(f.clock_domain == {"id":"assistant.audio", "kind":"media_relative"} for f in frames))
        finally:
            node.on_finish()

    def test_tts_model_receives_normalized_enumerations_pauses_and_temperature_units(self):
        spoken = []
        class RecordingModel(Model):
            def generate(self, text, sid, speed, callback):
                spoken.append(text)
                return super().generate(text, sid, speed, callback)
        node, ctx = LocalTtsNode(model_factory=RecordingModel), Context()
        originals = [
            "从1数到5：1，2，3，4，5。",
            "今天25℃，明天26°C；室内77℉。",
        ]
        frames = [TextFrame(text, 10) for text in originals]
        node.on_prepare()
        try:
            for frame in frames:
                node.on_process(frame, ctx)
            pump(node, ctx)
            self.assertEqual(spoken, [
                "从一数到五：一，二，三，四，五。",
                "今天二十五摄氏度，明天二十六摄氏度；室内七十七华氏度。",
            ])
            self.assertEqual([frame.text for frame in frames], originals,
                             "speech normalization must not mutate displayed TextFrames")
            audio = [frame for port, frame in ctx.emissions if port == "audio_out"]
            self.assertEqual([frame.timestamp_ns for frame in audio], [0, 40_000_000])
            self.assertEqual([frame.sequence for frame in audio], [10, 10])
        finally:
            node.on_finish()

    def test_cancel_payload_boundary_rejects_late_audio_and_old_text(self):
        entered, release = threading.Event(), threading.Event()
        class SlowFirst(Model):
            calls = 0
            def generate(self, text, sid, speed, callback):
                self.calls += 1
                if self.calls == 1:
                    entered.set()
                    release.wait(2)
                return super().generate(text, sid, speed, callback)
        node, ctx = LocalTtsNode(model_factory=SlowFirst), Context()
        node.on_prepare()
        try:
            node.on_process(TextFrame("旧回答。", 100), ctx)
            self.assertTrue(entered.wait(1))
            node.on_signal(types.SimpleNamespace(name="muxiva.turn.cancelled", payload=json.dumps({"turn_id":200}), sequence=0), ctx)
            node.on_process(TextFrame("迟到的旧回答。", 150), ctx)
            node.on_process(TextFrame("新回答。", 200), ctx)
            release.set()
            pump(node, ctx)
            frames = [frame for port,frame in ctx.emissions if port == "audio_out"]
            self.assertTrue(frames)
            self.assertTrue(all(frame.sequence == 200 for frame in frames))
        finally:
            release.set()
            node.on_finish()

    def test_cancellation_unblocks_full_audio_queue(self):
        class LongModel(Model):
            def generate(self, text, sid, speed, callback):
                import numpy as np
                samples = np.zeros(960 * 1000, dtype=np.float32)
                callback(samples, 1.0)
                return types.SimpleNamespace(samples=samples)
        node, ctx = LocalTtsNode({"max_audio_chunks":8}, model_factory=LongModel), Context()
        node.on_prepare()
        node.on_process(TextFrame("很长的回答。", 100), ctx)
        deadline = time.monotonic() + 1
        while node.results.qsize() < 8 and time.monotonic() < deadline:
            time.sleep(0.005)
        self.assertLessEqual(node.results.qsize(), 8)
        node.on_signal(types.SimpleNamespace(name="muxiva.turn.cancelled", payload={"turn_id":101}, sequence=0), ctx)
        node.on_finish()
        self.assertFalse(node.worker.is_alive())

    def test_resampler_flush_does_not_duplicate_short_native_audio(self):
        class Native44k(Model):
            sample_rate = 44100
            def generate(self, text, sid, speed, callback):
                import numpy as np
                samples = np.zeros(441, dtype=np.float32)
                callback(samples, 1.0)
                return types.SimpleNamespace(samples=samples)
        node, ctx = LocalTtsNode(model_factory=Native44k), Context()
        node.on_prepare()
        try:
            node.on_process(TextFrame("好。", 10), ctx)
            pump(node, ctx)
            samples = sum(len(frame.data)//2 for port,frame in ctx.emissions if port == "audio_out")
            self.assertEqual(samples, 240)
        finally:
            node.on_finish()


if __name__ == "__main__":
    unittest.main()
