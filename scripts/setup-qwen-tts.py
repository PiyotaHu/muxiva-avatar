"""Install an isolated official Qwen3-TTS experiment; never change the live TTS."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import venv

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".venv-qwen-tts"
MODEL = ROOT / ".models/qwen3-tts-0.6b-customvoice"
REPO = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"
REVISION = "85e237c12c027371202489a0ec509ded67b5e4b5"
LFS_SHA256 = {
    "model.safetensors": "bc3c7e785eb961179c25450d1acff03f839e0002f2f3a5aeb67b5735c0fa2adb",
    "speech_tokenizer/model.safetensors": "836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258",
}
FILES = {
    "config.json", "generation_config.json", "merges.txt", "model.safetensors",
    "preprocessor_config.json", "tokenizer_config.json", "vocab.json",
    "speech_tokenizer/config.json", "speech_tokenizer/configuration.json",
    "speech_tokenizer/model.safetensors", "speech_tokenizer/preprocessor_config.json",
}


def request(url, **headers):
    return urllib.request.urlopen(urllib.request.Request(url, headers={
        "User-Agent": "Muxiva-Qwen-TTS-Experiment/1", **headers}), timeout=90)


def verify(path, entry):
    if not path.is_file() or path.stat().st_size != entry["size"]:
        return False
    with path.open("rb") as stream:
        if entry.get("lfs"):
            return hashlib.file_digest(stream, "sha256").hexdigest() == LFS_SHA256[entry["rfilename"]]
        digest = hashlib.sha1(f"blob {entry['size']}\0".encode())
        while block := stream.read(1024 * 1024):
            digest.update(block)
        return digest.hexdigest() == entry["blobId"]


def install_models(verify_only=False):
    if verify_only:
        manifest = json.loads((ROOT / ".artifacts/qwen-tts/model-manifest.json").read_text(encoding="utf-8"))
        if manifest["repo"] != REPO or manifest["revision"] != REVISION:
            raise RuntimeError("Installed model manifest does not match the pinned source")
        checked = set()
        for entry in manifest["files"]:
            target = (ROOT / entry["path"]).resolve()
            name = target.relative_to(MODEL.resolve()).as_posix()
            if name not in FILES or name in checked:
                raise RuntimeError("Unexpected installed model file")
            if name in LFS_SHA256 and entry["sha256"] != LFS_SHA256[name]:
                raise RuntimeError("Installed weight manifest differs from pinned SHA256")
            if not target.is_file() or target.stat().st_size != entry["bytes"]:
                raise RuntimeError(f"Missing or incomplete installed file: {name}")
            with target.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != entry["sha256"]:
                    raise RuntimeError(f"Installed SHA256 mismatch: {name}")
            checked.add(name)
            print(f"Offline verified {name}", flush=True)
        if checked != FILES:
            raise RuntimeError("Installed model manifest is incomplete")
        print(f"Offline verification complete: {len(checked)} files, {manifest['total_bytes']} bytes", flush=True)
        return
    with request(f"https://huggingface.co/api/models/{REPO}/revision/{REVISION}?blobs=true") as response:
        metadata = json.load(response)
    if metadata["sha"] != REVISION:
        raise RuntimeError("Official model revision changed unexpectedly")
    entries = [entry for entry in metadata["siblings"] if entry["rfilename"] in FILES]
    if {entry["rfilename"] for entry in entries} != FILES:
        raise RuntimeError("Official snapshot is missing required files")
    manifest = {"repo": REPO, "revision": REVISION, "license": "Apache-2.0",
                "total_bytes": sum(entry["size"] for entry in entries), "files": []}
    print(json.dumps({"model": REPO, "bytes": manifest["total_bytes"]}), flush=True)
    for entry in entries:
        name = entry["rfilename"]
        if entry.get("lfs", {}).get("sha256", LFS_SHA256.get(name)) != LFS_SHA256.get(name):
            raise RuntimeError(f"Unexpected pinned LFS hash: {name}")
        target = MODEL / name
        if not verify(target, entry):
            target.parent.mkdir(parents=True, exist_ok=True)
            partial = target.with_name(target.name + ".partial")
            offset = partial.stat().st_size if partial.exists() else 0
            url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{name}"
            with request(url, **({"Range": f"bytes={offset}-"} if offset else {})) as response:
                resume = offset > 0 and response.status == 206
                if resume and not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
                    raise RuntimeError("Server returned a wrong resume range")
                count = offset if resume else 0
                last_log = time.monotonic()
                with partial.open("ab" if resume else "wb") as output:
                    while block := response.read(4 * 1024 * 1024):
                        output.write(block)
                        count += len(block)
                        if count > entry["size"]:
                            raise RuntimeError("Download exceeded pinned model size")
                        if time.monotonic() - last_log > 10:
                            print(f"{name}: {count}/{entry['size']} bytes", flush=True)
                            last_log = time.monotonic()
            if not verify(partial, entry):
                raise RuntimeError(f"Hash/length check failed: {name}")
            partial.replace(target)
        with target.open("rb") as stream:
            sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
        manifest["files"].append({"path": str(target.relative_to(ROOT)), "bytes": entry["size"], "sha256": sha256})
        print(f"Verified {name}", flush=True)
    artifact = ROOT / ".artifacts/qwen-tts"
    artifact.mkdir(parents=True, exist_ok=True)
    (artifact / "model-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def install_dependencies():
    python = ENV / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(ENV)
    base = [str(python), "-m", "pip", "install", "--disable-pip-version-check", "--no-cache-dir"]
    subprocess.run([*base, "torch==2.8.0+cpu", "torchaudio==2.8.0+cpu",
                    "--index-url", "https://download.pytorch.org/whl/cpu"], check=True)
    subprocess.run([*base, "qwen-tts==0.1.1", "numpy==2.2.6", "soundfile==0.13.1",
                    "librosa==0.11.0", "numba==0.63.1", "psutil==7.0.0"], check=True)
    subprocess.run([str(python), "-m", "pip", "check"], check=True)
    packages = subprocess.check_output([str(python), "-m", "pip", "list", "--format=json"], text=True)
    artifact = ROOT / ".artifacts/qwen-tts"
    artifact.mkdir(parents=True, exist_ok=True)
    (artifact / "installed-packages.json").write_text(packages, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--dependencies-only", action="store_true")
    group.add_argument("--models-only", action="store_true")
    group.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if not (args.models_only or args.verify_only):
        install_dependencies()
    if not args.dependencies_only:
        install_models(verify_only=args.verify_only)


if __name__ == "__main__":
    main()
