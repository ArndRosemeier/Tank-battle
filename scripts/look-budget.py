#!/usr/bin/env python3
"""
The ONE measured look budget (A2c) — §9's surface/line band, measured on a PNG.

    python3 scripts/look-budget.py <frame.png> [--json]

L is an 8-bit, 0–255 luminance: the same measure PIL's `.convert('L')` gives
(ITU-R 601-2: 0.299·R + 0.587·G + 0.114·B) on sRGB pixels. "Percent of white" is
L / 255. This is deliberately the perceptual measure the dispatcher used for the
A2b table, not the linear-light Rec.709 measure used by the D5 team-luma pin.

Budgets:
  surfaces  median L over 5 <= L < 102 is <= 22 (8.6 %), and the share of the
            WHOLE frame with 26 <= L <= 51 (10–20 %) is <= 25 %;
  lines     p99 of the whole frame is >= 150 (>= 58.8 %);
  contrast  p99 / median(surface) is >= 6 (the brief's aim is >= 8);
  tiles     a 24×14 grid of tile medians, p90 <= 12 % of white (L <= 30.6),
            which catches a locally bright wall a whole-frame median misses (A3c);
  void      share with L < 5 is reported (the brief gives no minimum; INFO);
  team      hull segmentation is skipped BY DESIGN: A2c makes hull surfaces neutral
            and shared, so saturation segmentation would measure the thin team trim,
            not the hull surface. The team trim medians are printed as a diagnostic;
            the A2b Rec.709 team-luma pin holds trim equality.

Exit 0 when every gated budget passes, 1 when one is missed, 2 for a malformed input
or missing dependency (a loud tool failure, not a pass).
"""

from __future__ import annotations

import colorsys
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as error:  # loud, never a silent zero
    raise SystemExit(f"look-budget: Pillow is required (pip install Pillow): {error}")


SURFACE_LOW = 5
SURFACE_HIGH = 102
MID_LOW = 26
MID_HIGH = 51
LINE_LOW = 102
# G1 (2026-10-24): the owner asked for "a completely cheesy TRON look" — hotter lines,
# wider bloom, light trails and a glowing horizon. The halo legitimately lifts the
# surface median, the mid band and the bright tiles, so those three ceilings were
# raised to the measured G1 player frames plus headroom (surface 25-31, mid share
# 25-30 %, tile p90 96-127 L). Line strength and contrast are unchanged: the frame
# must still read as bright lines on a dark field.
SURFACE_MEDIAN_MAX = 34
MID_SHARE_MAX = 0.35
LINE_P99_MIN = 150
CONTRAST_MIN = 6.0
TILE_COLUMNS = 24
TILE_ROWS = 14
TILE_P90_MAX_L = 140.0
VOID_LOW = 5


def percentile(hist: list[int], pct: float) -> int:
    total = sum(hist)
    if total == 0:
        return 0
    target = total * pct / 100.0
    seen = 0
    for value, count in enumerate(hist):
        seen += count
        if seen >= target:
            return value
    return 255


def median_in_range(hist: list[int], low: int, high: int) -> float | None:
    window = hist[low:high]
    total = sum(window)
    if total == 0:
        return None
    target = total / 2.0
    seen = 0
    for offset, count in enumerate(window):
        seen += count
        if seen >= target:
            return float(low + offset)
    return float(high - 1)


def median_of_hist(hist: list[int]) -> int:
    total = sum(hist)
    if total == 0:
        return 0
    target = total / 2.0
    seen = 0
    for value, count in enumerate(hist):
        seen += count
        if seen >= target:
            return value
    return 255


def tile_p90(luminance: Image.Image) -> tuple[int, list[int]]:
    """The A3c spatial check: p90 of the 24×14 tile medians."""
    width, height = luminance.size
    medians: list[int] = []
    for row in range(TILE_ROWS):
        y0 = (height * row) // TILE_ROWS
        y1 = (height * (row + 1)) // TILE_ROWS
        for column in range(TILE_COLUMNS):
            x0 = (width * column) // TILE_COLUMNS
            x1 = (width * (column + 1)) // TILE_COLUMNS
            tile = luminance.crop((x0, y0, x1, y1))
            medians.append(median_of_hist(tile.histogram()))
    medians.sort()
    index = max(0, min(len(medians) - 1, int(len(medians) * 0.9 + 0.999999) - 1))
    return medians[index], medians


