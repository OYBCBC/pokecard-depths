#!/usr/bin/env python3
"""程序化生成道具图标（原创像素画，30×30，P 模式 PNG，assets/items/）。

与 M3 批次的手绘图标同规格：深色描边 + 三段明暗 + 1px 高光点。
本工具只生成缺失的文件（--force 可强制重画全部）。

用法：python3 tools/make-item-icons.py [--force]
"""
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'items')
S = 30                       # 画布边长

INK = (24, 20, 34, 255)      # 描边
SH = lambda c: tuple(max(0, min(255, int(v * 0.62))) for v in c)   # 暗部
HI = lambda c: tuple(max(0, min(255, int(v * 0.45 + 150))) for v in c)  # 高光


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def canvas():
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def outline_pix(d, xy_box, fill):
    """实心形状 + 1px 深描边（先画描边大圈再填内芯）。"""
    x0, y0, x1, y1 = [int(v) for v in xy_box]
    d.ellipse([x0, y0, x1, y1], fill=INK)
    d.ellipse([x0 + 1, y0 + 1, x1 - 1, y1 - 1], fill=fill)


def orb(c, deco=None):
    """圆球道具（宝珠/糖果芯）。deco = 内部小装饰回调 (d, cx, cy)"""
    im, d = canvas()
    outline_pix(d, (5, 5, 25, 25), c)
    d.ellipse((10, 9, 14, 13), fill=HI(c))                    # 高光点
    if deco:
        deco(d, 15, 15)
    return im


def stone(c, spark=None):
    """多面石头（月亮石/进化石/冰岩）：不规则八边块。"""
    im, d = canvas()
    pts = [(8, 5), (20, 4), (25, 11), (24, 21), (15, 26), (6, 21), (4, 12)]
    d.polygon(pts, fill=INK)
    inner = [(p[0] * 0.92 + 15 * 0.08, p[1] * 0.92 + 15 * 0.08) for p in pts]
    d.polygon(inner, fill=c)
    d.polygon([(9, 9), (14, 7), (12, 12)], fill=HI(c))
    if spark:
        spark(d)
    return im


def berry(c, leaf=(86, 168, 74)):
    """树果：圆果身 + 顶部叶子。"""
    im, d = canvas()
    d.polygon([(15, 3), (22, 8), (15, 10), (9, 7)], fill=INK)
    d.polygon([(16, 4), (21, 8), (15, 9), (10, 7)], fill=leaf)
    d.line((15, 8, 15, 12), fill=(74, 52, 40, 255), width=2)
    outline_pix(d, (6, 10, 25, 27), c)
    d.ellipse((11, 14, 15, 18), fill=HI(c))
    return im


def badge(c, gem):
    """馆主徽章：八角盾 + 中央宝石。"""
    im, d = canvas()
    pts = [(15, 3), (24, 8), (26, 16), (20, 25), (10, 25), (4, 16), (6, 8)]
    d.polygon(pts, fill=INK)
    d.polygon([(p[0] * 0.88 + 15 * 0.12, p[1] * 0.88 + 15 * 0.12) for p in pts], fill=c)
    d.polygon([(15, 9), (20, 13), (17, 20), (12, 19), (10, 13)], fill=INK)
    d.polygon([(15, 10), (19, 13), (16, 19), (12, 18), (11, 13)], fill=gem)
    d.line((13, 12, 14, 13), fill=HI(gem))
    return im


