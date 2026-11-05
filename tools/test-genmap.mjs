// 地图生成回归：node --test tools/test-genmap.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { genMap } from '../js/sim/genmap.js?v=m5c';

const ROOT = dirname(fileURLToPath(import.meta.url));
void ROOT;

// mulberry32（与 js/sim/rng.js 同实现）
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F1_TARGET_MIN = 8 - 2;   // target = 8~9，允许下浮 2

test('连通性：BFS 从出生房可达所有房间', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const m = genMap(makeRng(seed), 1);
    const byKey = new Map(m.cells.map((c) => [c.x + ',' + c.y, c]));
    const seen = new Set(['6,6']);
    const q = [[6, 6]];
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const k = (x + dx) + ',' + (y + dy);
        if (byKey.has(k) && !seen.has(k)) { seen.add(k); q.push([x + dx, y + dy]); }
      }
    }
    assert.equal(seen.size, m.cells.length, `seed ${seed} 有孤岛`);
  }
});

test('房数：层1 目标 8-9（重 roll 保证 ≥6）；不超过网格', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const m = genMap(makeRng(seed), 1);
    assert.ok(m.cells.length >= F1_TARGET_MIN, `seed ${seed} 房数 ${m.cells.length}`);
    assert.ok(m.cells.length <= 20);
  }
});

test('特殊房唯一且类型正确：boss/shop/treasure 各 ≤1；boss 存在且不邻出生房', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const m = genMap(makeRng(seed), 1);
    const n = (t) => m.cells.filter((c) => c.type === t).length;
    assert.equal(n('boss'), 1, `seed ${seed} boss 数`);
    assert.ok(n('shop') <= 1 && n('treasure') <= 1 && n('start') === 1 && n('secret') <= 1);
    const boss = m.cells.find((c) => c.type === 'boss');
    const dist = Math.abs(boss.x - 6) + Math.abs(boss.y - 6);
    assert.ok(dist >= 2, `seed ${seed} boss 距出生 ${dist}`);
    // boss 是死端（单门）——四面体化验证
    const neighbors = m.cells.filter((c) => Math.abs(c.x - boss.x) + Math.abs(c.y - boss.y) === 1);
    assert.equal(neighbors.length, 1, `seed ${seed} boss 房门数 ${neighbors.length}`);
  }
});

test('隐藏房：与 ≥3 房相邻且不邻 Boss/特殊房；邻接门标记为 secret', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const m = genMap(makeRng(seed), 1);
    const secret = m.cells.find((c) => c.type === 'secret');
    if (!secret) continue;
    const adj = m.cells.filter((c) => Math.abs(c.x - secret.x) + Math.abs(c.y - secret.y) === 1);
    assert.ok(adj.length >= 3, `seed ${seed} 隐藏房只邻 ${adj.length}`);
    assert.ok(adj.every((c) => c.type === 'combat' || c.type === 'start'), '隐藏房邻接只能是普通/出生房');
    for (const c of adj) {
      const dx = secret.x - c.x, dy = secret.y - c.y;
      assert.equal(c.doors[dx + ',' + dy], 'secret', '邻居的隐藏门标记');
    }
  }
});

test('确定性：同种子同图（含 fallback 路径）', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const a = JSON.stringify(genMap(makeRng(seed), 1));
    const b = JSON.stringify(genMap(makeRng(seed), 1));
    assert.equal(a, b, `seed ${seed} 不同种子流`);
  }
});

test('营地每层保底（替补=免疫/克制的战略出口）', () => {
  for (let seed = 1; seed <= 300; seed++) {
    for (const floorNo of [1, 2, 3]) {
      const m = genMap(makeRng(seed + floorNo * 1000), floorNo);
      const camps = m.cells.filter((c) => c.type === 'camp').length;
      assert.equal(camps, 1, `seed ${seed} F${floorNo} 营地数 ${camps}`);
    }
  }
});

test('层2/层3：房数随层增长（11-12 / 15-16 附近）', () => {
  const sizes = { 2: [], 3: [] };
  for (let seed = 1; seed <= 100; seed++) {
    sizes[2].push(genMap(makeRng(seed), 2).cells.length);
    sizes[3].push(genMap(makeRng(seed), 3).cells.length);
  }
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(avg(sizes[2]) > 9 && avg(sizes[2]) < 14, '层2 均值 ' + avg(sizes[2]).toFixed(1));
  assert.ok(avg(sizes[3]) > 13 && avg(sizes[3]) < 18, '层3 均值 ' + avg(sizes[3]).toFixed(1));
});

test('F4 晶核之间：迷你层（4-6 房）且必有 Boss', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const m = genMap(makeRng(seed), 4);
    assert.ok(m.cells.length >= 4 && m.cells.length <= 6, `seed ${seed} F4 房数 ${m.cells.length}`);
    assert.equal(m.cells.filter((c) => c.type === 'boss').length, 1, 'Boss 必有');
    assert.equal(m.cells.filter((c) => c.type === 'start').length, 1);
  }
});
