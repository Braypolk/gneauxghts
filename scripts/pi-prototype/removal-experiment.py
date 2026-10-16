#!/usr/bin/env python3
"""Prepare an isolated, physically reduced Pi source tree. Never builds/runs apps."""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import shutil
from pathlib import Path

FEATURES = {"pi-prototype", "e2e-wdio"}
LEGACY_ROOTS = (
    "agent_guardrails.rs", "agent_permissions.rs", "agent_run_coordinator.rs",
    "agent_runtime.rs", "agent_runtime", "agent_tools.rs", "agent_tools", "chat.rs",
    "commands/chat_commands.rs", "commands/proposal_commands.rs",
)
CHAT_LEAVES = {"citations.rs", "date_time.rs", "structured_answer.rs"}
COPY_ROOTS = ("src", "src-tauri", "static", "e2e", "scripts", "docs", "patches", ".cargo")
COPY_FILES = (
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "rust-toolchain.toml",
    "svelte.config.js", "vite.config.js", "tsconfig.json", "components.json",
    "AGENTS.md", "ARCHITECTURE.md", "CONTEXT.md", "testing.md", ".gitignore",
)
OMIT_DIRS = {"node_modules", "target", ".git", ".scratch", ".svelte-kit", "build", "dist", ".cache", "__pycache__", "xcuserdata"}
SECRET_SUFFIXES = {".pem", ".p12", ".pfx", ".key", ".mobileprovision", ".sqlite", ".sqlite3", ".db", ".wal", ".shm"}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def tokens(source: str) -> list[str]:
    """Rust lexical tokens needed for module declarations, cfg and fn names.

    Discards comments and character literals; keeps strings as opaque tokens.
    Unknown syntax is never used to establish a compiler proof.
    """
    result, index = [], 0
    while index < len(source):
        char = source[index]
        if char.isspace():
            index += 1
            continue
        if source.startswith("//", index):
            end = source.find("\n", index)
            index = len(source) if end < 0 else end + 1
            continue
        if source.startswith("/*", index):
            depth, index = 1, index + 2
            while depth and index < len(source):
                if source.startswith("/*", index):
                    depth, index = depth + 1, index + 2
                elif source.startswith("*/", index):
                    depth, index = depth - 1, index + 2
                else:
                    index += 1
            if depth:
                raise ValueError("Unclosed Rust comment")
            continue
        raw = re.match(r'(?:br|r)(#*)"', source[index:])
        if raw:
            end_marker = '"' + raw.group(1)
            end = source.find(end_marker, index + raw.end())
            if end < 0:
                raise ValueError("Unclosed Rust raw string")
            result.append(source[index:end + len(end_marker)])
            index = end + len(end_marker)
            continue
        if char == '"':
            start, index = index, index + 1
            while index < len(source):
                if source[index] == "\\":
                    index += 2
                elif source[index] == '"':
                    index += 1
                    break
                else:
                    index += 1
            result.append(source[start:index])
            continue
        character = re.match(r"'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^'\\\n])'", source[index:])
        if character:
            index += character.end()
            continue
        word = re.match(r"[A-Za-z_][A-Za-z_0-9]*", source[index:])
        if word:
            result.append(word.group())
            index += word.end()
            continue
        result.append(char)
        index += 1
    return result


def cfg_value(items: list[str]) -> bool | None:
    """Three-valued cfg; unknown platform predicates conservatively stay reachable."""
    if len(items) == 1:
        return False if items[0] == "test" else None
    if len(items) == 3 and items[0:2] == ["feature", "="]:
        return json.loads(items[2]) in FEATURES
    if len(items) >= 3 and items[1] == "(" and items[-1] == ")":
        groups, current, depth = [], [], 0
        for token in items[2:-1]:
            if token == "," and depth == 0:
                if current:
                    groups.append(current)
                current = []
            else:
                current.append(token)
                depth += (token == "(") - (token == ")")
        if current:
            groups.append(current)
        values = [cfg_value(group) for group in groups]
        if items[0] in {"all", "cfg"}:
            return False if False in values else None if None in values else True
        if items[0] == "any":
            return True if True in values else None if None in values else False
        if items[0] == "not" and len(values) == 1:
            return None if values[0] is None else not values[0]
    return None


