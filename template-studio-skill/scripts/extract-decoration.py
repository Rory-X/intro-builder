#!/usr/bin/env python3
"""
Extract a decorative background from a reference resume image via any
OpenAI-images-edits-compatible API (gpt-image-2, doubao Seed/Seedream,
qwen-image, Stable Diffusion proxies, etc.). Optionally upload the result
to Vercel Blob and print the CDN URL, which template HTML/CSS can reference
directly.

Configuration (all in .env.local):
  TEMPLATE_IMAGE_API_BASE_URL   required, e.g. https://bmc-llm-relay.bluemediagroup.cn/v1
                                must point to a service that accepts POST /images/edits
                                with OpenAI-style multipart form (image, prompt, size, n)
  TEMPLATE_IMAGE_API_KEY        required, Bearer token for the service
  TEMPLATE_IMAGE_MODEL          required, e.g. gpt-image-2 / doubao-seedream-3-0 / wanx-v1
  TEMPLATE_IMAGE_SIZE           optional, default 1024x1536 (portrait, A4-ish)
  BLOB_READ_WRITE_TOKEN         required only when --upload-blob is set

Legacy fallbacks (read if TEMPLATE_IMAGE_* unset):
  OPENAI_API_KEY                → TEMPLATE_IMAGE_API_KEY
  OPENAI_BASE_URL               → TEMPLATE_IMAGE_API_BASE_URL

Graceful degradation: when image API config is missing/incomplete, the
script prints a WARNING to stderr and exits with code 0, stdout: {"skipped":
true, "reason":"..."}. The skill caller should detect skipped=true and
proceed with CSS-only decoration. Other steps (HTML/CSS authoring,
insert-template.ts) are unaffected.

Usage:
  # With config (recommended)
  python3 template-studio-skill/scripts/extract-decoration.py \\
    --reference docs/abbey-resume-reference.png \\
    --prompt "Extract decorative banner from top..." \\
    --output /tmp/abbey-banner.png \\
    --upload-blob --id abbey --role banner
  # → stdout: {"local_path":"...","blob_url":"https://..."}

  # Without config (graceful skip)
  # → stderr: WARNING: image API not configured...
  # → stdout: {"skipped":true,"reason":"..."}
  # → exit 0

Uses curl for HTTPS (Python 3.13 on macOS ships without bundled CA certs
which breaks urllib SSL).

Exit codes:
  0  success OR graceful skip (config missing)
  1  caller error (bad args, missing reference file)
  2  API/upload error (HTTP non-200, malformed response)
  3  transient (HTTP 000 / empty body — caller may retry)
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional


# ─── Config ───────────────────────────────────────────────────────


def load_image_api_config() -> Optional[dict]:
    """Read TEMPLATE_IMAGE_* env vars (with OPENAI_* legacy fallback).

    Returns None when required fields are missing — caller must treat None
    as the "graceful skip" signal. Returns dict {base_url, api_key, model,
    size} when complete.
    """
    base_url = (
        os.environ.get("TEMPLATE_IMAGE_API_BASE_URL", "").strip()
        or os.environ.get("OPENAI_BASE_URL", "").strip()
    )
    api_key = (
        os.environ.get("TEMPLATE_IMAGE_API_KEY", "").strip()
        or os.environ.get("OPENAI_API_KEY", "").strip()
    )
    model = os.environ.get("TEMPLATE_IMAGE_MODEL", "").strip()
    size = os.environ.get("TEMPLATE_IMAGE_SIZE", "1024x1536").strip()

    missing = []
    if not base_url:
        missing.append("TEMPLATE_IMAGE_API_BASE_URL")
    if not api_key:
        missing.append("TEMPLATE_IMAGE_API_KEY")
    if not model:
        missing.append("TEMPLATE_IMAGE_MODEL")
    if missing:
        return None  # type: ignore[return-value]
    return {
        "base_url": base_url.rstrip("/"),
        "api_key": api_key,
        "model": model,
        "size": size,
    }


def emit_skipped(reason: str) -> int:
    """Graceful skip path: warn to stderr, JSON to stdout, exit 0.

    Caller (skill / pipeline) should detect skipped=true and continue with
    CSS-only decoration so the template still inserts cleanly.
    """
    print(f"WARNING: {reason}", file=sys.stderr)
    print(
        "WARNING: skipping decoration extraction — template will have no decorative background",
        file=sys.stderr,
    )
    print(json.dumps({"skipped": True, "reason": reason}))
    return 0


# ─── Image API call ───────────────────────────────────────────────


def call_image_edit(cfg: dict, ref: Path, prompt: str) -> Optional[bytes]:
    """POST multipart to <base_url>/images/edits, return PNG bytes.

    Compatible with OpenAI's images-edits API shape; works with any service
    that mimics it (BMC relay's gpt-image-2, ARK doubao's seedream, qwen-image
    proxies, etc.). Response handles both b64_json and url payload formats —
    different providers return different shapes.

    Returns:
      bytes  — PNG payload on success
      None   — caller sees specific exit code via sys.exit() inside this fn
                 on hard errors (we exit early to keep main() readable)
    """
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        resp_path = f.name

    cmd = [
        "curl", "-s", "--max-time", "300",
        "-w", "%{http_code}",
        f"{cfg['base_url']}/images/edits",
        "-H", f"Authorization: Bearer {cfg['api_key']}",
        "-F", f"model={cfg['model']}",
        "-F", f"prompt={prompt}",
        "-F", f"size={cfg['size']}",
        "-F", "n=1",
        "-F", f"image=@{ref}",
        "-o", resp_path,
    ]

    print(f"calling {cfg['base_url']}/images/edits (model={cfg['model']}) ...", file=sys.stderr)
    r = subprocess.run(cmd, capture_output=True, text=True)
    status = r.stdout.strip()
    raw = Path(resp_path).read_bytes()
    print(f"HTTP {status}, body {len(raw)} bytes", file=sys.stderr)

    if status != "200" or len(raw) == 0:
        if status in ("000", "") or len(raw) == 0:
            print("ERROR: empty response (likely network/relay hiccup) — retry", file=sys.stderr)
            sys.exit(3)
        print(f"ERROR: HTTP {status}", file=sys.stderr)
        print(raw.decode("utf-8", errors="replace")[:500], file=sys.stderr)
        sys.exit(2)

    try:
        d = json.loads(raw.decode("utf-8"))
    except Exception as e:
        print(f"ERROR: non-JSON response: {e}", file=sys.stderr)
        print(raw[:500], file=sys.stderr)
        sys.exit(2)

    if "error" in d:
        print(f"ERROR: API error: {json.dumps(d['error'], ensure_ascii=False)}", file=sys.stderr)
        sys.exit(2)

    if "data" not in d or not d["data"]:
        print(f"ERROR: unexpected response shape: {json.dumps(d, ensure_ascii=False)[:500]}", file=sys.stderr)
        sys.exit(2)

    item = d["data"][0]

    # Provider variance: gpt-image-2 returns b64_json; some doubao/qwen proxies
    # return a URL pointing to a CDN-hosted PNG. Handle both.
    if "b64_json" in item:
        png = base64.b64decode(item["b64_json"])
    elif "url" in item:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            dl_path = f.name
        dl = subprocess.run(
            ["curl", "-s", "--max-time", "60", "-L", item["url"], "-o", dl_path],
            capture_output=True, text=True,
        )
        if dl.returncode != 0:
            print(f"ERROR: failed to download data[0].url: {item['url']}", file=sys.stderr)
            sys.exit(2)
        png = Path(dl_path).read_bytes()
    else:
        print(f"ERROR: data[0] has neither b64_json nor url. keys: {list(item.keys())}", file=sys.stderr)
        sys.exit(2)

    if "usage" in d:
        u = d["usage"]
        print(
            f"usage: input={u.get('input_tokens')} output={u.get('output_tokens')} total={u.get('total_tokens')}",
            file=sys.stderr,
        )
    return png


# ─── Vercel Blob upload ───────────────────────────────────────────


def upload_blob(png_bytes: bytes, template_id: str, role: str) -> str:
    """Upload PNG to Vercel Blob via raw HTTP PUT, return public URL."""
    token = os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip()
    if not token:
        print("ERROR: BLOB_READ_WRITE_TOKEN not set in env", file=sys.stderr)
        print("       --upload-blob requires this env var (see .env.local)", file=sys.stderr)
        sys.exit(1)

    blob_path = f"templates/{template_id}/{role}-{int(time.time())}.png"
    api_url = f"https://blob.vercel-storage.com/{blob_path}"

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        png_tmp = f.name
        f.write(png_bytes)

    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        resp_path = f.name

    cmd = [
        "curl", "-s", "--max-time", "120",
        "-w", "%{http_code}",
        "-X", "PUT", api_url,
        "-H", f"authorization: Bearer {token}",
        "-H", "x-content-type: image/png",
        "-H", "x-add-random-suffix: 0",
        "--data-binary", f"@{png_tmp}",
        "-o", resp_path,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    status = r.stdout.strip()
    raw = Path(resp_path).read_bytes()
    print(f"blob upload: HTTP {status}, body {len(raw)} bytes", file=sys.stderr)

    if status != "200" or len(raw) == 0:
        print(f"ERROR: blob upload failed (HTTP {status})", file=sys.stderr)
        print(raw.decode("utf-8", errors="replace")[:500], file=sys.stderr)
        sys.exit(2)

    try:
        d = json.loads(raw.decode("utf-8"))
    except Exception as e:
        print(f"ERROR: non-JSON blob response: {e}", file=sys.stderr)
        sys.exit(2)

    url = d.get("url")
    if not url:
        print(f"ERROR: blob response missing url: {d}", file=sys.stderr)
        sys.exit(2)
    return url


# ─── main ─────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True, help="Path to reference image (PNG/JPG)")
    parser.add_argument("--prompt", required=True, help="Edit prompt for the image API")
    parser.add_argument("--output", required=True, help="Where to save the extracted PNG locally")
    parser.add_argument("--upload-blob", action="store_true",
                        help="Upload result to Vercel Blob, print blob_url JSON to stdout")
    parser.add_argument("--id", help="Template id (required with --upload-blob)")
    parser.add_argument("--role", choices=["banner", "decoration", "icon"],
                        help="Asset role (required with --upload-blob)")
    args = parser.parse_args()

    # Reference file must exist regardless of config state
    ref = Path(args.reference)
    if not ref.exists():
        print(f"ERROR: reference not found: {ref}", file=sys.stderr)
        return 1

    if args.upload_blob and not (args.id and args.role):
        print("ERROR: --upload-blob requires --id and --role", file=sys.stderr)
        return 1

    # Config check — graceful skip if image API not configured.
    # Reference existence checked above so a misconfigured env still surfaces
    # caller errors first. This keeps "missing config" as a soft signal.
    cfg = load_image_api_config()
    if cfg is None:
        return emit_skipped(
            "image API not configured (set TEMPLATE_IMAGE_API_BASE_URL / "
            "TEMPLATE_IMAGE_API_KEY / TEMPLATE_IMAGE_MODEL in .env.local)"
        )

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"reference: {ref} ({ref.stat().st_size} bytes)", file=sys.stderr)
    print(f"model: {cfg['model']}, size: {cfg['size']}", file=sys.stderr)

    png = call_image_edit(cfg, ref, args.prompt)
    if png is None:
        # Should never reach — call_image_edit exits on hard errors.
        return 2

    out.write_bytes(png)
    print(f"saved: {out} ({len(png)} bytes)", file=sys.stderr)

    if args.upload_blob:
        blob_url = upload_blob(png, args.id, args.role)
        print(json.dumps({"local_path": str(out), "blob_url": blob_url}))
    else:
        print(json.dumps({"local_path": str(out)}))

    return 0


if __name__ == "__main__":
    sys.exit(main())
