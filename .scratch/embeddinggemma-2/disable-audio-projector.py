#!/usr/bin/env python3
"""Reproduce a bounded, experimental audio-loading probe. Not a product installer.

Accepts only the pinned Unsloth Q8 projector. Copies it without overwriting an
existing destination, then changes the audio-encoder metadata boolean. Every
tensor byte remains unchanged; audio weights remain in the downloaded file.
"""
import argparse
import hashlib
import pathlib
import shutil

SOURCE_SHA = "90e7b0238009e2954f856f2081dcf7f35af026b64c765e98f4777053e1754460"
RESULT_SHA = "6fa5d0913d818ddb9fb161d81661cdbb783f57f4a64744c4a309244ace65f742"
# Verified with GGUFReader from the pinned llama.cpp revision. This offset is
# valid only for SOURCE_SHA, which must be checked before copying or changing it.
AUDIO_FLAG_OFFSET = 1245


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    args = parser.parse_args()
    if digest(args.source) != SOURCE_SHA:
        parser.error("Source does not match the pinned Q8 projector SHA-256")
    with args.source.open("rb") as source:
        source.seek(AUDIO_FLAG_OFFSET)
        if source.read(1) != b"\x01":
            parser.error("Expected audio encoder boolean to be true")
        source.seek(0)
        with args.output.open("xb+") as target:
            shutil.copyfileobj(source, target)
            target.seek(AUDIO_FLAG_OFFSET)
            target.write(b"\x00")
    if digest(args.output) != RESULT_SHA:
        raise RuntimeError("Derived projector SHA-256 mismatch")
    print(f"Experimental copy verified: {RESULT_SHA}")


if __name__ == "__main__":
    main()
