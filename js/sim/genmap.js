// 以撒式楼层生成（《02》§6 规格，参照 BorisTheBrace 拆解 + Repentance 逆向伪代码）。
// 纯函数 + 注入 rng，node 可测；同种子逐位一致。
//
// 规格：
//   13×13 网格，中心 (6,6) 出生房；BFS 扩张：邻居已占/防环规则/50% 随机放弃
//   目标房数 = min(20, 5 + floor(10×层号/3) + rand(0,1))
//   重 roll：房数 < target-2，或死端 < minDead，或 Boss 与出生房相邻
//   死端（按距离降序）：Boss → 商店 → 宝箱 → 挑战 → 营地 → 密室(F2+) → 剩余（隐藏房候选/黑市替换池）
//   隐藏房：与 ≥3 房相邻、不邻 Boss/特殊房的空格；进图不显示，冲刺撞裂缝进入
//   大房型（M7）：普通战斗房标记 big='wide'|'tall'——内部尺寸放大（网格仍占 1 格，Boss 房同模式）
//   裂缝房（M7）：F4 出生房旁的超梦挑战入口，门缝需冲刺撞开

export const GRID = 13;

export function genMap(rand, floorNo = 1) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const m = tryGen(rand, floorNo);
    if (m) return m;
  }
  // 50 次仍失败（几乎不可能）：退化为纯十字骨架，保底可玩
  return fallbackGen(rand, floorNo);
}

function key(x, y) { return x + ',' + y; }

function tryGen(rand, floorNo) {
  // F4 晶核之间：迷你层（直奔梦幻终战），死端下限放宽、房数容差收紧（必须够 4 房）
  if (floorNo >= 4) return tryGenCore(rand, 4, 1, 0, floorNo);
  // 死端 ≥7（M7，F1 为 6）：Boss/商店/宝箱/挑战/营地占 5 个 + 密室(F2+) 1 个，
  // 仍剩 ≥1 个战斗死端供黑市/祭坛/事件房替换（条件性替换需要额外死端——M4.5/M5 同类教训）
  return tryGenCore(rand, Math.min(20, 5 + Math.floor(10 * floorNo / 3) + (rand() < 0.5 ? 0 : 1)), floorNo >= 2 ? 7 : 6, 2, floorNo);
}

