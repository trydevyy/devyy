"""Rasterize Devyy's existing asterisk mark without image dependencies."""
import math
import pathlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'src-tauri' / 'icons'

def png(name, background, foreground):
    size = 512
    rows = []
    segments = [(32, 14, 32, 50), (16.4, 23, 47.6, 41), (16.4, 41, 47.6, 23)]
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            values = [0, 0, 0, 0]
            for ox, oy in [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)]:
                px, py = (x + ox) * 64 / size, (y + oy) * 64 / size
                dx, dy = max(14 - px, 0, px - 50), max(14 - py, 0, py - 50)
                inside = dx * dx + dy * dy <= 14 * 14
                mark = False
                for ax, ay, bx, by in segments:
                    vx, vy = bx - ax, by - ay
                    t = ((px-ax)*vx + (py-ay)*vy)/(vx*vx+vy*vy)
                    if 0 <= t <= 1 and math.hypot(px-ax-t*vx, py-ay-t*vy) <= 3.4:
                        mark = True
                color = foreground if mark else background
                for i in range(3): values[i] += color[i] if inside else 0
                values[3] += 255 if inside else 0
            row.extend(round(v/4) for v in values)
        rows.append(row)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind+data))
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size,size,8,6,0,0,0))
    data += chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')
    (ROOT / name).write_bytes(data)

png('theme-dark.png', (32,33,36), (245,245,245))
png('theme-light.png', (245,245,245), (37,38,41))
