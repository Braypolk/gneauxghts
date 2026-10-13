"""Verify synthetic live research wire coverage, pairing and compaction evidence.

Usage: python3 verify_research_compaction.py REPORT.json REQUESTS.jsonl
The companion Rust live test checks the final rendered facts and citations.
"""
import json
import sys


def verify(report_path, capture_path):
    with open(report_path, encoding="utf-8") as source:
        report = json.load(source)
    with open(capture_path, encoding="utf-8") as source:
        requests = [json.loads(line)["request"] for line in source]
    expected = {item["noteId"] for item in report["expected"]}
    reads = {}
    completed = set()
    complete_before_first_summary = None
    summaries = 0
    worker_requests = 0
    read_output_bytes = 0
    max_read_page_bytes = 0
    handoff = None
    parent_reads = {}
    for request in requests:
        messages = request["messages"]
        system = messages[0].get("content", "")
        if isinstance(system, list):
            system = "".join(part.get("text", "") for part in system)
        summary = system.startswith("Compact the supplied run transcript")
        if summary:
            summaries += 1
            if complete_before_first_summary is None:
                complete_before_first_summary = sorted(completed)
        names = {tool.get("function", {}).get("name") for tool in request.get("tools", [])}
        parent = "research_notes" in names
        worker = "read_notes" in names and "research_notes" not in names
        worker_requests += int(worker)
        pending = set()
        for message in messages:
            if parent:
                for call in message.get("tool_calls", []):
                    if call["function"]["name"] == "read_notes":
                        parent_reads[call["id"]] = json.loads(call["function"]["arguments"])
            pending.update(call["id"] for call in message.get("tool_calls", []))
            if message["role"] != "tool":
                continue
            call_id = message["tool_call_id"]
            assert call_id in pending, f"Orphan or duplicate tool result: {call_id}"
            pending.remove(call_id)
            if parent:
                page = json.loads(message["content"])
                if page.get("research"):
                    handoff = page
                assert not page.get("failures"), page.get("failures")
            if not worker or call_id in reads:
                continue
            page = json.loads(message["content"])
            coverage = page.get("coverage", {})
            if coverage.get("scope") != "canonical_note":
                continue
            size = len(message["content"].encode("utf-8"))
            assert size <= 6000, "Individual read envelope exceeded its page capacity"
            assert page["remainingEvidenceBytes"] is None, "Unexpected cumulative evidence quota"
            read_output_bytes += size
            max_read_page_bytes = max(max_read_page_bytes, size)
            reads[call_id] = page
            if coverage.get("wholeNoteComplete"):
                completed.add(coverage["noteId"])
    events = report["events"]
    compactions = [event["details"] for event in events
                   if event["type"] == "contextMeasured"
                   and event["details"].get("mode") == "compaction"
                   and event["details"].get("phase") == "completed"
                   and event["details"].get("worker")]
    terminal = [event["details"] for event in events if event["type"] == "researchCompleted"]
    tool_updates = [event for event in events if event["type"] == "toolCallUpdated"
                    and event["status"] != "running"]
    assert report["error"] is None, report["error"]
    assert "Ok" in report["rendered"], report["rendered"]
    assert len(compactions) >= 2, compactions
    assert summaries >= len(compactions), "Missing actual summary requests"
    assert complete_before_first_summary, "No early complete note to preserve"
    assert completed == expected, (completed, expected)
    assert len(reads) > 12, "Did not exceed the former worker limit"
    assert read_output_bytes > 62_080, "Did not exceed the former cumulative evidence grant"
    assert len(terminal) == 1 and terminal[0]["reason"] == "validated", terminal
    assert terminal[0]["toolErrors"] == 0, terminal
    assert tool_updates and all(event["status"] == "success" for event in tool_updates), tool_updates
    assert sum(event["name"] == "research_notes" for event in tool_updates) == 1
    assert terminal[0]["readCalls"] == len(reads), "Wire reads differ from worker diagnostics"
    assert handoff is not None, "No actual research handoff reached the parent"
    remaining = set(handoff["remainingEvidenceIds"])
    recovered = set()
    for arguments in parent_reads.values():
        assert arguments["purpose"] == "answer" and arguments.get("evidence_ids"), arguments
        recovered.update(arguments["evidence_ids"])
    assert recovered == remaining, "Parent must recover exactly the remaining handoff evidence"
    assert len(handoff["items"]) + len(remaining) == len(expected)
    answer, cited = report["rendered"]["Ok"]
    for item in report["expected"]:
        assert item["code"] in answer
        assert any(source["noteId"] == item["noteId"] and item["code"] in source["excerpt"]
                   for source in cited), f"Missing final citation: {item}"
    return {"verified": True, "workerCompletions": worker_requests,
            "canonicalReadCalls": len(reads), "wholeNotesCompleted": len(completed),
            "workerReadOutputBytes": read_output_bytes, "maxReadPageBytes": max_read_page_bytes,
            "notesCompletedBeforeFirstCompaction": len(complete_before_first_summary),
            "summaryRequests": summaries, "workerCompactions": len(compactions),
            "researchTerminal": terminal[0], "parentRecoveryCalls": len(parent_reads),
            "recoveredPassages": len(recovered), "finalCitedFacts": len(cited),
            "elapsedSeconds": report["elapsedSeconds"],
            "compactions": compactions}


if __name__ == "__main__":
    print(json.dumps(verify(*sys.argv[1:]), indent=2))
