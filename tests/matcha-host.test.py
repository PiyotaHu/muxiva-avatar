"""Explicit real Matcha/Python Host regression; not part of default test discovery.

No server, microphone, playback device, ASR or network. Uses existing model files
and the checked-out Muxiva Host. Prints observations, does not package audio/models.
"""
from __future__ import annotations

from collections import deque
import importlib.util
import json
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("matcha_host_guard", ROOT / "scripts/benchmark-light-tts.py")
GUARD = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = GUARD
SPEC.loader.exec_module(GUARD)


class CheckedHost:
    def __init__(self, config):
        self.memory = GUARD.WindowsMemory()
        self.available_before = self.memory.available()
        if self.available_before < GUARD.minimum_available("matcha"):
            raise unittest.SkipTest("Matcha Host needs at least 1.5 GiB available RAM; no model loaded")
        library = ROOT.parent / "muxiva/crates/muxiva-studio/src/node_library.rs"
        source = library.read_text(encoding="utf-8")
        host = source.split('const PYTHON_HOST: &str = r#"', 1)[1].split('"#;', 1)[0]
        # A Windows venv executable may be a redirector with a different PID.
        # Read-only test preamble identifies the interpreter running the Host;
        # the production Host source/protocol itself is not changed.
        host = 'import os, json\nprint(json.dumps({"test_host_pid":os.getpid()}), flush=True)\n' + host
        self.output = queue.Queue(2048)
        self.diagnostics = deque(maxlen=32)
        self.memory_guard = GUARD.MemoryGuard()
        self.peak_rss = self.peak_private = 0
        self.minimum_free = self.available_before
        self.stopped = False
        self.process = subprocess.Popen(
            [sys.executable, "-X", "utf8", "-u", "-c", host,
             str(ROOT / ".muxiva/nodes/local_tts/node.py"), "node:LocalTtsNode", json.dumps(config)],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS,
        )
        self.host_pid = self.process.pid
        self.readers = [threading.Thread(target=self.read_stdout, daemon=True),
                        threading.Thread(target=self.read_stderr, daemon=True)]
        for reader in self.readers:
            reader.start()
        try:
            observed = json.loads(self.next_line(time.monotonic(), 15))
            self.check(isinstance(observed.get("test_host_pid"), int) and observed["test_host_pid"] > 0, "Host PID observation")
            self.host_pid = observed["test_host_pid"]
            self.check(json.loads(self.next_line(time.monotonic(), 15)) == {"ready":True}, "Host ready handshake")
            started = time.perf_counter()
            self.command("prepare", timeout=40)
            self.prepare_ms = round((time.perf_counter() - started) * 1000, 1)
        except BaseException:
            self.close(force=True)
            raise

    @staticmethod
    def check(condition, label):
        if not condition:
            raise AssertionError(label)

    def read_stdout(self):
        for line in self.process.stdout:
            while not self.stopped:
                try:
                    self.output.put(line, timeout=.05)
                    break
                except queue.Full:
                    pass

    def read_stderr(self):
        for line in self.process.stderr:
            self.diagnostics.append(line[:4096])

    def next_line(self, phase_started, timeout):
        while True:
            available = self.memory.available()
            self.minimum_free = min(self.minimum_free, available)
            if self.process.poll() is None:
                memory = self.memory.process(self.host_pid)
                self.peak_rss = max(self.peak_rss, memory["peak_rss_bytes"])
                self.peak_private = max(self.peak_private, memory["private_bytes"])
            reason = self.memory_guard.check(time.monotonic(), available, phase_started, timeout)
            if reason:
                self.stop_own_host()
                raise RuntimeError(reason)
            try:
                return self.output.get(timeout=.05)
            except queue.Empty:
                if self.process.poll() is not None:
                    raise RuntimeError("Host exited: " + "".join(self.diagnostics))

    def command(self, op, timeout=15, **values):
        self.process.stdin.write(json.dumps({"op":op, "node_id":"matcha-host-test", "default_output":"audio_out", **values}) + "\n")
        self.process.stdin.flush()
        started = time.monotonic()
        records = []
        while True:
            item = json.loads(self.next_line(started, timeout))
            if "ok" in item:
                self.check(item["ok"], item.get("error", "Host operation failed"))
                return records, item
            records.append(item)

    def text(self, value, sequence):
        return self.command("process", input_port="text_in", frame={"kind":"text", "text":value, "sequence":sequence})

    def drain(self, records, state, started):
        first = round((time.perf_counter() - started) * 1000, 1) if audio_frames(records) else None
        while state.get("next_tick_ms"):
            if time.perf_counter() - started > 30:
                self.stop_own_host()
                raise RuntimeError("Matcha Host case exceeded 30 seconds")
            time.sleep(min(state["next_tick_ms"], 20) / 1000)
            more, state = self.command("process", frame=None, input_port=None)
            records.extend(more)
            if first is None and audio_frames(more):
                first = round((time.perf_counter() - started) * 1000, 1)
        return records, first

    def stop_own_host(self):
        if self.process.poll() is None:
            # Stop this test's redirector AND its interpreter on watchdog
            # failure; never target another session or all python.exe processes.
            try:
                subprocess.run(["taskkill", "/PID", str(self.process.pid), "/T", "/F"],
                               capture_output=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
            finally:
                GUARD.stop_own_child(self.process)

    def close(self, force=False):
        try:
            if not force and self.process.poll() is None:
                self.command("finish", timeout=8)
                self.command("close", timeout=3)
                self.process.wait(timeout=3)
        finally:
            self.stopped = True
            self.stop_own_host()
            for reader in self.readers:
                reader.join(timeout=1)
            for pipe in (self.process.stdin, self.process.stdout, self.process.stderr):
                pipe.close()


def audio_frames(records):
    return [item["frame"] for item in records if item.get("kind") == "emission" and item.get("frame", {}).get("kind") == "audio"]


class MatchaHostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform != "win32":
            raise unittest.SkipTest("Uses existing Windows model installation and memory watchdog")
        graph = json.loads((ROOT / "graph.json").read_text(encoding="utf-8"))
        config = dict(next(node["node_config"] for node in graph["nodes"] if node["id"] == "local-tts"))
        if config.get("backend") != "matcha":
            raise unittest.SkipTest("Graph does not select Matcha; do not silently test another backend")
        config["max_audio_chunks"] = 8
        cls.voice_effect = config.get("voice_effect")
        cls.host = CheckedHost(config)
        cls.addClassCleanup(cls.host.close)

    def assert_audio_contract(self, records, sequence):
        frames = audio_frames(records)
        self.assertTrue(frames)
        offset = 0
        for frame in frames:
            self.assertEqual((frame["sequence"], frame["sample_rate_hz"], frame["channels"], frame["stream_id"]), (sequence, 24000, 1, "assistant"))
            self.assertEqual(frame["clock_domain"], {"id":"assistant.audio", "kind":"media_relative"})
            self.assertEqual(frame["timestamp_ns"], offset * 1_000_000_000 // 24000)
            pcm = bytes.fromhex(frame["pcm_hex"])
            self.assertEqual(len(pcm) % 2, 0)
            self.assertLessEqual(len(pcm), 1920)
            offset += len(pcm) // 2
        self.assertGreater(offset, 2400)
        return offset

    def test_01_real_matcha_fragments_keep_one_response_clock(self):
        sequence = 100
        started = time.perf_counter()
        records, state = self.host.text("你好，今天辛苦啦。", sequence)
        more, state = self.host.text("先休息一会儿，好吗？", sequence)
        records.extend(more)
        records, first = self.host.drain(records, state, started)
        samples = self.assert_audio_contract(records, sequence)
        completed = [item["frame"] for item in records if item.get("frame", {}).get("topic") == "muxiva.voice.tts.segment.completed"]
        self.assertEqual(len(completed), 2)
        self.assertEqual(sum(json.loads(frame["payload"])["samples"] for frame in completed), samples)
        if self.voice_effect:
            events = [json.loads(item["frame"]["payload"]) for item in records if item.get("frame", {}).get("topic") == "muxiva.voice.tts.started"]
            self.assertEqual(len(events), 2)
            self.assertTrue(all(event["voice_effect"] == {key:self.voice_effect[key] for key in ("pitch_semitones", "tempo")} for event in events))
        GUARD.print_json({"test":"real-matcha-host", "prepare_ms":self.host.prepare_ms,
                          "first_host_pcm_ms":first, "audio_seconds":round(samples / 24000, 3),
                          "output_sample_rate_hz":24000, "output_channels":1,
                          "available_before_mib":round(self.host.available_before / GUARD.MIB),
                          "minimum_available_mib":round(self.host.minimum_free / GUARD.MIB),
                          "peak_working_set_mib":round(self.host.peak_rss / GUARD.MIB),
                          "peak_sampled_private_mib":round(self.host.peak_private / GUARD.MIB),
                          "memory_scope":"actual Python Host PID, not venv redirector",
                          "scope":"Host receipt, not browser or acoustic onset"})

    def test_02_real_host_cancel_then_replacement_rejects_old_pcm(self):
        started = time.perf_counter()
        records, state = self.host.text("这是一段需要取消的回答。接下来还有很多内容，不应该继续播放。", 200)
        while not audio_frames(records):
            self.assertLess(time.perf_counter() - started, 10)
            time.sleep(.01)
            more, state = self.host.command("process", frame=None, input_port=None)
            records.extend(more)
        self.host.command("signal", input_port="signal_in", signal={
            "kind":"signal", "name":"muxiva.turn.cancelled", "sequence":0,
            "payload":{"turn_id":201},
        })
        records, state = self.host.text("迟到的旧回答。", 200)
        more, state = self.host.text("好，我停下了。", 201)
        records.extend(more)
        records, _ = self.host.drain(records, state, time.perf_counter())
        self.assert_audio_contract(records, 201)
        self.assertFalse([item for item in records if item.get("frame", {}).get("sequence") == 200])
        GUARD.print_json({"test":"real-matcha-host-cancel", "after_cancel_sequences":[201],
                          "payload_boundary_preserved":True, "late_pcm_rejected":True})

    def test_03_save_actual_node_output_for_audition(self):
        import wave
        text = "回来啦，今天有没有想我呀？先休息一会儿，慢慢跟我说，好不好？"
        started = time.perf_counter()
        records, state = self.host.text(text, 300)
        records, first = self.host.drain(records, state, started)
        samples = self.assert_audio_contract(records, 300)
        directory = ROOT / ".artifacts/matcha-light-tuning"
        directory.mkdir(parents=True, exist_ok=True)
        with wave.open(str(directory / "production-sample.wav"), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(24000)
            output.writeframes(b"".join(bytes.fromhex(frame["pcm_hex"]) for frame in audio_frames(records)))
        report = {"text":text, "voice_effect":self.voice_effect, "first_host_pcm_ms":first,
                  "duration_seconds":samples / 24000, "source":"actual configured LocalTtsNode/Python Host output",
                  "loudness_normalization":False, "cloud_calls":0}
        (directory / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        GUARD.print_json({"test":"real-matcha-node-audition", **report})


if __name__ == "__main__":
    unittest.main(verbosity=2)
