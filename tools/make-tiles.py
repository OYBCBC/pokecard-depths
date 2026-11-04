#!/usr/bin/env python3
"""程序化生成洞窟层像素图块（原创素材，确定性：同一 seed 产出逐位相同）。

产物（assets/tiles/，全部 16 texel = 1 世界单位）：
  cave-floor.png   整房地板 17×11 格烘焙成一张 272×176（每格随机石板样式 + 贴墙接触阴影）
  cave-wall.png    墙侧面 16×16（上下左右无缝平铺）
  cave-wall-top.png 墙顶 16×16（无缝平铺）
  flame.png        火把火焰 4 帧横排，每帧 8×12
  shadow.png       脚下假阴影 24×12（两级透明度的像素椭圆）

用法：python3 tools/make-tiles.py
"""
import os
import random
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'tiles')
T = 16                      # 每格像素
ROOM_W, ROOM_H = 17, 11     # 房间战斗区（格）

# 三层主题色板（《03》§4：《01》§10 洞窟蓝调 / 发电厂电光紫调 / 遗迹沙金调）
THEMES = {
    'cave': dict(GROUT=(24, 29, 42), STONE=[(52, 61, 82), (60, 72, 95), (68, 82, 106)],
                 HILITE=(88, 104, 132), SHADE=(40, 47, 64), PEBBLE=(96, 110, 136),
                 CRACK=(30, 35, 50), GLINT=[(111, 183, 216), (160, 225, 245)], WALLB=[(46, 54, 72), (54, 63, 84), (40, 47, 63)], TOPB=(34, 40, 56), TINT=(1.0, 1.0, 1.0)),
    'plant': dict(GROUT=(28, 22, 44), STONE=[(58, 48, 92), (66, 55, 104), (74, 62, 116)],
                  HILITE=(100, 84, 148), SHADE=(44, 36, 70), PEBBLE=(108, 92, 160),
                  CRACK=(34, 27, 54), GLINT=[(190, 140, 255), (225, 180, 255)], WALLB=[(50, 42, 84), (58, 48, 96), (44, 36, 76)], TOPB=(36, 30, 60), TINT=(0.94, 0.90, 1.12)),
    'ruins': dict(GROUT=(36, 28, 20), STONE=[(96, 78, 54), (108, 88, 62), (120, 98, 70)],
                  HILITE=(150, 124, 88), SHADE=(72, 58, 40), PEBBLE=(160, 132, 96),
                  CRACK=(46, 36, 26), GLINT=[(255, 200, 120), (255, 230, 180)], WALLB=[(90, 74, 52), (102, 84, 60), (78, 63, 44)], TOPB=(64, 52, 38), TINT=(1.16, 1.0, 0.82)),
}
GROUT, STONE, HILITE, SHADE, PEBBLE, CRACK, GLINT = THEMES['cave']['GROUT'], THEMES['cave']['STONE'], THEMES['cave']['HILITE'], THEMES['cave']['SHADE'], THEMES['cave']['PEBBLE'], THEMES['cave']['CRACK'], THEMES['cave']['GLINT']


_THEME = THEMES['cave']


def set_theme(name):
    global GROUT, STONE, HILITE, SHADE, PEBBLE, CRACK, GLINT, _THEME
    t = THEMES[name]
    _THEME = t
    GROUT, STONE, HILITE, SHADE, PEBBLE, CRACK, GLINT = t['GROUT'], t['STONE'], t['HILITE'], t['SHADE'], t['PEBBLE'], t['CRACK'], t['GLINT']


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def stone_rects(rng):
    """把一格切成若干块石板，返回 (x0, y0, x1, y1) 列表（含边界，格内坐标）。"""
    kind = rng.choices(['one', 'h2', 'v2', 'four', 'brick'], [3, 3, 3, 2, 2])[0]
    if kind == 'one':
        return [(0, 0, 15, 15)]
    if kind == 'h2':
        s = rng.randint(6, 9)
        return [(0, 0, 15, s - 1), (0, s, 15, 15)]
    if kind == 'v2':
        s = rng.randint(6, 9)
        return [(0, 0, s - 1, 15), (s, 0, 15, 15)]
    if kind == 'four':
        sx, sy = rng.randint(6, 9), rng.randint(6, 9)
        return [(0, 0, sx - 1, sy - 1), (sx, 0, 15, sy - 1), (0, sy, sx - 1, 15), (sx, sy, 15, 15)]
    s = rng.randint(6, 9)
    o = rng.randint(4, 11)
    return [(0, 0, 15, s - 1), (0, s, o - 1, 15), (o, s, 15, 15)]


