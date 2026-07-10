"""
Download Protomaps glyphs and sprites for self-hosting.

Outputs:
  frontend/public/fonts/pbf/{fontstack}/{range}.pbf   (glyphs)
  frontend/public/sprites/v4/light{,.json,@2x.png,@2x.json}  (sprites)
"""

import os
import sys
import urllib.request
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

FONTS = [
    "Noto Sans Regular",
    "Noto Sans Italic",
    "Noto Sans Medium",
]

# 256 ranges covering the full Unicode BMP (0–65535)
RANGES = [f"{i}-{i+255}" for i in range(0, 65536, 256)]

GLYPH_BASE = "https://cdn.protomaps.com/fonts/pbf"
SPRITE_BASE = "https://protomaps.github.io/basemaps-assets/sprites/v4"
SPRITE_FILES = ["light.json", "light.png", "light@2x.json", "light@2x.png"]

OUT_FONTS = os.path.join("frontend", "public", "fonts", "pbf")
OUT_SPRITES = os.path.join("frontend", "public", "sprites", "v4")


_opener = urllib.request.build_opener()
_opener.addheaders = [("User-Agent", "Mozilla/5.0")]


def download(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest):
        return dest, True  # already exists
    try:
        with _opener.open(url) as r:
            data = r.read()
        with open(dest, "wb") as f:
            f.write(data)
        return dest, True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return dest, None  # range doesn't exist — silently skip
        return dest, False
    except Exception:
        return dest, False


def main():
    tasks = []

    # Sprites
    for fname in SPRITE_FILES:
        url = f"{SPRITE_BASE}/{fname}"
        dest = os.path.join(OUT_SPRITES, fname)
        tasks.append((url, dest))

    # Glyphs
    for font in FONTS:
        encoded = urllib.parse.quote(font, safe="")
        font_dir = os.path.join(OUT_FONTS, font)
        for r in RANGES:
            url = f"{GLYPH_BASE}/{encoded}/{r}.pbf"
            dest = os.path.join(font_dir, f"{r}.pbf")
            tasks.append((url, dest))

    total = len(tasks)
    done = 0
    errors = []

    print(f"Downloading {total} files with 20 parallel workers…")

    with ThreadPoolExecutor(max_workers=20) as pool:
        futures = {pool.submit(download, url, dest): (url, dest) for url, dest in tasks}
        for future in as_completed(futures):
            dest, ok = future.result()
            done += 1
            if ok is False:
                errors.append(dest)
            if done % 100 == 0 or done == total:
                print(f"  {done}/{total} …", flush=True)

    print(f"\nDone. {total - len(errors)} OK, {len(errors)} errors.")
    if errors:
        print("Errors:")
        for e in errors[:20]:
            print(f"  {e}")


if __name__ == "__main__":
    import urllib.parse
    main()