# ---------- 36 件新图标（生成器表）----------
ICONS = {
    # 宝珠系
    'flame-orb': lambda: orb((232, 108, 44), lambda d, x, y: d.polygon(
        [(x, y + 6), (x - 4, y - 1), (x - 1, y + 1), (x, y - 6), (x + 2, y), (x + 4, y - 2), (x + 3, y + 5)],
        fill=(255, 216, 96))),
    'toxic-orb': lambda: orb((168, 88, 200), lambda d, x, y: (
        d.ellipse((x - 4, y - 4, x + 1, y + 1), fill=(210, 160, 240)),
        d.ellipse((x + 1, y + 1, x + 4, y + 4), fill=(210, 160, 240)))),
    'soul-dew': lambda: orb((120, 170, 240), lambda d, x, y: d.ellipse(
        (x - 3, y - 4, x + 3, y + 4), fill=(190, 220, 255))),
    'bouncy-ball': lambda: orb((226, 202, 82), lambda d, x, y: (
        d.arc((6, 6, 24, 24), 200, 340, fill=(200, 70, 60), width=3),
        d.arc((6, 6, 24, 24), 20, 160, fill=(70, 120, 200), width=3))),
    # 石/矿物系
    'moon-stone': lambda: stone((168, 176, 196), lambda d: d.ellipse((16, 15, 21, 20), fill=(224, 232, 250))),
    'evo-stone': lambda: stone((150, 196, 160), lambda d: d.polygon(
        [(15, 11), (19, 16), (15, 21), (11, 16)], fill=(230, 250, 235))),
    'icy-rock': lambda: stone((158, 208, 236), lambda d: d.line((13, 12, 20, 19), fill=(240, 250, 255), width=2)),
    'never-melt': lambda: stone((196, 226, 246), lambda d: d.polygon(
        [(15, 10), (18, 14), (16, 19), (12, 17)], fill=(255, 255, 255))),
    'thick-club': lambda: (lambda im, d: (
        d.line((8, 22, 22, 8), fill=INK, width=6),
        d.line((9, 21, 21, 9), fill=(228, 210, 180), width=4),
        d.ellipse((4, 18, 12, 26), fill=INK), d.ellipse((5, 19, 11, 25), fill=(240, 224, 196)),
        d.ellipse((18, 4, 26, 12), fill=INK), d.ellipse((19, 5, 25, 11), fill=(240, 224, 196)),
        im))(*canvas()),
    'deep-sea-tooth': lambda: (lambda im, d: (
        d.polygon([(15, 3), (21, 14), (17, 26), (13, 26), (9, 14)], fill=INK),
        d.polygon([(15, 5), (19, 14), (16, 24), (14, 24), (11, 14)], fill=(210, 226, 240)),
        d.line((14, 8, 13, 20), fill=HI((210, 226, 240))), im))(*canvas()),
    # 铃/护符/杂货
    'soothe-bell': lambda: (lambda im, d: (
        d.polygon([(13, 3), (17, 3), (17, 6), (13, 6)], fill=(214, 178, 84)),
        d.polygon([(9, 20), (21, 20), (23, 25), (7, 25)], fill=INK),
        d.polygon([(10, 21), (20, 21), (22, 24), (8, 24)], fill=(236, 202, 106)),
        d.ellipse((9, 7, 21, 20), fill=INK), d.ellipse((10, 8, 20, 19), fill=(246, 220, 138)),
        d.ellipse((12, 10, 15, 14), fill=HI((246, 220, 138))),
        d.ellipse((12, 24, 18, 28), fill=INK), d.ellipse((13, 25, 17, 27), fill=(214, 178, 84)), im))(*canvas()),
    'metronome': lambda: (lambda im, d: (
        d.polygon([(6, 25), (24, 25), (24, 21), (8, 21)], fill=INK),
        d.polygon([(7, 24), (23, 24), (23, 22), (8, 22)], fill=(150, 110, 70)),
        d.polygon([(10, 21), (20, 21), (16, 6), (12, 6)], fill=INK),
        d.polygon([(12, 20), (18, 20), (15, 8), (13, 8)], fill=(196, 156, 108)),
        d.line((15, 9, 20, 18), fill=INK, width=2), im))(*canvas()),
    'rocky-helmet': lambda: (lambda im, d: (
        d.polygon([(5, 20), (8, 10), (15, 5), (22, 10), (25, 20)], fill=INK),
        d.polygon([(7, 19), (10, 11), (15, 7), (20, 11), (23, 19)], fill=(140, 128, 148)),
        [d.line((x, 20, x + 2, 25 + (x % 3)), fill=INK, width=2) for x in (8, 14, 20)],
        d.polygon([(11, 16), (14, 12), (13, 17)], fill=HI((140, 128, 148))), im))(*canvas()),
    'gale-wing': lambda: (lambda im, d: (
        d.polygon([(5, 20), (24, 5), (25, 10), (12, 22), (7, 24)], fill=INK),
        d.polygon([(7, 19), (22, 7), (23, 10), (12, 20), (9, 21)], fill=(226, 232, 240)),
        d.polygon([(10, 22), (24, 10), (24, 13), (14, 23)], fill=(170, 190, 210)), im))(*canvas()),
    'binding-band': lambda: (lambda im, d: (
        d.rectangle((4, 11, 26, 20), fill=INK), d.rectangle((5, 12, 25, 19), fill=(226, 120, 88)),
        d.line((9, 12, 9, 19), fill=INK, width=2), d.line((15, 12, 15, 19), fill=INK, width=2),
        d.line((21, 12, 21, 19), fill=INK, width=2), im))(*canvas()),
    'black-sludge': lambda: (lambda im, d: (
        d.polygon([(7, 24), (5, 15), (10, 9), (16, 6), (23, 10), (25, 18), (22, 24)], fill=INK),
        d.polygon([(9, 22), (8, 16), (12, 11), (16, 9), (21, 12), (23, 17), (20, 22)], fill=(94, 74, 120)),
        d.ellipse((12, 13, 16, 16), fill=(150, 120, 180)),
        d.ellipse((18, 16, 21, 19), fill=(150, 120, 180)), im))(*canvas()),
    'electric-seed': lambda: (lambda im, d: (
        d.ellipse((9, 10, 22, 25), fill=INK), d.ellipse((10, 11, 21, 24), fill=(250, 214, 90)),
        d.polygon([(16, 13), (13, 18), (15, 18), (13, 23), (18, 17), (16, 17), (18, 13)], fill=(255, 255, 255)),
        d.polygon([(16, 4), (21, 8), (16, 10), (11, 7)], fill=INK),
        d.polygon((16, 5, 20, 8, 16, 9, 12, 7) and [(16, 5), (20, 8), (16, 9), (12, 7)], fill=(120, 200, 110)),
        im))(*canvas()),
    'sacred-ash': lambda: (lambda im, d: (
        d.polygon([(8, 10), (22, 10), (20, 22), (10, 22)], fill=INK),
        d.polygon([(9, 11), (21, 11), (19, 21), (11, 21)], fill=(214, 190, 150)),
        d.line((8, 8, 22, 8), fill=INK, width=3), d.line((9, 9, 21, 9), fill=(240, 226, 190)),
        [d.point((x, y), fill=(255, 250, 220)) for x, y in ((12, 14), (17, 16), (14, 18))],
        im))(*canvas()),
    'shell-bell': lambda: (lambda im, d: (
        d.polygon([(5, 22), (25, 22), (22, 10), (15, 5), (8, 10)], fill=INK),
        d.polygon([(7, 21), (23, 21), (20, 11), (15, 7), (10, 11)], fill=(240, 198, 160)),
        [d.line((15, 8, 15, 21), fill=(200, 150, 110), width=1),
         d.line((10, 12, 9, 21), fill=(200, 150, 110), width=1),
         d.line((20, 12, 21, 21), fill=(200, 150, 110), width=1)], im))(*canvas()),
    'lucky-egg': lambda: (lambda im, d: (
        d.ellipse((7, 8, 23, 26), fill=INK), d.ellipse((8, 9, 22, 25), fill=(250, 240, 214)),
        d.ellipse((11, 12, 14, 15), fill=(255, 255, 255)),
        d.polygon([(14, 7), (18, 4), (20, 9)], fill=(250, 214, 90)), im))(*canvas()),
    'amulet-coin': lambda: (lambda im, d: (
        d.ellipse((5, 6, 25, 26), fill=INK), d.ellipse((7, 8, 23, 24), fill=(246, 208, 88)),
        d.ellipse((11, 12, 17, 18), fill=INK), d.ellipse((12, 13, 16, 17), fill=(255, 240, 170)),
        d.polygon([(14, 5), (17, 8), (14, 11), (11, 8)], fill=(214, 168, 60)), im))(*canvas()),
    'silver-spray': lambda: (lambda im, d: (
        d.rectangle((9, 12, 22, 26), fill=INK), d.rectangle((10, 13, 21, 25), fill=(198, 210, 224)),
        d.rectangle((12, 7, 19, 12), fill=INK), d.rectangle((13, 8, 18, 11), fill=(150, 160, 176)),
        d.rectangle((12, 4, 14, 7), fill=INK), d.rectangle((17, 4, 19, 7), fill=INK),
        d.line((10, 17, 21, 17), fill=(150, 160, 176), width=1), im))(*canvas()),
    'purify-charm': lambda: (lambda im, d: (
        d.polygon([(15, 3), (24, 10), (21, 24), (9, 24), (6, 10)], fill=INK),
        d.polygon([(15, 5), (22, 11), (19, 22), (11, 22), (8, 11)], fill=(236, 226, 250)),
        d.polygon([(15, 9), (18, 13), (15, 17), (12, 13)], fill=(150, 120, 210)), im))(*canvas()),
    'rocket-card': lambda: (lambda im, d: (
        d.rectangle((5, 4, 25, 26), fill=INK), d.rectangle((7, 6, 23, 24), fill=(226, 226, 232)),
        d.polygon([(15, 8), (19, 14), (15, 20), (11, 14)], fill=(200, 60, 70)),
        d.rectangle((9, 21, 21, 22), fill=(120, 120, 132)), im))(*canvas()),
    'cave-compass': lambda: (lambda im, d: (
        d.ellipse((5, 5, 25, 25), fill=INK), d.ellipse((7, 7, 23, 23), fill=(190, 170, 130)),
        d.polygon([(15, 8), (17, 15), (15, 16), (13, 15)], fill=(220, 60, 60)),
        d.polygon([(15, 22), (13, 15), (15, 14), (17, 15)], fill=(240, 240, 240)),
        d.ellipse((13, 13, 17, 17), fill=INK), d.ellipse((14, 14, 16, 16), fill=(90, 80, 60)), im))(*canvas()),
    'escape-rope': lambda: (lambda im, d: (
        d.ellipse((7, 12, 25, 26), outline=INK, width=3),
        d.ellipse((7, 12, 25, 26), outline=(200, 170, 120), width=2),
        d.ellipse((10, 15, 22, 24), outline=INK, width=2),
        d.line((16, 12, 20, 4), fill=INK, width=3), d.line((16, 13, 20, 5), fill=(200, 170, 120), width=1),
        im))(*canvas()),
    'rare-candy': lambda: (lambda im, d: (
        d.ellipse((8, 8, 23, 23), fill=INK), d.ellipse((9, 9, 22, 22), fill=(250, 130, 160)),
        d.polygon([(4, 10), (9, 13), (8, 18), (3, 16)], fill=INK),
        d.polygon((4, 11, 8, 13, 7, 17, 4, 16) and [(4, 11), (8, 13), (7, 17), (4, 16)], fill=(230, 100, 130)),
        d.polygon([(22, 10), (27, 13), (26, 18), (21, 18)], fill=INK),
        d.polygon([(22, 11), (26, 13), (25, 17), (22, 17)], fill=(230, 100, 130)),
        d.ellipse((12, 12, 16, 16), fill=(255, 200, 215)), im))(*canvas()),
    'razor-fang': lambda: (lambda im, d: (
        d.polygon([(6, 8), (24, 6), (25, 14), (16, 24), (8, 20)], fill=INK),
        d.polygon([(8, 9), (22, 8), (23, 13), (15, 21), (9, 18)], fill=(214, 224, 236)),
        d.polygon([(10, 11), (19, 10), (14, 16)], fill=(255, 255, 255)), im))(*canvas()),
    'miracle-seed': lambda: (lambda im, d: (
        d.ellipse((8, 9, 23, 24), fill=INK), d.ellipse((9, 10, 22, 23), fill=(120, 190, 96)),
        d.line((11, 16, 20, 16), fill=(86, 150, 70), width=2),
        d.line((15, 12, 15, 21), fill=(86, 150, 70), width=2),
        d.ellipse((12, 12, 15, 15), fill=(200, 240, 180)),
        d.polygon([(16, 5), (22, 9), (16, 11), (12, 8)], fill=INK),
        d.polygon([(16, 6), (20, 9), (16, 10), (13, 8)], fill=(150, 200, 120)), im))(*canvas()),
    'leftovers-pick': lambda: (lambda im, d: (
        d.polygon([(8, 8), (22, 8), (21, 14), (9, 14)], fill=INK),
        d.polygon([(9, 9), (21, 9), (20, 13), (10, 13)], fill=(196, 158, 104)),
        d.polygon([(9, 14), (21, 14), (24, 24), (6, 24)], fill=INK),
        d.polygon([(10, 15), (20, 15), (22, 23), (8, 23)], fill=(226, 190, 130)),
        d.ellipse((12, 18, 15, 21), fill=(150, 110, 70)), im))(*canvas()),
    # 树果系
    'pecha-berry': lambda: berry((250, 168, 190)),
    'lum-berry': lambda: berry((168, 220, 130)),
    'leppa-berry': lambda: berry((235, 100, 90)),
    'lansat-berry': lambda: berry((240, 190, 90)),
    'salac-berry': lambda: berry((120, 210, 190)),
    'petaya-berry': lambda: berry((190, 130, 230)),
    # 徽章
    'badge-gray': lambda: badge((150, 150, 158), (200, 204, 214)),
    'badge-orange': lambda: badge((226, 140, 60), (250, 196, 120)),
    'badge-gold': lambda: badge((240, 200, 70), (255, 240, 160)),
}


def main():
    force = '--force' in sys.argv
    os.makedirs(OUT, exist_ok=True)
    made, skipped = [], []
    for slug, gen in ICONS.items():
        path = os.path.join(OUT, slug + '.png')
        if os.path.exists(path) and not force:
            skipped.append(slug)
            continue
        im = gen()
        if isinstance(im, tuple):      # 逗号串联绘制语句的生成器：末位是画布
            im = im[-1]
        if im.mode != 'RGBA':
            im = im.convert('RGBA')
        im.save(path, optimize=True)
        made.append(slug)
    print(f'生成 {len(made)} 个图标，跳过已存在 {len(skipped)} 个')
    if made:
        print('  ' + ' '.join(sorted(made)))


if __name__ == '__main__':
    main()
