"""Generate the CC0 Club Planner recognition regression corpus.

The generated assets are deterministic and intentionally synthetic. Run from the
repository root with the bundled Codex Python or any Python with Pillow/reportlab/numpy.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "tests" / "fixtures" / "recognition"
WIDTH_PX = 1200
HEIGHT_PX = 800
PX_PER_M = 80
ORIGIN = (120, 80)
FONT_PATH = Path("C:/Windows/Fonts/arial.ttf")
RASTER_FONT = ImageFont.truetype(str(FONT_PATH), 17) if FONT_PATH.exists() else ImageFont.truetype("DejaVuSans.ttf", 17)
if FONT_PATH.exists():
    pdfmetrics.registerFont(TTFont("RecognitionSans", str(FONT_PATH)))


def plan_geometry(index: int) -> dict:
    room_width = 10.5 + (index % 3) * 0.5
    room_height = 7.0 + (index % 2) * 0.4
    divider_x = 3.2 + (index % 4) * 0.35
    cross_y = 4.0 + (index % 3) * 0.25
    walls = [
        {"kind": "line", "start": [0, 0], "end": [room_width, 0]},
        {"kind": "line", "start": [room_width, 0], "end": [room_width, room_height]},
        {"kind": "line", "start": [room_width, room_height], "end": [0, room_height]},
        {"kind": "line", "start": [0, room_height], "end": [0, 0]},
        {"kind": "line", "start": [divider_x, 0], "end": [divider_x, 2.6]},
        {"kind": "line", "start": [divider_x, 3.5], "end": [divider_x, room_height]},
        {"kind": "line", "start": [divider_x, cross_y], "end": [room_width, cross_y]},
    ]
    if index % 3 == 0:
        walls.append({"kind": "arc", "start": [6.0, cross_y], "through": [7.0, cross_y - 0.7], "end": [8.0, cross_y]})
    if index % 4 == 1:
        walls.append({"kind": "line", "start": [8.2, cross_y], "end": [room_width - 0.4, room_height - 0.5]})
    return {
        "widthM": room_width,
        "heightM": room_height,
        "walls": walls,
        "openings": [
            {"kind": "door", "hostWallIndex": 4, "offsetM": 2.6, "widthM": 0.9},
            {"kind": "window", "hostWallIndex": 0, "offsetM": 6.0, "widthM": 1.4},
        ],
        "calibration": {"first": [0, room_height + 0.45], "second": [3, room_height + 0.45], "knownDistanceM": 3},
    }


def pixel(point: list[float]) -> tuple[float, float]:
    return ORIGIN[0] + point[0] * PX_PER_M, ORIGIN[1] + point[1] * PX_PER_M


def draw_plan(draw: ImageDraw.ImageDraw, geometry: dict, line_width: int = 7) -> None:
    for wall in geometry["walls"]:
        if wall["kind"] == "line":
            draw.line([pixel(wall["start"]), pixel(wall["end"])], fill=(18, 24, 32), width=line_width)
        else:
            start = np.array(pixel(wall["start"]))
            through = np.array(pixel(wall["through"]))
            end = np.array(pixel(wall["end"]))
            center = (start + end) / 2
            radius = float(np.linalg.norm(start - center))
            bbox = [center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius]
            draw.arc(bbox, 180, 360, fill=(18, 24, 32), width=line_width)
    divider_x = geometry["walls"][4]["start"][0]
    hinge = pixel([divider_x, 2.6])
    door_end = pixel([divider_x + 0.9, 2.6])
    draw.line([hinge, door_end], fill=(20, 90, 150), width=max(2, line_width // 2))
    door_radius = 0.9 * PX_PER_M
    draw.arc([hinge[0], hinge[1] - door_radius, hinge[0] + door_radius * 2, hinge[1] + door_radius], 180, 270, fill=(20, 90, 150), width=max(2, line_width // 3))
    window_start = pixel([6.0, 0])
    window_end = pixel([7.4, 0])
    draw.line([(window_start[0], window_start[1] - 7), (window_end[0], window_end[1] - 7)], fill=(20, 120, 170), width=3)
    draw.line([(window_start[0], window_start[1] + 7), (window_end[0], window_end[1] + 7)], fill=(20, 120, 170), width=3)
    dim_y = pixel(geometry["calibration"]["first"])[1]
    dim_start = pixel(geometry["calibration"]["first"])
    dim_end = pixel(geometry["calibration"]["second"])
    draw.line([dim_start, dim_end], fill=(70, 70, 70), width=2)
    draw.line([(dim_start[0], dim_y - 8), (dim_start[0], dim_y + 8)], fill=(70, 70, 70), width=2)
    draw.line([(dim_end[0], dim_y - 8), (dim_end[0], dim_y + 8)], fill=(70, 70, 70), width=2)
    draw.text((dim_start[0] + 80, dim_y + 8), "3000 мм", fill=(30, 30, 30), font=RASTER_FONT)
    draw.text(pixel([6.25, 0.18]), "ОКНО", fill=(20, 80, 120), font=RASTER_FONT)
    draw.text(pixel([0.4, 0.4]), "Высота H=3,0 м", fill=(40, 40, 40), font=RASTER_FONT)


def vector_pdf(path: Path, geometry: dict) -> None:
    page = canvas.Canvas(str(path), pagesize=(WIDTH_PX, HEIGHT_PX), pageCompression=1)
    page.setStrokeColorRGB(0.08, 0.1, 0.13)
    page.setLineWidth(5)
    for wall in geometry["walls"]:
        if wall["kind"] == "line":
            x1, y1 = pixel(wall["start"])
            x2, y2 = pixel(wall["end"])
            page.line(x1, HEIGHT_PX - y1, x2, HEIGHT_PX - y2)
        else:
            start = pixel(wall["start"])
            end = pixel(wall["end"])
            center_x = (start[0] + end[0]) / 2
            radius = abs(end[0] - start[0]) / 2
            page.arc(center_x - radius, HEIGHT_PX - start[1] - radius, center_x + radius, HEIGHT_PX - start[1] + radius, 0, 180)
    divider_x = geometry["walls"][4]["start"][0]
    hinge_x, hinge_y = pixel([divider_x, 2.6])
    page.setStrokeColorRGB(0.08, 0.35, 0.6)
    page.setLineWidth(2)
    page.line(hinge_x, HEIGHT_PX - hinge_y, hinge_x + 0.9 * PX_PER_M, HEIGHT_PX - hinge_y)
    page.arc(hinge_x - 0.9 * PX_PER_M, HEIGHT_PX - hinge_y - 0.9 * PX_PER_M, hinge_x + 0.9 * PX_PER_M, HEIGHT_PX - hinge_y + 0.9 * PX_PER_M, 270, 90)
    page.setFillColorRGB(0.12, 0.12, 0.12)
    page.setFont("RecognitionSans" if FONT_PATH.exists() else "Helvetica", 13)
    page.drawString(*[pixel([0.4, 0.4])[0], HEIGHT_PX - pixel([0.4, 0.4])[1]], "Высота H=3,0 м" if FONT_PATH.exists() else "Height H=3.0 m")
    page.drawCentredString((pixel([0, geometry["heightM"] + 0.45])[0] + pixel([3, geometry["heightM"] + 0.45])[0]) / 2, HEIGHT_PX - pixel([0, geometry["heightM"] + 0.45])[1] - 18, "3000 мм" if FONT_PATH.exists() else "3000 mm")
    page.drawString(pixel([6.25, 0.18])[0], HEIGHT_PX - pixel([6.25, 0.18])[1], "ОКНО" if FONT_PATH.exists() else "WINDOW")
    page.showPage()
    if path.stem.endswith("10"):
        page.setFont("RecognitionSans" if FONT_PATH.exists() else "Helvetica", 24)
        page.drawString(90, HEIGHT_PX - 100, "Дополнительная страница" if FONT_PATH.exists() else "Additional page")
        page.showPage()
    page.save()


def scan_image(path: Path, geometry: dict, seed: int) -> Image.Image:
    image = Image.new("RGB", (WIDTH_PX, HEIGHT_PX), (248, 247, 242))
    draw_plan(ImageDraw.Draw(image), geometry)
    rng = np.random.default_rng(seed)
    pixels = np.asarray(image).astype(np.int16)
    noise = rng.normal(0, 4.5, pixels.shape[:2])[:, :, None]
    pixels = np.clip(pixels + noise, 0, 255).astype(np.uint8)
    result = Image.fromarray(pixels, "RGB").filter(ImageFilter.GaussianBlur(0.45 + seed % 3 * 0.15))
    result.save(path, optimize=True)
    return result


def photo_image(path: Path, geometry: dict, seed: int) -> None:
    base = scan_image(path.with_suffix(".tmp.png"), geometry, seed + 100)
    angle = -2.5 + seed * 0.45
    rotated = base.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(72, 68, 62))
    quad = (30 + seed * 2, 10, rotated.width - 50, 28 + seed, rotated.width - 8, rotated.height - 35, 55, rotated.height - 5)
    warped = rotated.transform((WIDTH_PX, HEIGHT_PX), Image.Transform.QUAD, quad, resample=Image.Resampling.BICUBIC, fillcolor=(66, 62, 58))
    array = np.asarray(warped).astype(np.float32)
    gradient = np.linspace(0.72, 1.12, WIDTH_PX, dtype=np.float32)[None, :, None]
    vignette_y = np.linspace(0.9, 1.05, HEIGHT_PX, dtype=np.float32)[:, None, None]
    array = np.clip(array * gradient * vignette_y, 0, 255).astype(np.uint8)
    result = ImageEnhance.Contrast(Image.fromarray(array, "RGB")).enhance(0.92)
    result.save(path, quality=88, optimize=True)
    path.with_suffix(".tmp.png").unlink()


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    random.seed(3412)
    for category in ("vector", "scan", "photo"):
        (OUTPUT / category).mkdir(parents=True, exist_ok=True)
    cases = []
    for index in range(10):
        geometry = plan_geometry(index)
        variants = [
            ("vector", OUTPUT / "vector" / f"vector-{index + 1:02d}.pdf", "application/pdf"),
            ("scan", OUTPUT / "scan" / f"scan-{index + 1:02d}.png", "image/png"),
            ("photo", OUTPUT / "photo" / f"photo-{index + 1:02d}.jpg", "image/jpeg"),
        ]
        vector_pdf(variants[0][1], geometry)
        scan_image(variants[1][1], geometry, index)
        photo_image(variants[2][1], geometry, index)
        for category, path, mime in variants:
            cases.append({
                "id": f"{category}-{index + 1:02d}",
                "category": category,
                "path": path.relative_to(ROOT).as_posix(),
                "mimeType": mime,
                "license": "CC0-1.0 / self-generated",
                "sha256": digest(path),
                "groundTruth": geometry,
            })
    manifest = {
        "format": "club-planner-recognition-corpus",
        "version": 1,
        "license": "CC0-1.0",
        "generator": "tools/generate_recognition_corpus.py",
        "cases": cases,
        "manualFixtures": [{
            "id": "current-club-measurement",
            "path": "assets/measurement_plan.pdf",
            "license": "project-provided; do not redistribute outside this repository",
            "purpose": "manual import and visual comparison only",
        }],
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