def draw_floor_tile(img, ox, oy, rng, dim=1.0):
    px = img.load()
    for (x0, y0, x1, y1) in stone_rects(rng):
        base = rng.randrange(3)
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                # 石缝：每块石板的右边与下边各留 1px
                if x == x1 or y == y1:
                    c = GROUT
                elif x == x0 or y == y0:
                    c = HILITE if rng.random() < 0.7 else STONE[2]
                elif x == x1 - 1 or y == y1 - 1:
                    c = SHADE
                else:
                    r = rng.random()
                    c = STONE[base]
                    if r < 0.12:
                        c = STONE[max(0, base - 1)]
                    elif r < 0.2:
                        c = STONE[min(2, base + 1)]
                px[ox + x, oy + y] = shade(c, dim)
    # 点缀：裂纹 / 碎石 / 水晶碎屑反光
    r = rng.random()
    if r < 0.14:
        x, y = rng.randint(3, 11), rng.randint(3, 11)
        for _ in range(rng.randint(3, 5)):
            px[ox + x, oy + y] = shade(CRACK, dim)
            x = max(1, min(14, x + rng.choice([-1, 0, 1])))
            y = max(1, min(14, y + 1))
    elif r < 0.26:
        for _ in range(rng.randint(1, 3)):
            px[ox + rng.randint(2, 13), oy + rng.randint(2, 13)] = shade(PEBBLE, dim)
    elif r < 0.31:
        x, y = rng.randint(3, 12), rng.randint(3, 12)
        px[ox + x, oy + y] = GLINT[1]
        px[ox + x + 1, oy + y] = GLINT[0]
        px[ox + x, oy + y + 1] = GLINT[0]


def make_crack(rng):
    """墙裂缝 16×16（隐藏房入口的可疑墙）"""
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    px = img.load()
    x, y = 8, 2
    for step in range(12):
        px[min(15, max(0, x)), min(15, max(0, y))] = (12, 14, 22, 220)
        if 0 <= x + 1 < 16: px[x + 1, y] = (22, 25, 36, 160)
        x += rng.choice([-1, 0, 0, 1])
        y += 1
    return img


def make_floor(rng, boss=False, w=None, h=None):
    w = w or ROOM_W
    h = h or ROOM_H
    img = Image.new('RGB', (w * T, h * T))
    for ty in range(h):
        for tx in range(w):
            edge = tx == 0 or ty == 0 or tx == w - 1 or ty == h - 1
            draw_floor_tile(img, tx * T, ty * T, rng, 0.82 if edge else 1.0)
    if boss:
        tr, tg, tb = _THEME['TINT']
        px = img.load()
        W, H = img.size
        for y in range(H):
            for x in range(W):
                r, g, b = px[x, y]
                px[x, y] = (min(255, int(r * tr * 1.15 + 10)), min(255, int(g * tg * 0.95)), min(255, int(b * tb * 0.85)))
    # 贴墙接触阴影：北/东/西墙根 3px 渐暗（南墙低矮，不压暗）
    px = img.load()
    W, H = img.size
    for y in range(H):
        for x in range(W):
            d = min(y, x, W - 1 - x)
            if d < 3:
                px[x, y] = shade(px[x, y], 0.55 + 0.15 * d)
    return img


