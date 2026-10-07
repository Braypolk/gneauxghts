#!/usr/bin/env python3
"""Explicit, isolated real-runtime gate. Never accesses a vault or downloads files.

Run --help for artifact arguments. Servers run one at a time and are always
reaped. The output contains synthetic fixture scores/resources, never user data.
F16 GGUF is a quantization comparator, not proof of official-framework parity.
"""
import argparse
import base64
import contextlib
import hashlib
import json
import math
import pathlib
import socket
import statistics
import struct
import subprocess
import threading
import time
import urllib.error
import urllib.request
import zlib


def request(port, path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}/{path}", data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)


def vectors(response, count):
    rows = sorted(response["data"], key=lambda row: row["index"])
    if [row["index"] for row in rows] != list(range(count)):
        raise ValueError("Embedding response has missing/duplicate input indexes")
    result = [row["embedding"] for row in rows]
    for vector in result:
        if len(vector) != 768 or not all(math.isfinite(x) for x in vector):
            raise ValueError("Expected finite 768-dimensional output")
        if abs(sum(x*x for x in vector) - 1) > 0.002:
            raise ValueError("Expected L2-normalized nonzero output")
    return result


def cosine(a, b):
    return sum(x*y for x, y in zip(a, b, strict=True))


def ranking(query, corpus):
    return sorted(range(len(corpus)), key=lambda i: (-cosine(query, corpus[i]), i))


def quality(queries, corpus, judgments):
    ranks = [ranking(q, corpus) for q in queries]
    return {"top1": statistics.mean(order[0] in good for order, good in zip(ranks, judgments)),
            "mrr": statistics.mean(1 / (next(i for i, item in enumerate(order) if item in good) + 1)
                                   for order, good in zip(ranks, judgments)),
            "rankings": ranks}


def timings(samples):
    ordered = sorted(samples)
    return {"samples": len(samples), "p50_ms": statistics.median(samples),
            "p95_ms": ordered[math.ceil(len(ordered)*0.95)-1]}


