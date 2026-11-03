// 战斗公式与引擎回归测试：node --test tools/test-combat.mjs
// 运行：用 Lark 沙盒 node（本机无系统 node）
import { test } from 'node:test';
import assert from 'node:assert/strict';
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b} (±${eps})`);
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = (f) => JSON.parse(readFileSync(join(ROOT, 'js/data', f), 'utf8'));

const { damageStat, fireInterval, typeMultiplier, stabMultiplier, computeHit, enemyPanel } =
  await import(join(ROOT, 'js/sim/combat.js?v=m3f'));
const { createRun, stepRun } = await import(join(ROOT, 'js/sim/engine.js?v=m3f'));
const { enterRoom } = await import(join(ROOT, 'js/sim/actors.js?v=m3f'));
function combatNeighbor(run, d) {
  const cell = run.map.get(run.cellKey);
  for (const [dk] of Object.entries(cell.doors)) {
    const [dx, dy] = dk.split(',').map(Number);
    const nb = run.map.get((cell.x + dx) + ',' + (cell.y + dy));
    if (nb && nb.type === 'combat') return (cell.x + dx) + ',' + (cell.y + dy);
  }
  return run.cellKey;
}

const tc = D('typechart.json');
const ed = D('enemies.json');
const mv = D('moves.json');
const bal = D('balance.json');
const data = {
  typechart: tc.chart, enemies: ed.enemies, moves: mv.moves, balance: bal,
  waves: ed.waves, species: { player: { types: ['electric'] } },
};

// ---------- 特攻成长（以撒 Repentance 官方式） ----------
test('damageStat：初始 3.5，+1 伤 → 3.5×sqrt(2.2)=5.19', () => {
  assert.equal(damageStat(0), 3.5);
  near(damageStat(1), 3.5 * Math.sqrt(2.2), 1e-9);
  near(damageStat(2, 1), 3.5 * Math.sqrt(3.4) + 1, 1e-9);
});

// ---------- 出招间隔 ----------
test('fireInterval：T=0 → (10+1)/30≈2.73 发/秒；软上限 delay=5', () => {
  near(fireInterval(0), 11 / 30, 1e-9);
  assert.equal(fireInterval(1.82) <= fireInterval(1), true);
  assert.equal(fireInterval(10) >= 5 / 30, true, '软上限：delay 不低于 5 ticks');
});

// ---------- 克制表抽查（官方数值） ----------
test('typeMultiplier：官方克制抽查', () => {
  const c = tc.chart;
  assert.equal(typeMultiplier(c, 'electric', ['water']), 2);
  assert.equal(typeMultiplier(c, 'electric', ['flying']), 2);
  assert.equal(typeMultiplier(c, 'electric', ['grass']), 0.5);
  assert.equal(typeMultiplier(c, 'electric', ['ground']), 0);
  assert.equal(typeMultiplier(c, 'water', ['ground', 'rock']), 4, '双属性可到 ×4');
  assert.equal(typeMultiplier(c, 'grass', ['grass', 'poison']), 0.25, '双属性可到 ×0.25');
  assert.equal(typeMultiplier(c, 'ghost', ['normal']), 0);
  assert.equal(typeMultiplier(c, 'fairy', ['dragon', 'dark']), 4);
  // 全表对称性抽检：每行 18 个条目
  for (const atk of Object.keys(c)) assert.equal(Object.keys(c[atk]).length, 18);
});

test('stabMultiplier：本系 ×1.5', () => {
  assert.equal(stabMultiplier('electric', ['electric']), 1.5);
  assert.equal(stabMultiplier('water', ['electric']), 1);
});

// ---------- 单发伤害 ----------
test('computeHit：电打小拉达（一般）= 3.5×1×1.5×1.4 = 7.35', () => {
  const h = computeHit({ D: 3.5, power: 40, moveType: 'electric', atkTypes: ['electric'], defTypes: ['normal'], spdMod: 1.4, chart: tc.chart });
  assert.equal(h.kind, 'normal');
  near(h.dmg, 7.35, 1e-9);
});

test('computeHit：电打走路草（草/毒）= 克制 0.5', () => {
  const h = computeHit({ D: 3.5, power: 40, moveType: 'electric', atkTypes: ['electric'], defTypes: ['grass', 'poison'], spdMod: 1.04, chart: tc.chart });
  assert.equal(h.kind, 'weak');
  near(h.dmg, 3.5 * 0.5 * 1.5 * 1.04, 1e-9);
});

test('computeHit：免疫（电打纯地面）伤害 0', () => {
  const h = computeHit({ D: 3.5, power: 40, moveType: 'electric', atkTypes: ['electric'], defTypes: ['ground'], chart: tc.chart });
  assert.equal(h.dmg, 0);
  assert.equal(h.kind, 'immune');
});

// ---------- 敌人换算 ----------
test('enemyPanel：与 enemies.json 手填值一致（种族值换算可复算）', () => {
  for (const [id, spec] of Object.entries(ed.enemies)) {
    if (spec.family === 'boss') continue;   // Boss HP 手填设计值
    const p = enemyPanel(spec.base);
    near(p.hp, spec.hp, 0.01);
    near(p.speed, spec.speed, 0.01);
    near(p.spdMod, spec.spdMod, 0.01);
    assert.equal(p.touchDmg, spec.touchDmg, `${id} touchDmg`);
  }
});

// ---------- 引擎：确定性与全流程 ----------
test('引擎确定性：同种子同输入流 → 同状态', () => {
  const run1 = createRun(data, 12345);
  const run2 = createRun(data, 12345);
  const input = () => ({ move: { x: 0, y: 0 }, aim: { x: 0.3, y: -0.9 }, fire: true, dashEdge: false, slotEdge: false, useEdge: false });
  for (let i = 0; i < 1200; i++) {
    stepRun(run1, input(), data);
    stepRun(run2, input(), data);
  }
  const snap = (r) => JSON.stringify([r.t, r.stats, r.player.hp, r.player.pp, r.room,
    r.enemies.map((e) => [e.id, +e.x.toFixed(6), +e.y.toFixed(6), +e.hp.toFixed(6)]),
    r.projectiles.length]);
  assert.equal(snap(run1), snap(run2));
});

test('引擎流程（楼层）：清两波 → 房间 cleared → 门开', () => {
  const run = createRun(data, 7);
  const cell = run.map.get(run.cellKey);
  let combatKey = null;
  for (const [dk] of Object.entries(cell.doors)) {
    const [dx, dy] = dk.split(',').map(Number);
    const nb = run.map.get((cell.x + dx) + ',' + (cell.y + dy));
    if (nb && nb.type === 'combat') { combatKey = (cell.x + dx) + ',' + (cell.y + dy); break; }
  }
  assert.ok(combatKey, '出生房邻接战斗房');
  enterRoom(run, data, combatKey);
  assert.equal(run.enemies.length > 0, true, '战斗房有敌人');
  const idle = { move: { x: 0, y: 0 }, aim: { x: 0, y: -1 }, fire: false, dashEdge: false, slotEdge: false, useEdge: false };
  for (let i = 0; i < 30; i++) {
    if (run.enemies.length) for (const e of run.enemies) e.hp = 0;
    stepRun(run, idle, data);
  }
  assert.equal(run.map.get(combatKey).cleared, true, '战斗房清空');
  assert.equal(run.room.doorOpen, true, '门开');
});

test('引擎：接触伤害与无敌帧', () => {
  const run = createRun(data, 99);
  enterRoom(run, data, combatNeighbor(run, data));
  const e = run.enemies[0];
  const idle = { move: { x: 0, y: 0 }, aim: { x: 0, y: -1 }, fire: false, dashEdge: false, slotEdge: false, useEdge: false };
  e.x = run.player.x + 0.3; e.y = run.player.y; e.state = 'active';
  const hp0 = run.player.hp;
  stepRun(run, idle, data);
  assert.equal(run.player.hp, hp0 - 1, '接触扣 1 格');
  const hurt = run.events.some((ev) => ev.t === 'player-hurt');
  assert.equal(hurt, true);
  // 无敌帧内不再扣
  e.touchCd = 0; run.player.iframes = 0.5;
  stepRun(run, idle, data);
  assert.equal(run.player.hp, hp0 - 1, '无敌帧内不受伤');
});

test('引擎：冲刺给无敌与位移', () => {
  const run = createRun(data, 555);
  enterRoom(run, data, combatNeighbor(run, data));
  const east = { move: { x: 1, y: 0 }, aim: { x: 1, y: 0 }, fire: false, dashEdge: true, slotEdge: false, useEdge: false };
  const x0 = run.player.x;
  stepRun(run, east, data);
  assert.equal(run.player.dashActive, true);
  assert.equal(run.player.dashCharges, 1, '消耗 1 层充能');
  for (let i = 0; i < 7; i++) stepRun(run, { ...east, dashEdge: false }, data);   // 冲刺全程 0.18s≈11 帧
  assert.equal(run.player.x > x0 + 1.5, true, '冲刺位移明显（13 速 × 0.18s ≈ 2.3）');
  // 冲刺剩余窗口内（第 8~10 帧，0.18s 未到）接触不受伤
  const e = run.enemies[0];
  e.x = run.player.x; e.y = run.player.y; e.state = 'active'; e.touchCd = 0;
  const hp = run.player.hp;
  assert.equal(run.player.dashActive, true, '仍在冲刺中');
  stepRun(run, { ...east, dashEdge: false }, data);
  assert.equal(run.player.hp, hp, '冲刺期间无敌');
});
