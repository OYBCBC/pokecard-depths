// 地图生成回归：node --test tools/test-genmap.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { genMap } from '../js/sim/genmap.js?v=m9';

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

test('营地每层保底（替补=免疫/克制的战略出口；M11 起含 F4）', () => {
  for (let seed = 1; seed <= 300; seed++) {
    for (const floorNo of [1, 2, 3, 4]) {
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

test('F4 幽冥层：整层但房数压制（10-15 房，M11 控节奏）', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const m = genMap(makeRng(seed), 4);
    assert.ok(m.cells.length >= 10 && m.cells.length <= 15, `seed ${seed} F4 房数 ${m.cells.length}`);
    assert.equal(m.cells.filter((c) => c.type === 'boss').length, 1, 'Boss 必有');
    assert.equal(m.cells.filter((c) => c.type === 'start').length, 1);
  }
});

test('F5/F6 迷你层：晶核之间/梦境裂隙（4-6 房）且必有 Boss', () => {
  for (let seed = 1; seed <= 100; seed++) {
    for (const floorNo of [5, 6]) {
      const m = genMap(makeRng(seed), floorNo);
      assert.ok(m.cells.length >= 4 && m.cells.length <= 6, `seed ${seed} F${floorNo} 房数 ${m.cells.length}`);
      assert.equal(m.cells.filter((c) => c.type === 'boss').length, 1, 'Boss 必有');
      assert.equal(m.cells.filter((c) => c.type === 'start').length, 1);
    }
  }
});

// ---------- M7：大房型 / 密室 / 裂缝房 ----------

test('M7 密室：F2/F3/F4 每层保底 1 间 vault，F1/F5/F6 无；门两侧 locked', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const m1 = genMap(makeRng(seed), 1);
    assert.equal(m1.cells.filter((c) => c.type === 'vault').length, 0, `seed ${seed} F1 不应有 vault`);
    for (const floorNo of [2, 3, 4]) {
      const m = genMap(makeRng(seed + floorNo * 1000), floorNo);
      const vaults = m.cells.filter((c) => c.type === 'vault');
      assert.equal(vaults.length, 1, `seed ${seed} F${floorNo} vault 数 ${vaults.length}`);
      const byKey = new Map(m.cells.map((c) => [c.x + ',' + c.y, c]));
      const v = vaults[0];
      let lockedDoors = 0;
      for (const [dk, dt] of Object.entries(v.doors)) {
        const [dx, dy] = dk.split(',').map(Number);
        const nb = byKey.get((v.x + dx) + ',' + (v.y + dy));
        assert.ok(nb, 'vault 门必须通向存在的房');
        assert.equal(dt, 'locked', 'vault 侧门必须 locked');
        assert.equal(nb.doors[(-dx) + ',' + (-dy)], 'locked', '对侧门也必须 locked');
        lockedDoors++;
      }
      assert.ok(lockedDoors >= 1, 'vault 至少有一个门');
    }
    for (const floorNo of [5, 6]) {
      const m = genMap(makeRng(seed), floorNo);
      assert.equal(m.cells.filter((c) => c.type === 'vault').length, 0, `F${floorNo} 迷你层无 vault`);
    }
  }
});

test('M7 大房型：F1-F4 多数种子 ≥1 间 big；F5/F6 迷你层无；big 只标在战斗房', () => {
  let withBig = 0;
  for (let seed = 1; seed <= 100; seed++) {
    for (const floorNo of [1, 2, 3, 4]) {
      const m = genMap(makeRng(seed + floorNo * 777), floorNo);
      const bigs = m.cells.filter((c) => c.big);
      if (bigs.length) withBig++;
      for (const b of bigs) {
        assert.equal(b.type, 'combat', 'big 只标战斗房');
        assert.ok(b.big === 'wide' || b.big === 'tall');
      }
    }
    for (const floorNo of [5, 6]) {
      const m = genMap(makeRng(seed), floorNo);
      assert.equal(m.cells.filter((c) => c.big).length, 0, `F${floorNo} 迷你层无大房`);
    }
  }
  // ≥2 邻居的战斗房才放 big（防黑市/事件房替换吃掉大房），覆盖率 30%+ 即达标
  assert.ok(withBig > 100, `大房覆盖率过低：${withBig}/400`);
});