def external_modules(path: Path) -> list[Path]:
    values = tokens(path.read_text())
    depth, index, attrs, found = 0, 0, [], []
    while index < len(values):
        token = values[index]
        if depth == 0 and token == "#" and values[index + 1:index + 2] == ["["]:
            end, nesting = index + 2, 1
            while end < len(values) and nesting:
                nesting += (values[end] == "[") - (values[end] == "]")
                end += 1
            if nesting:
                raise ValueError(f"Unclosed Rust attribute: {path}")
            attrs.append(values[index + 2:end - 1])
            index = end
            continue
        if depth == 0 and token == "mod" and index + 2 < len(values) and values[index + 2] == ";":
            enabled = all(cfg_value(attr) is not False for attr in attrs if attr[:1] == ["cfg"])
            if enabled:
                explicit = [attr[2] for attr in attrs if attr[:2] == ["path", "="] and len(attr) == 3]
                if explicit:
                    child = path.parent / json.loads(explicit[-1])
                else:
                    base = path.parent if path.stem in {"lib", "mod"} else path.parent / path.stem
                    child = base / (values[index + 1] + ".rs")
                    if not child.is_file():
                        child = base / values[index + 1] / "mod.rs"
                if not child.is_file():
                    raise ValueError(f"Enabled module missing: {child}")
                found.append(child.resolve())
        depth += (token == "{") - (token == "}")
        if depth < 0:
            raise ValueError(f"Unbalanced Rust braces: {path}")
        if depth == 0 and token in {";", "}"}:
            attrs = []
        index += 1
    if depth:
        raise ValueError(f"Unbalanced Rust braces: {path}")
    return found


def module_graph(root: Path) -> list[str]:
    found, pending = set(), [root / "src-tauri/src/lib.rs"]
    while pending:
        path = pending.pop().resolve()
        path.relative_to(root.resolve())
        if path in found:
            continue
        found.add(path)
        pending.extend(external_modules(path))
    return sorted(str(path.relative_to(root.resolve())) for path in found)


def removal_files(root: Path) -> list[str]:
    source, found = root / "src-tauri/src", set()
    for relative in LEGACY_ROOTS:
        path = source / relative
        if not path.exists():
            raise ValueError(f"Expected legacy source is missing: {path}")
        found.update(path.rglob("*") if path.is_dir() else [path])
    found.update(path for path in (source / "chat").rglob("*") if path.relative_to(source / "chat").as_posix() not in CHAT_LEAVES)
    return sorted(str(path.relative_to(root)) for path in found if path.is_file())


def plan(root: Path) -> dict:
    root = root.resolve()
    graph, removed = module_graph(root), removal_files(root)
    collision = set(graph) & set(removed)
    if collision:
        raise ValueError(f"Removal reaches retained Pi graph: {sorted(collision)}")
    leaves = {f"src-tauri/src/chat/{leaf}" for leaf in CHAT_LEAVES} | {
        "src-tauri/src/chat_domain.rs", "src-tauri/src/proposal_policy.rs", "src-tauri/src/provider_config.rs",
    }
    if not leaves.issubset(graph):
        raise ValueError(f"Required retained leaves missing from graph: {sorted(leaves - set(graph))}")
    ledger = []
    for relative in removed:
        data = (root / relative).read_bytes()
        lexical = tokens(data.decode()) if relative.endswith(".rs") else []
        ledger.append({"path": relative, "sha256": digest(data), "bytes": len(data),
                       "lexicalFnNames": sorted({lexical[index + 1] for index, token in enumerate(lexical[:-1]) if token == "fn"})})
    return {"schema": "gneauxghts-pi-removal-v1", "features": sorted(FEATURES), "piGraph": graph,
            "removed": ledger, "retainedPolicyLeaves": sorted(leaves),
            "compilerProof": "pending native owner build and gates",
            "limits": ["Conservative top-level module scan mirrors the existing exclusion test; inline modules/macros require compiler validation.",
                       "lexicalFnNames includes tests and inactive cfg; it is not a compiler function count or maintained-cost measurement.",
                       "Shared frontend controllers, default native wiring, dependencies and retained policy remain; this is a bounded Rust lifecycle removal only."]}


