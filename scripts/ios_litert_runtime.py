#!/usr/bin/env python3
"""Stage the pinned iOS XCFramework for Xcode (never downloaded by the app)."""
import argparse
import hashlib
import pathlib
import shutil
import tempfile
import urllib.request
import zipfile

SHA256 = "d765b99592d4ec3d0c9e2bd69469454af06c834861340672da1891c0c121c347"
URL = "https://github.com/google-ai-edge/LiteRT-LM/releases/download/v0.18.0/CLiteRTLM.xcframework.zip"
ROOT = pathlib.Path(__file__).resolve().parents[1]
EXTERNALS = ROOT / "src-tauri/gen/apple/Externals"


def prepare(archive):
    EXTERNALS.mkdir(parents=True, exist_ok=True)
    if archive is None:
        archive = EXTERNALS / "CLiteRTLM-0.18.0.zip"
        if not archive.exists():
            partial = archive.with_suffix(".partial")
            try:
                with urllib.request.urlopen(URL, timeout=60) as response, partial.open("wb") as output:
                    shutil.copyfileobj(response, output)
                verify(partial)
                partial.replace(archive)
            finally:
                partial.unlink(missing_ok=True)
    verify(archive)
    # Always publish from the verified archive, never trust an old extracted tree.
    with tempfile.TemporaryDirectory(prefix=".litert-", dir=EXTERNALS) as stage:
        with zipfile.ZipFile(archive) as bundle:
            for entry in bundle.infolist():
                path = (pathlib.Path(stage) / entry.filename).resolve()
                if pathlib.Path(stage) not in path.parents:
                    raise ValueError("Invalid framework archive path")
            bundle.extractall(stage)
        source = pathlib.Path(stage) / "CLiteRTLM.xcframework"
        destination = EXTERNALS / source.name
        if destination.exists():
            shutil.rmtree(destination)
        shutil.move(source, destination)
    print(f"Verified LiteRT-LM 0.18.0 iOS runtime: {destination}")


def verify(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    actual = digest.hexdigest()
    if actual != SHA256:
        raise ValueError(f"LiteRT iOS checksum mismatch: {path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=pathlib.Path, help="Reuse a local official ZIP instead of downloading")
    prepare(parser.parse_args().archive)
