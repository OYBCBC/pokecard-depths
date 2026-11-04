#!/usr/bin/env python3
"""原创占位包生成器（ADR-15 换皮推演）。

程序化生成一套"原创像素怪"图集（8 方向 × Walk/Idle/Hurt），并产出 manifest
js/data/pack-orig.json：把 enemies.json / species.json 里的每个物种映射到
占位怪 + 原创名。游戏带 ?pack=orig 启动时整体替换表现层——引擎零改动，
验证"48 小时可切原创怪包"的架构保险（ADR-15）。

用法：python3 tools/make-orig-pack.py [数量]（默认 10 只，确定性种子）
"""
import json
import os
import sys

SP = '/Users/oybcbc/Library/Python/3.9/lib/python-site-packages'
if SP not in sys.path and os.path.isdir(SP):
    sys.path.append(SP)
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'assets', 'orig')

FW, FH = 24, 32          # 帧尺寸（与正式包同规格）
DUR = 16                 # 每帧 tick
MAX_ATLAS = 2048

# 原创命名音节（前缀×后缀组合，避开任何官方宝可梦名）
NAME_A = ['吱', '噜', '咔', '哞', '嗷', '噗', '叮', '咚', '咕', '唧', '嗖', '呜']
NAME_B = ['晶', '岩', '雷', '雾', '藤', '沙', '影', '露', '燧', '岚', '渊', '壳']
NAME_C = ['兽', '灵', '仔', '妖', '蜗', '蛛', '鲤', '鹗', '蜥', '鼬']

# 每只怪的调色板（body / belly / outline / eye）——手工挑的和谐色组
PALETTES = [
    ('#c8b78e', '#efe6cd', '#4a3f2c', '#2b2417'),
    ('#8fb8c9', '#dceef4', '#2d4552', '#16242c'),
    ('#c98f8f', '#f2dcdc', '#522d2d', '#2c1616'),
    ('#9dc98f', '#e3f2dc', '#2d522d', '#162c16'),
    ('#a89fc9', '#e6e0f2', '#3d2d52', '#1f162c'),
    ('#c9b48f', '#f2e8dc', '#52432d', '#2c2316'),
    ('#8fc9bd', '#dcf2ec', '#2d5248', '#162c26'),
    ('#c98fbd', '#f2dcf0', '#522d48', '#2c1626'),
    ('#bdc98f', '#ecf2dc', '#47522d', '#232c16'),
    ('#8f9dc9', '#dce4f2', '#2d3452', '#161a2c'),
]
# 体型变体：(宽半径, 高, 耳朵型)  ear: 0 圆耳 1 尖耳 2 角 3 触角
SHAPES = [(7, 14, 0), (6, 16, 1), (8, 12, 2), (6, 13, 3), (7, 15, 1), (5, 17, 2), (8, 13, 0), (6, 14, 3)]


