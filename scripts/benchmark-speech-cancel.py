"""Measure real-model cancellation acknowledgment and stale-audio rejection."""
import importlib.util
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("speech_benchmark", ROOT / "scripts/benchmark-speech.py")
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


def main():
    source = (ROOT.parent / "muxiva/crates/muxiva-studio/src/node_library.rs").read_text(encoding="utf-8")
    host_code = source.split('const PYTHON_HOST: &str = r#"', 1)[1].split('"#;', 1)[0]
    host = bench.Host(host_code, "local_tts", "node:LocalTtsNode", {"backend":"kokoro", "num_threads":4})
    try:
        old_sequence = time.monotonic_ns() // 1000
        host.command("process", input_port="text_in", frame={"kind":"text", "sequence":old_sequence, "text":"这是一段用于测试取消能力的长回答，我们正在验证新请求到来时旧语音不会继续播放，也不会污染新的回答。"})
        time.sleep(0.05)
        new_sequence = time.monotonic_ns() // 1000
        started = time.perf_counter()
        host.command("signal", signal={"kind":"signal", "name":"muxiva.turn.cancelled", "payload":{"turn_id":new_sequence}, "sequence":0})
        cancel_ms = (time.perf_counter() - started) * 1000
        records, state = host.command("process", input_port="text_in", frame={"kind":"text", "sequence":new_sequence, "text":"好的，请说。"})
        all_records = list(records)
        started = time.perf_counter()
        while state.get("next_tick_ms"):
            time.sleep(state["next_tick_ms"] / 1000)
            records, state = host.command("process", frame=None, input_port=None)
            all_records.extend(records)
            if time.perf_counter() - started > 30:
                raise RuntimeError("replacement synthesis exceeded 30 seconds")
        audio = [record["frame"] for record in all_records if record.get("frame", {}).get("kind") == "audio"]
        stale = sum(frame["sequence"] != new_sequence for frame in audio)
        if stale or not audio:
            raise RuntimeError(f"cancel regression: stale={stale}, replacement_chunks={len(audio)}")
        report = {"backend":"kokoro-fp32-cpu", "cancel_ack_ms":round(cancel_ms, 2), "stale_audio_chunks":stale, "replacement_audio_chunks":len(audio), "replacement_seconds":round(time.perf_counter() - started, 3)}
        output = ROOT / ".artifacts/speech-cancel.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report), flush=True)
    finally:
        host.close()


if __name__ == "__main__":
    main()
