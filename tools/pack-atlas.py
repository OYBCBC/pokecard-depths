#!/usr/bin/env python3
"""SpriteCollab（PMD 格式）动画图集打包器。

输入：.cache/sprite/<4位图鉴号>/ 下的 <动作>-Anim.png / <动作>-Offsets.png / AnimData.xml
输出：assets/atlas/<slug>.png（≤2048²，最近邻不缩放）+ <slug>.json 索引：
  { source, commit, shadowSize, anims: { Walk: { frameW, frameH, rows, frames: [
      { x, y, dur, ox, oy } ... ] } } }
  - rows=8 时帧序为 行主序（先第 0 帧的 8 个方向，再第 1 帧……），并按行展开为
    frames[direction][frameIndex] 结构；单行动画 rows=1。
  - ox/oy：Offsets.png 绿色像素（身体中心）相对帧中心的偏移（px，+x 右 / +y 下），
    渲染时 mesh 位置 = 实体位置 - (ox, oy)/16。

用法：python3 tools/pack-atlas.py <图鉴号> <slug> [动作1 动作2 ...]（动作缺省 Walk,Idle,Hurt）
"""
import json
import os
import sys
import xml.etree.ElementTree as ET

SP = '/Users/oybcbc/Library/Python/3.9/lib/python-site-packages'
if SP not in sys.path and os.path.isdir(SP):
    sys.path.append(SP)
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache')
ATLAS = os.path.join(ROOT, 'assets', 'atlas')

DIR_ORDER = ['Down', 'DownRight', 'Right', 'UpRight', 'Up', 'UpLeft', 'Left', 'DownLeft']
MAX_ATLAS = 2048


def find_green_center(img, fx, fy, fw, fh):
    """在帧区域内找绿色标记（Offsets 约定：纯绿=身体中心）。找不到返回 None。"""
    px = img.load()
    for y in range(fy, min(fy + fh, img.height)):
        for x in range(fx, min(fx + fw, img.width)):
            r, g, b = px[x, y][:3]
            if g > 200 and r < 90 and b < 90:
                return x - fx, y - fy
    return None


def pack_anim(anim_png, offsets_png, meta):
    fw, fh = meta['FrameWidth'], meta['FrameHeight']
    n_frames = len(meta['Durations'])
    cols = anim_png.width // fw
    rows = anim_png.height // fh
    assert cols * rows >= n_frames * meta.get('Rows', 1), \
        f"sheet {anim_png.size} 装不下 {n_frames} 帧 × {rows} 行"
    frames = []  # rows=1: [ {..} ]；rows=8: [dir][frame]
    for row in range(rows):
        row_frames = []
        for col in range(n_frames):
            fx, fy = col * fw, row * fh
            off = None
            if offsets_png is not None:
                off = find_green_center(offsets_png, fx, fy, fw, fh)
            if off is None:
                off = (fw // 2, fh // 2)     # 无标记：锚点取帧中心
            ox = off[0] - fw / 2
            oy = off[1] - fh / 2
            row_frames.append({
                'sx': fx, 'sy': fy,
                'dur': meta['Durations'][col],
                'ox': round(ox, 1), 'oy': round(oy, 1),
            })
        frames.append(row_frames)
    return {'frameW': fw, 'frameH': fh, 'rows': rows, 'frames': frames}


def main():
    dex, slug = sys.argv[1].zfill(4), sys.argv[2]
    anims_wanted = sys.argv[3:] or ['Walk', 'Idle', 'Hurt']
    src = os.path.join(CACHE, 'sprite', dex)
    commit = open(os.path.join(CACHE, 'sprite-collab-commit.txt')).read().strip()

    tree = ET.parse(os.path.join(src, 'AnimData.xml'))
    root = tree.getroot()
    shadow_size = int(root.findtext('ShadowSize', default='1'))

    packed = {}
    placements = []   # (anim, row, frameIdx, x, y)
    cur_x, cur_y, row_h = 2, 2, 0
    for anim_el in root.find('Anims'):
        name = anim_el.findtext('Name')
        if name not in anims_wanted:
            continue
        copy_of = anim_el.findtext('CopyOf')
        if copy_of:
            continue                     # M1 用不到 CopyOf 动作（Walk/Idle/Hurt 都非引用）
        meta = {
            'FrameWidth': int(anim_el.findtext('FrameWidth')),
            'FrameHeight': int(anim_el.findtext('FrameHeight')),
            'Durations': [int(d.text) for d in anim_el.find('Durations')],
        }
        anim_png = Image.open(os.path.join(src, f'{name}-Anim.png')).convert('RGBA')
        offsets_path = os.path.join(src, f'{name}-Offsets.png')
        offsets_png = Image.open(offsets_path).convert('RGBA') if os.path.exists(offsets_path) else None
        packed[name] = pack_anim(anim_png, offsets_png, meta)

        a = packed[name]
        for row in range(a['rows']):
            for fi in range(len(a['frames'][row])):
                if cur_x + a['frameW'] + 2 > MAX_ATLAS:
                    cur_x, cur_y, row_h = 2, cur_y + row_h + 2, 0
                placements.append((name, row, fi, cur_x, cur_y))
                cur_x += a['frameW'] + 2
                row_h = max(row_h, a['frameH'])
        # 每个动画（或动画的每个方向行）另起一行，方便核对
        cur_x, cur_y, row_h = 2, cur_y + row_h + 2, 0

    total_h = cur_y + row_h + 2
    assert total_h <= MAX_ATLAS, f'图集超高 {total_h}'
    atlas = Image.new('RGBA', (MAX_ATLAS, min(1024, (total_h + 63) // 64 * 64)), (0, 0, 0, 0))
    for (name, row, fi, x, y) in placements:
        a = packed[name]
        f = a['frames'][row][fi]
        frame = Image.open(os.path.join(src, f'{name}-Anim.png')).convert('RGBA').crop(
            (f['sx'], f['sy'], f['sx'] + a['frameW'], f['sy'] + a['frameH']))
        atlas.paste(frame, (x, y))
        f['x'], f['y'] = x, y
        f.pop('sx'), f.pop('sy')

    os.makedirs(ATLAS, exist_ok=True)
    atlas.save(os.path.join(ATLAS, f'{slug}.png'))
    doc = {
        'source': f'SpriteCollab sprite/{dex}',
        'commit': commit,
        'shadowSize': shadow_size,
        'dirs': DIR_ORDER,
        'atlas': [atlas.width, atlas.height],
        'anims': packed,
    }
    with open(os.path.join(ATLAS, f'{slug}.json'), 'w') as fp:
        json.dump(doc, fp, ensure_ascii=False)
    summary = ', '.join('{}: {}帧×{}行'.format(k, len(v['frames'][0]), v['rows']) for k, v in packed.items())
    print(f'{slug}: {atlas.size}, anims: {summary}')


if __name__ == '__main__':
    main()
