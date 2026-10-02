"""Optional local pitch/tempo DSP; one continuous Rubber Band stream per fragment.

No model, avatar, or host-context ownership. Pipes and the existing node queue
provide backpressure; a watchdog also releases blocked writes on cancellation.
"""
from __future__ import annotations

import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time


class VoiceEffect:
    def __init__(self, config=None):
        config = {} if config is None else config
        if not isinstance(config, dict) or set(config) - {"pitch_semitones", "tempo", "ffmpeg"}:
            raise ValueError("voice_effect must contain only pitch_semitones, tempo, ffmpeg")
        self.pitch = self._number(config, "pitch_semitones", 0, -6, 6)
        self.tempo = self._number(config, "tempo", 1, .75, 1.5)
        self.executable = config.get("ffmpeg", os.environ.get("MUXIVA_FFMPEG", "ffmpeg"))
        if not isinstance(self.executable, str) or not self.executable.strip():
            raise ValueError("voice_effect.ffmpeg must be an executable path or command name")

    @staticmethod
    def _number(config, key, default, low, high):
        value = config.get(key, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"voice_effect.{key} must be finite and between {low} and {high}")
        return float(value)

    @property
    def enabled(self):
        return self.pitch != 0 or self.tempo != 1

    @property
    def settings(self):
        return {"pitch_semitones": self.pitch, "tempo": self.tempo}

    def prepare(self):
        if not self.enabled:
            return
        executable = shutil.which(self.executable)
        if not executable:
            raise RuntimeError("Voice tuning requires FFmpeg with rubberband; set PATH, MUXIVA_FFMPEG or voice_effect.ffmpeg")
        self.executable = executable
        result = subprocess.run([executable, "-hide_banner", "-filters"], capture_output=True,
                                timeout=10, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode or not re.search(rb"\brubberband\s+", result.stdout):
            raise RuntimeError("Configured FFmpeg does not provide the rubberband audio filter")

    def stream(self, native_rate, output_rate, emit, active):
        return VoiceEffectStream(self, native_rate, output_rate, emit, active)


class VoiceEffectStream:
    """Float32 mono input/output. Only emit's owner may call NodeContext."""
    TIMEOUT = 60

    def __init__(self, effect, native_rate, output_rate, emit, active):
        self.is_current, self.emit = active, emit
        self.aborted = threading.Event()
        self.active = lambda: self.is_current() and not self.aborted.is_set()
        self.error = None
        self.stopped = threading.Event()
        self.stderr = tempfile.TemporaryFile()
        self.started = time.monotonic()
        command = [effect.executable, "-hide_banner", "-loglevel", "error", "-nostdin",
                   "-f", "f32le", "-ar", str(native_rate), "-ac", "1",
                   "-probesize", "32", "-analyzeduration", "0", "-blocksize", "4096", "-i", "pipe:0",
                   "-af", f"rubberband=pitch={2 ** (effect.pitch / 12):.12f}:tempo={effect.tempo:.12f}",
                   "-ar", str(output_rate), "-ac", "1", "-f", "f32le", "-flush_packets", "1", "pipe:1"]
        try:
            self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                            stderr=self.stderr, bufsize=0,
                                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except Exception:
            self.stderr.close()
            raise
        self.reader = threading.Thread(target=self._read, name="tts-voice-effect-reader", daemon=True)
        self.watchdog = threading.Thread(target=self._watch, name="tts-voice-effect-watchdog", daemon=True)
        self.reader.start()
        self.watchdog.start()

    def _kill(self):
        try:
            if self.process.poll() is None:
                self.process.kill()
        except ProcessLookupError:
            pass

    def _watch(self):
        while not self.stopped.wait(.02):
            if not self.active():
                self._kill()
                return
            if time.monotonic() - self.started > self.TIMEOUT:
                self.error = RuntimeError("Voice effect exceeded its 60 second fragment deadline")
                self.aborted.set()
                self._kill()
                return

    def _read(self):
        import numpy as np
        remainder = b""
        try:
            while self.active():
                chunk = self.process.stdout.read(3840)
                if not chunk:
                    if remainder:
                        raise RuntimeError("Voice effect returned truncated float32 PCM")
                    break
                data = remainder + chunk
                aligned = len(data) // 4 * 4
                remainder = data[aligned:]
                if aligned and not self.emit(np.frombuffer(data[:aligned], dtype="<f4")):
                    self._kill()
                    break
        except Exception as error:
            self.error = error
            self.aborted.set()
            self._kill()

    def write(self, samples):
        import numpy as np
        if not self.active():
            return 0
        self._check_error()
        data = memoryview(np.asarray(samples, dtype="<f4").reshape(-1)).cast("B")
        try:
            while data and self.active():
                written = self.process.stdin.write(data)
                if not written:
                    raise RuntimeError("Voice effect input pipe closed")
                data = data[written:]
        except (BrokenPipeError, OSError):
            if self.active():
                self._check_error()
                raise RuntimeError("Voice effect input pipe failed") from None
        return int(self.active())

    def _check_error(self):
        if self.error:
            raise self.error

    def finish(self):
        self.process.stdin.close()
        self.reader.join(self.TIMEOUT + 1)
        if self.reader.is_alive():
            raise RuntimeError("Voice effect reader did not finish")
        code = self.process.wait(timeout=5)
        if not self.is_current():
            return
        self._check_error()
        if code:
            self.stderr.seek(0)
            message = self.stderr.read(2048).decode("utf-8", errors="replace")
            raise RuntimeError(f"Voice effect failed ({code}): {message}")

    def close(self):
        self.aborted.set()
        self._kill()
        self.process.wait(timeout=5)
        self.stopped.set()
        self.watchdog.join(timeout=1)
        self.reader.join(timeout=2)
        self.process.stdin.close()
        self.process.stdout.close()
        self.stderr.close()
        if self.reader.is_alive():
            raise RuntimeError("Voice effect output consumer did not stop")
