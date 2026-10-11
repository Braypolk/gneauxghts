"""Explicit opt-in launcher for the synthetic app-runtime citation baseline.

Credentials remain in memory and the child environment, never artifacts/logs.
Settings must be a non-secret snapshot; no user note content is loaded here.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true', required=True, help='Opt in to paid requests for selected cases (default: all 13)')
    parser.add_argument('--settings', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--case', action='append', help='Run only specified corpus IDs; repeat to select multiple')
    parser.add_argument('--production-references', action='store_true', help='Use actual [S#] preparation and rendering over synthetic sources')
    parser.add_argument('--repeats', type=int, choices=[1, 2, 3], default=1)
    parser.add_argument('--preamble', type=Path, help='Explicit test-only full preamble candidate')
    parser.add_argument('--variant', help='Label this experiment arm')
    parser.add_argument('--corpus', type=Path, help='Explicit fixed-evidence corpus, including held-out cases')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('Saved-Keychain launcher requires macOS')
    if args.output.exists():
        parser.error('Output already exists; never overwrite a paid run')
    credential = subprocess.run(['security', 'find-generic-password', '-s',
        'com.braypolkinghorne.gneauxghts.credentials', '-a', 'provider.openai.api-key', '-w'],
        capture_output=True)
    if credential.returncode or not credential.stdout.strip():
        raise SystemExit('Saved OpenAI credential unavailable (value and diagnostics suppressed)')
    root = Path(__file__).resolve().parent
    environment = os.environ.copy()
    environment.update(OPENAI_API_KEY=credential.stdout.decode().strip(), GNEAUX_CITATION_LIVE='1',
        GNEAUX_CITATION_SETTINGS=str(args.settings.resolve()),
        GNEAUX_CITATION_CORPUS=str(args.corpus.resolve() if args.corpus else root / 'fixtures.json'),
        GNEAUX_LIVE_OUTPUT=str(args.output.resolve()))
    if args.case:
        environment['GNEAUX_CITATION_CASES'] = json.dumps(args.case)
    else:
        environment.pop('GNEAUX_CITATION_CASES', None)
    environment['GNEAUX_CITATION_REPEATS'] = str(args.repeats)
    if args.production_references:
        environment['GNEAUX_CITATION_REFERENCES'] = 'production'
    else:
        environment.pop('GNEAUX_CITATION_REFERENCES', None)
    for argument, name in [(args.preamble, 'GNEAUX_CITATION_PREAMBLE'), (args.variant, 'GNEAUX_CITATION_VARIANT')]:
        if argument is None:
            environment.pop(name, None)
        else:
            environment[name] = str(argument.resolve()) if isinstance(argument, Path) else argument
    try:
        result = subprocess.run(['cargo', 'test', '--manifest-path', 'src-tauri/Cargo.toml',
            'live_citation_fixed_evidence_baseline', '--', '--ignored', '--nocapture'],
            cwd=root.parents[2], env=environment)
        raise SystemExit(result.returncode)
    finally:
        environment.pop('OPENAI_API_KEY', None)


if __name__ == '__main__':
    main()
