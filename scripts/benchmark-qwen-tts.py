"""Bounded, offline Qwen3-TTS audition; does not connect to the production Graph."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import threading
import time

import psutil

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / ".models/qwen3-tts-0.6b-customvoice"
ARTIFACT = ROOT / ".artifacts/qwen-tts"
GIB = 1024 ** 3
CASES = [
    "你好，我是你的数字人助手，很高兴认识你。",
    "今天的天气怎么样？请帮我查询一下。",
    "别着急，我会陪你一起把问题弄清楚。我们先从最简单的一步开始，好吗？",
]


def emit(kind, **values):
    print(json.dumps({"kind": kind, **values}, ensure_ascii=False), flush=True)


def write_report(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def probe():
    """A small CPU operator probe, not a claim that full Qwen inference works."""
    import torch
    from torch.nn import functional as F
    torch.set_num_threads(4)
    rows = []
    for dtype in [torch.float32, torch.bfloat16, torch.float16]:
        torch.manual_seed(42)
        operations = {
            "linear": lambda: F.linear(torch.randn(1, 1024, dtype=dtype), torch.randn(2048, 1024, dtype=dtype)),
            "sdpa": lambda: F.scaled_dot_product_attention(*[torch.randn(1, 4, 16, 64, dtype=dtype) for _ in range(3)]),
            "conv1d": lambda: F.conv1d(torch.randn(1, 32, 512, dtype=dtype), torch.randn(32, 32, 7, dtype=dtype)),
            "conv_transpose1d": lambda: F.conv_transpose1d(torch.randn(1, 32, 128, dtype=dtype), torch.randn(32, 16, 8, dtype=dtype), stride=4),
        }
        for name, operation in operations.items():
            try:
                times = []
                with torch.inference_mode():
                    for _ in range(3):
                        started = time.perf_counter()
                        result = operation()
                        times.append((time.perf_counter() - started) * 1000)
                        if not torch.isfinite(result).all():
                            raise RuntimeError("Non-finite operator output")
                rows.append({"dtype": str(dtype), "operation": name, "ok": True, "median_ms_including_input_creation": statistics.median(times)})
            except Exception as error:
                rows.append({"dtype": str(dtype), "operation": name, "ok": False, "error": str(error)})
    report = {"purpose": "Small CPU operator compatibility only; no full-model latency or audio-quality conclusion",
              "torch": torch.__version__, "cuda_build": torch.version.cuda,
              "cpu_capability": torch.backends.cpu.get_cpu_capability(), "results": rows,
              "available_gib_after_import": psutil.virtual_memory().available / GIB}
    write_report(ARTIFACT / "cpu-operator-probe.json", report)
    print(json.dumps(report, indent=2), flush=True)


def worker(args):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    import numpy as np
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    if torch.version.cuda is not None:
        raise RuntimeError("This audition requires the isolated CPU-only Torch build")
    dtype = getattr(torch, args.dtype)
    emit("loading", dtype=args.dtype, threads=args.threads)
    started = time.perf_counter()
    model = Qwen3TTSModel.from_pretrained(str(MODEL), device_map="cpu", dtype=dtype,
                                         attn_implementation="sdpa", low_cpu_mem_usage=True,
                                         local_files_only=True)
    model.model.eval()
    load_seconds = time.perf_counter() - started
    parameters = sum(p.numel() * p.element_size() for p in model.model.parameters())
    # speech_tokenizer is a wrapper rather than an nn.Module child.
    parameters += sum(p.numel() * p.element_size() for p in model.model.speech_tokenizer.model.parameters())
    emit("loaded", load_seconds=load_seconds, parameter_bytes=parameters,
         speakers=model.get_supported_speakers(), rss_gib=psutil.Process().memory_info().rss / GIB)
    output = ARTIFACT / args.run_name
    output.mkdir(parents=True, exist_ok=True)
    report = {"model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", "source": str(MODEL),
              "runtime": "official qwen-tts 0.1.1, offline CPU", "dtype": args.dtype,
              "torch": torch.__version__, "threads": args.threads, "load_seconds": load_seconds,
              "parameter_bytes": parameters, "instruction_control": False,
              "api_streams_pcm": False, "cases": []}
    for speaker in args.speakers.split(","):
        if speaker.lower() not in model.get_supported_speakers():
            raise ValueError(f"Unsupported official voice: {speaker}")
        for index, text in enumerate(CASES[:args.case_count], 1):
            torch.manual_seed(42)
            emit("generating", speaker=speaker, case=index, text=text)
            started = time.perf_counter()
            with torch.inference_mode():
                waves, rate = model.generate_custom_voice(text=text, language="Chinese", speaker=speaker,
                    non_streaming_mode=True, max_new_tokens=192)
            elapsed = time.perf_counter() - started
            audio = np.asarray(waves[0], dtype=np.float32)
            if not len(audio) or not np.isfinite(audio).all():
                raise RuntimeError("Invalid synthesized audio")
            duration = len(audio) / rate
            name = f"{speaker.lower()}-case-{index}.wav"
            sf.write(output / name, audio, rate, subtype="PCM_16")
            row = {"text": text, "speaker": speaker, "sample_rate": rate,
                   "first_pcm_ms": elapsed * 1000, "first_pcm_definition": "first returned complete PCM array; not first codec token or speaker playback",
                   "wall_seconds": elapsed, "audio_seconds": duration, "rtf": elapsed / duration,
                   "wav": str((output / name).relative_to(ROOT)),
                   "max_new_tokens": 192, "max_length_may_truncate": duration >= 15.8,
                   "peak_amplitude": float(np.abs(audio).max()), "rms": float(np.sqrt(np.mean(audio ** 2)))}
            report["cases"].append(row)
            write_report(output / "report.json", report)
            emit("generated", **row)
    emit("complete", report=str(output / "report.json"))


def run_guarded(args):
    # Leave headroom for the user's active desktop, decoder activations, and
    # temporary load tensors. Never kill unrelated apps to obtain that headroom.
    minimum = 7.0 if args.dtype == "float32" else 4.5
    available = psutil.virtual_memory().available / GIB
    safety = {"minimum_available_gib": minimum, "available_gib_before": available,
              "dtype": args.dtype, "status": "not_started", "samples_created": False}
    path = ARTIFACT / args.run_name / "safety-report.json"
    if available < minimum:
        safety["reason"] = "Insufficient free RAM for a bounded full-model audition; no model tensors were loaded"
        write_report(path, safety)
        emit("blocked_by_memory", **safety)
        return 3
    command = [sys.executable, "-u", str(Path(__file__).resolve()), "--worker",
               "--dtype", args.dtype, "--threads", str(args.threads), "--case-count", str(args.case_count),
               "--speakers", args.speakers, "--run-name", args.run_name]
    started = time.monotonic()
    process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, encoding="utf-8", errors="replace")
    tracked = psutil.Process(process.pid)
    if sys.platform == "win32":
        tracked.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    logs = []
    def read_output():
        for line in process.stdout:
            logs.append(line)
            print(line, end="", flush=True)
    reader = threading.Thread(target=read_output, daemon=True)
    reader.start()
    minimum_seen, peak_rss, pressure = available, 0, 0
    reason = None
    while process.poll() is None:
        free = psutil.virtual_memory().available / GIB
        minimum_seen = min(minimum_seen, free)
        try:
            peak_rss = max(peak_rss, tracked.memory_info().rss / GIB)
        except psutil.NoSuchProcess:
            break
        pressure = pressure + 1 if free < 1.0 else 0
        if pressure >= 4:
            reason = "Stopped own test child after available RAM stayed below 1 GiB"
        elif time.monotonic() - started > args.timeout:
            reason = "Stopped own test child at the audition time limit"
        if reason:
            process.terminate()
            break
        time.sleep(.25)
    process.wait(timeout=15)
    reader.join(timeout=3)
    safety.update(status="completed" if process.returncode == 0 else "stopped_or_failed",
                  returncode=process.returncode, reason=reason,
                  minimum_available_gib_observed=minimum_seen, peak_child_rss_gib=peak_rss,
                  elapsed_seconds=time.monotonic() - started,
                  samples_created=bool(list(path.parent.glob("*.wav"))))
    write_report(path, safety)
    (path.parent / "runtime.log").write_text("".join(logs), encoding="utf-8")
    emit("safety_report", **safety)
    return process.returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--dtype", choices=["float32", "bfloat16", "float16"], default="bfloat16")
    parser.add_argument("--threads", type=int, choices=range(1, 9), default=4)
    parser.add_argument("--case-count", type=int, choices=range(1, 4), default=1)
    parser.add_argument("--speakers", default="Serena,Vivian")
    parser.add_argument("--run-name", default="official-bf16")
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()
    if Path(args.run_name).name != args.run_name or args.run_name in {".", ".."}:
        raise ValueError("run-name must be one safe directory name")
    if args.probe:
        probe()
    elif args.worker:
        worker(args)
    else:
        return run_guarded(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