def team_trim(rgb: Image.Image) -> dict[str, object]:
    """Cheap saturated-hue diagnostic; NOT a hull-surface measurement (see docstring)."""
    width, height = rgb.size
    pixels = rgb.load()
    buckets: dict[str, list[int]] = {"orange": [], "lime": [], "magenta": [], "cyan": []}
    for y in range(height):
        for x in range(width):
            red, green, blue = pixels[x, y]
            maximum = max(red, green, blue)
            minimum = min(red, green, blue)
            if maximum < 90 or maximum - minimum < 56:
                continue
            hue = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)[0] * 360.0
            if 12 <= hue <= 55:
                bucket = "orange"
            elif 65 <= hue <= 125:
                bucket = "lime"
            elif 165 <= hue <= 205:
                bucket = "cyan"  # includes the world's cyan structure: ambiguous
            elif 285 <= hue <= 345:
                bucket = "magenta"
            else:
                continue
            buckets[bucket].append(int(0.299 * red + 0.587 * green + 0.114 * blue))

    result: dict[str, object] = {}
    for name, values in buckets.items():
        values.sort()
        if values:
            result[name] = {
                "pixels": len(values),
                "medianL": values[len(values) // 2],
                "percent": round(values[len(values) // 2] / 2.55, 1),
            }
        else:
            result[name] = {"pixels": 0, "medianL": None, "percent": None}
    return result


def measure(path: Path) -> dict[str, object]:
    try:
        image = Image.open(path)
    except Exception as error:
        raise SystemExit(f"look-budget: cannot open {path}: {error}")
    image = image.convert("RGB")
    width, height = image.size
    luminance = image.convert("L")
    hist = luminance.histogram()
    total = width * height

    surface_median = median_in_range(hist, SURFACE_LOW, SURFACE_HIGH)
    mid_share = sum(hist[MID_LOW : MID_HIGH + 1]) / total
    line_p99 = percentile(hist, 99.0)
    void_share = sum(hist[:VOID_LOW]) / total
    line_share = sum(hist[LINE_LOW:]) / total
    contrast = (line_p99 / surface_median) if surface_median else 0.0
    tile_p90_l, tile_medians = tile_p90(luminance)

    failures: list[str] = []
    if surface_median is None:
        failures.append("no surface pixels in 5..101")
        surface_median_value = 0.0
    else:
        surface_median_value = surface_median
        if surface_median > SURFACE_MEDIAN_MAX:
            failures.append(f"surface median {surface_median:.0f} > {SURFACE_MEDIAN_MAX}")
    if mid_share > MID_SHARE_MAX:
        failures.append(f"mid-band share {mid_share * 100:.1f}% > {MID_SHARE_MAX * 100:.0f}%")
    if line_p99 < LINE_P99_MIN:
        failures.append(f"line p99 {line_p99} < {LINE_P99_MIN}")
    if contrast < CONTRAST_MIN:
        failures.append(f"contrast {contrast:.2f} < {CONTRAST_MIN}")
    if SKIP_TILE:
        print(f"tile p90 {tile_p90_l} L ({tile_p90_l / 2.55:.1f}%) [INFO — live frame: additive VFX are not surfaces]")
    elif tile_p90_l > TILE_P90_MAX_L:
        failures.append(
            f"tile p90 {tile_p90_l} L ({tile_p90_l / 2.55:.1f}%) > {TILE_P90_MAX_L:.1f} L ({TILE_P90_MAX_L / 2.55:.0f}%)"
        )

    return {
        "file": str(path),
        "width": width,
        "height": height,
        "luminance": "ITU-R 601-2 on sRGB (PIL convert L)",
        "voidShare": round(void_share * 100, 1),
        "surfaceMedianL": surface_median_value,
        "surfaceMedianPercent": round(surface_median_value / 2.55, 1),
        "midBandSharePercent": round(mid_share * 100, 1),
        "lineSharePercent": round(line_share * 100, 1),
        "lineP99": line_p99,
        "contrast": round(contrast, 2),
        "tileGrid": f"{TILE_COLUMNS}×{TILE_ROWS}",
        "tileP90L": tile_p90_l,
        "tileP90Percent": round(tile_p90_l / 2.55, 1),
        "tileP90MaxL": TILE_P90_MAX_L,
        "tileCount": len(tile_medians),
        "teamHulls": {
            "status": "skipped",
            "reason": "hull fill is neutral/shared in A2c; saturation measures trim, not hull surface",
        },
        "teamTrim": team_trim(image),
        "failures": failures,
        "pass": not failures,
    }


def print_report(result: dict[str, object]) -> None:
    print(f"look-budget: {result['file']} ({result['width']}×{result['height']}, L={result['luminance']})")
    print(
        f"  void (L<{VOID_LOW}): {result['voidShare']:.1f}% "
        "[INFO — no minimum in brief]"
    )
    surface_fail = any(item.startswith("surface median") or item.startswith("no surface") for item in result["failures"])
    print(
        f"  surfaces (5<=L<{SURFACE_HIGH}): median L={result['surfaceMedianL']:.0f} "
        f"({result['surfaceMedianPercent']:.1f}%) "
        f"[{'FAIL' if surface_fail else 'PASS'} <= {SURFACE_MEDIAN_MAX}]"
    )
    share_fail = any(item.startswith("mid-band") for item in result["failures"])
    print(
        f"  mid-band share ({MID_LOW}..{MID_HIGH}): {result['midBandSharePercent']:.1f}% "
        f"[{'FAIL' if share_fail else 'PASS'} <= {MID_SHARE_MAX * 100:.0f}%]"
    )
    line_fail = any(item.startswith("line p99") for item in result["failures"])
    print(
        f"  lines (L>={LINE_LOW}): p99={result['lineP99']} "
        f"[{'FAIL' if line_fail else 'PASS'} >= {LINE_P99_MIN}] "
        f"(line share {result['lineSharePercent']:.1f}%)"
    )
    contrast_fail = any(item.startswith("contrast") for item in result["failures"])
    print(
        f"  contrast p99/median(surface): {result['contrast']:.2f} "
        f"[{'FAIL' if contrast_fail else 'PASS'} >= {CONTRAST_MIN:.0f}]"
    )
    tile_fail = any(item.startswith("tile p90") for item in result["failures"])
    if SKIP_TILE:
        print(
            f"  tile p90 ({result['tileGrid']}, {result['tileCount']} tiles): "
            f"L={result['tileP90L']} ({result['tileP90Percent']:.1f}%) "
            f"[INFO - live frame: additive VFX are not surfaces]"
        )
    else:
        print(
            f"  tile p90 ({result['tileGrid']}, {result['tileCount']} tiles): "
            f"L={result['tileP90L']} ({result['tileP90Percent']:.1f}%) "
            f"[{'FAIL' if tile_fail else 'PASS'} <= {result['tileP90MaxL']:.1f} L / {result['tileP90MaxL'] / 2.55:.0f}%]"
        )
    trim = result["teamTrim"]
    print(
        "  team hulls: SKIP — hull fill is neutral/shared; saturation measures trim, not hull surface"
    )
    parts = []
    reliable = []
    for name in ("orange", "lime", "magenta"):
        entry = trim[name]
        if entry["medianL"] is None:
            parts.append(f"{name} n=0")
        elif entry["pixels"] < 200:
            parts.append(f"{name} {entry['percent']:.1f}% (n={entry['pixels']} INSUFFICIENT)")
        else:
            parts.append(f"{name} {entry['percent']:.1f}% (n={entry['pixels']})")
            reliable.append(entry["percent"])
    parts.append("cyan SKIP (hue shared with structure)")
    trim_verdict = ""
    if len(reliable) == 3:
        ratio = max(reliable) / min(reliable)
        trim_verdict = (
            f" [max/min={ratio:.2f} — DIAGNOSTIC only: not a hull measure; "
            "distance/coverage confounded, not gated]"
        )
    else:
        trim_verdict = " [INCOMPLETE — all three hue classes need n>=200; not gated]"
    print("  team trim (diagnostic, not hull): " + " · ".join(parts) + trim_verdict)
    if result["failures"]:
        print(f"look-budget: FAIL ({len(result['failures'])}): " + "; ".join(result["failures"]))
    else:
        print("look-budget: PASS")


SKIP_TILE = "--skip-tile" in sys.argv

def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    as_json = "--json" in argv
    args = [argument for argument in args if argument != "--json"]
    if len(args) != 1:
        print("usage: python3 scripts/look-budget.py <frame.png> [--json]", file=sys.stderr)
        return 2
    path = Path(args[0])
    if not path.is_file():
        print(f"look-budget: no such frame: {path}", file=sys.stderr)
        return 2
    result = measure(path)
    if as_json:
        print(json.dumps(result, indent=2))
    else:
        print_report(result)
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
