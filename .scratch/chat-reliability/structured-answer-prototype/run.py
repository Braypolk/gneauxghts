"""Disposable paired citation prototype. --build-only is free; --run generates 12 paid answers.

Temporarily includes runtime.rs in the existing test-only evaluation module,
compiles it, and restores the exact original source before any model request.
No production prompt, runtime, settings or vault writes. Credential stays in memory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--build-only', action='store_true')
    mode.add_argument('--run', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    root = here.parents[2]
    if args.run and (args.output is None or args.output.exists()):
        parser.error('--run needs a fresh --output path')
    host = root / 'src-tauri/src/chat/citation_evaluation.rs'
    original = host.read_bytes()
    include = b'\ninclude!(concat!(env!("CARGO_MANIFEST_DIR"), "/../.scratch/chat-reliability/structured-answer-prototype/runtime.rs"));\n'
    if include in original:
        parser.error('Temporary prototype already included; inspect before proceeding')
    provenance = {'hostBeforeSha256': hashlib.sha256(original).hexdigest()}
    for name in ['runtime.rs', 'run.py', 'fixtures.json', 'settings.json', 'baseline-preamble.txt']:
        provenance[name] = hashlib.sha256((here / name).read_bytes()).hexdigest()
    try:
        host.write_bytes(original + include)
        result = subprocess.run(['cargo', 'test', '--manifest-path', 'src-tauri/Cargo.toml',
            'live_structured_answer_prototype', '--no-run', '--message-format=json'],
            cwd=root, capture_output=True, text=True)
        (here / 'build.log').write_text(result.stderr)
        if result.returncode:
            print(result.stderr[-12000:])
            raise SystemExit(result.returncode)
        executables = []
        for line in result.stdout.splitlines():
            item = json.loads(line)
            if item.get('reason') == 'compiler-artifact' and item.get('profile', {}).get('test') and item.get('executable'):
                executables.append(item['executable'])
    finally:
        if host.read_bytes() != original + include:
            raise SystemExit('Host changed during compilation; preserve it and inspect manually')
        host.write_bytes(original)
    provenance['hostRestoredSha256'] = hashlib.sha256(host.read_bytes()).hexdigest()
    matching = []
    for executable in executables:
        listing = subprocess.run([executable, '--list'], capture_output=True, text=True, check=True)
        if 'chat::citation_evaluation::live_structured_answer_prototype:' in listing.stdout:
            matching.append(executable)
    if len(matching) != 1:
        raise SystemExit('Expected one evaluation executable')
    executable = matching[0]
    provenance['executableSha256'] = hashlib.sha256(Path(executable).read_bytes()).hexdigest()
    provenance['executable'] = executable
    (here / ('run-provenance.json' if args.run else 'build-provenance.json')).write_text(json.dumps(provenance, indent=2)+'\n')
    print('Prototype compiled; evaluation host restored byte for byte.', flush=True)
    if args.build_only:
        return
    if sys.platform != 'darwin':
        raise SystemExit('Saved-Keychain launcher requires macOS')
    credential = subprocess.run(['security', 'find-generic-password', '-s',
        'com.braypolkinghorne.gneauxghts.credentials', '-a', 'provider.openai.api-key', '-w'], capture_output=True)
    if credential.returncode or not credential.stdout.strip():
        raise SystemExit('Saved OpenAI credential unavailable; diagnostics suppressed')
    env = os.environ.copy()
    env.update(OPENAI_API_KEY=credential.stdout.decode().strip(), GNEAUX_CITATION_LIVE='1',
        GNEAUX_CITATION_SETTINGS=str(here/'settings.json'), GNEAUX_CITATION_CORPUS=str(here/'fixtures.json'),
        GNEAUX_CITATION_PREAMBLE=str(here/'baseline-preamble.txt'), GNEAUX_LIVE_OUTPUT=str(args.output.resolve()))
    try:
        completed = subprocess.run([executable, '--exact', 'chat::citation_evaluation::live_structured_answer_prototype',
            '--ignored', '--nocapture'], cwd=root, env=env)
        raise SystemExit(completed.returncode)
    finally:
        env.pop('OPENAI_API_KEY', None)


if __name__ == '__main__':
    main()
