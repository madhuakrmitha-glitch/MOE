"""Local fake Ollama server for browser tests. Never use real provider credentials."""

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        self.send_response(200)
        self.send_header(
            "Content-Type",
            "application/x-ndjson" if data.get("stream") else "application/json",
        )
        self.end_headers()
        text = "A practical response from the test provider."
        if not data.get("stream"):
            self.wfile.write(
                json.dumps(
                    {
                        "message": {"content": text},
                        "done": True,
                        "prompt_eval_count": 10,
                        "eval_count": 8,
                    }
                ).encode()
            )
        else:
            for token in text.split(" "):
                self.wfile.write(
                    (
                        json.dumps({"message": {"content": token + " "}, "done": False})
                        + "\n"
                    ).encode()
                )
                self.wfile.flush()
                time.sleep(0.03)
            self.wfile.write(
                (
                    json.dumps(
                        {
                            "message": {"content": ""},
                            "done": True,
                            "prompt_eval_count": 10,
                            "eval_count": 8,
                        }
                    )
                    + "\n"
                ).encode()
            )

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8766), Handler).serve_forever()
