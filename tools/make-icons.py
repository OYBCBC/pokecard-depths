#!/usr/bin/env python3
"""PWA 图标（assets/icons/）：从皮卡丘图集 Idle 首帧裁剪。

  icon-192.png / icon-512.png   透明底立绘
  maskable-192.png / maskable-512.png   圆角底板 + 78% 居中（安全区）
  favicon.png  32×32

用法：python3 tools/make-icons.py
"""
import json
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATLAS = os.path.join(ROOT, 'assets', 'atlas', 'pikachu.png')
AMETA = os.path.join(ROOT, 'assets', 'atlas', 'pikachu.json')
OUT = os.path.join(ROOT, 'assets', 'icons')


def sprite_frame():
    im = Image.open(ATLAS).convert('RGBA')
    meta = json.load(open(AMETA))
    a = meta['anims'].get('Idle') or meta['anims'].get('Walk')
    # frames = 按方向的数组；每帧 {dur, ox, oy, gy, x, y}
    f0 = a['frames'][0][0] if isinstance(a['frames'][0], list) else a['frames'][0]
    w, h = a['frameW'], a['frameH']
    return im.crop((f0['x'], f0['y'], f0['x'] + w, f0['y'] + h))


def tight(im):
    """裁到内容包围盒（去掉脚下留白）。"""
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def fit_into(im, size, ratio):
    """等比缩放到 size 的 ratio 比例内，居中返回 RGBA 画布。"""
    cv = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    box = int(size * ratio), int(size * ratio)
    im2 = im.copy()
    im2.thumbnail(box, Image.LANCZOS)
    cv.paste(im2, ((size - im2.width) // 2, (size - im2.height) // 2), im2)
    return cv


def maskable(im, size, ratio=0.78):
    """圆角底板 + 居中精灵（maskable 安全区：内容 ≤80%）。"""
    cv = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(cv)
    # 深夜蓝渐变近似：两层圆角矩形
    r = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(11, 14, 24, 255))
    d.rounded_rectangle([int(size * 0.04), int(size * 0.04), int(size * 0.96), int(size * 0.62)],
                        radius=int(r * 0.7), fill=(26, 34, 56, 255))
    im2 = im.copy()
    im2.thumbnail((int(size * ratio), int(size * ratio)), Image.LANCZOS)
    cv.paste(im2, ((size - im2.width) // 2, (size - im2.height) // 2 + int(size * 0.03)), im2)
    return cv


def main():
    os.makedirs(OUT, exist_ok=True)
    fr = tight(sprite_frame())
    for size in (192, 512):
        fit_into(fr, size, 0.96).save(os.path.join(OUT, f'icon-{size}.png'), optimize=True)
        maskable(fr, size).save(os.path.join(OUT, f'maskable-{size}.png'), optimize=True)
    fit_into(fr, 32, 0.98).save(os.path.join(OUT, 'favicon.png'), optimize=True)
    print('icons →', OUT, '（icon-192/512 · maskable-192/512 · favicon）')


if __name__ == '__main__':
    main()
