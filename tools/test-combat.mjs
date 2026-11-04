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
  await import(join(ROOT, 'js/sim/combat.js?v=m4c'));
const { createRun, stepRun } = await import(join(ROOT, 'js/sim/engine.js?v=m4c'));
const { enterRoom } = await import(join(ROOT, 'js/sim/actors.js?v=m4c'));
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
const fl = D('floors.json');
const data = {
  typechart: tc.chart, enemies: ed.enemies, moves: mv.moves, balance: bal,
  items: JSON.parse(readFileSync(join(ROOT, 'js/data/items.json'), 'utf8')).items,
  itemPools: JSON.parse(readFileSync(join(ROOT, 'js/data/items.json'), 'utf8')).poolConfig,
  waves: fl.floors['1'].waves, floors: fl.floors,
  species: { player: { types: ['electric'] } },
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


// ---------- M4：多层塔 / Z 招式 / 进化 / 替补 ----------
const { goNextFloor } = await import(join(ROOT, 'js/sim/engine.js?v=m4c'));

function idleInput() {
  return { move: { x: 0, y: 0 }, aim: { x: 0, y: -1 }, fire: false, dashEdge: false, slotEdge: false, useEdge: false, zEdge: false, swapEdge: false };
}
function state_hurt(run, dmg) { run.hurtPlayer(dmg); }

test('M4 层推进：Boss 死→楼梯→踩楼梯进层 2（新地图/新敌群/hpMul/成长保留）', () => {
  const run = createRun(data, 2024);
  const bossCell = [...run.map.values()].find((c) => c.type === 'boss');
  enterRoom(run, data, bossCell.x + ',' + bossCell.y);
  run.player.inv.passives.push('protein');
  const boss = run.enemies.find((e) => e.family === 'boss');
  boss.hp = 0;
  for (let i = 0; i < 8; i++) stepRun(run, idleInput(), data);
  assert.equal(run.over, false, '层 1 Boss 死不结束');
  assert.ok(run.pickups.some((k) => k.kind === 'stairs'), '有楼梯');
  run.player.x = run.pickups.find((k) => k.kind === 'stairs').x;
  run.player.y = run.pickups.find((k) => k.kind === 'stairs').y;
  for (let i = 0; i < 4; i++) stepRun(run, idleInput(), data);
  assert.equal(run.floorNo, 2, '进入层 2');
  near(run.hpMul, 1.35, 1e-9);
  assert.ok(run.player.inv.passives.includes('protein'), '成长保留');
  const f2ids = new Set(fl.floors['2'].waves.flat().map((w) => w.id));
  const cc = [...run.map.values()].find((c) => c.type === 'combat');
  enterRoom(run, data, cc.x + ',' + cc.y);
  assert.ok(run.enemies.every((e) => f2ids.has(e.eid)), '层 2 敌群正确');
});

test('M4 Z 招式：PP 满释放 AoE + 清零；PP 不足不放', () => {
  const run = createRun(data, 55);
  run.player.pp = 100;
  const cc = [...run.map.values()].find((c) => c.type === 'combat');
  enterRoom(run, data, cc.x + ',' + cc.y);
  for (const e of run.enemies) { e.state = 'active'; e.x = run.player.x + 1.5; e.y = run.player.y; }
  stepRun(run, { ...idleInput(), zEdge: true }, data);
  const z = run.events.find((e) => e.t === 'zmove');
  assert.ok(z, 'Z 事件');
  assert.equal(run.player.pp, 0);
  assert.equal(z.hits, 3, '全场命中');
  assert.equal(run.events.filter((e) => e.t === 'enemy-die').length, 3, '一波全灭（下一波已刷，总血对比无意义）');
  assert.ok(run.enemies.length > 0 || run.room.cleared, '灭波后推进');
  run.player.pp = 50;
  stepRun(run, { ...idleInput(), zEdge: true }, data);
  assert.equal(run.events.filter((e) => e.t === 'zmove').length, 0, 'PP 不足不放');
});

test('M4 进化：层 2 用雷之石 → 雷丘（面板成长）', () => {
  const run = createRun(data, 66);
  run.floorNo = 2;
  run.player.inv.consumable = 'thunder-stone';
  const d0 = run.player.stats.damage;
  stepRun(run, { ...idleInput(), useEdge: true }, data);
  assert.equal(run.player.evolved, true);
  assert.equal(run.player.species, 'raichu');
  assert.ok(run.player.stats.damage > d0, '伤害成长');
  assert.ok(run.player.maxHp > 6, '血上限成长');
});

test('M4 替补：结伴→F 切换→伤害由替补承受→濒死自动回主力', () => {
  const run = createRun(data, 77);
  run.pedestals.push({ id: 9001, itemId: 'companion:rattata', price: 0, x: run.player.x, y: run.player.y, taken: false });
  stepRun(run, idleInput(), data);
  const p = run.player;
  assert.ok(p.companion, '结伴');
  stepRun(run, { ...idleInput(), swapEdge: true }, data);
  assert.equal(p.activeSide, 'companion');
  p.iframes = 0;
  state_hurt(run, 2);
  assert.equal(p.companion.hp, p.companion.maxHp - 2, '替补承受');
  p.iframes = 0;
  state_hurt(run, 99);
  assert.equal(p.activeSide, 'main', '濒死回主力');
  assert.equal(run.player.alive, true, '主力无损');
});

test('M4 层 3 Boss（娜姿）死亡 → 通关 win', () => {
  const run = createRun(data, 88);
  goNextFloor(run, data); goNextFloor(run, data);
  assert.equal(run.floorNo, 3);
  const sb = [...run.map.values()].find((c) => c.type === 'boss');
  enterRoom(run, data, sb.x + ',' + sb.y);
  const boss = run.enemies.find((e) => e.family === 'boss');
  assert.equal(boss.name, '娜姿');
  boss.state = 'active';
  boss.hp = 0;
  for (let i = 0; i < 8; i++) stepRun(run, idleInput(), data);
  assert.equal(run.win, true, '第三层 Boss 死=通关');
  assert.equal(run.over, true);
});

// ---------- 房间暂存回归（用户 2026-11-04 报的 bug） ----------

test('回归：Boss 击败后离开再重进 → 楼梯与金币仍在', () => {
  const run = createRun(data, 20261104);
  const boss = [...run.map.values()].find((c) => c.type === 'boss');
  const bossKey = boss.x + ',' + boss.y;
  enterRoom(run, data, bossKey);
  const b = run.enemies.find((e) => e.family === 'boss');
  b.state = 'active'; b.hp = 0;
  for (let i = 0; i < 8; i++) stepRun(run, idleInput(), data);
  assert.ok(run.pickups.some((k) => k.kind === 'stairs'), 'Boss 死亡掉楼梯');
  const coins0 = run.pickups.filter((k) => k.kind === 'coin').length;
  assert.equal(coins0, 6, '撒 6 金币');
  // 走出 Boss 房（唯一门）再回来
  const [dx, dy] = Object.keys(boss.doors)[0].split(',').map(Number);
  const nbKey = (boss.x + dx) + ',' + (boss.y + dy);
  enterRoom(run, data, nbKey);
  assert.ok(!run.pickups.some((k) => k.kind === 'stairs'), '离开后拾取列表已清');
  enterRoom(run, data, bossKey);
  assert.ok(run.pickups.some((k) => k.kind === 'stairs'), '★ 重进 Boss 房楼梯恢复');
  assert.equal(run.pickups.filter((k) => k.kind === 'coin').length, 6, '金币也恢复');
});

test('回归：Boss 房楼梯保底（暂存丢失也能进下一层）', () => {
  const run = createRun(data, 20261105);
  const boss = [...run.map.values()].find((c) => c.type === 'boss');
  const bossKey = boss.x + ',' + boss.y;
  // 直接构造“cleared 但无暂存”的边界态
  enterRoom(run, data, bossKey);
  run.enemies.find((e) => e.family === 'boss').hp = 0;
  for (let i = 0; i < 8; i++) stepRun(run, idleInput(), data);
  delete boss.stash;                       // 模拟暂存意外缺失
  enterRoom(run, data, bossKey);
  assert.ok(run.pickups.some((k) => k.kind === 'stairs'), '保底楼梯仍生成');
  run.player.x = run.pickups.find((k) => k.kind === 'stairs').x;
  run.player.y = run.pickups.find((k) => k.kind === 'stairs').y;
  for (let i = 0; i < 3; i++) stepRun(run, idleInput(), data);
  assert.equal(run.floorNo, 2, '踩楼梯正常进层 2');
});

test('回归：宝箱房道具重进不重 roll（防刷道具）', () => {
  const run = createRun(data, 20261106);
  const tr = [...run.map.values()].find((c) => c.type === 'treasure');
  const trKey = tr.x + ',' + tr.y;
  enterRoom(run, data, trKey);
  assert.equal(run.pedestals.length, 1);
  const first = run.pedestals[0].itemId;
  const [dx, dy] = Object.keys(tr.doors)[0].split(',').map(Number);
  enterRoom(run, data, (tr.x + dx) + ',' + (tr.y + dy));
  enterRoom(run, data, trKey);
  assert.equal(run.pedestals.length, 1, '仍是一个台座');
  assert.equal(run.pedestals[0].itemId, first, '同一件道具（未被重 roll）');
});
