---
name: image-analyzer
description: Use when you need to understand the visual content, layout, colors, or typography of an image file (PNG/JPG/etc.) but cannot view it directly — especially when running on models without vision capabilities. Also use before replicating a design from a reference screenshot, or when you need to extract structured layout information from an image programmatically.
---

# Image Analyzer — Programmatic Vision for Vision-less Models

Parse any image into a structured JSON description: colors, layout regions,
text blocks with font-size estimates, decorative elements, and spacing
patterns. Zero dependencies beyond Python 3 stdlib + macOS `sips`.

## Quick Start

```bash
# Quick summary (one line)
python3 .claude/skills/image-analyzer/scripts/analyze.py <image> --summary-only

# Full structured JSON
python3 .claude/skills/image-analyzer/scripts/analyze.py <image> -o /tmp/result.json

# Higher precision (slower)
python3 .claude/skills/image-analyzer/scripts/analyze.py <image> -r 2
```

**Resolution guide**: `-r 8` (fast overview) → `-r 4` (default, good balance) → `-r 2` (fine detail, for small text or precise measurements).

## Output Schema

The JSON has five top-level sections plus a `summary`:

### `summary.description`
One-line human-readable summary. Start here.

### `colors`
| Field | Description |
|---|---|
| `mode` | `"grayscale"` or `"color"` |
| `palette` | Top 20 dominant colors: `{hex, rgb, pct}` each |

### `layout`
| Field | Description |
|---|---|
| `layout_type` | `"single_column"` / `"two_column"` / `"multi_column"` |
| `header_region` | Dark band in top 25% (likely header) |
| `body_regions` | Content bands between header and footer |
| `footer_region` | Dark band in bottom 15% (likely footer) |
| `column_gaps` | Vertical whitespace gaps between columns |
| `all_regions` | Every detected region with `{y_start, y_end, type}` |

### `text`
| Field | Description |
|---|---|
| `text_clusters[]` | Each block of text: `{y_start, y_end, height_px, row_count, estimated_font_size_px, alignment, avg_dark_pct}` |
| `total_clusters` | Count of text blocks detected |
| `estimated_font_sizes_px` | Unique font sizes detected across all clusters |

### `decorations`
| Field | Description |
|---|---|
| `solid_bars[]` | Full-width dark bands: `{start_y, end_y, coverage_pct, color}` |
| `bar_count` | Total number of solid bars |

### `spacing`
| Field | Description |
|---|---|
| `gaps_between_clusters_px` | Raw gap sizes between consecutive text clusters |
| `typical_section_gap_px` | Median gap (best estimate of standard section spacing) |

## Workflow for Template Replication

When replicating a design from a reference image:

1. **Quick overview**: `--summary-only -r 8` — get the gist
2. **Full analysis**: `-r 4` — get colors, layout, text, decorations
3. **Design decisions from the JSON**:
   - `colors.palette[0]` → header/hero background color
   - `colors.mode == "grayscale"` → no accent colors needed
   - `layout.header_region` → header height and color
   - `layout.layout_type` → single vs. multi-column
   - `decorations.solid_bars` → horizontal rules, dividers
   - `text.text_clusters[].estimated_font_size_px` → heading vs. body sizes
   - `text.text_clusters[].alignment` → text alignment per block
   - `spacing.typical_section_gap_px` → `--section-gap` value
4. **Scale to A4**: reference measurements ÷ reference_width × 800 ≈ A4 px values

## Limitations

- **Cannot read text content** — only detects *where* text is, not *what* it says. For OCR, use a separate tool.
- **Font size estimates are approximate** — derived from text block height, not actual glyph metrics.
- **No semantic understanding** — detects "a dark rectangle here" not "a photo of a person here".
- **sips dependency** — format conversion relies on macOS `sips`. On Linux, install ImageMagick or Pillow.

## Common Patterns

### "I need to replicate this resume template"
→ Run `-r 2` for precise font sizes, check `decorations.solid_bars` for header/dividers, use `colors.palette` for the color scheme, check `layout.layout_type` for column structure.

### "What colors does this design use?"
→ Read `colors.palette` — the first few entries with high `pct` are the dominant colors. `colors.mode == "grayscale"` means no hue — everything is black/white/gray.

### "How is the page laid out?"
→ Check `layout.layout_type` and `layout.all_regions` — this tells you the vertical structure (header → content → footer) and whether there are sidebars.
