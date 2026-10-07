#!/usr/bin/env python3
"""Compare projector precision and runtime buffers on the same small fixtures.

No downloads or vault access. This measures sampled process RSS, not complete
unified-memory allocation. Quality comparisons use an F16 GGUF projector as
the control; they do not establish parity with Google's reference framework.
"""
import argparse
import hashlib
import json
import pathlib
import statistics

from embedding_eval import cosine, evaluate, server, summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["binary", "model", "projector-f16", "projector-q8", "output"]:
        parser.add_argument("--" + name, type=pathlib.Path, required=True)
    parser.add_argument("--fixture", type=pathlib.Path,
                        default=pathlib.Path(__file__).parent / "fixtures/embedding-evaluation.json")
    parser.add_argument("--samples", type=int, default=40)
    parser.add_argument("--projector-no-audio", type=pathlib.Path,
                        help="Experimental copy with clip.has_audio_encoder=false")
    parser.add_argument("--only", nargs="+", help="Run only these variant names")
    parser.add_argument("--control-results", type=pathlib.Path,
                        help="Prior results containing f16_projector for vector comparisons")
    args = parser.parse_args()
    if args.samples < 2:
        parser.error("--samples must be at least two")
    args.output.mkdir(parents=True, exist_ok=True)
    fixture = json.loads(args.fixture.read_text())
    report = {"fixture_sha256": hashlib.sha256(args.fixture.read_bytes()).hexdigest(), "models": {}}
    variants = [
        ("f16_projector", args.projector_f16, {}),
        ("q8_projector", args.projector_q8, {}),
        ("q8_small_batch", args.projector_q8, {"batch": 512, "microbatch": 512}),
        ("q8_serial", args.projector_q8,
         {"batch": 512, "microbatch": 512, "slots": 1, "context": 2048}),
        ("q8_batch1024", args.projector_q8, {"batch": 1024, "microbatch": 1024}),
    ]
    if args.projector_no_audio:
        variants.append(("q8_no_audio", args.projector_no_audio, {}))
    if args.only:
        unknown = set(args.only) - {name for name, _, _ in variants}
        if unknown:
            parser.error(f"Unknown/unavailable variants: {sorted(unknown)}")
        variants = [variant for variant in variants if variant[0] in args.only]
    prior_control = {}
    if args.control_results:
        prior = json.loads(args.control_results.read_text())
        if prior["fixture_sha256"] != report["fixture_sha256"]:
            parser.error("Control results use a different fixture")
        prior_control = prior["models"]["f16_projector"]
    for name, projector, config in variants:
        print(f"Evaluating {name}", flush=True)
        try:
            with server(args.binary, args.model, projector, "mean", args.output,
                        name, 3, **config) as (port, resources):
                result = evaluate(port, "gemma", fixture, args.samples, True)
            result["resources"] = resources
            report["models"][name] = result
            control = report["models"].get("f16_projector", prior_control)
            if "images" in control:
                result["control_comparison"] = {
                    "minimum_image_cosine": min(cosine(a, b) for a, b in
                                                zip(result["images"], control["images"], strict=True)),
                    "minimum_text_cosine": min(cosine(a, b) for field in ["documents", "queries"]
                                               for a, b in zip(result[field], control[field], strict=True)),
                    "text_top1_agreement": statistics.mean(a[0] == b[0] for a, b in zip(
                        result["text"]["rankings"], control["text"]["rankings"], strict=True)),
                }
        except Exception as error:
            report["models"][name] = {"error": str(error)}
        (args.output / "results.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({name: summary(report)[name]}, indent=2), flush=True)
    raise SystemExit(int(any("error" in model for model in report["models"].values())))


if __name__ == "__main__":
    main()
