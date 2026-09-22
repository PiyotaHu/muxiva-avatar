"""Exercise real speech models through the exact checked-out Muxiva Python Host."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
import wave

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


class Host:
    def __init__(self, host_code, node_name, entrypoint, config):
        self.process = subprocess.Popen(
            [sys.executable, "-u", "-c", host_code, str(ROOT / ".muxiva/nodes" / node_name / "node.py"), entrypoint, json.dumps(config)],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8",
        )
        # Capture diagnostics without allowing a full stderr pipe to block inference.
        import threading
        self.diagnostics = []
        self.reader = threading.Thread(target=lambda: self.diagnostics.extend(self.process.stderr), daemon=True)
        self.reader.start()
        if json.loads(self.process.stdout.readline()) != {"ready": True}:
            raise RuntimeError("Muxiva Python Host did not become ready")
        self.command("prepare")

    def command(self, op, **payload):
        self.process.stdin.write(json.dumps({"op": op, "node_id": "benchmark", "default_output": "audio_out", **payload}) + "\n")
        self.process.stdin.flush()
        records = []
        while True:
            line = self.process.stdout.readline()
            if not line:
                raise RuntimeError("Host exited: " + "".join(self.diagnostics[-10:]))
            record = json.loads(line)
            if "ok" in record:
                if not record["ok"]:
                    raise RuntimeError(record.get("error", "Node failed"))
                return records, record
            records.append(record)

    def close(self):
        try:
            self.command("finish")
            self.command("close")
            self.process.wait(timeout=10)
        finally:
            if self.process.poll() is None:
                self.process.terminate()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--muxiva-source", type=Path, default=ROOT.parent / "muxiva")
    parser.add_argument("--output-dir", type=Path, default=ROOT / ".artifacts/speech")
    parser.add_argument("--speaker-id", type=int, default=3)
    parser.add_argument("--num-threads", type=int, default=4)
    parser.add_argument("--backend", choices=["kokoro-int8", "kokoro", "melo"], default="kokoro")
    parser.add_argument("--quick", action="store_true")
    args = parser.parse_args()
    source = (args.muxiva_source / "crates/muxiva-studio/src/node_library.rs").read_text(encoding="utf-8")
    host_code = source.split('const PYTHON_HOST: &str = r#"', 1)[1].split('"#;', 1)[0]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    tts = Host(host_code, "local_tts", "node:LocalTtsNode", {"speaker_id": args.speaker_id, "num_threads": args.num_threads, "backend":args.backend})
    cases = ["你好，我是你的数字人助手，很高兴认识你。", "今天的天气怎么样？请帮我查询一下。", "请从一数到十：一，二，三，四，五，六，七，八，九，十。"]
    if args.quick:
        cases = cases[:1]
    reports = []
    recordings = []
    try:
        for index, text in enumerate(cases):
            sequence = time.monotonic_ns() // 1000
            started = time.perf_counter()
            all_records = []
            records, state = tts.command("process", input_port="text_in", frame={"kind": "text", "text": text, "sequence": sequence})
            all_records.extend(records)
            first_pcm_ms = round((time.perf_counter() - started) * 1000, 1) if any(item.get("frame", {}).get("kind") == "audio" for item in records) else None
            while state.get("next_tick_ms"):
                time.sleep(state["next_tick_ms"] / 1000)
                records, state = tts.command("process", frame=None, input_port=None)
                if first_pcm_ms is None and any(item.get("frame", {}).get("kind") == "audio" for item in records):
                    first_pcm_ms = round((time.perf_counter() - started) * 1000, 1)
                all_records.extend(records)
                if time.perf_counter() - started > 90:
                    raise RuntimeError("TTS exceeded the benchmark deadline")
            elapsed = time.perf_counter() - started
            audio_frames = [item["frame"] for item in all_records if item.get("frame", {}).get("kind") == "audio"]
            pcm = b"".join(bytes.fromhex(frame["pcm_hex"]) for frame in audio_frames)
            if not pcm:
                raise RuntimeError("TTS did not emit audio")
            if any(frame["sequence"] != sequence for frame in audio_frames):
                raise RuntimeError("TTS response sequence was not preserved")
            sample_offset = 0
            for frame in audio_frames:
                if frame.get("stream_id") != "assistant" or frame.get("timestamp_ns") != sample_offset * 1_000_000_000 // 24000:
                    raise RuntimeError("Host did not preserve the PCM stream identity/sample clock")
                if frame.get("clock_domain") != {"id":"assistant.audio", "kind":"media_relative"}:
                    raise RuntimeError("Host did not preserve the media-relative clock domain")
                sample_offset += len(bytes.fromhex(frame["pcm_hex"])) // 2
            duration = len(pcm) / 48000
            output = args.output_dir / f"speaker-{args.speaker_id}-case-{index+1}.wav"
            with wave.open(str(output), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(24000)
                audio.writeframes(pcm)
            reports.append({"text": text, "first_pcm_ms": first_pcm_ms, "wall_seconds": round(elapsed, 3), "audio_seconds": round(duration, 3), "rtf": round(elapsed / duration, 3), "wav": str(output)})
            recordings.append(pcm)
            print(json.dumps(reports[-1], ensure_ascii=False), flush=True)
    finally:
        tts.close()
    asr = Host(host_code, "local_speech", "node:LocalSpeechNode", {})
    try:
        for report, pcm in zip(reports, recordings):
            samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
            samples = np.interp(np.arange(int(len(samples) * 2 / 3)) * 1.5, np.arange(len(samples)), samples)
            samples = np.concatenate((np.zeros(8000), samples, np.zeros(24000)))
            records = []
            started = time.perf_counter()
            for offset in range(0, len(samples), 320):
                chunk = (np.clip(samples[offset:offset+320], -1, 1) * 32767).astype("<i2").tobytes()
                result, _ = asr.command("process", input_port="audio_in", frame={"kind":"audio", "pcm_hex":chunk.hex(), "sample_rate_hz":16000, "channels":1, "sequence":offset//320+1})
                records.extend(result)
            finals = [item["frame"] for item in records if item.get("port") == "text_out"]
            previews = [item["frame"] for item in records if item.get("port") == "transcript_preview_out"]
            if not finals or not previews:
                raise RuntimeError("ASR did not emit both preview and final")
            if finals[-1]["sequence"] != previews[-1]["sequence"]:
                raise RuntimeError("ASR preview/final utterance IDs differ")
            report["asr_final"] = " ".join(item["text"] for item in finals)
            report["asr_preview_count"] = len(previews)
            report["asr_wall_seconds"] = round(time.perf_counter() - started, 3)
            print(json.dumps({key: value for key,value in report.items() if key.startswith("asr")}, ensure_ascii=False), flush=True)
    finally:
        asr.close()
    result = {"runtime":"real Muxiva project Python Host", "backend":args.backend, "runtime_version":"sherpa-onnx 1.13.5 CPU", "speaker_id":args.speaker_id, "num_threads":args.num_threads, "cases":reports}
    (args.output_dir / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
