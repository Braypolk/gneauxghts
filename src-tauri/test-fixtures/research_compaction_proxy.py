"""Opt-in synthetic research acceptance fixture; never route real vaults here.

Override loaded-capacity metadata only. Completion requests pass unchanged to
the configured local server. Optional JSONL capture contains synthetic prompts
and tool outputs, but never request headers or credentials.
"""
import argparse
import json
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--capacity", type=int, default=32000)
    parser.add_argument("--port", type=int, default=18841)
    parser.add_argument("--capture", required=True, help="New JSONL path for this run (must not exist)")
    args = parser.parse_args()
    with open(args.capture, "x", encoding="utf-8"):
        pass  # Never mix two acceptance runs or overwrite previous evidence.
    lock = threading.Lock()
    count = 0

    class Proxy(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.path != "/api/v1/models":
                self.send_error(404)
                return
            body = json.dumps({"models": [{"key": args.model, "loaded_instances": [
                {"id": args.model, "config": {"context_length": args.capacity}}
            ]}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            nonlocal count
            if self.path != "/v1/chat/completions":
                self.send_error(404)
                return
            body = self.rfile.read(int(self.headers["Content-Length"]))
            value = json.loads(body)
            system = value.get("messages", [{}])[0].get("content", "")
            if isinstance(system, list):
                system = "".join(part.get("text", "") for part in system)
            names = [tool.get("function", {}).get("name") for tool in value.get("tools", [])]
            kind = "summary" if system.startswith("Compact the supplied run transcript") else (
                "parent" if "research_notes" in names else "worker")
            with lock:
                count += 1
                with open(args.capture, "a", encoding="utf-8") as output:
                    output.write(json.dumps({"index": count, "kind": kind, "request": value}) + "\n")
                print(f"Request {count}: {kind}, {len(body)} bytes", flush=True)
            request = urllib.request.Request(args.upstream.rstrip("/") + "/chat/completions",
                                             data=body, headers={"Content-Type": "application/json"})
            if self.headers.get("Authorization"):
                request.add_header("Authorization", self.headers["Authorization"])
            try:
                upstream = urllib.request.urlopen(request, timeout=120)
            except urllib.error.HTTPError as error:
                upstream = error
            with upstream:
                self.send_response(upstream.status)
                self.send_header("Content-Type", upstream.headers.get("Content-Type", "application/json"))
                self.send_header("Connection", "close")
                self.end_headers()
                try:
                    while chunk := upstream.read1(65536):
                        self.wfile.write(chunk)
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass  # Cancellation intentionally drops an in-flight response.
                self.close_connection = True

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Proxy)
    print(f"Synthetic capacity proxy listening on {server.server_address}; capacity={args.capacity}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
