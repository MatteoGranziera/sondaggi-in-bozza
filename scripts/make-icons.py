# Draws the extension icons (icons/*.png) and the store icon (store/icon-store-128.png),
# with no dependencies: a green rounded square with three poll bars, supersampled.
# Run: python3 scripts/make-icons.py
import os
import struct
import zlib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
BG = (27, 138, 90)
FG = (255, 255, 255)
SS = 4


def inside_round_rect(x, y, size, r):
    cx = min(max(x, r), size - r)
    cy = min(max(y, r), size - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def bar(x, y, size, row, length):
    top = size * (0.27 + row * 0.19)
    h = size * 0.11
    left = size * 0.22
    right = left + size * 0.56 * length
    r = h / 2
    if not (top <= y <= top + h):
        return False
    cy = top + r
    if x < left + r:
        return (x - (left + r)) ** 2 + (y - cy) ** 2 <= r * r
    if x > right - r:
        return (x - (right - r)) ** 2 + (y - cy) ** 2 <= r * r
    return True


def pixel(px, py, size):
    cover = fg = 0
    for sy in range(SS):
        for sx in range(SS):
            x = px + (sx + 0.5) / SS
            y = py + (sy + 0.5) / SS
            if inside_round_rect(x, y, size, size * 0.22):
                cover += 1
                if any(bar(x, y, size, i, l) for i, l in enumerate((0.95, 0.6, 0.8))):
                    fg += 1
    if not cover:
        return (0, 0, 0, 0)
    t = fg / cover
    rgb = tuple(round(BG[i] * (1 - t) + FG[i] * t) for i in range(3))
    return rgb + (round(255 * cover / (SS * SS)),)


def png(total, art, pad):
    rows = b''
    for y in range(total):
        rows += b'\x00'
        for x in range(total):
            inside = pad <= x < pad + art and pad <= y < pad + art
            rows += bytes(pixel(x - pad, y - pad, art) if inside else (0, 0, 0, 0))

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', total, total, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')


for size in (16, 32, 48, 128):
    with open(os.path.join(ROOT, 'icons', f'{size}.png'), 'wb') as f:
        f.write(png(size, size, 0))
# The store wants 96px of art inside a 128px canvas.
with open(os.path.join(ROOT, 'store', 'icon-store-128.png'), 'wb') as f:
    f.write(png(128, 96, 16))
