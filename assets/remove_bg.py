from __future__ import annotations

import glob
from collections import Counter

from PIL import Image


def _color_distance_sq(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    dr = a[0] - b[0]
    dg = a[1] - b[1]
    db = a[2] - b[2]
    return dr * dr + dg * dg + db * db


def remove_background(filepath: str, *, tolerance: int = 42, max_bg_colors: int = 8) -> None:
    print(f"Processing {filepath}...")
    img = Image.open(filepath).convert("RGBA")
    pixels = img.load()
    width, height = img.size

    # Infer background palette from the edges.
    edge_colors: list[tuple[int, int, int]] = []
    for x in range(width):
        for y in (0, height - 1):
            r, g, b, a = pixels[x, y]
            if a > 0:
                edge_colors.append((r, g, b))
    for y in range(height):
        for x in (0, width - 1):
            r, g, b, a = pixels[x, y]
            if a > 0:
                edge_colors.append((r, g, b))

    if not edge_colors:
        img.save(filepath)
        return

    bg_palette = [color for color, _ in Counter(edge_colors).most_common(max_bg_colors)]
    tol_sq = tolerance * tolerance

    visited: set[tuple[int, int]] = set()
    queue: list[tuple[int, int]] = []

    def is_background_pixel(x: int, y: int) -> bool:
        r, g, b, a = pixels[x, y]
        if a == 0:
            return False
        color = (r, g, b)
        return any(_color_distance_sq(color, bg) <= tol_sq for bg in bg_palette)

    # Seed BFS from all edge pixels so we only remove edge-connected background.
    for x in range(width):
        for y in (0, height - 1):
            if (x, y) not in visited:
                visited.add((x, y))
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if (x, y) not in visited:
                visited.add((x, y))
                queue.append((x, y))

    head = 0
    while head < len(queue):
        cx, cy = queue[head]
        head += 1

        if is_background_pixel(cx, cy):
            pixels[cx, cy] = (0, 0, 0, 0)

            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in visited:
                        visited.add((nx, ny))
                        queue.append((nx, ny))

    img.save(filepath)


files = glob.glob("/Users/joseochoa/Desktop/pixel-math/assets/enemy_*.png") + [
    "/Users/joseochoa/Desktop/pixel-math/assets/player_mage.png"
]
for f in files:
    remove_background(f)
print("Done!")