def hx(c):
    c = c.lstrip('#')
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def draw_creature(draw, cx, feet_y, pal, shape, pose, facing, bob):
    """pose: idle/walk1/walk2/hurt；facing: front/back/side；bob: 竖直偏移"""
    body, belly, line, eye = (hx(p) for p in pal)
    rw, hgt, ear = shape
    top = feet_y - hgt + bob
    cy = top + hgt // 2
    # 身体：椭圆
    draw.ellipse([cx - rw, top, cx + rw, top + hgt], fill=body, outline=line)
    # 肚皮（正面/侧面）
    if facing != 'back':
        draw.ellipse([cx - rw // 2, cy, cx + rw // 2, feet_y - 1 + bob], fill=belly)
    # 耳朵/角
    if ear == 0:
        draw.ellipse([cx - rw + 1, top - 4, cx - rw + 7, top + 2], fill=body, outline=line)
        draw.ellipse([cx + rw - 7, top - 4, cx + rw - 1, top + 2], fill=body, outline=line)
    elif ear == 1:
        draw.polygon([(cx - rw + 1, top + 1), (cx - rw + 4, top - 7), (cx - rw + 8, top)], fill=body, outline=line)
        draw.polygon([(cx + rw - 8, top), (cx + rw - 4, top - 7), (cx + rw - 1, top + 1)], fill=body, outline=line)
    elif ear == 2:
        draw.line([(cx - 3, top), (cx - 5, top - 7)], fill=line, width=2)
        draw.line([(cx + 3, top), (cx + 5, top - 7)], fill=line, width=2)
    else:
        draw.arc([cx - 5, top - 9, cx + 5, top + 1], 180, 360, fill=line, width=2)
    # 眼睛
    if facing == 'front':
        draw.ellipse([cx - 4, cy - 2, cx - 1, cy + 1], fill=eye)
        draw.ellipse([cx + 1, cy - 2, cx + 4, cy + 1], fill=eye)
    elif facing == 'side':
        draw.ellipse([cx + 1, cy - 2, cx + 4, cy + 1], fill=eye)
    # 走路：左右脚交替抬起
    if pose == 'walk1':
        draw.rectangle([cx - rw + 2, feet_y - 2 + bob, cx - rw + 6, feet_y - 1 + bob], fill=belly)
    elif pose == 'walk2':
        draw.rectangle([cx + rw - 6, feet_y - 2 + bob, cx + rw - 2, feet_y - 1 + bob], fill=belly)
    if pose == 'hurt':
        draw.line([(cx - rw - 2, top - 3), (cx + rw + 2, feet_y + 1)], fill=(255, 80, 80), width=2)


def frame_img(pal, shape, pose, facing, flip=False):
    img = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bob = -1 if pose == 'walk1' else (1 if pose == 'walk2' else 0)
    if pose == 'hurt':
        bob = 2
    draw_creature(d, FW // 2 + (2 if flip else 0), FH - 4, pal, shape, pose, facing, bob)
    if flip:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    return img


def pack_one(idx, pal, shape, name):
    """一只怪 → orig-<idx>.png/.json（Idle/Walk/Hurt × 8 方向）。"""
    dirs = ['Down', 'DownRight', 'Right', 'UpRight', 'Up', 'UpLeft', 'Left', 'DownLeft']

    def facing_of(d):
        if d == 'Up' or d == 'UpRight' or d == 'UpLeft':
            return 'back', False
        if d in ('Right', 'DownRight'):
            return 'side', False
        if d in ('Left', 'DownLeft'):
            return 'side', True
        return 'front', False

    anim_def = {
        'Idle': ['idle', 'idle2'],
        'Walk': ['walk1', 'idle', 'walk2', 'idle2'],
        'Hurt': ['hurt', 'idle'],
    }
    # frames 排布：行主序按方向（rows=8 时 frames[dir][frameIdx]）
    frames = {}
    for anim_name, poses in anim_def.items():
        frames[anim_name] = []
        for d in dirs:
            facing, flip = facing_of(d)
            row = []
            for p in poses:
                pose = p if p in ('walk1', 'walk2', 'hurt') else 'idle'
                bob_variant = p == 'idle2'
                row.append((pose, facing, flip, bob_variant))
            frames[anim_name].append(row)

    # 打包：逐动画逐方向逐帧横向排（简单一行一帧，2048 上限内足够）
    all_frames = []
    for anim_name in anim_def:
        for di in range(8):
            for fi in range(len(anim_def[anim_name])):
                all_frames.append((anim_name, di, fi))
    cols = MAX_ATLAS // FW
    rows_n = (len(all_frames) + cols - 1) // cols
    atlas = Image.new('RGBA', (min(len(all_frames), cols) * FW, rows_n * FH), (0, 0, 0, 0))

    def draw_pose(anim_name, di, fi):
        pose, facing, flip, bob_variant = frames[anim_name][di][fi]
        img = frame_img(pal, shape, pose, facing, flip)
        if bob_variant:
            img = img.transpose(Image.FLIP_TOP_BOTTOM) if False else img
        return img

    index = {}
    for k, (anim_name, di, fi) in enumerate(all_frames):
        cx, cy = (k % cols) * FW, (k // cols) * FH
        img = draw_pose(anim_name, di, fi)
        atlas.paste(img, (cx, cy))
        index.setdefault(anim_name, [[None] * len(anim_def[anim_name]) for _ in range(8)])
        # gy：帧内最低不透明行（贴地）
        gy = None
        px = img.load()
        for yy in range(FH - 1, -1, -1):
            if any(px[xx, yy][3] > 128 for xx in range(0, FW, 2)):
                gy = yy
                break
        index[anim_name][di][fi] = {'x': cx, 'y': cy, 'dur': DUR, 'ox': 0, 'oy': 0, 'gy': gy if gy is not None else FH - 1}

    atlas.save(os.path.join(OUT_DIR, f'orig-{idx}.png'))
    doc = {
        'source': f'procedural orig-pack #{idx}',
        'license': 'CC0（程序化生成占位素材，换皮推演用）',
        'shadowSize': 1,
        'dirs': dirs,
        'atlas': [atlas.width, atlas.height],
        'anims': {
            name: {'frameW': FW, 'frameH': FH, 'rows': 8, 'grounded': True, 'frames': index[name]}
            for name in anim_def
        },
    }
    with open(os.path.join(OUT_DIR, f'orig-{idx}.json'), 'w') as fp:
        json.dump(doc, fp, ensure_ascii=False, indent=1)
    return doc


def main():
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    os.makedirs(OUT_DIR, exist_ok=True)
    names = []
    docs = []
    for i in range(count):
        pal = PALETTES[i % len(PALETTES)]
        shape = SHAPES[i % len(SHAPES)]
        name = NAME_A[i % 12] + NAME_B[(i // 3) % 12] + NAME_C[i % 10]
        names.append(name)
        docs.append(pack_one(i, pal, shape, name))
        print(f'orig-{i}: {name} {shape}')

    # manifest：enemies.json + species.json 的所有物种 → 占位怪 + 原创名
    enemies = json.load(open(os.path.join(ROOT, 'js/data/enemies.json')))['enemies']
    species = json.load(open(os.path.join(ROOT, 'js/data/species.json')))['species']
    entries = {}
    keys = list(species.keys()) + list(enemies.keys())
    for k, i in zip(keys, range(len(keys))):
        entries[k] = {'name': names[i % count], 'anim': f'orig-{i % count}'}
    manifest = {
        '_comment': 'ADR-15 换皮推演：?pack=orig 启动时整体替换表现层（名字/图集/叫声关闭），引擎零改动。',
        'name': '晶穴·原创占位包',
        'atlasDir': 'assets/orig',
        'cries': False,
        'entries': entries,
    }
    with open(os.path.join(ROOT, 'js/data/pack-orig.json'), 'w') as fp:
        json.dump(manifest, fp, ensure_ascii=False, indent=1)
    print(f'manifest: js/data/pack-orig.json（{len(entries)} 条映射，{count} 只占位怪）')


if __name__ == '__main__':
    main()
