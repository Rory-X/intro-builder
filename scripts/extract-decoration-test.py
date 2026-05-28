"""
Extract "decoration only" from a reference resume PNG via gpt-image-2's
image-edit endpoint. Uses curl for the HTTPS call (system trust store);
Python parses the JSON.

Usage:
  python3 scripts/extract-decoration-test.py
"""
import os, sys, json, base64, subprocess, tempfile
from pathlib import Path

API_KEY = "sk-snfhubk4381BX4oAn9RiFIfls2AAZBiiUHLhKjkhvAvjEX8W"
BASE_URL = "https://bmc-llm-relay.bluemediagroup.cn/v1"

REF = Path("docs/abbey-resume-reference.png")
OUT_DIR = Path("/tmp/template-studio")
OUT_DIR.mkdir(exist_ok=True)

PROMPT = (
    "Output a clean decorative background image based on the input resume. "
    "Keep ONLY the abstract geometric decorations from the input: "
    "the soft gray concentric circles. "
    "CRITICAL position rule: place the circles in the TOP-RIGHT corner only, "
    "exactly mirroring their position in the input. Do NOT move them to the "
    "top-left or any other location. "
    "Completely remove ALL text, ALL photos/portraits, ALL icons, "
    "ALL bullet points, ALL section titles, ALL colored bars. "
    "Do NOT add any decorative elements that do not exist in the input — "
    "no extra triangles, no dot patterns, no diagonal lines, no halftone, "
    "no shapes in the bottom area. The bottom of the page must be empty. "
    "The result should be a near-empty page with just the top-right circles "
    "on a clean white/off-white background, suitable as a decorative layer "
    "behind a resume."
)

def main():
    print(f"reference: {REF} ({REF.stat().st_size} bytes)")

    with tempfile.NamedTemporaryFile(mode="w+b", suffix=".json", delete=False) as f:
        out_json = f.name

    cmd = [
        "curl", "-s", "--max-time", "300",
        "-w", "\n---HTTP_STATUS:%{http_code}\n",
        f"{BASE_URL}/images/edits",
        "-H", f"Authorization: Bearer {API_KEY}",
        "-F", "model=gpt-image-2",
        "-F", f"prompt={PROMPT}",
        "-F", "size=1024x1536",
        "-F", "n=1",
        "-F", f"image=@{REF}",
        "-o", out_json,
    ]
    print("calling /images/edits ...")
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout.strip())
    if r.stderr:
        print("stderr:", r.stderr.strip())

    raw = Path(out_json).read_bytes()
    print(f"response file: {len(raw)} bytes")
    if len(raw) < 200:
        print("body:", raw[:500])

    try:
        d = json.loads(raw.decode("utf-8"))
    except Exception:
        print("not JSON, head:", raw[:500])
        sys.exit(1)

    print("response keys:", list(d.keys()))
    if "error" in d:
        print("ERROR:", json.dumps(d["error"], ensure_ascii=False, indent=2))
        sys.exit(1)
    if "usage" in d:
        print("usage:", d["usage"])

    if "data" not in d:
        print("no data field. dump:")
        print(json.dumps({k: v for k, v in d.items() if not isinstance(v, list)}, indent=2)[:1000])
        sys.exit(1)

    item = d["data"][0]
    if "b64_json" in item:
        png = base64.b64decode(item["b64_json"])
        out = OUT_DIR / "extracted-decoration-2.png"
        out.write_bytes(png)
        print(f"saved {out} ({len(png)} bytes)")
    elif "url" in item:
        print("url:", item["url"])
    else:
        print("unknown item shape:", list(item.keys()))

if __name__ == "__main__":
    main()
