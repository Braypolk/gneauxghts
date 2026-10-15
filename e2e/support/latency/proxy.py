"""Local-only timing proxy. Records metadata/counts, never prompts or reasoning."""
import argparse
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
from pathlib import Path
import threading
import time
from urllib.parse import urlsplit


def serve(upstream, port, output):
    target = urlsplit(upstream)
    assert target.scheme == 'http' and not target.username and not target.password
    address = ipaddress.ip_address(target.hostname)
    assert address.is_private or address in ipaddress.ip_network('100.64.0.0/10'), 'Local model endpoint required'
    output.parent.mkdir(parents=True, exist_ok=True)
    lock = threading.Lock()
    counter = 0

    def record(row):
        with lock, output.open('a') as stream:
            stream.write(json.dumps(row) + '\n')

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *_):
            pass

        def do_GET(self):
            self.forward()

        def do_POST(self):
            self.forward()

        def forward(self):
            nonlocal counter
            with lock:
                counter += 1
                request_id = counter
            start = time.monotonic()
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            row = {'id': request_id, 'path': self.path, 'method': self.command,
                   'startedAtMillis': round(time.time() * 1000), 'requestBytes': len(body)}
            if body:
                value = json.loads(body)
                for key in ['model', 'stream', 'max_tokens', 'reasoning_effort']:
                    if key in value:
                        row[key] = value[key]
                row['messages'] = len(value.get('messages', []))
                row['tools'] = len(value.get('tools', []))
            record({**row, 'phase': 'started'})
            connection = http.client.HTTPConnection(target.hostname, target.port or 80, timeout=330)
            headers_sent = False
            try:
                headers = {key: value for key, value in self.headers.items()
                           if key.lower() not in ['host', 'connection', 'accept-encoding']}
                headers['Accept-Encoding'] = 'identity'
                connection.request(self.command, self.path, body=body or None, headers=headers)
                response = connection.getresponse()
                row.update(status=response.status, headersMillis=round((time.monotonic() - start) * 1000))
                self.send_response(response.status)
                for key, value in response.getheaders():
                    if key.lower() not in ['connection', 'transfer-encoding', 'content-length']:
                        self.send_header(key, value)
                self.send_header('Connection', 'close')
                self.end_headers()
                headers_sent = True
                self.close_connection = True
                row.update(responseBytes=0, reasoningChars=0, contentChars=0, toolArgumentChars=0)
                sse = 'text/event-stream' in response.getheader('Content-Type', '')
                while True:
                    chunk = response.readline() if sse else response.read(8192)
                    if not chunk:
                        break
                    now = round((time.monotonic() - start) * 1000)
                    row.setdefault('firstByteMillis', now)
                    row['responseBytes'] += len(chunk)
                    self.wfile.write(chunk)
                    self.wfile.flush()
                    if sse and chunk.startswith(b'data:'):
                        try:
                            value = json.loads(chunk[5:])
                        except (ValueError, UnicodeDecodeError):
                            continue
                        if value.get('usage'):
                            row['usage'] = value['usage']
                        for choice in value.get('choices', []):
                            delta = choice.get('delta', {})
                            reasoning = delta.get('reasoning_content') or delta.get('reasoning') or ''
                            content = delta.get('content') or ''
                            arguments = ''.join(t.get('function', {}).get('arguments', '')
                                                for t in delta.get('tool_calls', []))
                            if reasoning or content or arguments:
                                row.setdefault('firstDeltaMillis', now)
                            if content or arguments:
                                row.setdefault('firstAnswerOrToolMillis', now)
                            row['reasoningChars'] += len(reasoning)
                            row['contentChars'] += len(content)
                            row['toolArgumentChars'] += len(arguments)
                            if choice.get('finish_reason'):
                                row['finishReason'] = choice['finish_reason']
            except Exception as error:
                row['errorType'] = type(error).__name__
                if not headers_sent:
                    self.send_error(502, 'Local timing upstream failed')
            finally:
                connection.close()
                row.update(phase='finished', elapsedMillis=round((time.monotonic() - start) * 1000),
                           finishedAtMillis=round(time.time() * 1000))
                record(row)

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    print(f'Local timing proxy listening on 127.0.0.1:{port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream', required=True)
    parser.add_argument('--port', type=int, default=1236)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    serve(args.upstream, args.port, args.output)
