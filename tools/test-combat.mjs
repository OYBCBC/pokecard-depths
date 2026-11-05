// 战斗公式与引擎回归测试：node --test tools/test-combat.mjs
// 运行：用 Lark 沙盒 node（本机无系统 node）
import { test } from 'node:test';
import assert from 'node:assert/strict';
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b} (±${eps})`);
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = (f) => JSON.parse(readFileSync(join(ROOT, 'js/data', f), 'utf8'));

const { damageStat, fireInterval, typeMultiplier, stabMultiplier, computeHit, enemyPanel } =
  await import(join(ROOT, 'js/sim/combat.js?v=m5c'));
const { createRun, stepRun } = await import(join(ROOT, 'js/sim/engine.js?v=m5c'));
const _engine = await import(join(ROOT, 'js/sim/engine.js?v=m5c'));
const { enterRoom } = await import(join(ROOT, 'js/sim/actors.js?v=m5c'));
const _save = await import(join(ROOT, 'js/sim/save.js?v=m5c'));
const _dex = await import(join(ROOT, 'js/sim/dex.js?v=m5c'));
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
  species: D('species.json').species,
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
const { goNextFloor } = await import(join(ROOT, 'js/sim/engine.js?v=m5c'));

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

test('M5 层 3 Boss（娜姿）死亡 → 楼梯去 F4；梦幻死 → 净化通关', () => {
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
  assert.equal(run.win, false, 'F3 不再是终点');
  assert.ok(run.pickups.some((k) => k.kind === 'stairs'), 'F3 Boss 死出楼梯');
  // 上 F4 → 晶核之间
  goNextFloor(run, data);
  assert.equal(run.floorNo, 4);
  assert.equal(data.floors['4'].name, '晶核之间');
  const mewRoom = [...run.map.values()].find((c) => c.type === 'boss');
  enterRoom(run, data, mewRoom.x + ',' + mewRoom.y);
  const mew = run.enemies.find((e) => e.family === 'boss');
  assert.equal(mew.name, '梦幻');
  // 三段推进：打到 66%/33% 触发 phase2/3，再打死 → 净化通关
  mew.state = 'active';
  mew.hp = mew.maxHp * 0.5;
  stepRun(run, idleInput(), data);
  assert.equal(mew.b.phase, 2, '50% 血 → P2');
  mew.hp = mew.maxHp * 0.2;
  stepRun(run, idleInput(), data);
  assert.equal(mew.b.phase, 3, '20% 血 → P3');
  mew.hp = 0;
  let sawPurify = false, sawClear = false;
  for (let i = 0; i < 8; i++) {
    stepRun(run, idleInput(), data);
    if (run.events.some((e) => e.t === 'mew-purify')) sawPurify = true;
    if (run.events.some((e) => e.t === 'floor-clear')) sawClear = true;
  }
  assert.equal(run.win, true, '梦幻死=通关');
  assert.equal(run.over, true);
  assert.ok(sawPurify, '净化演出事件');
  assert.ok(sawClear, 'floor-clear 事件');
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

// ---------- 存档系统（M4） ----------

test('存档：序列化→JSON 往返→复活，同输入演算 300 帧逐位一致', () => {
  const { serializeRun, deserializeRun } = await0_import_save();
  const runA = createRun(data, 20261107);
  // 推进一段有内容的局面：清两间 + 拿一件道具 + 进 Boss 房打 3 秒
  const cc = [...runA.map.values()].filter((c) => c.type === 'combat').slice(0, 2);
  for (const c of cc) {
    enterRoom(runA, data, c.x + ',' + c.y);
    for (const e of runA.enemies) e.hp = 0;
    for (let i = 0; i < 10; i++) stepRun(runA, idleInput(), data);
  }
  const tr = [...runA.map.values()].find((c) => c.type === 'treasure');
  enterRoom(runA, data, tr.x + ',' + tr.y);
  const ped = runA.pedestals[0];
  runA.player.x = ped.x; runA.player.y = ped.y;
  for (let i = 0; i < 3; i++) stepRun(runA, idleInput(), data);
  const bossC = [...runA.map.values()].find((c) => c.type === 'boss');
  enterRoom(runA, data, bossC.x + ',' + bossC.y);
  for (let i = 0; i < 180; i++) stepRun(runA, idleInput(), data);

  // 序列化 → 真实 localStorage 路径（stringify/parse）
  const saved = JSON.parse(JSON.stringify(serializeRun(runA)));
  const runB = deserializeRun(data, saved);
  assert.ok(runB, '复活成功');
  assert.equal(runB.floorNo, runA.floorNo);
  assert.equal(runB.cellKey, runA.cellKey);
  assert.ok(runB.enemies.some((e) => e.family === 'boss' && e.b.cfg), 'Boss cfg 已重绑');

  // 同输入演算 300 帧（含射击随机骰点）
  const shotInput = () => ({ move: { x: Math.sin(runA.t * 3) * 0.7, y: Math.cos(runA.t * 2) * 0.5 }, aim: { x: 0.6, y: -0.8 }, fire: true });
  for (let i = 0; i < 300; i++) {
    const inp = shotInput();
    stepRun(runA, inp, data);
    stepRun(runB, JSON.parse(JSON.stringify(inp)), data);
  }
  const pa = runA.player, pb = runB.player;
  near(pa.x, pb.x, 1e-9); near(pa.y, pb.y, 1e-9);
  assert.equal(pa.hp, pb.hp, 'hp 一致');
  assert.equal(runA.enemies.length, runB.enemies.length, '敌数一致');
  const ba = runA.enemies.find((e) => e.family === 'boss'), bb = runB.enemies.find((e) => e.family === 'boss');
  if (ba && bb) near(ba.hp, bb.hp, 1e-9);
  near(runA.stats.dmgDealt, runB.stats.dmgDealt, 1e-6, '总伤害一致（rng 路径一致）');
});

test('存档：复活后可正常下层（楼梯→层2）与重进暂存', () => {
  const { serializeRun, deserializeRun } = await0_import_save();
  const runA = createRun(data, 20261108);
  const bossC = [...runA.map.values()].find((c) => c.type === 'boss');
  enterRoom(runA, data, bossC.x + ',' + bossC.y);
  runA.enemies.find((e) => e.family === 'boss').hp = 0;
  for (let i = 0; i < 10; i++) stepRun(runA, idleInput(), data);
  const runB = deserializeRun(data, JSON.parse(JSON.stringify(serializeRun(runA))));
  const st = runB.pickups.find((k) => k.kind === 'stairs');
  assert.ok(st, '复活后楼梯在');
  runB.player.x = st.x; runB.player.y = st.y;
  for (let i = 0; i < 5; i++) stepRun(runB, idleInput(), data);
  assert.equal(runB.floorNo, 2, '复活档可下层');
});
// 顶层 await import（test 回调是同步的，用文件头注入的 _save 单例）
function await0_import_save() {
  if (!_save) throw new Error('save 模块需在文件顶部 import');
  return _save;
}

test('每日种子：同日确定、跨日不同', () => {
  const { dailySeed } = _save;
  assert.equal(dailySeed(new Date(2026, 10, 4)), dailySeed(new Date(2026, 10, 4, 23, 59)), '同日同时区一致');
  assert.notEqual(dailySeed(new Date(2026, 10, 4)), dailySeed(new Date(2026, 10, 5)), '跨日不同');
  assert.ok(dailySeed(new Date()) <= 4294967295, 'uint32');
});

test('存档：isDaily 标记随档保留', () => {
  const { serializeRun, deserializeRun } = _save;
  const runA = createRun(data, 42);
  runA.isDaily = true;
  const runB = deserializeRun(data, JSON.parse(JSON.stringify(serializeRun(runA))));
  assert.equal(runB.isDaily, true);
});

// ---------- 图鉴（M4） ----------

test('图鉴：物种表构建（野生+伙伴+馆主搭档，别名合并，按图鉴号排序）', () => {
  const { dexSpecies } = _dex;
  const list = dexSpecies(data);
  assert.ok(list.length >= 23, '至少 23 条（实际 ' + list.length + '）');
  assert.ok(list.every((c, i) => i === 0 || list[i - 1].dex <= c.dex), '按图鉴号排序');
  assert.ok(!list.some((c) => c.eid === 'grimer-small'), '小臭泥并入臭泥');
  assert.ok(!list.some((c) => c.eid === 'brock'), '训练家不进图鉴');
  for (const eid of ['pikachu', 'raichu', 'onix', 'alakazam', 'kecleon']) {
    assert.ok(list.some((c) => c.eid === eid), eid + ' 在表');
  }
});

test('图鉴：事件点亮（遭遇/击杀/馆主搭档/进化/结伴/别名）', () => {
  const { dexApply } = _dex;
  let dex = {};
  ({ dex } = dexApply(dex, [{ t: 'spawn', eid: 'rattata', x: 1, y: 1 }]));
  assert.equal(dex.rattata.seen, 1);
  ({ dex } = dexApply(dex, [{ t: 'enemy-die', eid: 'rattata', x: 1, y: 1 }]));
  assert.equal(dex.rattata.kills, 1);
  assert.equal(dex.rattata.seen, 1, '重复遭遇不叠加');
  ({ dex } = dexApply(dex, [{ t: 'enemy-die', eid: 'grimer-small', x: 1, y: 1 }]));
  assert.ok(dex.grimer && dex.grimer.kills === 1, '小臭泥击杀并入臭泥');
  assert.ok(!dex['grimer-small'], '无独立条目');
  ({ dex } = dexApply(dex, [{ t: 'boss-intro', name: '小刚', ace: 'onix' }]));
  assert.equal(dex.onix.seen, 1, '馆主搭档点亮');
  ({ dex } = dexApply(dex, [{ t: 'evolve', to: 'raichu', name: '雷丘' }]));
  assert.equal(dex.raichu.seen, 1, '进化点亮');
  ({ dex } = dexApply(dex, [{ t: 'companion-join', name: '蚊香蝌蚪', eid: 'poliwag' }]));
  assert.equal(dex.poliwag.seen, 1, '结伴点亮');
});

// ---------- M5 第二批：道具全量 / 黑市祭坛 / 徽章 / 异常状态 ----------

const _items = await import(join(ROOT, 'js/sim/items.js?v=m5c'));
const items = data.items;

test('道具全量：74 件（被动42+强化8+消耗11+纪念10+徽章3），图标齐全、池合法', () => {
  const ids = Object.keys(items);
  assert.equal(ids.length, 74, '总数 74，实际 ' + ids.length);
  const byKind = {};
  for (const id of ids) byKind[items[id].kind] = (byKind[items[id].kind] || 0) + 1;
  assert.equal(byKind.passive, 42);
  assert.equal(byKind.stat, 8);
  assert.equal(byKind.consumable, 11);
  assert.equal(byKind.trinket, 10);
  assert.equal(byKind.badge, 3);
  const VALID_POOLS = new Set(['T', 'S', 'O', 'C', 'X', 'D', 'A']);
  for (const id of ids) {
    const it = items[id];
    assert.ok(it.name && it.desc && it.icon != null, id + ' 有名字/描述/图标');
    assert.ok(existsSync(join(ROOT, 'assets/items', it.icon + '.png')), id + ' 图标 PNG 存在');
    assert.ok(it.quality >= 0 && it.quality <= 4, id + ' 品质 0-4');
    for (const p of it.pools) assert.ok(VALID_POOLS.has(p), id + ' 池代码 ' + p);
    if (it.kind === 'badge') assert.equal(it.pools.length, 0, '徽章不入池（Boss 掉落）');
  }
  const poolOf = (code) => ids.filter((id) => items[id].pools.includes(code));
  assert.ok(poolOf('D').length >= 3, '黑市池 ≥3（实际 ' + poolOf('D').length + '）');
  assert.ok(poolOf('A').length >= 4, '祭坛池 ≥4（实际 ' + poolOf('A').length + '）');
});

test('专属件：电气球皮卡丘 ×2 / 雷丘失效；粗骨头卡拉卡拉 ×1.6；进化奇石进化后失效', () => {
  const { applyItems } = _items;
  const inv = { passives: ['light-ball', 'thick-club'], trinket: null, badges: [] };
  const mPika = applyItems(items, inv, { species: 'pikachu', evolved: false });
  near(mPika.dmgMul, 2, 1e-9);
  const mRaichu = applyItems(items, inv, { species: 'raichu', evolved: true });
  near(mRaichu.dmgMul, 1, 1e-9, '进化成雷丘后电气球失效（经典梗）');
  const mCubone = applyItems(items, inv, { species: 'cubone', evolved: false });
  near(mCubone.dmgMul, 1.6, 1e-9);
  const mEvo = applyItems(items, { passives: ['evo-stone'], trinket: null, badges: [] }, { species: 'pikachu', evolved: true });
  near(mEvo.blockChance, 0, 1e-9, '进化后进化奇石不格挡');
  const mUn = applyItems(items, { passives: ['evo-stone'], trinket: null, badges: [] }, { species: 'pikachu', evolved: false });
  near(mUn.blockChance, 0.15, 1e-9);
});

test('徽章：Boss 击败掉落（F1 灰）并生效（击退 ×1.25）', () => {
  const run = createRun(data, 777);
  run.player.inv.passives = [];
  // 直接进 Boss 房击杀
  const bossCell = [...run.map.values()].find((c) => c.type === 'boss');
  enterRoom(run, data, bossCell.x + ',' + bossCell.y);
  const boss = run.enemies.find((e) => e.family === 'boss');
  assert.ok(boss, 'Boss 已生成');
  boss.hp = 0; run.player.pp = 0; run.player.iframes = 9;
  // 击杀走 stepRun 统一死亡检查
  for (let i = 0; i < 120 && run.enemies.length; i++) stepRun(run, idleInput(), data);
  assert.equal(run.enemies.length, 0, 'Boss 已死');
  assert.deepEqual(run.player.inv.badges, ['badge-gray'], 'F1 掉灰色徽章');
  near(run.player.mods.knockMul, 1.25, 1e-9);
  assert.ok(run.events.some((e) => e.t === 'badge-take') || run.pickups.some((k) => k.kind === 'stairs'), '楼梯/事件在');
});

test('黑市/祭坛：无伤检定开房（F2 出现），进房有台座、锁路线互斥', () => {
  const run = createRun(data, 20261104);
  run.stats.hurtFloors = [];                 // 整层无伤 → 检定必过（1.35 > 1）
  // F1 直接击杀 Boss 踩楼梯
  const bossCell = [...run.map.values()].find((c) => c.type === 'boss');
  enterRoom(run, data, bossCell.x + ',' + bossCell.y);
  const boss = run.enemies.find((e) => e.family === 'boss');
  boss.hp = 0; run.player.iframes = 9;
  rideStairs(run, 200);
  assert.equal(run.floorNo, 2, '已下层');
  assert.ok(run.bm && run.bm.kind, '黑市/祭坛已开（bm.kind=' + (run.bm && run.bm.kind) + '）');
  const cell = [...run.map.values()].find((c) => c.type === run.bm.kind);
  assert.ok(cell, '地图上存在 ' + run.bm.kind + ' 房');
  // 未探索前是死端 combat 替换：恰好 1 邻居 → 不在必经之路上
  const nb = Object.values(cell.doors).length;
  assert.equal(nb, 1, '替换的是死端');
  // 进房内容
  enterRoom(run, data, cell.x + ',' + cell.y);
  assert.equal(run.room.type, run.bm.kind);
  assert.ok(run.room.cleared, '无战斗房');
  if (run.bm.kind === 'blackmarket') {
    assert.equal(run.pedestals.length, 3, '黑市 3 件');
    assert.ok(run.pedestals.every((d) => d.priceHp === 2), '亲密度上限定价 ♥×2');
    assert.equal(run.bm.route, 'blackmarket', '路线锁定');
  } else {
    assert.equal(run.pedestals.length, 2, '祭坛 2 件');
    assert.ok(run.pedestals.every((d) => d.price > 0 && !d.priceHp), '祭坛金钱定价');
    assert.equal(run.bm.route, 'altar', '路线锁定');
    assert.ok(run.pickups.some((k) => k.kind === 'heart'), '祭坛免费心');
  }
});

test('黑市交易：priceHp 扣亲密度上限（hpPaid 进存档），下限保护 2 格', () => {
  const run = createRun(data, 31337);
  // 手工布置黑市房内容（绕开随机检定）
  const cell = [...run.map.values()].find((c) => c.type === 'combat');
  cell.type = 'blackmarket';
  enterRoom(run, data, cell.x + ',' + cell.y);
  // 手工摆 3 件 D 池道具（绕开 rollItem 随机，聚焦交易机制）
  run.pedestals.length = 0;
  ['flame-orb', 'toxic-orb', 'soul-dew'].forEach((id, i) =>
    run.pedestals.push({ id: 900 + i, itemId: id, price: 0, priceHp: 2, x: run.roomW / 2 + (i - 1) * 2.6, y: run.roomH / 2 - 0.5, taken: false }));
  const d = run.pedestals[0];
  const maxBefore = run.player.maxHp;
  run.player.x = d.x; run.player.y = d.y;
  for (let i = 0; i < 3 && !d.taken; i++) stepRun(run, idleInput(), data);
  assert.equal(d.taken, true, '已购买');
  assert.equal(run.player.hpPaid, 2);
  assert.equal(run.player.maxHp, maxBefore - 2, '上限 -2');
  assert.ok(run.player.inv.passives.includes(d.itemId) || run.player.inv.trinket === d.itemId, '道具入包');
  // 上限保护：maxHp=3 时买不起（3-2<2）
  const d2 = run.pedestals.find((p) => !p.taken);
  run.player.x = d2.x; run.player.y = d2.y;
  for (let i = 0; i < 3 && !d2.taken; i++) stepRun(run, idleInput(), data);   // 第二件：4-2=2 ✓ 可买
  assert.equal(d2.taken, true, '第二件可买（剩 2 格）');
  assert.equal(run.player.maxHp, 2);
  const d3 = run.pedestals.find((p) => !p.taken) || d2;
  run.player.x = d3.x; run.player.y = d3.y;
  run.player.hpPaid = 4;                        // 已买两件：maxHp=2 → 2-2<2 买不起
  const { recompute: _rc } = _engine; _rc(run, data);
  for (let i = 0; i < 3; i++) stepRun(run, idleInput(), data);
  assert.equal(d3.taken, false, '上限不足不能交易（剩 2 格保底）');
  // 存档往返：hpPaid 保持，maxHp = 基线 6 - 4 = 2
  const { serializeRun, deserializeRun } = _save;
  const rt = deserializeRun(data, JSON.parse(JSON.stringify(serializeRun(run))));
  assert.equal(rt.player.hpPaid, 4);
  assert.equal(rt.player.maxHp, 2, 'maxHp 经 hpPaid 重算');
});

test('互斥：进过黑市后祭坛永不再出（kind 只能是 blackmarket）', () => {
  const run = createRun(data, 20261104);        // 与前测同种子：F2 走到 Boss 灭掉再下层
  run.bm.route = 'blackmarket';                 // 预锁黑市路线
  run.stats.hurtFloors = [];
  for (const f of [2, 3]) {
    const bossCell = [...run.map.values()].find((c) => c.type === 'boss');
    enterRoom(run, data, bossCell.x + ',' + bossCell.y);
    const boss = run.enemies.find((e) => e.family === 'boss');
    boss.hp = 0; run.player.iframes = 9;
    rideStairs(run, 300);
  }
  assert.equal(run.floorNo, 3, '到 F3');
  if (run.bm.kind) assert.equal(run.bm.kind, 'blackmarket', '锁路线后只出黑市');
});

test('异常状态：中毒 DoT / 冰冻定身 / 束缚带减速', () => {
  const run = createRun(data, 555);
  run.player.inv.passives = ['toxic-orb', 'icy-rock', 'binding-band'];
  const { recompute } = await0_engine();
  recompute(run, data);
  // 中毒：poisonChance=0.3+icy 0.12 → 造一只敌人打它若干次，看 poisonT/frozenT/slowT
  const e0 = { id: 1, eid: 'rattata', name: '小拉达', types: ['normal'], family: 'wanderer',
    radius: 0.4, score: 1, hp: 100, maxHp: 100, touchDmg: 1, speed: 1, spdMod: 1,
    x: 8, y: 5, px: 8, py: 5, kx: 0, ky: 0, state: 'active', spawnT: 0, flash: 0, touchCd: 0, stun: 0,
    anim: 'Idle', dir: 0, moving: false, wanderT: 0, wx: 0, wy: 0, shoot: null, shootCd: 0 };
  run.enemies.push(e0);
  run.player.x = 8; run.player.y = 3.2;      // 敌在正南（y+ = 南）——瞄准要朝南！
  let sawPoison = false, sawFreeze = false;
  for (let i = 0; i < 900 && !(sawPoison && sawFreeze); i++) {
    e0.hp = 100; e0.state = 'active'; e0.spawnT = 0;   // 别让 DoT 杀掉/出生态挡接触
    stepRun(run, { ...idleInput(), aim: { x: 0, y: 1 }, fire: true }, data);
    if (e0.poisonT > 0) sawPoison = true;
    if (e0.frozenT > 0) sawFreeze = true;
  }
  assert.ok(sawPoison, '剧毒宝珠上毒');
  assert.ok(sawFreeze || true, '概率路径见下：确定性断言');
  // 冻结/减速确定性：直接把概率拉满各验一发
  run.enemies.length = 0;
  run.enemies.push(e0);
  run.player.mods.freezeChance = 1; run.player.mods.slowOnHit = 1.5;
  let frz = false;
  for (let i = 0; i < 120 && !frz; i++) {
    e0.hp = 100; e0.poisonT = 0; e0.state = 'active'; e0.spawnT = 0; e0.frozenT = 0;
    e0.x = 8; e0.y = 5; e0.px = 8; e0.py = 5;      // 钉在弹道上（概率阶段会游走）
    run.player.x = 8; run.player.y = 3.2; run.player.px = 8; run.player.py = 3.2;
    stepRun(run, { ...idleInput(), aim: { x: 0, y: 1 }, fire: true }, data);
    if (e0.frozenT > 0) frz = true;
  }
  assert.ok(frz, '冰冻上过（确定性）');
  for (let i = 0; i < 90 && e0.frozenT > 0; i++) stepRun(run, idleInput(), data);
  assert.ok(e0.frozenT === undefined || e0.frozenT <= 0, '冰冻 0.8s 后解冻');
  stepRun(run, { ...idleInput(), aim: { x: 0, y: 1 }, fire: true }, data);
  assert.ok(e0.slowT > 0, '束缚带减速（确定性）');
  assert.ok(run.player.hp > 0, '玩家还活着（测试用例兜底）');
});

test('圣灰：进 Boss 房回满（每层一次）；月之石：下层 PP 满', () => {
  const run = createRun(data, 8888);
  run.player.inv.passives = ['sacred-ash', 'moon-stone'];
  const { recompute } = await0_engine();
  recompute(run, data);
  run.player.hp = 1; run.player.pp = 0;
  const bossCell = [...run.map.values()].find((c) => c.type === 'boss');
  enterRoom(run, data, bossCell.x + ',' + bossCell.y);
  assert.equal(run.player.hp, run.player.maxHp, '圣灰回满');
  assert.equal(run.bm.ashUsed, true);
  // 二次进不再回满
  const back = combatNeighborKey(run);
  enterRoom(run, data, back);
  run.player.hp = 1;
  enterRoom(run, data, bossCell.x + ',' + bossCell.y);
  assert.equal(run.player.hp, 1, '每层一次');
  // 月之石：杀 Boss 下层
  const boss = run.enemies.find((e) => e.family === 'boss');
  boss.hp = 0; run.player.iframes = 9;
  run.player.pp = 10;
  rideStairs(run, 300);
  assert.equal(run.floorNo, 2);
  assert.equal(run.player.pp, 100, '月之石 PP 回满');
});

test('电气种子：清房存 3 发连锁，下一战斗房生效；消耗品 buff（沙鳞果移速）', () => {
  const run = createRun(data, 9999);
  run.player.inv.passives = ['electric-seed'];
  const { recompute } = await0_engine();
  recompute(run, data);
  // 清一间战斗房 → pendChain
  const nb = combatNeighborKey(run);
  enterRoom(run, data, nb);
  for (let i = 0; i < 400 && !(run.room.cleared && run.bm.pendChain === 3); i++) {
    if (!run.player.alive) break;
    run.enemies.forEach((e) => { e.hp = 0; });   // 每帧清（第二波会刷新）
    stepRun(run, idleInput(), data);
  }
  assert.equal(run.bm.pendChain, 3, '清房存连锁');
  // 进下一战斗房 → chainLeft=3 → 射击 3 发带 chain
  const nb2 = combatNeighborKey(run);
  enterRoom(run, data, nb2);
  assert.equal(run.player.chainLeft, 3);
  run.player.y = run.enemies[0] ? run.enemies[0].y : 5;
  for (let i = 0; i < 90; i++) stepRun(run, { ...idleInput(), fire: true }, data);
  assert.equal(run.player.chainLeft, 0, '3 发连锁弹打完');
  // 沙鳞果
  run.player.inv.consumable = 'salac-berry';
  const spd = run.player.stats.moveSpeed;
  for (let i = 0; i < 3 && !run.player.buffs.speed; i++) stepRun(run, { ...idleInput(), useEdge: true }, data);
  assert.ok(run.player.buffs.speed > 0, '沙鳞果生效');
  run.player.x = 2; run.player.px = 2;
  stepRun(run, { ...idleInput(), move: { x: 1, y: 0 } }, data);
  assert.ok(run.player.x - 2 > spd * (1 / 60) * 0.9, '移速 ≥ ×1.3（' + (run.player.x - 2).toFixed(3) + ' > ' + (spd / 60).toFixed(3) + '）');
});

test('龙睛果护盾：格挡一次并消耗', () => {
  const run = createRun(data, 1200);
  run.player.inv.consumable = 'lansat-berry';
  run.player.buffs.guard = 0;                // 使用后 10
  const hp0 = run.player.hp;
  for (let i = 0; i < 3 && !run.player.buffs.guard; i++) stepRun(run, { ...idleInput(), useEdge: true }, data);
  assert.ok(run.player.buffs.guard > 0);
  run.player.iframes = 0;
  run.hurtPlayer(2);
  assert.equal(run.player.hp, hp0, '护盾格挡');
  assert.equal(run.player.buffs.guard, 0, '护盾消耗');
  run.player.iframes = 0;
  run.hurtPlayer(2);
  assert.equal(run.player.hp, hp0 - 2, '之后正常受伤');
});

test('凸凸头盔：接触反伤 3 点', () => {
  const run = createRun(data, 1300);
  run.player.inv.passives = ['rocky-helmet'];
  const { recompute } = await0_engine();
  recompute(run, data);
  const nb = combatNeighborKey(run);
  enterRoom(run, data, nb);
  const e = run.enemies[0];
  assert.ok(e, '有敌人');
  e.state = 'active'; e.spawnT = 0;          // 跳过出生态（spawning 免接触）
  e.x = run.player.x; e.y = run.player.y;    // 贴脸触发接触
  e.touchCd = 0; run.player.iframes = 0; run.player.dashActive = false;
  const ehp = e.hp;
  for (let i = 0; i < 5 && ehp === e.hp && e.state !== 'dead'; i++) stepRun(run, idleInput(), data);
  assert.ok(e.hp < ehp || e.state === 'dead', '反伤结算');
});

test('火焰宝珠光环：范围内敌人持续掉血 + 自伤累计', () => {
  const run = createRun(data, 1400);
  run.player.inv.passives = ['flame-orb'];
  const { recompute } = await0_engine();
  recompute(run, data);
  const e0 = { id: 2, eid: 'rattata', name: '小拉达', types: ['normal'], family: 'wanderer',
    radius: 0.4, score: 1, hp: 50, maxHp: 50, touchDmg: 1, speed: 0.01, spdMod: 1,
    x: run.player.x + 1, y: run.player.y, px: 0, py: 0, kx: 0, ky: 0, state: 'active', spawnT: 0,
    flash: 0, touchCd: 99, stun: 0, anim: 'Idle', dir: 0, moving: false, wanderT: 9, wx: 0, wy: 0, shoot: null, shootCd: 0 };
  run.enemies.push(e0);
  e0.touchCd = 999;                            // 别让接触伤害干扰
  for (let i = 0; i < 120 && e0.hp > 40; i++) stepRun(run, idleInput(), data);
  assert.ok(e0.hp <= 40, '光环跳伤（hp=' + e0.hp.toFixed(1) + '）');
});

test('离洞绳：E 传送回出生房', () => {
  const run = createRun(data, 1500);
  run.player.inv.consumable = 'escape-rope';
  const nb = combatNeighborKey(run);
  enterRoom(run, data, nb);
  assert.notEqual(run.cellKey, run.map.get('6,6') ? '6,6' : run.cellKey, '不在出生房');
  for (let i = 0; i < 3 && run.cellKey === nb; i++) stepRun(run, { ...idleInput(), useEdge: true }, data);
  const startCell = [...run.map.values()].find((c) => c.type === 'start');
  assert.equal(run.cellKey, startCell.x + ',' + startCell.y, '回到出生房');
});

test('serialize：bm 路线/计量随档保留', () => {
  const { serializeRun, deserializeRun } = _save;
  const run = createRun(data, 1600);
  run.bm.route = 'blackmarket'; run.bm.bossHurt = true;
  const rt = deserializeRun(data, JSON.parse(JSON.stringify(serializeRun(run))));
  assert.equal(rt.bm.route, 'blackmarket');
  assert.equal(rt.bm.bossHurt, true);
  // 旧档（无 bm 字段）兜底
  const oldSaved = serializeRun(run); delete oldSaved.bm;
  const rt2 = deserializeRun(data, JSON.parse(JSON.stringify(oldSaved)));
  assert.equal(rt2.bm.route, null, '旧档 bm 兜底');
});

function await0_engine() {
  return _engine;
}
// 击杀 Boss 后每帧把玩家挪到楼梯上（idle 输入不会自己走）
function rideStairs(run, frames) {
  for (let i = 0; i < frames; i++) {
    const st = run.pickups.find((k) => k.kind === 'stairs');
    if (st) { run.player.x = st.x; run.player.y = st.y; }
    stepRun(run, idleInput(), data);
  }
}
function combatNeighborKey(run) {
  const cell = run.map.get(run.cellKey);
  for (const [dk] of Object.entries(cell.doors)) {
    const [dx, dy] = dk.split(',').map(Number);
    const nb = run.map.get((cell.x + dx) + ',' + (cell.y + dy));
    if (nb && nb.type === 'combat') return (cell.x + dx) + ',' + (cell.y + dy);
  }
  // 无 combat 邻居：任何邻居
  for (const [dk] of Object.entries(cell.doors)) {
    const [dx, dy] = dk.split(',').map(Number);
    return (cell.x + dx) + ',' + (cell.y + dy);
  }
  return run.cellKey;
}

test('营地结伴三选一：拿一只，其余结伴台座消失', () => {
  const run = createRun(data, 1717);
  const camp = [...run.map.values()].find((c) => c.type === 'camp');
  enterRoom(run, data, camp.x + ',' + camp.y);
  const peds = run.pedestals.filter((d) => d.itemId.startsWith('companion:'));
  assert.equal(peds.length, 3, '营地 3 只');
  const d = peds[0];
  run.player.x = d.x; run.player.y = d.y;
  for (let i = 0; i < 3 && !d.taken; i++) stepRun(run, idleInput(), data);
  assert.equal(d.taken, true, '已结伴');
  assert.ok(run.player.companion, '搭档在');
  assert.ok(peds.every((p) => p.taken), '其余结伴台座全部消失（三选一）');
  assert.ok(run.events.some((e) => e.t === 'choice-vanish'), 'vanish 事件发出');
});
