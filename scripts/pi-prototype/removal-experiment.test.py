#!/usr/bin/env python3
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("removal_experiment", Path(__file__).with_name("removal-experiment.py"))
removal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(removal)


def write(root, relative, content):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return path


def fixture(root):
    for relative in removal.LEGACY_ROOTS:
        if relative.endswith(".rs"):
            write(root, "src-tauri/src/" + relative, 'fn legacy_turn() { let _ = "fn not_a_function() {}"; }\n')
        else:
            write(root, "src-tauri/src/" + relative + "/loop.rs", "fn legacy_loop() {}\n")
    write(root, "src-tauri/src/chat/store.rs", "fn persist_old_run() {}")
    for leaf in removal.CHAT_LEAVES:
        write(root, "src-tauri/src/chat/" + leaf, "pub fn retained_policy() {}\n")
    for leaf in ("chat_domain", "proposal_policy", "provider_config"):
        write(root, "src-tauri/src/" + leaf + ".rs", "pub fn retained_domain() {}\n")
    write(root, "src-tauri/src/pi_chat.rs", '\n'.join(f'#[path = "chat/{leaf}"] mod {Path(leaf).stem};' for leaf in sorted(removal.CHAT_LEAVES)))
    write(root, "src-tauri/src/lib.rs", '''
#[cfg(not(feature = "pi-prototype"))] mod agent_runtime;
#[cfg(not(feature = "pi-prototype"))] mod chat;
#[cfg(feature = "pi-prototype")] #[path = "pi_chat.rs"] mod chat;
mod chat_domain; mod proposal_policy; mod provider_config;
''')
    write(root, "src/main.ts", "export const source = true;\n")
    write(root, "package.json", "{}\n")


class RemovalExperimentTests(unittest.TestCase):
    def test_rust_lexer_hides_comment_string_raw_and_character_tokens(self):
        values = removal.tokens('/* nested /* fn fake() {} */ */ fn real() { let x = r###"mod hidden; }"###; let c = \'}\'; // mod nope;\n }')
        self.assertEqual([values[i + 1] for i, value in enumerate(values[:-1]) if value == "fn"], ["real"])
        self.assertNotIn("hidden", values)

    def test_cfg_unknown_remains_conservative_even_under_not(self):
        for text, expected in (( 'cfg(not(feature = "pi-prototype"))', False),
                               ('cfg(all(feature = "pi-prototype", not(test)))', True),
                               ('cfg(any(test, feature = "e2e-wdio"))', True),
                               ('cfg(not(target_os = "ios"))', None)):
            self.assertIs(removal.cfg_value(removal.tokens(text)), expected)

    def test_actual_module_graph_and_removal_inventory_are_disjoint(self):
        root = Path(__file__).resolve().parents[2]
        ledger = removal.plan(root)
        self.assertFalse(set(ledger["piGraph"]) & {item["path"] for item in ledger["removed"]})
        self.assertIn("src-tauri/src/pi_chat.rs", ledger["piGraph"])
        self.assertIn("src-tauri/src/services/note_timeline.rs", ledger["piGraph"])
        self.assertEqual(ledger["compilerProof"], "pending native owner build and gates")

    def test_prepare_physically_removes_and_archives_exact_bytes_preserving_source(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root, output, cache = base / "working", base / "experiment", base / "cache"
            fixture(root)
            write(root, "src-tauri/target/private", "cache")
            write(root, "src-tauri/gen/apple/private", "generated")
            write(root, "src-tauri/gen/apple/Externals/arm64/debug/libapp.a", "old native application")
            write(root, "src/.env.local", "SECRET=value")
            write(root, "src/key.pem", "private")
            write(root, "node_modules/library/index.js", "cache")
            write(root, ".scratch/private.md", "private")
            before = (root / "src-tauri/src/chat/store.rs").read_bytes()
            ledger = removal.prepare(root, output, cache)
            self.assertEqual((root / "src-tauri/src/chat/store.rs").read_bytes(), before)
            self.assertFalse((output / "source/src-tauri/src/chat/store.rs").exists())
            self.assertEqual((output / "removed-source/src-tauri/src/chat/store.rs").read_bytes(), before)
            self.assertTrue((output / "source/src-tauri/src/chat/citations.rs").is_file())
            self.assertEqual((output / "source/src-tauri/target").resolve(), cache.resolve())
            self.assertEqual((output / "source/node_modules").resolve(), (root / "node_modules").resolve())
            self.assertFalse((output / "source/src/.env.local").exists())
            self.assertFalse((output / "source/src/key.pem").exists())
            self.assertTrue((output / "source/src-tauri/gen/apple/private").is_file())
            self.assertFalse((output / "source/src-tauri/gen/apple/Externals/arm64/debug/libapp.a").exists())
            self.assertFalse((output / "source/.scratch").exists())
            self.assertIn("--- a/src-tauri/src/chat/store.rs", (output / "removal.patch").read_text())
            self.assertIn("\\ No newline at end of file", (output / "removal.patch").read_text())
            manifest = json.loads((output / "source-manifest.json").read_text())
            self.assertEqual(ledger["sourceManifestSha256"], removal.digest(json.dumps(manifest, sort_keys=True).encode()))
            item = next(item for item in ledger["removed"] if item["path"].endswith("agent_runtime.rs"))
            self.assertEqual(item["lexicalFnNames"], ["legacy_turn"])

    def test_reachable_legacy_module_fails_closed_before_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root)
            with (root / "src-tauri/src/lib.rs").open("a") as source:
                source.write("mod agent_tools;\n")
            with self.assertRaisesRegex(ValueError, "Removal reaches retained Pi graph"):
                removal.plan(root)

    def test_missing_enabled_module_and_source_symlink_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "working"
            fixture(root)
            write(root, "src-tauri/src/lib.rs", "mod missing;\n")
            with self.assertRaisesRegex(ValueError, "Enabled module missing"):
                removal.module_graph(root)
            fixture(root)
            (root / "src/linked").symlink_to(base / "outside")
            with self.assertRaisesRegex(ValueError, "Source symlink"):
                removal.prepare(root, base / "experiment")

    def test_refuses_existing_output_overlap_or_original_target_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "working"
            fixture(root)
            for output, cache in ((root / "experiment", None), (base, None), (base / "experiment", root / "src-tauri/target")):
                with self.assertRaises(ValueError):
                    removal.prepare(root, output, cache)
            (base / "existing").mkdir()
            with self.assertRaisesRegex(ValueError, "must not already exist"):
                removal.prepare(root, base / "existing")


if __name__ == "__main__":
    unittest.main()