def png_fixture(kind, width=384, height=256):
    """Small deterministic diagrams; no decoder/dependency/download required."""
    pixels = bytearray([255] * (width * height * 3))

    def pixel(x, y, color):
        if 0 <= x < width and 0 <= y < height:
            at = (y*width+x)*3
            pixels[at:at+3] = bytes(color)

    def line(x1, y1, x2, y2, color, thickness=3):
        steps = max(abs(x2-x1), abs(y2-y1), 1)
        for i in range(steps+1):
            x, y = round(x1+(x2-x1)*i/steps), round(y1+(y2-y1)*i/steps)
            for dx in range(-thickness, thickness+1):
                for dy in range(-thickness, thickness+1):
                    pixel(x+dx, y+dy, color)

    black = (20, 20, 20)
    if kind in ("rising", "falling"):
        line(40, 220, 350, 220, black, 1)
        line(40, 220, 40, 25, black, 1)
        ys = [195, 170, 150, 100, 60, 30]
        if kind == "falling":
            ys.reverse()
        for i in range(5):
            line(55+i*55, ys[i], 55+(i+1)*55, ys[i+1], (30, 100, 220))
    elif kind == "circle":
        for y in range(height):
            for x in range(width):
                if (x-192)**2+(y-128)**2 < 85**2:
                    pixel(x, y, (220, 25, 25))
    elif kind == "square":
        for y in range(50, 206):
            for x in range(114, 270):
                pixel(x, y, (25, 70, 220))
    else:
        raise ValueError(kind)

    def chunk(name, data):
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name+data))

    rows = b"".join(b"\0" + pixels[y*width*3:(y+1)*width*3] for y in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def image_input(data):
    return {"content": [{"type": "image_url", "image_url": {
        "url": "data:image/png;base64," + base64.b64encode(data).decode()}}]}


def gates(report):
    models, limits = report["models"], report["thresholds"]
    errors = {name: value["error"] for name, value in models.items() if "error" in value}
    if errors:
        return {"runtime": {"passed": False, "errors": errors}}
    baseline, candidate, reference = [models[name] for name in ["jina", "gemma_q8", "gemma_f16"]]
    comparisons = [(cosine(a, b)) for field in ["documents", "queries", "images"]
                   for a, b in zip(candidate[field], reference[field], strict=True)]
    agreement = statistics.mean(a[0] == b[0] for a, b in zip(
        candidate["text"]["rankings"], reference["text"]["rankings"], strict=True))
    observed = {
        "text_mrr_regression": baseline["text"]["mrr"] - candidate["text"]["mrr"],
        "text_top1_regression": baseline["text"]["top1"] - candidate["text"]["top1"],
        "text_p95_baseline_ratio": candidate["text_latency"]["p95_ms"] / baseline["text_latency"]["p95_ms"],
        "image_p95_ms": candidate["image_latency"]["p95_ms"],
        "peak_rss_bytes": candidate["resources"]["peak_rss_bytes"],
        "text_to_image_top1": candidate["text_to_image"]["top1"],
        "image_to_text_top1": candidate["image_to_text"]["top1"],
        "quantization_cosine": min(comparisons),
        "quantization_top1_agreement": agreement,
    }
    checks = [
        ("text_mrr_regression", "text_mrr_max_regression", False),
        ("text_top1_regression", "text_top1_max_regression", False),
        ("text_p95_baseline_ratio", "text_p95_max_baseline_ratio", False),
        ("image_p95_ms", "image_p95_max_ms", False),
        ("peak_rss_bytes", "peak_rss_max_bytes", False),
        ("text_to_image_top1", "text_image_top1_min", True),
        ("image_to_text_top1", "text_image_top1_min", True),
        ("quantization_cosine", "quantization_cosine_min", True),
        ("quantization_top1_agreement", "quantization_top1_agreement_min", True),
    ]
    return {key: {"observed": observed[key], "threshold": limits[limit],
                  "passed": observed[key] is not None and (
                      observed[key] >= limits[limit] if minimum else observed[key] <= limits[limit])}
            for key, limit, minimum in checks}


def summary(report):
    return {name: {key: ({k: v for k, v in value.items() if k not in ["rankings", "args"]}
                         if isinstance(value, dict) else value)
                   for key, value in model.items() if key not in ["documents", "queries", "images"]}
            for name, model in report["models"].items()}


@contextlib.contextmanager
def server(binary, model, projector, pooling, output, name, verbosity=0, *,
           slots=4, context=8192, batch=2048, microbatch=2048):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    args = [str(binary), "-m", str(model), "--embeddings", "--pooling", pooling,
            "--host", "127.0.0.1", "--port", str(port), "--ctx-size", str(context),
            "--threads", "12", "--threads-batch", "12", "--parallel", str(slots),
            "-ngl", "99", "--log-verbosity", str(verbosity)]
    if projector:
        args += ["--mmproj", str(projector), "--batch-size", str(batch), "--ubatch-size", str(microbatch),
                 "--image-min-tokens", "280", "--image-max-tokens", "280"]
    log = output / f"{name}.log"
    stopped = threading.Event()
    rss = []
    started = time.perf_counter()
    with log.open("w") as stream:
        child = subprocess.Popen(args, stdout=stream, stderr=stream)

        def sample():
            while not stopped.wait(0.1):
                proc = subprocess.run(["ps", "-o", "rss=", "-p", str(child.pid)],
                                      capture_output=True, text=True)
                if proc.returncode == 0 and proc.stdout.strip():
                    rss.append(int(proc.stdout.strip())*1024)

        monitor = threading.Thread(target=sample, daemon=True)
        try:
            monitor.start()
            deadline = time.monotonic() + 240
            while True:
                if child.poll() is not None:
                    raise RuntimeError(f"{name} exited {child.returncode}; inspect {log}")
                try:
                    request(port, "health")
                    break
                except (urllib.error.URLError, TimeoutError, ConnectionError):
                    if time.monotonic() >= deadline:
                        raise TimeoutError(f"{name} startup timeout; inspect {log}")
                    time.sleep(0.1)
            stats = {"startup_ms": (time.perf_counter()-started)*1000,
                     "server_pid": child.pid,
                     "args": args, "model_bytes": model.stat().st_size,
                     "projector_bytes": projector.stat().st_size if projector else 0}
            yield port, stats
            stats["idle_rss_bytes"] = rss[-1] if rss else None
            stats["peak_rss_bytes"] = max(rss) if rss else None
        finally:
            stopped.set()
            if monitor.ident is not None:
                monitor.join(timeout=5)
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


def evaluate(port, family, fixture, samples, vision):
    document_prefix = "Document: " if family == "jina" else "title: none | text: "
    query_prefix = "Query: " if family == "jina" else "task: search result | query: "

    def embed(inputs):
        return vectors(request(port, "v1/embeddings", {"input": inputs, "encoding_format": "float"}), len(inputs))

    start = time.perf_counter()
    docs = embed([document_prefix + text for text in fixture["documents"]])
    throughput = len(docs)/(time.perf_counter()-start)
    query_inputs = [query_prefix + case["text"] for case in fixture["queries"]]
    queries = embed(query_inputs)
    text_times = []
    for i in range(samples):
        start = time.perf_counter()
        one = embed([query_inputs[i % len(query_inputs)]])[0]
        text_times.append((time.perf_counter()-start)*1000)
        if cosine(one, queries[i % len(query_inputs)]) < 0.9999:
            raise ValueError("Batch and single-input embeddings differ")
    report = {"text": quality(queries, docs, [q["relevant"] for q in fixture["queries"]]),
              "text_latency": timings(text_times), "documents_per_second": throughput,
              "documents": docs, "queries": queries}
    if vision:
        kinds = ["rising", "falling", "circle", "square"]
        inputs = [image_input(png_fixture(kind)) for kind in kinds]
        # Serialize image work, as required by the production plan.
        images = [embed([item])[0] for item in inputs]
        if any(cosine(a, b) > 0.9999 for i, a in enumerate(images) for b in images[i+1:]):
            raise ValueError("Different images produced indistinguishable vectors")
        image_queries = embed([query_prefix + text for text in fixture["image_descriptions"]])
        image_texts = embed([document_prefix + text for text in fixture["image_descriptions"]])
        try:
            embed([image_input(b"not an image")])
        except urllib.error.HTTPError as error:
            # llama.cpp currently reports decoder rejection as HTTP 500.
            # The provider must translate it into failed-media coverage and
            # prevalidate bytes; verify that this rejection leaves text usable.
            corrupt_status = error.code
        else:
            raise ValueError("Runtime accepted corrupt image input")
        if cosine(embed([query_inputs[0]])[0], queries[0]) < 0.9999:
            raise ValueError("Corrupt image poisoned subsequent text encoding")
        judged = [[i] for i in range(len(kinds))]
        image_times = []
        for i in range(samples):
            start = time.perf_counter()
            vector = embed([inputs[i % len(inputs)]])[0]
            image_times.append((time.perf_counter()-start)*1000)
            if cosine(vector, images[i % len(inputs)]) < 0.9999:
                raise ValueError("Repeated image encoding differs")
        report.update({"text_to_image": quality(image_queries, images, judged),
                       "image_to_text": quality(images, image_texts, judged),
                       "image_to_image": quality(images, images, judged),
                       "image_latency": timings(image_times), "images": images,
                       "corrupt_image_http_status": corrupt_status, "text_after_corrupt_image": True})
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["baseline-bin", "candidate-bin", "jina", "gemma", "reference", "projector", "output"]:
        parser.add_argument("--"+name, type=pathlib.Path, required=True)
    parser.add_argument("--fixture", type=pathlib.Path,
                        default=pathlib.Path(__file__).parent / "fixtures/embedding-evaluation.json")
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--log-verbosity", type=int, default=0)
    args = parser.parse_args()
    if args.samples < 2:
        parser.error("--samples must be at least two")
    args.output.mkdir(parents=True, exist_ok=True)
    fixture = json.loads(args.fixture.read_text())
    report = {"fixture_sha256": hashlib.sha256(args.fixture.read_bytes()).hexdigest(),
              "thresholds": fixture["thresholds"], "models": {}}
    variants = [("jina", args.baseline_bin, args.jina, None, "last"),
                ("gemma_q8", args.candidate_bin, args.gemma, args.projector, "mean"),
                ("gemma_f16", args.candidate_bin, args.reference, args.projector, "mean")]
    for name, binary, model, projector, pooling in variants:
        print(f"Evaluating {name}", flush=True)
        try:
            with server(binary, model, projector, pooling, args.output, name, args.log_verbosity) as (port, resources):
                result = evaluate(port, "jina" if name == "jina" else "gemma", fixture,
                                  args.samples, projector is not None)
            result["resources"] = resources
            report["models"][name] = result
        except Exception as error:
            report["models"][name] = {"error": str(error)}
        (args.output / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    report["gates"] = gates(report)
    report["spike_passed"] = all(check["passed"] for check in report["gates"].values())
    report["release_ready"] = False
    report["remaining_release_gates"] = ["official-framework parity", "screenshots and small text",
                                         "minimum-device/platform validation", "application integration contracts"]
    (args.output / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(summary(report), indent=2))
    print(json.dumps({"gates": report["gates"], "spike_passed": report["spike_passed"]}, indent=2))
    return 0 if report["spike_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
