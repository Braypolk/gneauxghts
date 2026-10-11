"""Offline claim-review accounting. Semantic judgments are supplied by a reviewer.

No providers, tools, credentials, network, or automatic entailment judge are used.
"""
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
VERDICTS = {"supported", "unsupported", "contradicted", "unassessable", "unreviewed"}
COVERAGE = {"covered", "missing", "unreviewed"}


def load(path):
    return json.loads(Path(path).read_text())


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def pointer(value, path):
    for key in path.strip("/").split("/"):
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value


def normalize_sources(sources):
    result = []
    for source in sources:
        passage = source.get("passage")
        if passage:
            result.append({"id": passage["id"], "title": source["title"],
                           "location": passage["location"], "text": source["excerpt"],
                           "authority": "read", "scope": "historical" if passage.get("historical") else "current",
                           "metadata": {k: passage[k] for k in ["historical", "revisions"] if k in passage}})
    return result


def verify_origin(observation):
    origin = observation["origin"]
    path = REPO / origin["path"]
    if not path.exists():
        return "unavailable"
    if hashlib.sha256(path.read_bytes()).hexdigest() != origin["sha256"]:
        raise ValueError(f"{observation['id']}: original trace hash changed")
    trace = load(path)
    answer = pointer(trace, origin["answerPointer"])
    if answer["content"] != observation["answer"] or normalize_sources(answer["sources"]) != observation["sources"]:
        raise ValueError(f"{observation['id']}: answer/source snapshot differs from original")
    if pointer(trace, origin["questionPointer"]) != observation["question"]:
        raise ValueError(f"{observation['id']}: question differs from original")
    return "verified"


def validate_review(review, sources, requirements):
    if not review["answer"].strip():
        raise ValueError("Empty answer")
    source_ids = [s["id"] for s in sources]
    if len(source_ids) != len(set(source_ids)):
        raise ValueError("Duplicate source IDs")
    for source in sources:
        if source["authority"] not in {"read", "preview"} or not source["text"]:
            raise ValueError("Invalid source authority/text")
    claim_ids = [c["id"] for c in review["claims"]]
    if len(claim_ids) != len(set(claim_ids)):
        raise ValueError("Duplicate claim IDs")
    # This validates annotations against our simple curated Markdown, not arbitrary
    # app Markdown rendering. Citation scope is manually reviewed, never guessed by proximity.
    links = set(re.findall(r"\]\(passage:([^\s)]+)\)", review["answer"]))
    assigned = set()
    for claim in review["claims"]:
        if not claim["quote"] or claim["quote"] not in review["answer"]:
            raise ValueError(f"{claim['id']}: claim quote is not an exact answer substring")
        if not claim["proposition"].strip() or claim["verdict"] not in VERDICTS:
            raise ValueError("Invalid proposition/verdict")
        if not isinstance(claim["requiresCitation"], bool):
            raise ValueError("requiresCitation must be boolean")
        if not set(claim["citationIds"]) <= links:
            raise ValueError(f"{claim['id']}: annotated citation absent from answer")
        if claim["verdict"] != "unreviewed" and not claim["reason"].strip():
            raise ValueError("Reviewed claims require a reason")
        if claim["requiresCitation"] and not claim["citationIds"] and claim["verdict"] == "supported":
            raise ValueError("Uncited note claim cannot be supported by cited evidence")
        assigned.update(claim["citationIds"])
    if review.get("claimInventory", "full") == "full" and links != assigned:
        raise ValueError("Every inline passage link needs a reviewed claim association")
    coverage_ids = [c["id"] for c in review["coverage"]]
    if len(coverage_ids) != len(set(coverage_ids)) or set(coverage_ids) != set(requirements):
        raise ValueError("Coverage must grade each requirement exactly once")
    for item in review["coverage"]:
        if item["status"] not in COVERAGE or (item["status"] != "unreviewed" and not item["reason"].strip()):
            raise ValueError("Invalid coverage review")


def score(review, sources, requirements):
    validate_review(review, sources, requirements)
    by_id = {s["id"]: s for s in sources}
    claims = []
    for claim in review["claims"]:
        ids = claim["citationIds"]
        member = bool(ids) and all(i in by_id for i in ids)
        authority = member and all(by_id[i]["authority"] == "read" for i in ids)
        cite_required = claim["requiresCitation"]
        claims.append({"id": claim["id"], "citationPresent": bool(ids) if cite_required else None,
                       "citationMembership": member if cite_required else None,
                       "readAuthority": authority if cite_required else None,
                       "semanticVerdict": claim["verdict"], "failureTags": claim["failureTags"],
                       "passed": claim["verdict"] == "supported" and (not cite_required or authority)})
    complete = bool(claims) and all(c["semanticVerdict"] != "unreviewed" for c in claims) and all(
        c["status"] != "unreviewed" for c in review["coverage"])
    passed = complete and all(c["passed"] for c in claims) and all(c["status"] == "covered" for c in review["coverage"])
    inventory = review.get("claimInventory", "full")
    if inventory not in {"full", "focused"}:
        raise ValueError("Unknown claim inventory scope")
    return {"reviewComplete": complete, "passed": passed, "claimInventory": inventory,
            "wholeAnswerPass": passed if inventory == "full" else None, "claims": claims,
            "coverage": review["coverage"]}


