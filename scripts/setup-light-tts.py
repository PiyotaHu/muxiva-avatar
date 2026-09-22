"""Download official small-TTS candidates without changing the running pipeline."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / '.models' / 'tts-candidates'
RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/'
ASSETS = [
    ('zipvoice', 'tts-models', 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2', 109162785,
     '77219c8b40f4ee8d73a7f902305ff6c1128ef9b54461c41b4ca6ed890b6c2803'),
    ('zipvoice', 'vocoder-models', 'vocos_24khz.onnx', 54157409,
     'bcb3b970e384161c4d634f0bb9e999ff1c471b34c9bc0b1049a5014065ed3cc0'),
    ('matcha', 'tts-models', 'matcha-icefall-zh-baker.tar.bz2', 75463442,
     '20de2ec034b55562609d6362771c934905dfe11d0f41ec103d593427ad9a7efb'),
    ('matcha', 'vocoder-models', 'vocos-22khz-univ.onnx', 53884024, None),
]


def sha256(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def install(spec):
    backend, tag, name, expected_size, expected_sha = spec
    archive = name.endswith('.tar.bz2')
    target = (DEST / 'downloads' if archive else DEST) / name
    target.parent.mkdir(parents=True, exist_ok=True)
    url = RELEASE + tag + '/' + name
    valid = target.is_file() and target.stat().st_size == expected_size
    if valid and expected_sha:
        valid = sha256(target) == expected_sha
    if not valid:
        partial = target.with_name(target.name + '.partial')
        request = urllib.request.Request(url, headers={'User-Agent': 'Muxiva-Light-TTS-Setup'})
        print('Downloading ' + name, flush=True)
        with urllib.request.urlopen(request, timeout=60) as response, partial.open('wb') as handle:
            while chunk := response.read(1024 * 1024):
                handle.write(chunk)
        actual_sha = sha256(partial)
        if partial.stat().st_size != expected_size or (expected_sha and actual_sha != expected_sha):
            raise RuntimeError('Size/SHA256 mismatch: ' + name)
        partial.replace(target)
    actual_sha = sha256(target)
    if archive:
        destination = DEST / name.removesuffix('.tar.bz2')
        if not destination.is_dir():
            # Python's data filter rejects absolute escapes and unsafe links.
            with tarfile.open(target, 'r:bz2') as handle:
                handle.extractall(DEST, filter='data')
    print('Verified ' + name, flush=True)
    return {'backend': backend, 'name': name, 'url': url, 'bytes': expected_size,
            'sha256': actual_sha, 'publisher_sha256': expected_sha,
            'verification': 'official GitHub release digest' if expected_sha else
            'official HTTPS and release size; SHA256 recorded locally, no publisher digest available'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', choices=['zipvoice', 'matcha', 'all'], default='all')
    args = parser.parse_args()
    selected = [row for row in ASSETS if args.backend == 'all' or row[0] == args.backend]
    with ThreadPoolExecutor(max_workers=2) as workers:
        records = list(workers.map(install, selected))
    report = ROOT / '.artifacts' / 'light-tts'
    report.mkdir(parents=True, exist_ok=True)
    (report / ('download-' + args.backend + '.json')).write_text(json.dumps({
        'production_changed': False, 'models_loaded': False, 'assets': records,
        'license_note': 'Matcha Baker checkpoint is for non-commercial comparison; do not ship by default.'
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
