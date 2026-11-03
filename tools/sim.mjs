// 无头平衡模拟：机器人打 N 局，输出 TTK / 生存 / 命中率。
// 用法：node tools/sim.mjs [局数] [种子基数]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';
const D = (f) => JSON.parse(readFileSync(join(ROOT, 'js/data', f), 'utf8'));

const { createRun, stepRun, STEP } = await import(join(ROOT, 'js/sim/engine.js?v=m2d'));

const tc = D('typechart.json'), ed = D('enemies.json'), mv = D('moves.json'), bal = D('balance.json');
const data = {
  typechart: tc.chart, enemies: ed.enemies, moves: mv.moves, balance: bal,
  waves: ed.waves, species: { player: { types: ['electric'] } },
};

const GAMES = Number(process.argv[2] || 50);
const SEED0 = Number(process.argv[3] || 1000);

// 机器人策略：
//  - aim：站桩向最近敌人射击；
//  - kite：始终向远离最近敌人的方向移动 + 射击（走位风筝）
function botInput(run, mode) {
  const p = run.player;
  let nearest = null, nd = 1e9;
  for (const e of run.enemies) {
    if (e.state === 'spawning') continue;
    const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d < nd) { nd = d; nearest = e; }
  }
  // 也躲敌弹（kite 模式）
  let danger = null;
  if (mode === 'kite') {
    for (const b of run.projectiles) {
      if (b.owner !== 'enemy') continue;
      const d = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
      if (d < 2.2 * 2.2 && d < nd) { nd = d; danger = b; }
    }
  }
  const tgt = danger || nearest;
  let move = { x: 0, y: 0 };
  if (tgt) {
    const dx = tgt.x - p.x, dy = tgt.y - p.y;          // 指向目标
    const awayx = -dx, awayy = -dy;
    const l = Math.hypot(dx, dy) || 1;
    if (mode === 'kite') {
      // 近身风筝（远离），远处逼近（射程 6.5，保持 ~4 格输出）
      if (l < 2.6) move = { x: awayx / l, y: awayy / l };
      else if (l > 4.2) move = { x: dx / l, y: dy / l };
    } else {
      // aim 模式也向射程外的目标逼近（站桩打不到 6.5 格外的射手）
      if (l > 5.2) move = { x: dx / l, y: dy / l };
    }
  }
  // 撞墙回中
  if (p.x < 2) move.x = 1; if (p.x > 15) move.x = -1;
  if (p.y < 2) move.y = 1; if (p.y > 9) move.y = -1;
  const aim = nearest
    ? { x: nearest.x - p.x, y: nearest.y - p.y }
    : { x: 0, y: -1 };
  return { move, aim, fire: !!nearest, dashEdge: false };
}

function playGame(seed, mode, maxSeconds = 120) {
  const run = createRun(data, seed);
  let t = 0, waveTimes = [];
  let lastWave = 0;
  while (t < maxSeconds) {
    stepRun(run, botInput(run, mode), data);
    t += STEP;
    if (run.room.state === 'cleared') break;
    if (run.room.waveIdx !== lastWave) { waveTimes.push(t); lastWave = run.room.waveIdx; }
    if (!run.player.alive) break;
  }
  return {
    t, dead: !run.player.alive, cleared: run.room.state === 'cleared',
    kills: run.stats.kills, shots: run.stats.shots, dmg: run.stats.dmgDealt,
    hpLeft: run.player.hp, waveTimes,
  };
}

for (const mode of ['aim', 'kite']) {
  const results = [];
  for (let g = 0; g < GAMES; g++) results.push(playGame((SEED0 + g * 7919) >>> 0, mode));
  const avg = (f) => (results.reduce((s, r) => s + f(r), 0) / results.length);
  const ttk = avg((r) => r.t);
  const cls = results.filter((r) => r.cleared).length;
  const dead = results.filter((r) => r.dead).length;
  const acc = avg((r) => (r.shots ? r.kills / r.shots : 0));
  console.log(`[${mode}] ${GAMES} 局：清房率 ${(cls / GAMES * 100).toFixed(0)}%  死亡率 ${(dead / GAMES * 100).toFixed(0)}%  ` +
    `平均时长 ${ttk.toFixed(1)}s（目标 8-20s）  击杀/发 ${acc.toFixed(2)}  均伤害 ${avg(r => r.dmg).toFixed(0)}`);
  const slowest = Math.max(...results.map(r => r.t)).toFixed(1);
  const fastest = Math.min(...results.map(r => r.t)).toFixed(1);
  console.log(`       时长区间 ${fastest}s ~ ${slowest}s；单局击杀 ${avg(r => r.kills).toFixed(1)}`);
}