test('M11 裂缝房条件化：F4/F5/F6 每个种子 0~1 间（邻出生房+门标记），F1-F3 恒无', () => {
  let seen4 = 0, seen5 = 0, seen6 = 0;
  for (let seed = 1; seed <= 100; seed++) {
    for (const floorNo of [4, 5, 6]) {
      const m = genMap(makeRng(seed), floorNo);
      const fis = m.cells.filter((c) => c.type === 'fissure');
      assert.ok(fis.length <= 1, `seed ${seed} F${floorNo} fissure 数 ${fis.length}`);
      if (fis.length) {
        if (floorNo === 4) seen4++;
        if (floorNo === 5) seen5++;
        if (floorNo === 6) seen6++;
        const byKey = new Map(m.cells.map((c) => [c.x + ',' + c.y, c]));
        const start = m.start;
        // 整层模式出生房四邻通常被占满：允许「邻普通/出生房且离出生房 ≤3」的藏匿位
        const isAdj = [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => {
          const nb = byKey.get((fis[0].x + dx) + ',' + (fis[0].y + dy));
          return nb && (nb.type === 'combat' || nb.type === 'start');
        });
        assert.ok(isAdj, `seed ${seed} F${floorNo} fissure 必须邻普通/出生房`);
        const dist = Math.abs(fis[0].x - start.x) + Math.abs(fis[0].y - start.y);
        assert.ok(dist <= 3, `seed ${seed} F${floorNo} fissure 距出生 ${dist} >3`);
        const f = fis[0];
        for (const [dk, dt] of Object.entries(f.doors)) {
          const [dx, dy] = dk.split(',').map(Number);
          const nb = byKey.get((f.x + dx) + ',' + (f.y + dy));
          if (nb && nb.type === 'start') {
            assert.equal(dt, 'fissure', 'fissure→start 门标记 fissure');
            assert.equal(nb.doors[(-dx) + ',' + (-dy)], 'fissure');
          }
        }
      }
    }
    for (const floorNo of [1, 2, 3]) {
      assert.equal(genMap(makeRng(seed + floorNo), floorNo).cells.filter((c) => c.type === 'fissure').length, 0);
    }
  }
  // 概率检定（F4 8% / F5 12% / F6 25%，100 种子）：出现次数下限取期望的 1/3（更低概率 <1e-5）
  assert.ok(seen4 > 2, `F4 裂缝房出现率异常（seen=${seen4}/100，期望 ~8）`);
  assert.ok(seen5 > 4, `F5 裂缝房出现率异常（seen=${seen5}/100，期望 ~12）`);
  assert.ok(seen6 > 8, `F6 裂缝房出现率异常（seen=${seen6}/100，期望 ~25）`);
});

test('M7 连通性保持：vault/fissure 不产生孤岛（BFS 全可达；M11 六层全覆盖）', () => {
  for (let seed = 1; seed <= 300; seed++) {
    for (const floorNo of [1, 2, 3, 4, 5, 6]) {
      const m = genMap(makeRng(seed * 31 + floorNo), floorNo);
      const byKey = new Map(m.cells.map((c) => [c.x + ',' + c.y, c]));
      const seen = new Set([m.start.x + ',' + m.start.y]);
      const q = [[m.start.x, m.start.y]];
      while (q.length) {
        const [x, y] = q.pop();
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const k = (x + dx) + ',' + (y + dy);
          if (byKey.has(k) && !seen.has(k)) { seen.add(k); q.push([x + dx, y + dy]); }
        }
      }
      assert.equal(seen.size, m.cells.length, `seed ${seed} F${floorNo} 有孤岛`);
    }
  }
});

// ---------- M10：Boss 骷髅门 ----------

test('M10 Boss 门：boss 房邻接边两侧标记 boss；其余边不标 boss（M11 六层全覆盖）', () => {
  for (let seed = 1; seed <= 300; seed++) {
    for (const floorNo of [1, 2, 3, 4, 5, 6]) {
      const m = genMap(makeRng(seed + floorNo * 131), floorNo);
      const byKey = new Map(m.cells.map((c) => [c.x + ',' + c.y, c]));
      let bossEdges = 0;
      for (const c of m.cells) {
        for (const [dk, dt] of Object.entries(c.doors)) {
          const [dx, dy] = dk.split(',').map(Number);
          const nb = byKey.get((c.x + dx) + ',' + (c.y + dy));
          if (!nb) continue;
          const bossEdge = c.type === 'boss' || nb.type === 'boss';
          const fisEdge = c.type === 'fissure' || nb.type === 'fissure';
          if (bossEdge && !fisEdge) {
            // boss↔普通房：两侧骷髅门
            assert.equal(dt, 'boss', `seed ${seed} F${floorNo} boss 边标记`);
            assert.equal(nb.doors[(-dx) + ',' + (-dy)], 'boss', '对侧也是 boss');
            bossEdges++;
          } else if (!bossEdge) {
            assert.notEqual(dt, 'boss', `seed ${seed} F${floorNo} 非 boss 边不应标 boss`);
          }
          if (fisEdge) {
            // 裂缝边（含 boss↔fissure）：未揭示前必须是 fissure（冲刺撞开的门禁不可被 boss 门绕过）
            assert.equal(dt, 'fissure', `seed ${seed} F${floorNo} fissure 边标记`);
          }
        }
      }
      assert.equal(bossEdges, 2, `seed ${seed} F${floorNo} boss 边数 ${bossEdges}（boss 是死端，恰好一条边两侧各一）`);
    }
  }
});
