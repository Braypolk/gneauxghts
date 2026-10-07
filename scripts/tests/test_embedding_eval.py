import importlib.util
import copy
import json
import math
import pathlib
import tempfile
import unittest
from unittest.mock import Mock, patch

SCRIPT = pathlib.Path(__file__).parents[1] / "embedding_eval.py"
spec = importlib.util.spec_from_file_location("embedding_eval", SCRIPT)
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


class EmbeddingEvaluationContracts(unittest.TestCase):
    def test_response_order_uses_input_indexes(self):
        a, b = [1.0] + [0.0]*767, [0.0, 1.0] + [0.0]*766
        response = {"data": [{"index": 1, "embedding": b}, {"index": 0, "embedding": a}]}
        self.assertEqual(evaluation.vectors(response, 2), [a, b])
        response["data"][0]["index"] = 0
        with self.assertRaisesRegex(ValueError, "indexes"):
            evaluation.vectors(response, 2)

    def test_rejects_nonfinite_zero_wrong_dimension_and_unnormalized_vectors(self):
        for vector in [[1.0]*768, [0.0]*768, [1.0]*512, [math.nan]+[0.0]*767]:
            with self.assertRaises(ValueError):
                evaluation.vectors({"data": [{"index": 0, "embedding": vector}]}, 1)

    def test_judged_ranking_counts_hard_negatives(self):
        result = evaluation.quality([[1.0, 0.0], [0.0, 1.0]],
                                    [[1.0, 0.0], [0.0, 1.0]], [[1], [1]])
        self.assertEqual(result["top1"], 0.5)
        self.assertEqual(result["mrr"], 0.75)

    def test_png_inputs_are_distinct_and_image_only(self):
        fixtures = [evaluation.png_fixture(name) for name in ["rising", "falling", "circle", "square"]]
        self.assertEqual(len(set(fixtures)), 4)
        for fixture in fixtures:
            self.assertTrue(fixture.startswith(b"\x89PNG\r\n\x1a\n"))
            content = evaluation.image_input(fixture)["content"]
            self.assertEqual([part["type"] for part in content], ["image_url"])

    def test_runtime_failure_cannot_pass_gate(self):
        checks = evaluation.gates({"models": {"gemma_q8": {"error": "could not start"}},
                                   "thresholds": {}})
        self.assertFalse(checks["runtime"]["passed"])

    def test_observed_text_regression_cannot_be_hidden_by_image_success(self):
        vector = [1.0] + [0.0]*767
        model = {"text": {"mrr": 1.0, "top1": 1.0, "rankings": [[0]]},
                 "text_latency": {"p95_ms": 10}, "image_latency": {"p95_ms": 100},
                 "resources": {"peak_rss_bytes": 1024},
                 "text_to_image": {"top1": 1.0}, "image_to_text": {"top1": 1.0},
                 "documents": [vector], "queries": [vector], "images": [vector]}
        limits = json.loads((SCRIPT.parent / "fixtures/embedding-evaluation.json").read_text())["thresholds"]
        report = {"thresholds": limits, "models": {name: copy.deepcopy(model)
                  for name in ["jina", "gemma_q8", "gemma_f16"]}}
        self.assertTrue(all(gate["passed"] for gate in evaluation.gates(report).values()))
        report["models"]["gemma_q8"]["text"]["mrr"] = 0.9
        self.assertFalse(evaluation.gates(report)["text_mrr_regression"]["passed"])
        report["models"]["gemma_q8"]["resources"]["peak_rss_bytes"] = None
        self.assertFalse(evaluation.gates(report)["peak_rss_bytes"]["passed"])

    def test_percentile_uses_nearest_rank(self):
        self.assertEqual(evaluation.timings(list(range(1, 21))),
                         {"samples": 20, "p50_ms": 10.5, "p95_ms": 19})

    def test_failed_evaluation_reaps_its_owned_server(self):
        child = Mock(pid=12345)
        child.poll.return_value = None
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            model = root / "model.gguf"
            model.write_bytes(b"fixture")
            with patch.object(evaluation.subprocess, "Popen", return_value=child), \
                 patch.object(evaluation.subprocess, "run", return_value=Mock(returncode=1)), \
                 patch.object(evaluation, "request", return_value={"status": "ok"}), \
                 patch.object(evaluation.socket, "socket") as socket:
                socket.return_value.__enter__.return_value.getsockname.return_value = ("127.0.0.1", 12345)
                with self.assertRaisesRegex(RuntimeError, "fixture failure"):
                    with evaluation.server(root / "server", model, None, "last", root, "test"):
                        raise RuntimeError("fixture failure")
            child.terminate.assert_called_once()
            child.wait.assert_called_once_with(timeout=10)


if __name__ == "__main__":
    unittest.main()
