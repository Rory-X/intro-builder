#!/usr/bin/env python3
"""
Programmatic image analyzer — for models without vision capabilities.

Parses PNG pixel data (or converts any format via sips) and outputs a
structured JSON description of the image: colors, layout regions, text
areas, font-size estimates, decorative elements, and spacing patterns.

Usage:
  python3 analyze.py <image_path> [--output result.json] [--resolution 4]

Resolution controls sampling density (1=fine, 8=coarse, default 4).
Higher resolution = slower but more precise text detection.

Output JSON schema — see SKILL.md §Output Schema.
"""

import argparse
import json
import os
import struct
import subprocess
import sys
import tempfile
import zlib
from collections import Counter
from pathlib import Path
from typing import Any


# ─── PNG parsing (zero-dependency) ──────────────────────────────────


def read_png(path: str) -> tuple[int, int, bytes]:
    """Return (width, height, raw_rgba_bytes) for a PNG file.

    Handles 8-bit RGBA PNGs. For indexed or grayscale PNGs, convert via
    sips first (see ensure_png).
    """
    with open(path, "rb") as f:
        sig = f.read(8)
        if sig != b"\x89PNG\r\n\x1a\n":
            raise ValueError("Not a valid PNG file")

        chunks: list[tuple[str, bytes]] = []
        while True:
            lb = f.read(4)
            if len(lb) < 4:
                break
            length = struct.unpack(">I", lb)[0]
            ctype = f.read(4).decode("ascii", errors="replace")
            data = f.read(length)
            f.read(4)  # CRC
            chunks.append((ctype, data))
            if ctype == "IEND":
                break

    # Parse IHDR
    ihdr = next(data for ctype, data in chunks if ctype == "IHDR")
    w = struct.unpack(">I", ihdr[0:4])[0]
    h = struct.unpack(">I", ihdr[4:8])[0]
    bit_depth = ihdr[8]
    color_type = ihdr[9]

    if bit_depth != 8 or color_type not in (2, 6):
        raise ValueError(
            f"Unsupported PNG: bit_depth={bit_depth} color_type={color_type}. "
            f"Convert to 8-bit RGB/RGBA first."
        )

    # Decompress IDAT
    idat = b"".join(data for ctype, data in chunks if ctype == "IDAT")
    raw = zlib.decompress(idat)

    return w, h, raw


def get_pixel(raw: bytes, w: int, h: int, x: int, y: int) -> tuple[int, int, int, int]:
    """Get RGBA pixel at (x, y). Returns (0,0,0,0) for out-of-bounds."""
    if x < 0 or y < 0 or x >= w or y >= h:
        return (0, 0, 0, 0)
    stride = w * 4 + 1  # +1 for filter byte
    offset = y * stride + 1 + x * 4
    if offset + 3 >= len(raw):
        return (0, 0, 0, 0)
    return (raw[offset], raw[offset + 1], raw[offset + 2], raw[offset + 3])


def ensure_png(image_path: str) -> str:
    """Convert any image to a temp 8-bit RGBA PNG via macOS sips.

    Returns the path to the temp PNG. Caller should clean up.
    """
    path = Path(image_path)
    if path.suffix.lower() == ".png":
        # Check if it's a compatible PNG
        try:
            read_png(str(path))
            return str(path)
        except Exception:
            pass  # Will convert below

    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    tmp.close()
    subprocess.run(
        ["sips", "-s", "format", "png", str(path), "--out", tmp.name],
        check=True, capture_output=True,
    )
    return tmp.name


# ─── Color analysis ─────────────────────────────────────────────────