def make_wall_side(rng):
    """无缝岩壁：错缝石块，坐标按 16 取模绘制保证四向平铺。"""
    img = Image.new('RGB', (T, T), GROUT)
    px = img.load()
    rows = [(0, 4), (5, 9), (10, 15)]
    for ri, (y0, y1) in enumerate(rows):
        off = (ri * 6) % T
        cuts = sorted({off, (off + rng.randint(6, 9)) % T})
        segs = []
        for i, c in enumerate(cuts):
            n = cuts[(i + 1) % len(cuts)]
            length = (n - c) % T or T
            segs.append((c, length))
        for (sx, length) in segs:
            base = rng.choice(_THEME['WALLB'])
            for dy in range(y0, y1):
                for dx in range(length - 1):
                    x = (sx + dx) % T
                    c = base
                    if dy == y0:
                        c = shade(base, 1.28)
                    elif dy == y1 - 1:
                        c = shade(base, 0.78)
                    elif rng.random() < 0.15:
                        c = shade(base, 0.9 if rng.random() < 0.5 else 1.1)
                    px[x, dy] = c
    return img


def make_wall_top(rng):
    img = Image.new('RGB', (T, T))
    px = img.load()
    for y in range(T):
        for x in range(T):
            base_top = _THEME['TOPB']
            c = base_top
            r = rng.random()
            if r < 0.15:
                c = (40, 47, 65)
            elif r < 0.25:
                c = (28, 33, 46)
            px[x, y] = c
    return img


FLAME_COLS = [(255, 246, 200), (255, 200, 90), (255, 128, 40), (190, 60, 30)]


def make_flame(rng):
    fw, fh, frames = 8, 12, 4
    img = Image.new('RGBA', (fw * frames, fh), (0, 0, 0, 0))
    px = img.load()
    for f in range(frames):
        sway = [0, 1, 0, -1][f]
        for y in range(fh):
            t = y / (fh - 1)                     # 0=顶 1=底
            half = 0.6 + 3.0 * (t ** 0.8)        # 上尖下宽
            if y < 2:
                half *= 0.6
            cx = 3.5 + sway * (1 - t)
            for x in range(fw):
                d = abs(x - cx) / max(half, 0.01)
                if d > 1:
                    continue
                if d < 0.35 and t > 0.45:
                    c = FLAME_COLS[0]
                elif d < 0.6:
                    c = FLAME_COLS[1]
                elif d < 0.85:
                    c = FLAME_COLS[2]
                else:
                    c = FLAME_COLS[3]
                if rng.random() < 0.08 and y < fh - 3:
                    continue                      # 火舌边缘随机缺口
                px[f * fw + x, y] = c + (255,)
    return img


def make_shadow():
    w, h = 24, 12
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = img.load()
    cx, cy = (w - 1) / 2, (h - 1) / 2
    for y in range(h):
        for x in range(w):
            d = ((x - cx) / (w / 2)) ** 2 + ((y - cy) / (h / 2)) ** 2
            if d <= 0.55:
                px[x, y] = (0, 0, 0, 120)
            elif d <= 1.0:
                px[x, y] = (0, 0, 0, 64)
    return img


def make_orb(name, core, mid, edge, size=10):
    """发光弹体（电击弹/酸液弹）：白核 + 主题色 + 外缘渐隐。"""
    cx = cy = (size - 1) / 2
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    px = img.load()
    for y in range(size):
        for x in range(size):
            d = ((x - cx) / (size / 2)) ** 2 + ((y - cy) / (size / 2)) ** 2
            if d <= 0.18:
                px[x, y] = core + (255,)
            elif d <= 0.55:
                px[x, y] = mid + (255,)
            elif d <= 1.0:
                px[x, y] = edge + (170,)
    return img


