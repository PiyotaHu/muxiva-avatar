"""PCM-to-animation transform. Playback timing is owned by the audio consumer.

This node emits an RMS mouth-opening envelope, not recognized phonemes. Sequence
identifies an output generation; sample offsets identify positions within it.
"""

from __future__ import annotations

import array
import json
import math
import sys

import muxiva


class AvatarAnimationNode:
    def __init__(self, config=None):
        self.config = config or {}
        self.stream_id = str(self.config.get("stream_id", "assistant"))
        self.window_ms = int(self.config.get("window_ms", 20))
        self.floor_db = float(self.config.get("floor_db", -48))
        self.ceiling_db = float(self.config.get("ceiling_db", -15))
        self.cancel_names = set(self.config.get("cancel_signal_names", ["muxiva.playback.cancelled"]))
        if not 5 <= self.window_ms <= 100:
            raise ValueError("window_ms must be between 5 and 100")
        if not self.floor_db < self.ceiling_db <= 0:
            raise ValueError("require floor_db < ceiling_db <= 0")
        self._sequence = None
        self._sample_offset = 0
        self._rate = None
        self._timestamped = False
        self._cancel_before = 0
        self._pending_reset = None

    def _emit(self, ctx, topic, payload, sequence):
        ctx.emit("event_out", muxiva.EventFrame(
            topic, json.dumps(payload, separators=(",", ":")),
            source="avatar.animation", sequence=sequence,
        ))

    def _flush_reset(self, ctx):
        if self._pending_reset is None:
            return
        sequence = self._pending_reset
        self._pending_reset = None
        self._emit(ctx, "muxiva.avatar.reset", {
            "schema_version": 1,
            "stream_id": self.stream_id,
            "before_sequence": sequence,
        }, sequence)

    def on_process(self, frame, ctx):
        self._flush_reset(ctx)
        if frame is None:
            return
        if getattr(ctx, "input_port", "audio_in") == "signal_in":
            self.on_signal(frame, ctx)
            self._flush_reset(ctx)
            return
        sequence = int(frame.sequence)
        if sequence < self._cancel_before:
            return
        if self._sequence is not None and sequence < self._sequence:
            return
        rate = int(frame.sample_rate_hz)
        channels = int(frame.channels)
        data = bytes(frame.data)
        if not 8000 <= rate <= 192000 or not 1 <= channels <= 8:
            raise ValueError("unsupported PCM rate or channel count")
        if len(data) % (2 * channels):
            raise ValueError("PCM S16LE frame must contain complete channel samples")
        if len(data) > rate * channels * 2 * 30:
            raise ValueError("PCM frame exceeds 30-second bounded analysis limit")
        if not data:
            return
        if sequence != self._sequence:
            self._sequence, self._sample_offset, self._rate = sequence, 0, rate
            self._timestamped = False
        elif rate != self._rate:
            raise ValueError("sample rate may change only at a new sequence")
        # TTS timestamps are media positions relative to the sequence's start.
        # A lossy presentation edge may omit entire PCM chunks; counting only
        # received samples would shift every subsequent mouth cue earlier.
        # Older Hosts expose no timestamp (or default every frame to zero), so
        # keep contiguous counting until a real nonzero timestamp is observed.
        timestamp_ns = int(getattr(frame, "timestamp_ns", 0) or 0)
        if timestamp_ns < 0:
            raise ValueError("PCM media timestamp must be nonnegative")
        if timestamp_ns > 0 or self._timestamped:
            self._timestamped = True
            # TTS converts integer samples to integer nanoseconds. Round back
            # to the nearest sample rather than floor, which would lose one
            # sample at rates such as 22.05 kHz and 44.1 kHz.
            sample_start = (timestamp_ns * rate + 500_000_000) // 1_000_000_000
            if sample_start < self._sample_offset:
                return  # Duplicate or delayed older PCM cannot rewind cues.
            self._sample_offset = sample_start
        samples = array.array("h")
        samples.frombytes(data)
        if sys.byteorder != "little":
            samples.byteswap()
        count = len(samples) // channels
        window = max(1, round(rate * self.window_ms / 1000))
        keyframes = []
        for start in range(0, count, window):
            length = min(window, count - start)
            energy = 0.0
            for offset in range(start, start + length):
                # Match mono playback downmix; do not treat each stereo sample
                # as an additional instant on the playback clock.
                value = sum(samples[offset * channels:(offset + 1) * channels]) / (channels * 32768)
                energy += value * value
            rms = math.sqrt(energy / length)
            db = 20 * math.log10(max(rms, 1e-8))
            opening = max(0.0, min(1.0, (db - self.floor_db) / (self.ceiling_db - self.floor_db)))
            keyframes.append({
                "sample_offset": self._sample_offset + start,
                "sample_count": length,
                "mouth_open": round(opening, 4),
            })
        payload = {
            "schema_version": 1,
            "stream_id": self.stream_id,
            "sequence": sequence,
            "sample_rate_hz": rate,
            "sample_start": self._sample_offset,
            "sample_count": count,
            "method": "rms_envelope",
            "keyframes": keyframes,
        }
        self._sample_offset += count
        self._emit(ctx, "muxiva.avatar.animation", payload, sequence)

    def on_signal(self, signal, ctx):
        if getattr(signal, "name", "") not in self.cancel_names:
            return
        sequence = int(signal.sequence)
        if sequence < self._cancel_before:
            return
        self._cancel_before = sequence
        if self._sequence is not None and self._sequence < sequence:
            self._sequence, self._sample_offset, self._rate = None, 0, None
            self._timestamped = False
        # The current Python Host does not return port emissions from signal
        # callbacks. Use its normal wakeup mechanism, not an ad-hoc transport.
        self._pending_reset = sequence
        ctx.schedule_next_tick(1)

    def on_finish(self, ctx=None):
        self._sequence, self._sample_offset, self._rate = None, 0, None
        self._timestamped = False
        self._pending_reset = None

    def on_abort(self, reason, ctx=None):
        self.on_finish(ctx)
