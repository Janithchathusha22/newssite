"""Small stdin/stdout bridge used by the Node editorial API."""

from __future__ import annotations

import json
import io
import contextlib
import sys
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

def main() -> int:
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError("Expected one JSON article object")
        log_buffer = io.StringIO()
        # The legacy worker prints progress messages. Keep stdout a strict JSON
        # transport for Node and forward human-readable progress to stderr.
        with contextlib.redirect_stdout(log_buffer):
            from groq_ai_processor import process_article_with_groq

            result = process_article_with_groq(payload)
        logs = log_buffer.getvalue()
        if logs:
            sys.stderr.write(logs)
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        sys.stderr.write(f"{type(exc).__name__}: {exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
