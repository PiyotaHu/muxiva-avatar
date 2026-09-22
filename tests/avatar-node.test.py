import importlib.util
import json
import pathlib
import struct
import sys
import types
import unittest


class EventFrame:
    def __init__(self, topic, payload, **kwargs):
        self.topic, self.payload = topic, payload
        self.__dict__.update(kwargs)


sys.modules['muxiva'] = types.SimpleNamespace(EventFrame=EventFrame)
spec = importlib.util.spec_from_file_location('avatar_node', pathlib.Path(__file__).resolve().parents[1] / '.muxiva/nodes/avatar_animation/node.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Context:
    input_port = 'audio_in'

    def __init__(self):
        self.events = []
        self.tick = None

    def emit(self, port, frame):
        self.events.append((port, frame.topic, json.loads(frame.payload)))

    def schedule_next_tick(self, value):
        self.tick = value


def audio(values, sequence=1, rate=24000, channels=1, timestamp_ns=None):
    frame = types.SimpleNamespace(data=struct.pack('<' + 'h' * len(values), *values), sequence=sequence, sample_rate_hz=rate, channels=channels)
    if timestamp_ns is not None:
        frame.timestamp_ns = timestamp_ns
    return frame


class AvatarNodeTests(unittest.TestCase):
    def test_sample_offsets_are_per_sequence_not_frame_number(self):
        node, ctx = module.AvatarAnimationNode(), Context()
        node.on_process(audio([3000] * 480), ctx)
        node.on_process(audio([3000] * 240), ctx)
        node.on_process(audio([3000] * 120, sequence=2), ctx)
        payloads = [event[2] for event in ctx.events]
        self.assertEqual([p['sample_start'] for p in payloads], [0, 480, 0])
        self.assertEqual([p['sample_count'] for p in payloads], [480, 240, 120])
        self.assertEqual(payloads[1]['keyframes'][0]['sample_offset'], 480)

    def test_stereo_is_counted_in_sample_frames(self):
        node, ctx = module.AvatarAnimationNode(), Context()
        node.on_process(audio([3000, 3000] * 480, channels=2), ctx)
        self.assertEqual(ctx.events[-1][2]['sample_count'], 480)
        self.assertEqual(len(ctx.events[-1][2]['keyframes']), 1)

    def test_silence_and_loudness_are_bounded(self):
        node, ctx = module.AvatarAnimationNode(), Context()
        node.on_process(audio([0] * 480 + [32767] * 480), ctx)
        self.assertEqual([k['mouth_open'] for k in ctx.events[-1][2]['keyframes']], [0, 1])

    def test_cancel_drops_late_pcm_and_preserves_new_sequence(self):
        node, ctx = module.AvatarAnimationNode(), Context()
        node.on_process(audio([3000] * 480), ctx)
        node.on_signal(types.SimpleNamespace(name='muxiva.playback.cancelled', sequence=2), ctx)
        self.assertEqual(ctx.tick, 1)
        node.on_process(None, ctx)
        self.assertEqual(ctx.events[-1][1], 'muxiva.avatar.reset')
        self.assertEqual(ctx.events[-1][2]['before_sequence'], 2)
        count = len(ctx.events)
        node.on_process(audio([3000] * 480), ctx)
        self.assertEqual(len(ctx.events), count)
        node.on_process(audio([3000] * 480, sequence=2), ctx)
        self.assertEqual(ctx.events[-1][2]['sample_start'], 0)

    def test_cancellation_signal_name_is_configuration(self):
        node, ctx = module.AvatarAnimationNode({'cancel_signal_names': ['app.cancel']}), Context()
        node.on_signal(types.SimpleNamespace(name='muxiva.turn.cancelled', sequence=2), ctx)
        self.assertIsNone(ctx.tick)
        node.on_signal(types.SimpleNamespace(name='app.cancel', sequence=2), ctx)
        self.assertEqual(ctx.tick, 1)

    def test_cancel_preserves_already_arrived_new_generation_offsets(self):
        node, ctx = module.AvatarAnimationNode(), Context()
        node.on_process(audio([3000] * 480, sequence=2), ctx)
        node.on_signal(types.SimpleNamespace(name='muxiva.playback.cancelled', sequence=2), ctx)
        node.on_process(audio([3000] * 240, sequence=2), ctx)
        self.assertEqual(ctx.events[-1][2]['sample_start'], 480)
        # A duplicate and then stale signal cannot reopen older generation 1.
        node.on_signal(types.SimpleNamespace(name='muxiva.playback.cancelled', sequence=2), ctx)
        node.on_process(None, ctx)
        count = len(ctx.events)
        node.on_signal(types.SimpleNamespace(name='muxiva.playback.cancelled', sequence=1), ctx)
        node.on_process(audio([3000] * 480, sequence=1), ctx)
        self.assertEqual(len(ctx.events), count)

    def test_chunk_tail_offsets_have_no_rounding_gap(self):
        node, ctx = module.AvatarAnimationNode(), Context()
        node.on_process(audio([3000] * 501, rate=22050), ctx)
        node.on_process(audio([3000] * 600, rate=22050), ctx)
        keys = [key for event in ctx.events for key in event[2]['keyframes']]
        self.assertEqual(keys[0]['sample_offset'], 0)
        for previous, following in zip(keys, keys[1:]):
            self.assertEqual(previous['sample_offset'] + previous['sample_count'], following['sample_offset'])
        self.assertEqual(keys[-1]['sample_offset'] + keys[-1]['sample_count'], 1101)

    def test_zero_sequence_and_stereo_antiphase(self):
        node, ctx = module.AvatarAnimationNode(), Context()
        node.on_process(audio([3000, -3000] * 480, sequence=0, channels=2), ctx)
        self.assertEqual(ctx.events[-1][2]['sequence'], 0)
        self.assertEqual(ctx.events[-1][2]['keyframes'][0]['mouth_open'], 0)

    def test_invalid_pcm_and_rate_changes_are_rejected(self):
        node, ctx = module.AvatarAnimationNode(), Context()
        bad = audio([3])
        bad.data = b'\0'
        with self.assertRaises(ValueError):
            node.on_process(bad, ctx)
        node.on_process(audio([3000] * 480), ctx)
        with self.assertRaises(ValueError):
            node.on_process(audio([3000] * 320, rate=16000), ctx)

    def test_dropped_middle_pcm_keeps_original_playback_position(self):
        node, ctx = module.AvatarAnimationNode(), Context()
        node.on_process(audio([3000] * 480, timestamp_ns=0), ctx)
        # The lossy avatar branch omitted samples [480, 960). Audio playback
        # still contains that chunk; following cues must start at sample 960.
        node.on_process(audio([3000] * 480, timestamp_ns=40_000_000), ctx)
        node.on_process(audio([3000] * 480, timestamp_ns=60_000_000), ctx)
        self.assertEqual([event[2]['sample_start'] for event in ctx.events], [0, 960, 1440])
        self.assertEqual(ctx.events[1][2]['keyframes'][0]['sample_offset'], 960)

    def test_dropped_first_pcm_starts_at_nonzero_media_position(self):
        node, ctx = module.AvatarAnimationNode(), Context()
        node.on_process(audio([3000] * 480, timestamp_ns=80_000_000), ctx)
        self.assertEqual(ctx.events[-1][2]['sample_start'], 1920)

    def test_legacy_host_with_all_zero_timestamps_stays_contiguous(self):
        node, ctx = module.AvatarAnimationNode(), Context()
        for _ in range(3):
            node.on_process(audio([3000] * 480, timestamp_ns=0), ctx)
        self.assertEqual([event[2]['sample_start'] for event in ctx.events], [0, 480, 960])

    def test_timestamp_roundtrip_at_nonintegral_nanosecond_sample_rate(self):
        node, ctx = module.AvatarAnimationNode(), Context()
        for offset in (501, 1002, 2505):
            timestamp_ns = offset * 1_000_000_000 // 22050
            node.on_process(audio([3000] * 501, rate=22050, timestamp_ns=timestamp_ns), ctx)
        self.assertEqual([event[2]['sample_start'] for event in ctx.events], [501, 1002, 2505])

    def test_timestamped_old_pcm_does_not_rewind_and_new_sequence_can_start_at_zero(self):
        node, ctx = module.AvatarAnimationNode(), Context()
        node.on_process(audio([3000] * 480, timestamp_ns=20_000_000), ctx)
        node.on_process(audio([3000] * 480, timestamp_ns=0), ctx)
        node.on_process(audio([3000] * 480, timestamp_ns=20_000_000), ctx)
        self.assertEqual(len(ctx.events), 1)
        node.on_process(audio([3000] * 480, sequence=2, timestamp_ns=0), ctx)
        self.assertEqual(ctx.events[-1][2]['sample_start'], 0)

    def test_thirty_second_frame_is_bounded_and_retains_exact_sample_end(self):
        node, ctx = module.AvatarAnimationNode(), Context()
        frame = types.SimpleNamespace(data=b'\0\0' * 720000, sequence=1,
            sample_rate_hz=24000, channels=1, timestamp_ns=0)
        node.on_process(frame, ctx)
        payload = ctx.events[-1][2]
        self.assertEqual(len(payload['keyframes']), 1500)
        last = payload['keyframes'][-1]
        self.assertEqual(last['sample_offset'] + last['sample_count'], 720000)
        self.assertLess(len(json.dumps(payload)), 128 * 1024)


if __name__ == '__main__':
    unittest.main()
