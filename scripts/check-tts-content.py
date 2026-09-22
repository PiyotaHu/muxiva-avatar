"""Offline ASR readback of explicit WAV files, for TTS content screening only.

ASR can itself omit or misrecognize words. This is not a score for naturalness,
cuteness, speaker quality, or exact pronunciation; listen to the originals.
No cloud calls, audio writes, production imports, or model load at import time.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = ROOT / ".models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"


def read_wav(path, np, soxr):
    with wave.open(str(path), "rb") as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getcomptype() != "NONE":
            raise ValueError("Expected uncompressed 16-bit mono PCM WAV")
        rate, count = audio.getframerate(), audio.getnframes()
        if not 8000 <= rate <= 192000 or count <= 0:
            raise ValueError("Expected nonempty audio at 8000..192000 Hz")
        pcm = audio.readframes(count)
    if len(pcm) != count * 2:
        raise ValueError("Truncated WAV data")
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    if rate != 16000:
        samples = soxr.resample(samples, rate, 16000, quality="HQ")
    return np.ascontiguousarray(samples, dtype=np.float32), rate, count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--files", type=Path, nargs="+", required=True, help="Explicit local WAV paths")
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--output", type=Path, help="Optional new .json report; never overwrites existing files")
    parser.add_argument("--num-threads", type=int, default=2, choices=range(1, 9))
    args = parser.parse_args()
    model_dir = args.model_dir.resolve()
    model, tokens = model_dir / "model.int8.onnx", model_dir / "tokens.txt"
    for path in (model, tokens):
        if not path.is_file():
            parser.error("Missing local model file: " + str(path))
    output = args.output.resolve() if args.output else None
    if output and (output.suffix.lower() != ".json" or output.exists()):
        parser.error("--output must be a new .json path; existing files are never overwritten")
    # Only an explicit CLI run loads these dependencies and one local CPU model.
    import numpy as np
    import sherpa_onnx
    import soxr

    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(model), tokens=str(tokens), num_threads=args.num_threads,
        sample_rate=16000, feature_dim=80, decoding_method="greedy_search",
        provider="cpu", language="zh", use_itn=False, debug=False,
    )
    results = []
    for requested in args.files:
        path = requested.resolve()
        row = {"path": str(path)}
        try:
            samples, rate, count = read_wav(path, np, soxr)
            stream = recognizer.create_stream()
            stream.accept_waveform(16000, samples)
            recognizer.decode_stream(stream)
            row.update(ok=True, text=stream.result.text, input_sample_rate_hz=rate,
                       input_samples=count, audio_seconds=round(count / rate, 4))
        except Exception as error:
            row.update(ok=False, error=f"{type(error).__name__}: {error}")
        results.append(row)
    report = {
        "purpose": "tts_content_screening_only",
        "limitations": "ASR may misrecognize words; not a naturalness, cuteness, or pronunciation score.",
        "model_dir": str(model_dir), "language": "zh", "use_itn": False,
        "recognition_sample_rate_hz": 16000, "files": results,
    }
    encoded = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("x", encoding="utf-8") as destination:
            destination.write(encoded)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(encoded, end="")
    return 0 if all(row["ok"] for row in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