def summarize(rows):
    claims = [c for row in rows for c in row["score"]["claims"]]
    note_claims = [c for c in claims if c["citationPresent"] is not None]
    return {"reviewedSamples": sum(row["score"]["reviewComplete"] for row in rows),
            "pendingSamples": sum(not row["score"]["reviewComplete"] for row in rows),
            "passingReviewedSamples": sum(row["score"]["passed"] for row in rows),
            "annotatedClaims": len(claims), "noteClaims": len(note_claims),
            "noteClaimsWithCitation": sum(c["citationPresent"] for c in note_claims),
            "noteClaimsWithAllCitationsInSuppliedSources": sum(c["citationMembership"] for c in note_claims),
            "noteClaimsWithReadAuthority": sum(c["readAuthority"] for c in note_claims),
            "semanticVerdicts": dict(Counter(c["semanticVerdict"] for c in claims)),
            "failureTags": dict(Counter(t for c in claims for t in c["failureTags"]))}


def evaluate(corpus, baseline):
    controls = []
    for case in corpus["cases"]:
        for control in case["controls"]:
            result = score(control, case["sources"], case["requirements"])
            if not result["reviewComplete"] or result["passed"] != control["expectedPass"]:
                raise ValueError(f"Control accounting mismatch: {case['id']}/{control['id']}")
            controls.append({"case": case["id"], "category": case["category"],
                             "control": control["id"], "score": result})
    observations = []
    for observation in baseline["observations"]:
        snapshot = {k: observation[k] for k in ["question", "answer", "sources"]}
        if digest(snapshot) != observation["snapshotSha256"]:
            raise ValueError(f"{observation['id']}: retained snapshot changed")
        observations.append({"id": observation["id"], "category": observation["category"],
                             "traceVerification": verify_origin(observation),
                             "score": score(observation, observation["sources"], observation["requirements"])})
    return {"method": "Offline accounting of explicit human claim judgments; not an automatic semantic judge.",
            "corpusSha256": digest(corpus), "baselineSha256": digest(baseline),
            "controls": {"summary": summarize(controls), "results": controls},
            "recordedBaseline": {"sampling": baseline["sampling"], "summary": summarize(observations),
                                 "results": observations},
            "limitations": ["Hand-written controls exercise the rubric and accounting, not model behavior.",
                            "Historical observations are selected regressions and controls from different model/prompt versions, not a current-model success rate.",
                            "Original traces verify recorded snapshots; disposable vault citations are not revalidated as current.",
                            "Semantic support, citation scope, and complete claim inventory require human review.",
                            "No new model requests or provider spend."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', type=Path, default=ROOT / 'fixtures.json', help='Fixed corpus for this review, bound by hash')
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="Validate fixture/control accounting and recorded provenance")
    check.add_argument("--verify-traces", action="store_true", help="Fail if original local ignored traces are absent")
    report = sub.add_parser("report", help="Write offline baseline accounting")
    report.add_argument("--output", type=Path, required=True)
    prepare = sub.add_parser("prepare", help="Create an UNGRADED review from future fixed-evidence answers")
    prepare.add_argument("answers", type=Path)
    prepare.add_argument("--output", type=Path, required=True)
    grade = sub.add_parser("grade", help="Account for manually completed fixed-evidence reviews")
    grade.add_argument("review", type=Path)
    grade.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    corpus = load(args.corpus)
    if args.command == "grade":
        review = load(args.review)
        if review["corpusSha256"] != digest(corpus):
            raise ValueError("Review belongs to a different corpus")
        by_id = {c["id"]: c for c in corpus["cases"]}
        rows = []
        for row in review["results"]:
            if digest(row["answer"]) != row["answerSha256"]:
                raise ValueError("Reviewed answer differs from prepared answer")
            case = by_id[row["caseId"]]
            rows.append({"case": case["id"], "metadata": row.get("metadata", {}),
                         "score": score(row, case["sources"], case["requirements"])})
        args.output.write_text(json.dumps({"method": "Human claim judgments over fixed evidence; not automatic semantic grading", "reviewSha256": digest(review), "summary": summarize(rows), "results": rows}, indent=2) + "\n")
        return
    if args.command == "prepare":
        by_id = {c["id"]: c for c in corpus["cases"]}
        rows = []
        for answer in load(args.answers):
            case = by_id[answer["caseId"]]
            rows.append({"caseId": case["id"], "answer": answer["answer"], "answerSha256": digest(answer["answer"]), "claims": [],
                         "coverage": [{"id": k, "status": "unreviewed", "reason": ""} for k in case["requirements"]],
                         "metadata": {k: answer[k] for k in ["variant", "repeat", "model", "usage"] if k in answer}})
        with args.output.open("x") as stream:
            json.dump({"corpusSha256": digest(corpus), "instruction": "Annotate every note-based claim, exact quote, citation scope, semantic verdict/reason and required coverage. Empty or pending reviews cannot pass.", "results": rows}, stream, indent=2)
            stream.write("\n")
        return
    result = evaluate(corpus, load(ROOT / "recorded-baseline.json"))
    if args.command == "check":
        if args.verify_traces and any(r["traceVerification"] != "verified" for r in result["recordedBaseline"]["results"]):
            raise ValueError("Original trace unavailable")
        print(json.dumps({"controls": result["controls"]["summary"], "recordedBaseline": result["recordedBaseline"]["summary"]}, indent=2))
    else:
        args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