function tryGenCore(rand, target, minDead, tol, floorNo = 1) {
  const cells = new Map();          // key -> { x, y, type, }
  const put = (x, y, type) => cells.set(key(x, y), { x, y, type });

  const cx = 6, cy = 6;
  put(cx, cy, 'start');
  const queue = [[cx, cy]];
  const N = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  let count = 1;

  while (queue.length && count < target) {
    const [qx, qy] = queue.shift();
    for (const [dx, dy] of N) {
      if (count >= target) break;
      const nx = qx + dx, ny = qy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      if (cells.has(key(nx, ny))) continue;
      // 防环：候选格的已占邻居（除来源格）≥1 → 放弃
      let occ = 0;
      for (const [ex, ey] of N) {
        if (ex === -dx && ey === -dy) continue;
        if (cells.has(key(nx + ex, ny + ey))) occ++;
      }
      if (occ >= 1) continue;
      if (rand() < 0.5) continue;
      put(nx, ny, 'combat');
      queue.push([nx, ny]);
      count++;
    }
  }
  if (count < target - tol) return null;

  // 死端 = 恰有 1 个邻居的房（不含出生房）
  const neighborsOf = (x, y) => N.filter(([dx, dy]) => cells.has(key(x + dx, y + dy)));
  const deadEnds = [...cells.values()]
    .filter((c) => !(c.x === cx && c.y === cy) && neighborsOf(c.x, c.y).length === 1)
    .map((c) => ({ ...c, d: Math.abs(c.x - cx) + Math.abs(c.y - cy) }))
    .sort((a, b) => b.d - a.d);
  if (deadEnds.length < minDead) return null;

  // Boss=最远死端（且不与出生房相邻）
  const boss = deadEnds[0];
  if (Math.abs(boss.x - cx) + Math.abs(boss.y - cy) < 2) return null;
  cells.get(key(boss.x, boss.y)).type = 'boss';
  const rest = deadEnds.slice(1);
  const takeDeadEnd = () => {
    const c = rest.shift();
    return c ? cells.get(key(c.x, c.y)) : null;
  };
  const shop = takeDeadEnd();   if (shop) shop.type = 'shop';
  const treasure = takeDeadEnd(); if (treasure) treasure.type = 'treasure';
  const challenge = takeDeadEnd(); if (challenge) challenge.type = 'challenge';
  // 救援营地每层保底（替补=换 Build 载体，是免疫/克制的战略出口，必须拿得到）
  const camp = takeDeadEnd();   if (camp) camp.type = 'camp';
  // 锁住的宝物密室（M7，F2+）：钥匙经济的目标房
  if (floorNo >= 2) { const vault = takeDeadEnd(); if (vault) vault.type = 'vault'; }

  // 大房型（M7）：非死端的普通战斗房，按层号放 1~2 个——内部放大（网格 1 格）
  const combatAll = [...cells.values()].filter((c) => c.type === 'combat');
  const bigs = floorNo >= 4 ? [] : combatAll
    .filter((c) => neighborsOf(c.x, c.y).length >= 2)
    .sort((a, b) => b.d - a.d)
    .slice(0, floorNo >= 3 ? 2 : 1);
  bigs.forEach((c, i) => { c.big = i % 2 === 0 ? 'wide' : 'tall'; });

  // 隐藏房：与 ≥3 个普通/出生房相邻的空格（不邻 Boss/特殊房），邻居越多权重越高
  const special = new Set(['boss', 'shop', 'treasure', 'challenge', 'camp', 'secret', 'vault']);
  let best = null, bestScore = -1;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (cells.has(key(x, y))) continue;
      let adj = 0, bad = 0, deadAdj = 0;
      for (const [dx, dy] of N) {
        const c = cells.get(key(x + dx, y + dy));
        if (!c) continue;
        adj++;
        if (special.has(c.type)) bad++;
        if (deadEnds.some((de) => de.x === c.x && de.y === c.y)) deadAdj++;
      }
      if (adj >= 3 && bad === 0 && deadAdj === 0) {
        const score = adj + rand() * 2;
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
    }
  }
  if (best) put(best.x, best.y, 'secret');

  // 裂缝房（M7）：F4 出生房旁的超梦挑战（可选隐藏 Boss）；门缝冲刺撞开
  if (floorNo >= 4) {
    const spot = N.map(([dx, dy]) => ({ x: cx + dx, y: cy + dy }))
      .find((p) => p.x >= 0 && p.y >= 0 && p.x < GRID && p.y < GRID && !cells.has(key(p.x, p.y)));
    if (spot) put(spot.x, spot.y, 'fissure');
  }

  // 运行时字段
  for (const c of cells.values()) {
    c.cleared = c.type === 'start';
    c.visited = c.type === 'start';
    c.doors = {};
    for (const [dx, dy] of N) {
      const nb = cells.get(key(c.x + dx, c.y + dy));
      if (nb) {
        // 密室门两侧上锁；裂缝门两侧标 fissure（表现=裂缝，冲刺撞开）
        const lockedPair = (c.type === 'vault' || nb.type === 'vault') ? 'locked'
          : (c.type === 'fissure' || nb.type === 'fissure') ? 'fissure'
          : nb.type === 'secret' ? 'secret' : 'normal';
        c.doors[dx + ',' + dy] = lockedPair;
      }
    }
  }

  return {
    grid: GRID, target,
    cells: [...cells.values()],
    start: { x: cx, y: cy },
    counts: tally(cells),
  };
}

function tally(cells) {
  const t = {};
  for (const c of cells.values()) t[c.type] = (t[c.type] || 0) + 1;
  return t;
}

function fallbackGen(rand, floorNo) {
  const cells = new Map();
  const put = (x, y, type) => cells.set(key(x, y), { x, y, type });
  put(6, 6, 'start');
  put(6, 5, 'combat'); put(6, 4, 'combat'); put(6, 3, 'shop');
  put(5, 6, 'combat'); put(4, 6, 'treasure'); put(3, 6, 'combat');
  put(7, 6, 'combat'); put(8, 6, 'combat'); put(6, 2, 'boss');
  put(5, 5, 'camp'); put(7, 5, 'challenge');      // 营地保底（替补=克制出口），兜底图同样要有
  if (floorNo >= 2) put(7, 7, 'vault');
  for (const c of cells.values()) {
    c.cleared = c.type === 'start';
    c.visited = c.type === 'start';
    c.doors = {};
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nb = cells.get(key(c.x + dx, c.y + dy));
      if (nb) {
        const lockedPair = (c.type === 'vault' || nb.type === 'vault') ? 'locked' : nb.type === 'secret' ? 'secret' : 'normal';
        c.doors[dx + ',' + dy] = lockedPair;
      }
    }
  }
  return { grid: GRID, target: cells.size, cells: [...cells.values()], start: { x: 6, y: 6 }, counts: tally(cells), fallback: true };
}
