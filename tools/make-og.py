#!/usr/bin/env python3
"""OG 分享卡（og-cover.png，1200×630）：程序化晶穴背景 + 图集立绘 + 标题字。

立绘取图集 Attack/Idle 首帧（皮卡丘居左、大岩蛇与梦幻右侧群像），
字体用仓库内缝合像素字体（大号时抗锯齿可接受）。

用法：python3 tools/make-og.py
"""
import json
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATLAS_DIR = os.path.join(ROOT, 'assets', 'atlas')
FONT = os.path.join(ROOT, 'assets', 'fonts', 'fusion-pixel-zh.woff2')
W, H = 1200, 630


def frame(slug, anim='Attack'):
    im = Image.open(os.path.join(ATLAS_DIR, slug + '.png')).convert('RGBA')
    meta = json.load(open(os.path.join(ATLAS_DIR, slug + '.json')))
    a = meta['anims'].get(anim) or meta['anims'].get('Idle') or list(meta['anims'].values())[0]
    f0 = a['frames'][0][0] if isinstance(a['frames'][0], list) else a['frames'][0]
    w, h = a['frameW'], a['frameH']
    crop = im.crop((f0['x'], f0['y'], f0['x'] + w, f0['y'] + h))
    bbox = crop.getbbox()
    return crop.crop(bbox) if bbox else crop


def scale_h(im, h):
    w = int(im.width * h / im.height)
    return im.resize((w, h), Image.LANCZOS)


def crystal(draw, x, y, s, color, alpha):
    """一颗晶簇：叠两三个锥形多边形。"""
    for dx, dy, ss in ((0, 0, s), (s * 0.45, s * 0.15, s * 0.65), (-s * 0.4, s * 0.1, s * 0.5)):
        pts = [(x + dx - ss * 0.35, y + dy), (x + dx, y + dy - ss), (x + dx + ss * 0.35, y + dy)]
        draw.polygon(pts, fill=color + (alpha,))


def main():
    img = Image.new('RGBA', (W, H))
    d = ImageDraw.Draw(img)
    # 背景：深夜蓝渐变
    top, bot = (11, 14, 30), (26, 22, 46)
    for y in range(H):
        k = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * k) for i in range(3)) + (255,))
    # 远景晶簇剪影
    d2 = ImageDraw.Draw(img)
    for x, y, s, a in [(90, H, 210, 34), (330, H, 150, 26), (1050, H, 260, 38), (760, H, 130, 24), (600, H, 170, 20)]:
        crystal(d2, x, y, s, (80, 140, 200), a)
    # 星尘
    import random
    rnd = random.Random(42)
    for _ in range(70):
        x, y = rnd.randrange(W), rnd.randrange(H)
        r = rnd.choice((1, 1, 2, 3))
        c = rnd.choice([(127, 212, 255), (199, 159, 255), (255, 210, 74)])
        d2.ellipse((x, y, x + r, y + r), fill=c + (rnd.randrange(40, 130),))
    # 地面光带
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((W // 2 - 430, H - 190, W // 2 + 430, H + 90), fill=(64, 96, 160, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(60))
    img.alpha_composite(glow)

    # 立绘：皮卡丘（左，最大）、大岩蛇 + 梦幻（右侧群像）
    pika = scale_h(frame('pikachu'), 400)
    img.alpha_composite(pika, (120, H - pika.height - 30))
    onix = scale_h(frame('onix'), 250)
    img.alpha_composite(onix, (860, H - onix.height - 20))
    mew = scale_h(frame('mew'), 170)
    img.alpha_composite(mew, (1040, 130))

    # 标题字
    font_big = ImageFont.truetype(FONT, 96)
    font_sub = ImageFont.truetype(FONT, 34)
    tx, ty = 88, 96
    d.text((tx + 4, ty + 4), '宝可梦 · 晶穴深处', font=font_big, fill=(0, 0, 0, 160))
    d.text((tx, ty), '宝可梦 · 晶穴深处', font=font_big, fill=(255, 233, 160, 255))
    d.text((tx + 4, ty + 130), 'Pokémon: Crystal Depths', font=font_sub, fill=(127, 212, 255, 255))
    d.text((tx + 4, ty + 178), '以撒式洞窟肉鸽 × HD-2D · 免费浏览器同人游戏', font=font_sub, fill=(215, 230, 255, 235))
    # 底部角标
    tag = '集道具 · 打馆主 · 净化梦幻'
    tw = d.textlength(tag, font=font_sub)
    d.rounded_rectangle((tx, H - 84, tx + tw + 36, H - 30), radius=8, fill=(26, 34, 56, 220), outline=(127, 212, 255, 120), width=2)
    d.text((tx + 18, H - 78), tag, font=font_sub, fill=(255, 233, 160, 255))

    img.convert('RGB').save(os.path.join(ROOT, 'og-cover.png'), optimize=True)
    print('og-cover.png →', W, 'x', H)


if __name__ == '__main__':
    main()
