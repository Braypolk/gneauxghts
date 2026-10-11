"""Explicit continuation on Rig 0.41. --run generates only seven unfinished answers.

Temporarily observes formatter deltas in test builds, then restores the exact
original source before offline walkthroughs or model requests.
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
    mode.add_argument('--offline', action='store_true')
    mode.add_argument('--run', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    base = here.parent
    root = base.parents[2]
    assert '=0.41.0' in (root/'src-tauri/Cargo.toml').read_text(), 'Comparison must finish before Rig migration'
    if args.run and (args.output is None or args.output.exists()):
        parser.error('--run needs a fresh --output path')
    hosts = [root/'src-tauri/src/chat/citation_evaluation.rs', root/'src-tauri/src/agent_runtime.rs',
        root/'src-tauri/src/agent_runtime/context_measurement.rs']
    originals = {host:host.read_bytes() for host in hosts}
    if any(b'structured-answer-streaming/' in data for data in originals.values()):
        parser.error('Temporary prototype already installed; inspect before proceeding')
    replacements = dict(originals)
    replacements[hosts[0]] += b'\ninclude!(concat!(env!("CARGO_MANIFEST_DIR"), "/../.scratch/chat-reliability/structured-answer-prototype/runtime.rs"));\ninclude!(concat!(env!("CARGO_MANIFEST_DIR"), "/../.scratch/chat-reliability/structured-answer-streaming/completion/resume-bench.rs"));\n'
    needle = b'        match item {\n            MultiTurnStreamItem::StreamAssistantItem'
    assert replacements[hosts[1]].count(needle)==1
    replacements[hosts[1]] = replacements[hosts[1]].replace(needle,b'        #[cfg(test)]\n        prototype_observe_item(&item);\n'+needle)
    replacements[hosts[1]] += b'\n#[cfg(test)]\ninclude!(concat!(env!("CARGO_MANIFEST_DIR"), "/../.scratch/chat-reliability/structured-answer-streaming/adapter.rs"));\n'
    needle = b'        let result = self.inner.stream(request).await;'
    assert replacements[hosts[2]].count(needle)==1
    replacements[hosts[2]] = replacements[hosts[2]].replace(needle,b'        #[cfg(test)]\n        super::prototype_observe_wire(&request);\n'+needle)
    provenance = {'hostBeforeSha256':{str(host.relative_to(root)):hashlib.sha256(data).hexdigest() for host,data in originals.items()}}
    paths=[base/name for name in ['adapter.rs','bench.rs','run.py','fixtures.json','settings.json','baseline-preamble.txt','runtime.json','run-provenance.json']]
    paths += [here/'resume.py',here/'resume-bench.rs',base.parent/'structured-answer-prototype/runtime.rs',root/'src-tauri/Cargo.toml',root/'src-tauri/Cargo.lock']
    provenance['sourceHashes']={str(path.relative_to(root)):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    cache = here/'build-provenance.json'
    cached = json.loads(cache.read_text()) if cache.exists() else None
    if cached and cached['hostBeforeSha256']==provenance['hostBeforeSha256'] and cached['sourceHashes']==provenance['sourceHashes'] and Path(cached['executable']).exists() and hashlib.sha256(Path(cached['executable']).read_bytes()).hexdigest()==cached['executableSha256']:
        provenance=cached
        executable=cached['executable']
    else:
        executable=build(root,here,hosts,originals,replacements,provenance)
    (here/('run-provenance.json' if args.run else 'build-provenance.json')).write_text(json.dumps(provenance,indent=2)+'\n')
    print('Prototype ready; all three production hosts restored byte for byte.',flush=True)
    if args.build_only:return
    if args.offline:
        result=subprocess.run([executable,'--exact','chat::citation_evaluation::offline_streaming_walkthrough','--ignored','--nocapture'],cwd=root)
        raise SystemExit(result.returncode)
    run_paid(args,here,root,executable)


def build(root,here,hosts,originals,replacements,provenance):
    try:
        for host,data in replacements.items():host.write_bytes(data)
        result = subprocess.run(['cargo', 'test', '--manifest-path', 'src-tauri/Cargo.toml',
            'compact_streaming_prototype', '--no-run', '--message-format=json'],
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
        conflicts=[]
        for host in hosts:
            if host.read_bytes()!=replacements[host]:conflicts.append(str(host))
            else:host.write_bytes(originals[host])
        if conflicts:raise SystemExit('Hosts changed during compilation; preserved for inspection: '+', '.join(conflicts))
    provenance['hostRestoredSha256']={str(host.relative_to(root)):hashlib.sha256(host.read_bytes()).hexdigest() for host in hosts}
    matching = []
    for executable in executables:
        listing = subprocess.run([executable, '--list'], capture_output=True, text=True, check=True)
        if 'chat::citation_evaluation::live_compact_streaming_prototype:' in listing.stdout:
            matching.append(executable)
    if len(matching) != 1:
        raise SystemExit('Expected one evaluation executable')
    executable = matching[0]
    provenance['executableSha256'] = hashlib.sha256(Path(executable).read_bytes()).hexdigest()
    provenance['executable'] = executable
    (here/'build-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    return executable


def run_paid(args,here,root,executable):
    if sys.platform != 'darwin':
        raise SystemExit('Saved-Keychain launcher requires macOS')
    credential = subprocess.run(['security', 'find-generic-password', '-s',
        'com.braypolkinghorne.gneauxghts.credentials', '-a', 'provider.openai.api-key', '-w'], capture_output=True)
    if credential.returncode or not credential.stdout.strip():
        raise SystemExit('Saved OpenAI credential unavailable; diagnostics suppressed')
    env = os.environ.copy()
    env.update(OPENAI_API_KEY=credential.stdout.decode().strip(), GNEAUX_CITATION_LIVE='1',
        GNEAUX_CITATION_SETTINGS=str(here.parent/'settings.json'), GNEAUX_CITATION_CORPUS=str(here.parent/'fixtures.json'),
        GNEAUX_CITATION_PREAMBLE=str(here.parent/'baseline-preamble.txt'), GNEAUX_LIVE_OUTPUT=str(args.output.resolve()),GNEAUX_STREAM_PREVIOUS=str(here.parent/'runtime.json'))
    try:
        completed = subprocess.run([executable, '--exact', 'chat::citation_evaluation::live_compact_streaming_prototype',
            '--ignored', '--nocapture'], cwd=root, env=env)
        raise SystemExit(completed.returncode)
    finally:
        env.pop('OPENAI_API_KEY', None)


if __name__ == '__main__':
    main()