def omitted(path: Path) -> bool:
    name = path.name.lower()
    stale_app_artifact = name == "libapp.a" or path.suffix.lower() in {".app", ".dsym", ".ipa", ".xcarchive"}
    return stale_app_artifact or path.name in OMIT_DIRS or name.startswith(".env") or name.endswith(".env") or ".env." in name or name in {"credentials", "credentials.json", "credentials.toml", "secrets.json", ".ds_store"} or path.suffix.lower() in SECRET_SUFFIXES


def copy_source(root: Path, destination: Path) -> list[dict]:
    manifest = []
    def copy(path: Path):
        if omitted(path):
            return
        if path.is_symlink():
            raise ValueError(f"Source symlink requires explicit review; not followed: {path.relative_to(root)}")
        if path.is_dir():
            for child in sorted(path.iterdir()):
                copy(child)
        elif path.is_file():
            relative = path.relative_to(root)
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            data = path.read_bytes()
            target.write_bytes(data)
            shutil.copymode(path, target)
            manifest.append({"path": str(relative), "sha256": digest(data), "bytes": len(data)})
    for relative in (*COPY_ROOTS, *COPY_FILES):
        path = root / relative
        if path.exists():
            copy(path)
    return manifest


def prepare(root: Path, output: Path, target_cache: Path | None = None) -> dict:
    root, output = root.resolve(), output.resolve()
    if output.is_relative_to(root) or root.is_relative_to(output):
        raise ValueError("Experiment root must be disjoint from the working source")
    if output.exists():
        raise ValueError("Experiment root must not already exist")
    if target_cache:
        target_cache = target_cache.resolve()
        if target_cache.is_relative_to(root) or root.is_relative_to(target_cache) or target_cache.is_relative_to(output) or output.is_relative_to(target_cache):
            raise ValueError("Target cache must be separate from working source and experiment")
    ledger = plan(root)
    output.mkdir(parents=True)
    snapshot, archive = output / "source", output / "removed-source"
    snapshot.mkdir()
    manifest = copy_source(root, snapshot)
    diff = []
    for item in ledger["removed"]:
        relative = item["path"]
        path = snapshot / relative
        data = path.read_bytes()
        if digest(data) != item["sha256"]:
            raise ValueError(f"Source changed during capture: {relative}")
        retained = archive / relative
        retained.parent.mkdir(parents=True, exist_ok=True)
        retained.write_bytes(data)
        for line in difflib.unified_diff(data.decode().splitlines(keepends=True), [], fromfile="a/" + relative, tofile="/dev/null"):
            diff.append(line if line.endswith("\n") else line + "\n\\ No newline at end of file\n")
        path.unlink()
    if module_graph(snapshot) != ledger["piGraph"]:
        raise ValueError("Pi module graph changed after physical removal")
    # Recheck original bytes so concurrent editing fails instead of claiming an exact snapshot.
    if any(digest((root / item["path"]).read_bytes()) != item["sha256"] for item in manifest):
        raise ValueError("Working source changed during capture; retain this failed capture separately and retry with a fresh root")
    if (root / "node_modules").is_dir():
        (snapshot / "node_modules").symlink_to(root / "node_modules", target_is_directory=True)
    if target_cache:
        target_cache.mkdir(parents=True, exist_ok=True)
        (snapshot / "src-tauri/target").symlink_to(target_cache, target_is_directory=True)
    ledger["sourceManifestSha256"] = digest(json.dumps(manifest, sort_keys=True).encode())
    ledger["copyPolicy"] = {"roots": list(COPY_ROOTS), "rootFiles": list(COPY_FILES), "omittedDirectories": sorted(OMIT_DIRS),
                          "omittedArtifacts": ["libapp.a", "*.app", "*.dSYM", "*.ipa", "*.xcarchive", "environment and credential files", "private key/certificate/provision files", "SQLite database/WAL/SHM files"],
                          "sourceSymlinks": "refused; never followed", "thirdPartyRuntimeResources": "retained, hashed in source manifest; not removal savings"}
    ledger["cacheLinks"] = {"node_modules": str(root / "node_modules") if (snapshot / "node_modules").exists() else None, "target": str(target_cache) if target_cache else None}
    (output / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (output / "removal-ledger.json").write_text(json.dumps(ledger, indent=2) + "\n")
    (output / "removal.patch").write_text("".join(diff))
    (output / "REPRODUCE.md").write_text(REPRODUCTION)
    return ledger


REPRODUCTION = """# Native owner reproduction — not executed by the preparer

This source physically lacks the files in ../removal-ledger.json. Originals are
archived outside source in ../removed-source; ../removal.patch is the exact diff.
The working source and production default are untouched. The reduced tree is
only expected to compile with pi-prototype; ordinary default wiring still names
the removed modules behind disabled cfg. Do not claim a default-build pass here.

Run from source/ under the exclusive native lease. Use a separate target cache;
never link the original worktree target (the binary could otherwise be replaced).
An optional precloned cache may accelerate compilation, but final native gates
must bind their binary/frontend/source receipts to this tree, not cached results.

1. `VITE_PI_PROTOTYPE=true VITE_E2E_NATIVE=true pnpm build`
2. `cargo test --manifest-path src-tauri/Cargo.toml --features pi-prototype,e2e-wdio --test pi_lifecycle_exclusion`
3. `TAURI_CONFIG="$(cat scripts/pi-prototype/tauri.prototype.conf.json)" cargo build --manifest-path src-tauri/Cargo.toml --features pi-prototype,e2e-wdio`
4. Hash the exact source manifest, lockfiles, removal ledger/patch, build config,
   built binary and served frontend; preserve compiler logs with those receipts.
5. Run the SAME final desktop interactive/fault/expanded fixture gates as the
   unremoved lane from this cwd. Direct gate scripts use this source's
   src-tauri/target/debug/gneauxghts. In particular run
   `PI_PROTOTYPE_INTERACTIVE_FAILURES=true node scripts/pi-prototype/desktop-interactive-gate.mjs`
   and `node scripts/pi-prototype/fault-gate.mjs`; reproduce the final expanded
   matrix and both compatible/Responses fixture protocols with the exact flags
   recorded by the native owner. Gate scripts manage their disposable roots;
   unset PI_PROTOTYPE_DATA and use no private vault or hands-on evaluation root.
6. The required final iOS, live-provider and default-build regression gates are
   separate evidence. No template command or structural graph pass substitutes
   for them. Record unmet gates as pending, never successful removal acceptance.

Avoid run.mjs against another cwd/artifact: it rebuilds and can overwrite the
binary being compared. Record binary hashes before/after gates. Added Pi adapters,
policy, recovery, frontend caller obligations and dependencies remain part of
the cost ledger. Lexical function names/file bytes are inventory, not savings.
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("plan", "prepare"))
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path)
    parser.add_argument("--target-cache", type=Path)
    args = parser.parse_args()
    if args.mode == "plan":
        if args.output or args.target_cache:
            parser.error("plan is read-only and accepts neither output nor cache")
        ledger = plan(args.source.resolve())
        print(json.dumps({"schema": ledger["schema"], "removedPaths": [item["path"] for item in ledger["removed"]], "retainedPolicyLeaves": ledger["retainedPolicyLeaves"], "compilerProof": ledger["compilerProof"]}, indent=2))
    else:
        if not args.output or not args.output.is_absolute():
            parser.error("prepare requires a fresh absolute --output outside source")
        if args.target_cache and not args.target_cache.is_absolute():
            parser.error("target cache must be an explicit absolute path")
        ledger = prepare(args.source, args.output, args.target_cache)
        print(json.dumps({"sourceManifestSha256": ledger["sourceManifestSha256"], "experiment": str(args.output), "compilerProof": ledger["compilerProof"]}))


if __name__ == "__main__":
    main()