def make_door():
    """门洞贴图（16×24）：拱形发光洞（open 态，关态用墙体材质盖住）。"""
    w, h = 16, 24
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = img.load()
    for y in range(h):
        for x in range(w):
            # 拱形：上缘半圆
            if y < 10:
                dx = (x - 7.5) / 7.5
                dy = (y - 10) / 10
                if dx * dx + dy * dy > 1:
                    continue
            # 内部：暗洞 + 边缘亮线
            edge = (x in (0, 1, 14, 15)) or (y >= 22) or (y < 10 and ((x - 7.5) ** 2 / 7.5 ** 2 + (y - 10) ** 2 / 10 ** 2) > 0.64)
            if edge:
                px[x, y] = (127, 212, 255, 255)
            else:
                px[x, y] = (14, 20, 34, 255)
    return img




def make_coin():
    img = Image.new('RGBA', (10, 10), (0, 0, 0, 0))
    px = img.load()
    for y in range(10):
        for x in range(10):
            d = ((x - 4.5) / 4.5) ** 2 + ((y - 4.5) / 4.5) ** 2
            if d <= 0.16: px[x, y] = (255, 236, 160, 255)
            elif d <= 0.62: px[x, y] = (255, 200, 60, 255)
            elif d <= 1.0: px[x, y] = (196, 140, 30, 255)
    return img


def make_heart_px():
    img = Image.new('RGBA', (10, 9), (0, 0, 0, 0))
    px = img.load()
    for y in range(9):
        for x in range(10):
            # 两圆 + 三角的经典像素心
            c1 = ((x - 2.5) / 2.6) ** 2 + ((y - 2.5) / 2.6) ** 2 <= 1
            c2 = ((x - 7.5) / 2.6) ** 2 + ((y - 2.5) / 2.6) ** 2 <= 1
            tri = y >= 3 and abs(x - 4.5) <= (8.5 - y) * 0.72
            if c1 or c2 or tri:
                edge = y >= 6 or x <= 0 or x >= 9
                px[x, y] = (150, 30, 50, 255) if edge else (255, 90, 110, 255)
    return img


def make_ring():
    """预警圈 32×32：外亮环 + 半透明内芯（程序渲染时随剩余时间缩放）"""
    img = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    px = img.load()
    for y in range(32):
        for x in range(32):
            d = ((x - 15.5) / 15.5) ** 2 + ((y - 15.5) / 15.5) ** 2
            if 0.72 <= d <= 1.0: px[x, y] = (255, 120, 90, 230)
            elif d < 0.72: px[x, y] = (255, 120, 90, 40)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    rng = random.Random(20261103)
    for theme in ['cave', 'plant', 'ruins']:
        set_theme(theme)
        r1 = random.Random(20261103 if theme == 'cave' else (20261105 if theme == 'plant' else 20261106))
        make_floor(r1).save(os.path.join(OUT, f'{theme}-floor.png'))
        make_floor(random.Random(hash(theme) % 99991 + 7), boss=True, w=24, h=16).save(os.path.join(OUT, f'{theme}-floor-boss.png'))
        make_wall_side(r1).save(os.path.join(OUT, f'{theme}-wall.png'))
        make_wall_top(r1).save(os.path.join(OUT, f'{theme}-wall-top.png'))
    set_theme('cave')
    make_crack(random.Random(77)).save(os.path.join(OUT, 'crack.png'))
    make_coin().save(os.path.join(OUT, 'coin.png'))
    make_heart_px().save(os.path.join(OUT, 'heart.png'))
    make_ring().save(os.path.join(OUT, 'ring.png'))
    make_wall_side(rng).save(os.path.join(OUT, 'cave-wall.png'))
    make_wall_top(rng).save(os.path.join(OUT, 'cave-wall-top.png'))
    make_flame(rng).save(os.path.join(OUT, 'flame.png'))
    make_shadow().save(os.path.join(OUT, 'shadow.png'))
    make_orb('bolt', (255, 255, 220), (255, 234, 106), (255, 200, 40)).save(os.path.join(OUT, 'orb-bolt.png'))
    make_orb('acid', (240, 255, 210), (150, 220, 90), (80, 160, 60)).save(os.path.join(OUT, 'orb-acid.png'))
    make_door().save(os.path.join(OUT, 'door.png'))
    print('tiles ->', OUT)


if __name__ == '__main__':
    main()
