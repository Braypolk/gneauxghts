#!/usr/bin/env python3
"""Isolated macOS LiteRT text/vision probe; no downloads or vault access.

Requires the pinned litert-lm-api wheel in a separate environment and the Mach
memory helper compiled from macos_process_memory.c. Run each backend in a fresh
process. Runtime caches must remain in the explicitly supplied cache directory.
"""
import argparse
import ctypes
import dataclasses
import hashlib
import importlib.metadata
import json
import pathlib
import time

from embedding_eval import cosine, png_fixture, quality, timings, vectors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["model", "memory-library", "cache", "output"]:
        parser.add_argument("--"+name, type=pathlib.Path, required=True)
    parser.add_argument("--backend", choices=["cpu", "gpu"], required=True)
    parser.add_argument("--vision-tokens", type=int, choices=[70, 140], default=140)
    parser.add_argument("--samples", type=int, default=40)
    parser.add_argument("--fixture", type=pathlib.Path,
                        default=pathlib.Path(__file__).parent / "fixtures/embedding-evaluation.json")
    args = parser.parse_args()
    if args.samples < 2:
        parser.error("--samples must be at least two")
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fixture = json.loads(args.fixture.read_text())
    memory = ctypes.CDLL(str(args.memory_library)).sample_process_memory
    memory.argtypes = [ctypes.POINTER(ctypes.c_uint64)]
    memory.restype = ctypes.c_int

    def snapshot():
        values = (ctypes.c_uint64*4)()
        status = memory(values)
        if status:
            raise RuntimeError(f"Mach memory query failed: {status}")
        return dict(zip(["rss_bytes", "peak_rss_bytes", "physical_footprint_bytes",
                         "peak_physical_footprint_bytes"], values, strict=True))

    report = {"backend": args.backend, "vision_tokens": args.vision_tokens,
              "text_min_signature": 128, "text_max_signature": 1024,
              "output_dimensions": 768, "model_bytes": args.model.stat().st_size,
              "fixture_sha256": hashlib.sha256(args.fixture.read_bytes()).hexdigest(),
              "runtime_version": importlib.metadata.version("litert-lm-api"),
              "cache": str(args.cache), "phases": {"before_runtime_import": snapshot()}}

    def checkpoint(name):
        report["phases"][name] = snapshot()
        args.output.write_text(json.dumps(report, indent=2)+"\n")
        print(name, json.dumps(report["phases"][name]), flush=True)

    import litert_lm
    checkpoint("after_runtime_import")
    with litert_lm.ModelInfo(str(args.model)) as info:
        report["reported_model_metadata"] = {
            "modalities": dataclasses.asdict(info.input_modalities),
            "embedding_dimension": info.embedding.dimension,
            "text_signatures": info.embedding.signature_selection,
            "vision_signatures": info.vision_signature_selection,
        }
    backend = (litert_lm.Backend.CPU(thread_count=12) if args.backend == "cpu"
               else litert_lm.Backend.GPU())
    options = litert_lm.EmbeddingOptions(normalize=True, output_size=768,
                                       insert_special_tokens=True,
                                       input_overflow_strategy=litert_lm.InputOverflowStrategy.ERROR,
                                       vision_tokens_per_image=args.vision_tokens)
    start = time.perf_counter()
    with litert_lm.EmbeddingEngine(str(args.model), backend=backend, vision_backend=backend,
                                   min_input_length=128, max_input_length=1024,
                                   vision_tokens_per_image=args.vision_tokens,
                                   cache_dir=str(args.cache)) as engine:
        report["startup_ms"] = (time.perf_counter()-start)*1000
        checkpoint("after_engine_load")

        def embed(items):
            rows = engine.compute_embedding_batch(items, options=options)
            return vectors({"data": [{"index": i, "embedding": row.embedding}
                                      for i, row in enumerate(rows)]}, len(items))

        docs = embed(["title: none | text: "+text for text in fixture["documents"]])
        query_inputs = ["task: search result | query: "+case["text"] for case in fixture["queries"]]
        queries = embed(query_inputs)
        report["text"] = quality(queries, docs, [case["relevant"] for case in fixture["queries"]])
        text_times = []
        for i in range(args.samples):
            start = time.perf_counter()
            vector = embed([query_inputs[i % len(query_inputs)]])[0]
            text_times.append((time.perf_counter()-start)*1000)
            if cosine(vector, queries[i % len(queries)]) < 0.9999:
                raise ValueError("Batch and singleton text vectors differ")
        report["text_latency"] = timings(text_times)
        checkpoint("after_text_work")
        images_in = [litert_lm.Content.ImageBytes(png_fixture(kind))
                     for kind in ["rising", "falling", "circle", "square"]]
        start = time.perf_counter()
        images = [embed([item])[0] for item in images_in]
        report["first_four_images_ms"] = (time.perf_counter()-start)*1000
        checkpoint("after_first_images")
        if any(cosine(a, b) > 0.9999 for i, a in enumerate(images) for b in images[i+1:]):
            raise ValueError("Distinct images produced indistinguishable vectors")
        image_queries = embed(["task: search result | query: "+text
                               for text in fixture["image_descriptions"]])
        image_texts = embed(["title: none | text: "+text for text in fixture["image_descriptions"]])
        judgments = [[i] for i in range(4)]
        report["text_to_image"] = quality(image_queries, images, judgments)
        report["image_to_text"] = quality(images, image_texts, judgments)
        image_times = []
        for i in range(args.samples):
            start = time.perf_counter()
            vector = embed([images_in[i % 4]])[0]
            image_times.append((time.perf_counter()-start)*1000)
            if cosine(vector, images[i % 4]) < 0.9999:
                raise ValueError("Repeated image vectors differ")
        report["image_latency"] = timings(image_times)
        report["vectors"] = {"documents": docs, "queries": queries, "images": images}
        checkpoint("after_text_and_vision_work")
        time.sleep(2)
        checkpoint("after_two_seconds_idle")
    checkpoint("after_engine_close")
    print(json.dumps({key: value for key, value in report.items() if key != "vectors"}, indent=2))


if __name__ == "__main__":
    main()
