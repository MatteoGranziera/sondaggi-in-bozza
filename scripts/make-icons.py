# Draws the extension icons (icons/*.png) and the store icon (store/icon-store-128.png)
# with no dependencies, by supersampling the shapes of icons/icon.svg: a green tile with
# three poll bars and a pencil. Keep the shapes below in step with the SVG.
# Run: python3 scripts/make-icons.py
import os
import struct
import zlib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
GREEN = (27, 138, 90)
SS = 8

# All coordinates are in the SVG's 128x128 viewBox.
TILE = (0, 0, 128, 128, 28)
BARS = [(24, 28, 72, 12, 6), (24, 56, 40, 12, 6), (24, 84, 24, 12, 6)]
PENCIL = [(64, 104), (68, 86), (89, 65), (103, 79), (82, 100)]


def quad(a, b, c, steps=24):
    return [((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0],
             (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1])
            for t in (i / steps for i in range(1, steps + 1))]


ERASER = [(92, 62), (96, 58)] + quad((96, 58), (99, 55), (102, 58)) + [(110, 66)] \
    + quad((110, 66), (113, 69), (110, 72)) + [(106, 76)]


def in_round_rect(x, y, left, top, w, h, r):
    if not (left <= x <= left + w and top <= y <= top + h):
        return False
    cx = min(max(x, left + r), left + w - r)
    cy = min(max(y, top + r), top + h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def in_polygon(x, y, pts):
    inside = False
    for (ax, ay), (bx, by) in zip(pts, pts[1:] + pts[:1]):
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            inside = not inside
    return inside


def render(n):
    data = bytearray(n * n * 4)
    for py in range(n):
        for px in range(n):
            cover = white = 0
            for sy in range(SS):
                y = (py + (sy + 0.5) / SS) * 128 / n
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) * 128 / n
                    if in_round_rect(x, y, *TILE):
                        cover += 1
                        if any(in_round_rect(x, y, *b) for b in BARS) or in_polygon(x, y, PENCIL) or in_polygon(x, y, ERASER):
                            white += 1
            if cover:
                i = (py * n + px) * 4
                rgb = [round((GREEN[c] * (cover - white) + 255 * white) / cover) for c in range(3)]
                data[i:i + 4] = bytes(rgb + [round(cover * 255 / SS ** 2)])
    return data


def write_png(path, w, h, data):
    def chunk(tag, body):
        return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body) & 0xffffffff)

    raw = b''.join(b'\0' + bytes(data[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


for size in (16, 32, 48, 128):
    write_png(os.path.join(ROOT, 'icons', f'{size}.png'), size, size, render(size))

# The store wants 96px of art inside a 128px canvas.
art = render(96)
store = bytearray(128 * 128 * 4)
for y in range(96):
    store[((y + 16) * 128 + 16) * 4:((y + 16) * 128 + 112) * 4] = art[y * 96 * 4:(y + 1) * 96 * 4]
write_png(os.path.join(ROOT, 'store', 'icon-store-128.png'), 128, 128, store)