def quantize(r: int, g: int, b: int, step: int) -> tuple[int, int, int]:
    """Quantize a color to reduce noise in palette extraction."""
    return ((r // step) * step, (g // step) * step, (b // step) * step)


def analyze_colors(raw: bytes, w: int, h: int, sample_step: int = 10) -> dict[str, Any]:
    """Extract color palette and statistics."""
    counter: Counter = Counter()
    is_grayscale = True
    total = 0

    for y in range(0, h, sample_step):
        for x in range(0, w, sample_step):
            r, g, b, a = get_pixel(raw, w, h, x, y)
            if a < 100:
                continue
            total += 1
            q = quantize(r, g, b, 16)
            counter[q] += 1
            if abs(r - g) > 10 or abs(g - b) > 10 or abs(r - b) > 10:
                is_grayscale = False

    palette = []
    for (r, g, b), count in counter.most_common(20):
        pct = round(count / total * 100, 1) if total > 0 else 0
        palette.append({
            "hex": f"#{r:02x}{g:02x}{b:02x}",
            "rgb": [r, g, b],
            "pct": pct,
        })

    # Detect if image is monochrome/grayscale
    mode = "grayscale" if is_grayscale else "color"

    return {
        "mode": mode,
        "palette": palette,
        "sample_count": total,
    }


# ─── Layout structure ───────────────────────────────────────────────


def analyze_layout(raw: bytes, w: int, h: int) -> dict[str, Any]:
    """Detect major layout regions: header, body, footer, columns."""
    # Build a vertical brightness profile
    profile = []
    for y in range(0, h, 2):
        samples = []
        for x in range(0, w, 4):
            r, g, b, a = get_pixel(raw, w, h, x, y)
            if a > 100:
                samples.append((r + g + b) // 3)
        if samples:
            avg = sum(samples) // len(samples)
            dark_pct = sum(1 for s in samples if s < 80) / len(samples) * 100
            profile.append({"y": y, "avg_brightness": avg, "dark_pct": round(dark_pct, 1)})

    # Detect major transitions (>30 brightness change or dark_pct crossing 50%)
    regions = []
    current_region = None
    for i, row in enumerate(profile):
        is_dark_band = row["dark_pct"] > 40
        is_light = row["avg_brightness"] > 220

        label = "content"
        if is_dark_band:
            label = "dark_band"
        elif is_light:
            label = "empty"

        if current_region is None or current_region["label"] != label:
            if current_region is not None:
                current_region["end_y"] = row["y"]
                if current_region["end_y"] - current_region["start_y"] >= 8:
                    regions.append(current_region)
            current_region = {"start_y": row["y"], "label": label}

    if current_region is not None:
        current_region["end_y"] = profile[-1]["y"]
        if current_region["end_y"] - current_region["start_y"] >= 8:
            regions.append(current_region)

    # Classify regions
    structure = {"header_region": None, "body_regions": [], "footer_region": None, "all_regions": []}

    for region in regions:
        y_start = region["start_y"]
        y_end = region["end_y"]
        height_pct = (y_end - y_start) / h * 100 if h > 0 else 0

        entry = {
            "y_start": y_start,
            "y_end": y_end,
            "height_px": y_end - y_start,
            "height_pct": round(height_pct, 1),
            "type": region["label"],
        }

        if y_start < h * 0.25 and region["label"] == "dark_band":
            structure["header_region"] = entry
        elif y_start > h * 0.85 and region["label"] == "dark_band":
            structure["footer_region"] = entry
        elif region["label"] == "content":
            structure["body_regions"].append(entry)

        structure["all_regions"].append(entry)

    # Detect column layout by sampling horizontal brightness at mid-height
    mid_y = h // 2
    col_profile = []
    for x in range(0, w, 4):
        samples = []
        for dy in range(-20, 21, 2):
            r, g, b, a = get_pixel(raw, w, h, x, mid_y + dy)
            if a > 100:
                samples.append((r + g + b) // 3)
        if samples:
            avg = sum(samples) // len(samples)
            col_profile.append({"x": x, "avg_brightness": avg})

    # Detect vertical gaps (columns)
    gaps = []
    in_gap = False
    gap_start = 0
    for i, col in enumerate(col_profile):
        is_empty = col["avg_brightness"] > 240
        if is_empty and not in_gap:
            gap_start = col["x"]
            in_gap = True
        elif not is_empty and in_gap:
            gap_width = col["x"] - gap_start
            if gap_width > w * 0.05:  # >5% of width = meaningful gap
                gaps.append({"x_start": gap_start, "x_end": col["x"], "width_px": gap_width})
            in_gap = False

    layout_type = "single_column"
    if len(gaps) == 1 and gaps[0]["width_px"] > w * 0.1:
        layout_type = "two_column"
    elif len(gaps) >= 2:
        layout_type = "multi_column"

    structure["layout_type"] = layout_type
    structure["column_gaps"] = gaps
    structure["image_dimensions"] = {"width": w, "height": h}

    return structure


# ─── Text region detection ──────────────────────────────────────────


def analyze_text(raw: bytes, w: int, h: int, resolution: int = 4) -> dict[str, Any]:
    """Detect text regions and estimate font sizes."""
    text_rows = []

    for y in range(0, h, resolution):
        vals = []
        for x in range(0, w, max(2, resolution)):
            r, g, b, a = get_pixel(raw, w, h, x, y)
            if a > 100:
                vals.append((r + g + b) // 3)

        if len(vals) < 30:
            continue

        min_v = min(vals)
        max_v = max(vals)
        variance = max_v - min_v
        dark_pct = sum(1 for v in vals if v < 100) / len(vals) * 100

        # Text rows: high variance + moderate dark pixel density
        if variance > 60 and 2 < dark_pct < 55:
            # Find the horizontal extent of text in this row
            text_x = []
            for x in range(0, w, max(2, resolution)):
                r, g, b, a = get_pixel(raw, w, h, x, y)
                if a > 100 and (r + g + b) // 3 < 100:
                    text_x.append(x)

            x_start = min(text_x) if text_x else 0
            x_end = max(text_x) if text_x else w

            text_rows.append({
                "y": y,
                "variance": variance,
                "dark_pct": round(dark_pct, 1),
                "x_range": [x_start, x_end],
            })

    # Cluster text rows into blocks.
    # A line of 13px text sampled every 4px yields ~3 rows.
    # Gap threshold: 6 * resolution (covers line-height spacing).
    cluster_gap = max(8, 6 * resolution)
    clusters = []
    if text_rows:
        cluster_rows = [text_rows[0]]
        for row in text_rows[1:]:
            if row["y"] - cluster_rows[-1]["y"] > cluster_gap:
                clusters.append(_make_text_cluster(cluster_rows, resolution))
                cluster_rows = [row]
            else:
                cluster_rows.append(row)
        clusters.append(_make_text_cluster(cluster_rows, resolution))

    # Estimate overall typography
    font_estimates = []
    for c in clusters:
        if c["estimated_font_size_px"]:
            font_estimates.append(c["estimated_font_size_px"])

    return {
        "text_clusters": clusters,
        "total_clusters": len(clusters),
        "estimated_font_sizes_px": sorted(set(font_estimates)),
    }


def _make_text_cluster(rows: list[dict], resolution: int) -> dict[str, Any]:
    """Summarize a cluster of text rows."""
    y_start = rows[0]["y"]
    y_end = rows[-1]["y"]
    height = y_end - y_start
    # Font size ≈ cluster height (upper bound), but at least resolution*1.5 for
    # single-row clusters (a single detected row at resolution=4 means text is
    # anywhere from 1-8px tall — conservatively estimate 8-16px range).
    if height > 0:
        est_font = round(height * 0.85)
    elif len(rows) == 1:
        est_font = resolution * 4  # rough estimate for single-row detection
    else:
        est_font = None

    # Determine horizontal alignment
    x_starts = [r["x_range"][0] for r in rows if r["x_range"][0] > 0]
    if x_starts:
        avg_start = sum(x_starts) // len(x_starts)
        # Use variance of x_start to determine alignment
        var_start = sum((s - avg_start) ** 2 for s in x_starts) / len(x_starts) if len(x_starts) > 1 else 0
        if avg_start < 80:
            alignment = "left"
        elif var_start < 200 and avg_start < 200:
            alignment = "left"
        else:
            alignment = "center" if avg_start > 300 else "left"
    else:
        alignment = "unknown"

    return {
        "y_start": y_start,
        "y_end": y_end,
        "height_px": height,
        "row_count": len(rows),
        "estimated_font_size_px": est_font,
        "alignment": alignment,
        "avg_dark_pct": round(sum(r["dark_pct"] for r in rows) / len(rows), 1),
    }


# ─── Decorations & lines ────────────────────────────────────────────


def analyze_decorations(raw: bytes, w: int, h: int) -> dict[str, Any]:
    """Detect decorative elements: solid bars, rules, shapes."""
    solid_bars = []
    thin_rules = []

    for y in range(0, h):
        dark = 0
        total = 0
        sample_color = (0, 0, 0)

        for x in range(0, w, 3):
            r, g, b, a = get_pixel(raw, w, h, x, y)
            if a > 100:
                total += 1
                if (r + g + b) // 3 < 60:
                    dark += 1
                    sample_color = (r, g, b)

        if total < 50:
            continue

        ratio = dark / total if total > 0 else 0

        if ratio > 0.7:
            # Cluster consecutive dark rows into bars
            if not solid_bars or y - solid_bars[-1]["end_y"] > 2:
                solid_bars.append({
                    "start_y": y,
                    "end_y": y,
                    "coverage_pct": round(ratio * 100),
                    "color": f"#{sample_color[0]:02x}{sample_color[1]:02x}{sample_color[2]:02x}",
                })
            else:
                solid_bars[-1]["end_y"] = y
                # Update coverage
                solid_bars[-1]["coverage_pct"] = max(
                    solid_bars[-1]["coverage_pct"], round(ratio * 100)
                )

    # Filter: keep bars > 2px height
    solid_bars = [b for b in solid_bars if b["end_y"] - b["start_y"] > 2]

    return {
        "solid_bars": solid_bars,
        "bar_count": len(solid_bars),
    }


# ─── Spacing analysis ───────────────────────────────────────────────


def analyze_spacing(raw: bytes, w: int, h: int, text_clusters: list[dict]) -> dict[str, Any]:
    """Extract spacing patterns between content regions."""
    if len(text_clusters) < 2:
        return {"gaps": [], "typical_section_gap_px": None}

    gaps = []
    for i in range(1, len(text_clusters)):
        gap = text_clusters[i]["y_start"] - text_clusters[i - 1]["y_end"]
        if gap > 0:
            gaps.append(gap)

    typical = None
    if gaps:
        # Median gap (ignoring very large outliers)
        sorted_gaps = sorted(gaps)
        mid = len(sorted_gaps) // 2
        typical = sorted_gaps[mid]

    return {
        "gaps_between_clusters_px": gaps,
        "typical_section_gap_px": typical,
    }


# ─── Main ───────────────────────────────────────────────────────────


def analyze(image_path: str, resolution: int = 4) -> dict[str, Any]:
    """Full image analysis. Returns structured JSON."""
    # Ensure we have a parseable PNG
    png_path = ensure_png(image_path)
    w, h, raw = read_png(png_path)

    # Clean up temp file if we created one
    if png_path != image_path:
        try:
            os.unlink(png_path)
        except OSError:
            pass

    colors = analyze_colors(raw, w, h, sample_step=max(5, resolution * 2))
    layout = analyze_layout(raw, w, h)
    text = analyze_text(raw, w, h, resolution)
    decorations = analyze_decorations(raw, w, h)
    spacing = analyze_spacing(raw, w, h, text["text_clusters"])

    # Summarize for quick consumption
    summary = _build_summary(colors, layout, text, decorations)

    return {
        "image": {
            "path": image_path,
            "dimensions": {"width": w, "height": h},
        },
        "summary": summary,
        "colors": colors,
        "layout": layout,
        "text": text,
        "decorations": decorations,
        "spacing": spacing,
    }


def _build_summary(
    colors: dict,
    layout: dict,
    text: dict,
    decorations: dict,
) -> dict[str, Any]:
    """Human-readable summary for quick understanding."""
    parts = []

    # Color mode
    parts.append(f"{colors['mode']} image, {layout['image_dimensions']['width']}x{layout['image_dimensions']['height']}px")

    # Layout
    parts.append(f"layout: {layout['layout_type']}")
    if layout["header_region"]:
        h = layout["header_region"]
        parts.append(f"header at y=[{h['y_start']},{h['y_end']}] ({h['height_px']}px, {h['type']})")

    # Text
    if text["total_clusters"]:
        sizes = text["estimated_font_sizes_px"]
        parts.append(f"{text['total_clusters']} text blocks, font sizes ~{sizes}px")

    # Decorations
    if decorations["bar_count"]:
        bars = decorations["solid_bars"]
        bar_descs = [f"{b['color']} bar at y={b['start_y']}-{b['end_y']}" for b in bars[:5]]
        parts.append(f"{decorations['bar_count']} solid bars: {'; '.join(bar_descs)}")

    # Dominant colors
    if colors["palette"]:
        top = colors["palette"][:3]
        parts.append(f"top colors: {', '.join(c['hex'] for c in top)}")

    return {"description": " | ".join(parts)}


# ─── CLI ────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Programmatic image analyzer — for vision-less models",
    )
    parser.add_argument("image", help="Path to image file (PNG/JPG/GIF/etc.)")
    parser.add_argument("--output", "-o", help="Write JSON to file (default: stdout)")
    parser.add_argument(
        "--resolution", "-r", type=int, default=4,
        help="Sampling resolution: 1=fine, 8=coarse (default: 4)",
    )
    parser.add_argument(
        "--summary-only", action="store_true",
        help="Output only the summary, not full analysis",
    )
    args = parser.parse_args()

    if not os.path.exists(args.image):
        print(f"ERROR: image not found: {args.image}", file=sys.stderr)
        return 1

    try:
        result = analyze(args.image, args.resolution)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    output = result["summary"] if args.summary_only else result
    json_str = json.dumps(output, ensure_ascii=False, indent=2)

    if args.output:
        Path(args.output).write_text(json_str, encoding="utf-8")
        print(f"Saved to {args.output}", file=sys.stderr)
    else:
        print(json_str)

    return 0


if __name__ == "__main__":
    sys.exit(main())
