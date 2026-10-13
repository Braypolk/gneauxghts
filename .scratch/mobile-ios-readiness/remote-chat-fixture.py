#!/usr/bin/env python3
"""Synthetic Chat Completions / Responses server; loopback only, no credentials logged.

Not a model or live OpenAI test. Requests must contain an IOS_ scenario marker.
Run with --log /private/tmp/.../requests.jsonl; all content must be synthetic.
"""
import argparse
import json
import re
import socket
import struct
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def values(value, key):
    if isinstance(value, dict):
        if key in value:
            yield value[key]
        for child in value.values():
            yield from values(child, key)
    elif isinstance(value, list):
        for child in value:
            yield from values(child, key)


class Fixture(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def record(self, data):
        data = {"time": time.time(), **data}
        with self.server.log_lock, open(self.server.log_path, "a") as stream:
            stream.write(json.dumps(data) + "\n")

    def json_reply(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        # Optional exact-token check for Keychain read/replace/delete probes.
        # The file contains synthetic tokens only, keyed by URL path prefix;
        # reread on each request so rotation needs no server restart. Never log
        # either the expected token or the received Authorization value.
        if not self.server.auth_file:
            return True
        tokens = json.loads(Path(self.server.auth_file).read_text())
        expected = next((token for prefix, token in tokens.items() if self.path.startswith(prefix)), None)
        if expected and self.headers.get("Authorization") == f"Bearer {expected}":
            return True
        self.json_reply(401, {"error": {"message": "Synthetic token mismatch", "code": "invalid_api_key"}})
        return False

    def do_GET(self):
        self.record({"method": "GET", "path": self.path, "authenticated": bool(self.headers.get("Authorization"))})
        if not self.authorized():
            return
        if self.path.endswith("/models"):
            self.json_reply(200, {"object": "list", "data": [{"id": "ios-fixture", "owned_by": "synthetic"}, {"id": "gpt-5.4", "owned_by": "synthetic"}]})
        else:
            self.json_reply(404, {"error": {"message": "Unknown fixture path"}})

    def event(self, data):
        self.wfile.write(("data: " + json.dumps(data) + "\n\n").encode())
        self.wfile.flush()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.record({"method": "POST", "path": self.path, "authenticated": bool(self.headers.get("Authorization")), "body": body})
        if not self.authorized():
            return
        history = body.get("messages", body.get("input", []))
        users = [item for item in history if item.get("role") == "user"]
        user = json.dumps(users[-1] if users else {})
        marker = re.search(r"IOS_[A-Z_]+", user)
        if not marker:
            self.json_reply(400, {"error": {"message": "Synthetic IOS_ scenario marker required"}})
            return
        scenario = marker.group()
        with self.server.log_lock:
            key = (self.path, scenario)
            attempt = self.server.attempts.get(key, 0) + 1
            self.server.attempts[key] = attempt
        if scenario == "IOS_ERROR" or (scenario == "IOS_RETRY" and attempt == 1):
            self.json_reply(401, {"error": {"message": "Synthetic authentication failure", "type": "invalid_request_error", "code": "invalid_api_key"}})
            return
        if scenario == "IOS_DISCONNECT":
            self.close_connection = True
            return
        if scenario == "IOS_TIMEOUT" and attempt == 1:
            # Deliberately exceed the unmodified production 15-minute deadline.
            time.sleep(930)
            self.close_connection = True
            return
        tools = [tool.get("function", tool) for tool in body.get("tools", [])]
        formatter = next((tool["name"] for tool in tools if "segments" in tool.get("parameters", {}).get("properties", {})), None)
        outputs = [item for item in history if item.get("role") == "tool" or item.get("type") == "function_call_output"]
        # Scope tool results to this turn, avoiding prior-turn fixture state.
        last_user = max((i for i, item in enumerate(history) if item.get("role") == "user"), default=-1)
        outputs = [item for item in history[last_user + 1:] if item.get("role") == "tool" or item.get("type") == "function_call_output"]
        result_text = json.dumps(outputs)
        if scenario == "IOS_PROPOSE_BREAK" and outputs:
            # The tool has staged a durable proposal, then the next provider
            # request loses its connection. Review must remain explicit.
            self.close_connection = True
            return
        name, arguments = None, None
        text, sources = "Simulator remote chat works.", []
        if scenario == "IOS_READ":
            if not outputs:
                name, arguments = "find_notes", {"query": "MARIGOLD", "mode": "lexical", "limit": 3}
            elif len(outputs) == 1:
                decoded = json.loads(outputs[-1].get("content", outputs[-1].get("output", "{}")))
                ids = list(values(decoded, "evidenceId"))
                note_ids = list(values(decoded, "noteId"))
                if ids:
                    name, arguments = "read_notes", {"purpose": "answer", "evidence_ids": ids[:1]}
                elif note_ids:
                    name, arguments = "read_notes", {"purpose": "answer", "note_id": note_ids[0]}
                else:
                    raise ValueError("Discovery did not return a synthetic note identity")
            else:
                text = "The project codename is MARIGOLD."
                refs = re.findall(r"\bS[1-9][0-9]*\b", result_text)
                sources = list(dict.fromkeys(refs))[:1]
        elif scenario.startswith("IOS_PROPOSE_"):
            if not outputs:
                name, arguments = "propose_note_change", {"operation": "create", "title": scenario, "markdown": "Synthetic mobile proposal.\n"}
            else:
                text = "The synthetic proposal is ready for review."
        elif scenario.startswith("IOS_UPDATE_"):
            target = re.search(r"TARGET_NOTE_ID=([A-Za-z0-9_-]+)", user)
            if not target:
                raise ValueError("Update scenario requires a synthetic TARGET_NOTE_ID")
            if not outputs:
                name, arguments = "read_notes", {"purpose": "edit", "note_id": target.group(1)}
            elif len(outputs) == 1:
                decoded = json.loads(outputs[-1].get("content", outputs[-1].get("output", "{}")))
                content_hash = next(values(decoded, "contentHash"))
                name, arguments = "propose_note_change", {"operation": "edit", "note_id": target.group(1), "expected_content_hash": content_hash, "edits": [{"kind": "replace", "oldText": "Original synthetic paragraph.", "newText": "Updated synthetic paragraph."}]}
            else:
                text = "The synthetic update is ready for review."
        elif scenario == "IOS_FOLLOWUP":
            text = "Earlier you asked IOS_STREAM; this is the follow-up."
        if not name and formatter:
            name, arguments = formatter, {"segments": [{"text": text, "sources": sources}]}
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            if scenario in ("IOS_LOSS", "IOS_EOF") and attempt == 1:
                # Lose the transport halfway through structured output, before
                # any complete formatter call can be admitted as an answer.
                if self.path.endswith("/responses"):
                    self.event({"type": "response.created", "response": {"id": "resp_loss", "object": "response", "status": "in_progress", "output": []}})
                    self.event({"type": "response.output_item.added", "output_index": 0, "item": {"id": "fc_loss", "type": "function_call", "call_id": "call_loss", "name": name, "arguments": ""}})
                    self.event({"type": "response.function_call_arguments.delta", "output_index": 0, "item_id": "fc_loss", "delta": '{"segments":[{"text":"Partial synthetic answer'})
                else:
                    self.event({"id": "chatcmpl_loss", "object": "chat.completion.chunk", "created": 0, "model": body["model"], "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": "call_loss", "type": "function", "function": {"name": name, "arguments": '{"segments":[{"text":"Partial synthetic answer'}}]}, "finish_reason": None}]})
                time.sleep(0.5)
                if scenario == "IOS_LOSS":
                    self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
                self.connection.close()
                self.record({"scenario": scenario, "transport_closed_midstream": True})
            elif scenario in ("IOS_CANCEL", "IOS_INTERRUPT") and attempt == 1:
                # Hold a real HTTP stream open, then emit until the app cancels.
                for _ in range(100):
                    self.wfile.write(b": synthetic keepalive\n\n")
                    self.wfile.flush()
                    time.sleep(0.2)
            elif self.path.endswith("/responses"):
                self.stream_responses(body, name, arguments, text)
            elif self.path.endswith("/chat/completions"):
                self.completions(body, name, arguments, text)
            else:
                raise ValueError("Unknown streaming fixture path")
        except (BrokenPipeError, ConnectionResetError):
            self.record({"scenario": scenario, "client_disconnected": True})

    def completions(self, body, name, arguments, text):
        ident = "chatcmpl_" + uuid.uuid4().hex

        def chunk(delta, finish=None):
            self.event({"id": ident, "object": "chat.completion.chunk", "created": 0, "model": body["model"], "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]})

        chunk({"role": "assistant"})
        if name:
            encoded = json.dumps(arguments)
            chunk({"tool_calls": [{"index": 0, "id": "call_" + uuid.uuid4().hex, "type": "function", "function": {"name": name, "arguments": ""}}]})
            for offset in range(0, len(encoded), 12):
                chunk({"tool_calls": [{"index": 0, "function": {"arguments": encoded[offset:offset + 12]}}]})
                time.sleep(0.04)
            chunk({}, "tool_calls")
        else:
            for word in text.split():
                chunk({"content": word + " "})
                time.sleep(0.04)
            chunk({}, "stop")
        self.event({"id": ident, "object": "chat.completion.chunk", "created": 0, "model": body["model"], "choices": [], "usage": {"prompt_tokens": 4000, "completion_tokens": 30, "total_tokens": 4030}})
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def stream_responses(self, body, name, arguments, text):
        ident = "resp_" + uuid.uuid4().hex
        response = {"id": ident, "object": "response", "status": "in_progress", "model": body["model"], "output": []}
        self.event({"type": "response.created", "response": response})
        if name:
            item = {"id": "fc_" + uuid.uuid4().hex, "type": "function_call", "call_id": "call_" + uuid.uuid4().hex, "name": name, "arguments": ""}
            self.event({"type": "response.output_item.added", "output_index": 0, "item": item})
            encoded = json.dumps(arguments)
            for offset in range(0, len(encoded), 12):
                self.event({"type": "response.function_call_arguments.delta", "output_index": 0, "item_id": item["id"], "delta": encoded[offset:offset + 12]})
                time.sleep(0.04)
            item = dict(item, arguments=encoded, status="completed")
        else:
            item = {"id": "msg_" + uuid.uuid4().hex, "type": "message", "role": "assistant", "content": []}
            self.event({"type": "response.output_item.added", "output_index": 0, "item": item})
            for word in text.split():
                self.event({"type": "response.output_text.delta", "output_index": 0, "item_id": item["id"], "content_index": 0, "delta": word + " "})
                time.sleep(0.04)
            item = dict(item, content=[{"type": "output_text", "text": text, "annotations": []}], status="completed")
        self.event({"type": "response.output_item.done", "output_index": 0, "item": item})
        self.event({"type": "response.completed", "response": dict(response, status="completed", output=[item], usage={"input_tokens": 4000, "output_tokens": 30, "total_tokens": 4030})})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=18440)
    parser.add_argument("--log", required=True)
    parser.add_argument("--auth-file", help="Synthetic expected-token JSON mapping URL prefixes to tokens")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Fixture)
    server.log_path = args.log
    server.log_lock = threading.Lock()
    server.auth_file = args.auth_file
    server.attempts = {}
    print(f"Synthetic chat fixture listening on 127.0.0.1:{args.port}", flush=True)
    server.serve_forever()
