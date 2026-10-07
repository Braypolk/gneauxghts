#!/usr/bin/env python3
"""Measure the pinned, previously downloaded GGUF controls with macOS metrics.

Paths are explicit snapshots of this isolated experiment; never touches a vault.
"""
import ctypes
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "scripts"))
from embedding_eval import evaluate, server, summary

artifacts = pathlib.Path("/private/tmp/gneauxghts-gemma-spike")
output = artifacts / "macos-baseline-evaluation"
output.mkdir(parents=True, exist_ok=True)
fixture = json.loads((root / "scripts/fixtures/embedding-evaluation.json").read_text())
sample = ctypes.CDLL(str(artifacts / "process-memory.dylib")).sample_child_memory
sample.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_uint64)]
sample.restype = ctypes.c_int
runtime = artifacts / "runtime/llama-b11454/llama-server"
model = artifacts / "embeddinggemma-2-Q8_0.gguf"
jina = pathlib.Path("/Users/bray.polkinghorne/Library/Application Support/com.braypolkinghorne.gneauxghts/semantic/models/jina-embeddings-v5-text-nano-retrieval-Q6_K.gguf")
report = {"models": {}}
variants = [
    ("jina", pathlib.Path("/opt/homebrew/bin/llama-server"), jina, None, "last"),
    ("gemma_f16_projector", runtime, model, artifacts / "mmproj-F16.gguf", "mean"),
    ("gemma_q8_no_audio", runtime, model, artifacts / "mmproj-Q8_0-no-audio-experiment.gguf", "mean"),
]
for name, binary, backbone, projector, pooling in variants:
    print(f"Evaluating {name}", flush=True)
    with server(binary, backbone, projector, pooling, output, name, 3) as (port, resources):
        result = evaluate(port, "jina" if name == "jina" else "gemma", fixture, 40, projector is not None)
        values = (ctypes.c_uint64*3)()
        status = sample(resources["server_pid"], values)
        if status:
            raise RuntimeError(f"Child memory query failed: {status}")
        resources["macos_native"] = dict(zip(
            ["rss_bytes", "physical_footprint_bytes", "peak_physical_footprint_bytes"], values, strict=True))
    result["resources"] = resources
    report["models"][name] = result
    (output / "results.json").write_text(json.dumps(report, indent=2)+"\n")
    print(json.dumps(summary(report)[name], indent=2), flush=True)
