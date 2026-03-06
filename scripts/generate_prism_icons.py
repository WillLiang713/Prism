from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ICONS_DIR = ROOT / "src-tauri" / "icons"
MASTER_SIZE = 1024


def rounded_rect_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def draw_icon(size: int = MASTER_SIZE) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    tile_margin = int(size * 0.11)
    tile_radius = int(size * 0.23)
    tile_box = (
        tile_margin,
        tile_margin,
        size - tile_margin,
        size - tile_margin,
    )
    tile_w = tile_box[2] - tile_box[0]
    tile_h = tile_box[3] - tile_box[1]

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_box = (
        tile_box[0],
        tile_box[1] + int(size * 0.02),
        tile_box[2],
        tile_box[3] + int(size * 0.02),
    )
    shadow_draw.rounded_rectangle(
        shadow_box,
        radius=tile_radius,
        fill=(0, 0, 0, 130),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=int(size * 0.03)))
    image.alpha_composite(shadow)

    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tile_draw = ImageDraw.Draw(tile)
    tile_draw.rounded_rectangle(
        tile_box,
        radius=tile_radius,
        fill=(12, 12, 14, 255),
        outline=(58, 58, 64, 255),
        width=max(2, int(size * 0.007)),
    )

    gloss = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gloss_draw = ImageDraw.Draw(gloss)
    gloss_draw.rounded_rectangle(
        (
            tile_box[0] + int(tile_w * 0.06),
            tile_box[1] + int(tile_h * 0.05),
            tile_box[2] - int(tile_w * 0.06),
            tile_box[1] + int(tile_h * 0.42),
        ),
        radius=int(tile_radius * 0.7),
        fill=(255, 255, 255, 10),
    )
    gloss = gloss.filter(ImageFilter.GaussianBlur(radius=int(size * 0.02)))

    tile.alpha_composite(gloss)
    image.alpha_composite(tile)

    glyph = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glyph_draw = ImageDraw.Draw(glyph)

    stem_left = tile_box[0] + int(tile_w * 0.28)
    stem_top = tile_box[1] + int(tile_h * 0.24)
    stem_bottom = tile_box[1] + int(tile_h * 0.76)
    stem_width = int(tile_w * 0.12)
    bowl_left = stem_left + stem_width
    bowl_top = tile_box[1] + int(tile_h * 0.24)
    bowl_right = tile_box[0] + int(tile_w * 0.73)
    bowl_bottom = tile_box[1] + int(tile_h * 0.58)
    bowl_radius = int(tile_h * 0.12)
    cut_left = stem_left + int(tile_w * 0.08)
    cut_top = tile_box[1] + int(tile_h * 0.32)
    cut_right = tile_box[0] + int(tile_w * 0.60)
    cut_bottom = tile_box[1] + int(tile_h * 0.50)

    white = (245, 245, 246, 255)
    cut = (12, 12, 14, 255)

    glyph_draw.rounded_rectangle(
        (stem_left, stem_top, stem_left + stem_width, stem_bottom),
        radius=int(stem_width * 0.45),
        fill=white,
    )
    glyph_draw.rounded_rectangle(
        (bowl_left, bowl_top, bowl_right, bowl_bottom),
        radius=bowl_radius,
        fill=white,
    )

    glyph_draw.polygon(
        [
            (cut_left, cut_top),
            (cut_right, cut_top),
            (bowl_right - int(tile_w * 0.02), cut_bottom),
            (cut_left + int(tile_w * 0.05), cut_bottom),
        ],
        fill=cut,
    )

    facet = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    facet_draw = ImageDraw.Draw(facet)
    facet_draw.polygon(
        [
            (tile_box[0] + int(tile_w * 0.49), tile_box[1] + int(tile_h * 0.24)),
            (tile_box[0] + int(tile_w * 0.66), tile_box[1] + int(tile_h * 0.24)),
            (tile_box[0] + int(tile_w * 0.59), tile_box[1] + int(tile_h * 0.36)),
        ],
        fill=(255, 255, 255, 32),
    )
    facet = facet.filter(ImageFilter.GaussianBlur(radius=int(size * 0.005)))

    glyph.alpha_composite(facet)
    image.alpha_composite(glyph)

    return image


def save_outputs(master: Image.Image) -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    master_512 = master.resize((512, 512), Image.Resampling.LANCZOS)
    master_512.save(ICONS_DIR / "icon-512.png")

    sizes = {
        "128x128.png": 128,
        "32x32.png": 32,
    }
    for name, px in sizes.items():
        master.resize((px, px), Image.Resampling.LANCZOS).save(ICONS_DIR / name)

    master_512.save(
        ICONS_DIR / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


def main() -> None:
    master = draw_icon()
    save_outputs(master)
    print(f"Generated icons in {ICONS_DIR}")


if __name__ == "__main__":
    main()
