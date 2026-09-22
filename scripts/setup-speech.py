"""Install an isolated CPU speech runtime and verified model files."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import venv

ROOT = Path(__file__).resolve().parents[1]
DEPENDENCIES = ["numpy==2.2.6", "sherpa-onnx==1.13.5", "sherpa-onnx-core==1.13.5", "websockets==15.0.1", "soxr==1.0.0"]


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def install_models(tts_backend="kokoro") -> None:
    manifest = json.loads((ROOT / "models.lock.json").read_text(encoding="utf-8"))
    selected = {"kokoro":"kokoro-fp32-v1.1-zh", "kokoro-int8":"kokoro-int8-v1.1-zh", "melo":"melo-vits-zh-en"}
    for model in manifest["models"]:
        if model["id"] in selected.values() and tts_backend != "all" and model["id"] != selected[tts_backend]:
            continue
        target = ROOT / model["target"]
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.is_file() or digest(target) != model["sha256"]:
            partial = target.with_suffix(target.suffix + ".partial")
            print(f"Downloading {model['id']}", flush=True)
            # The complete archive is checked before it is installed/extracted.
            request = urllib.request.Request(model["url"], headers={"User-Agent": "Muxiva-Avatar-Setup"})
            with urllib.request.urlopen(request, timeout=120) as response, partial.open("wb") as output:
                shutil.copyfileobj(response, output)
            actual = digest(partial)
            if actual != model["sha256"]:
                raise RuntimeError(f"SHA256 mismatch for {model['id']}: {actual}")
            partial.replace(target)
        if model.get("extract") and not all((ROOT / file).is_file() for file in model["files"]):
            destination = (ROOT / model["extract"]).resolve()
            with tarfile.open(target, "r:*") as archive:
                archive.extractall(destination, filter="data")
        if not all((ROOT / file).is_file() for file in model.get("files", [])):
            raise RuntimeError(f"Missing extracted files for {model['id']}")
        print(f"Verified {model['id']}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models-only", action="store_true")
    parser.add_argument("--dependencies-only", action="store_true")
    parser.add_argument("--tts-backend", choices=["kokoro", "kokoro-int8", "melo", "all"], default="kokoro")
    args = parser.parse_args()
    if not args.models_only:
        target = ROOT / ".venv"
        python = target / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
        if not python.exists():
            venv.EnvBuilder(with_pip=True).create(target)
        subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check", *DEPENDENCIES], check=True)
    if not args.dependencies_only:
        install_models(args.tts_backend)


if __name__ == "__main__":
    main()
