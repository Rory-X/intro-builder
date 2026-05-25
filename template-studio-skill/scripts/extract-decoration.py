#!/usr/bin/env python3
"""
Extract a decorative background from a reference resume image via gpt-image-2's
/v1/images/edits endpoint. Uses curl for the HTTPS call (Python 3.13 on macOS
ships without bundled CA certs and breaks urllib SSL).

Usage:
  python3 template-studio-skill/scripts/extract-decoration.py \\
    --reference docs/test-samples/abbey-resume-reference.png \\
    --prompt "Output a clean decorative background ..." \\
    --output public/templates/decorations/abbey.png

Env:
  OPENAI_API_KEY    BMC relay key (required)
  OPENAI_BASE_URL   defaults to https://bmc-llm-relay.bluemediagroup.cn/v1
  GPT_IMAGE_SIZE    defaults to 1024x1536 (portrait, A4-ish)

Exit codes:
  0 success
  1 caller error (bad args, missing file, missing key)
  2 API error (HTTP non-200 or unexpected response shape)
  3 transient (HTTP 000 / empty body — caller may retry)
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True, help="Path to reference image (PNG/JPG)")
    parser.add_argument("--prompt", required=True, help="Edit prompt for gpt-image-2")
    parser.add_argument("--output", required=True, help="Where to save the extracted PNG")
    parser.add_argument("--model", default="gpt-image-2")
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        print("ERROR: OPENAI_API_KEY not set in env", file=sys.stderr)
        print("       export OPENAI_API_KEY=<key from ~/.claude/reference/keys.md>", file=sys.stderr)
        return 1

    base_url = os.environ.get("OPENAI_BASE_URL", "https://bmc-llm-relay.bluemediagroup.cn/v1").rstrip("/")
    size = os.environ.get("GPT_IMAGE_SIZE", "1024x1536")

    ref = Path(args.reference)
    if not ref.exists():
        print(f"ERROR: reference not found: {ref}", file=sys.stderr)
        return 1

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"reference: {ref} ({ref.stat().st_size} bytes)")
    print(f"model: {args.model}, size: {size}")

    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        resp_path = f.name

    cmd = [
        "curl", "-s", "--max-time", "300",
        "-w", "%{http_code}",
        f"{base_url}/images/edits",
        "-H", f"Authorization: Bearer {api_key}",
        "-F", f"model={args.model}",
        "-F", f"prompt={args.prompt}",
        "-F", f"size={size}",
        "-F", "n=1",
        "-F", f"image=@{ref}",
        "-o", resp_path,
    ]

    print("calling /images/edits ...")
    r = subprocess.run(cmd, capture_output=True, text=True)
    status = r.stdout.strip()

    raw = Path(resp_path).read_bytes()
    print(f"HTTP {status}, body {len(raw)} bytes")

    if status != "200" or len(raw) == 0:
        # 000 = network reset / timeout; empty body = upstream hiccup. Both
        # are usually transient at the relay. Caller can retry.
        if status in ("000", "") or len(raw) == 0:
            print("ERROR: empty response (likely network/relay hiccup) — retry", file=sys.stderr)
            return 3
        print(f"ERROR: HTTP {status}", file=sys.stderr)
        print(raw.decode("utf-8", errors="replace")[:500], file=sys.stderr)
        return 2

    try:
        d = json.loads(raw.decode("utf-8"))
    except Exception as e:
        print(f"ERROR: non-JSON response: {e}", file=sys.stderr)
        print(raw[:500], file=sys.stderr)
        return 2

    if "error" in d:
        print(f"ERROR: API error: {json.dumps(d['error'], ensure_ascii=False)}", file=sys.stderr)
        return 2

    if "data" not in d or not d["data"]:
        print(f"ERROR: unexpected response: {json.dumps(d, ensure_ascii=False)[:500]}", file=sys.stderr)
        return 2

    item = d["data"][0]
    if "b64_json" not in item:
        print(f"ERROR: no b64_json in response. keys: {list(item.keys())}", file=sys.stderr)
        return 2

    png = base64.b64decode(item["b64_json"])
    out.write_bytes(png)

    if "usage" in d:
        u = d["usage"]
        print(f"usage: input={u.get('input_tokens')} output={u.get('output_tokens')} total={u.get('total_tokens')}")
    print(f"saved: {out} ({len(png)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
