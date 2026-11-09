// 伙伴系统回归：物种专属默认攻击 / Z 招式与 PP 按上场侧独立 / 技能机归上场侧 / Q 切槽门槛
// node --test tools/test-companion.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';
const D = (f) => JSON.parse(readFileSync(join(ROOT, 'js/data', f), 'utf8'));
const { createRun, stepRun, STEP } = await import(join(ROOT, 'js/sim/engine.js?v=m7b'));

const tc = D('typechart.json'), ed = D('enemies.json'), mv = D('moves.json'), bal = D('balance.json'), itemsDoc = D('items.json');
const fl = D('floors.json');
const data = {
  typechart: tc.chart, enemies: ed.enemies, moves: mv.moves, items: itemsDoc.items,
  itemPools: itemsDoc.poolConfig, balance: bal, waves: fl.floors['1'].waves, floors: fl.floors,
  species: D('species.json').species, floorNo: 1,
};

const IDLE = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: false };

function newRun() {
  const run = createRun(data, 20261107);
  // 出生房保底技能机台座别干扰：标 taken
  for (const d of run.pedestals) d.taken = true;
  return run;
}
// 在玩家脚下放一个免费台座，走一步触发拾取
function stepPedestal(run, itemId) {
  const p = run.player;
  run.pedestals.push({ id: run.nextId++, itemId, price: 0, x: p.x, y: p.y, taken: false });
  stepRun(run, { ...IDLE }, data);
}
// 泵 n 帧空步（跨射击冷却用）
function pump(run, n) {
  for (let i = 0; i < n; i++) stepRun(run, { ...IDLE }, data);
}

test('结伴：物种专属 moveA/zmove，B 槽与 PP 初始为空', () => {
  const run = newRun();
  stepPedestal(run, 'companion:poliwag');
  const c = run.player.companion;
  assert.ok(c, '结伴成功');
  assert.equal(c.moveA, 'bubble');
  assert.equal(c.zmove, 'hydro-pump-z');
  assert.equal(c.moveB, null);
  assert.equal(c.tmItem, null);
  assert.equal(c.pp, 0);
  assert.ok(data.moves[c.moveA].power > 0, '伙伴招式必须是玩家可用版（威力>0）');
});

test('换人后 A 槽弹型随上场侧切换（不再用主伙伴的招式）', () => {
  const run = newRun();
  stepPedestal(run, 'companion:poliwag');
  const p = run.player;
  // 主力开火
  stepRun(run, { ...IDLE, fire: true }, data);
  assert.equal(run.projectiles.some((b) => b.owner === 'player' && b.moveId === p.moveA), true);
  pump(run, 60);                                   // 跨过射击冷却
  // F 换替补再开火 → 应为替补自己的招式
  stepRun(run, { ...IDLE, swapEdge: true }, data);
  assert.equal(p.activeSide, 'companion');
  stepRun(run, { ...IDLE, fire: true }, data);
  assert.equal(run.projectiles.some((b) => b.owner === 'player' && b.moveId === 'bubble'), true);
  assert.equal(run.projectiles.some((b) => b.owner === 'player' && b.moveId === p.moveA), false);
});

test('Z 招式独立：替补放自己的 Z、烧自己的 PP，主力条不动', () => {
  const run = newRun();
  stepPedestal(run, 'companion:poliwag');
  const p = run.player, c = p.companion;
  stepRun(run, { ...IDLE, swapEdge: true }, data);
  c.pp = 100; p.pp = 10;
  stepRun(run, { ...IDLE, zEdge: true }, data);
  const zev = run.events.find((e) => e.t === 'zmove');
  assert.ok(zev, 'Z 事件存在');
  assert.equal(zev.id, 'hydro-pump-z', '放的是替补自己的 Z');
  assert.equal(c.pp, 0, '烧替补 PP');
  assert.equal(p.pp, 10, '主力 PP 不动');
  // 反向：主力放自己的 Z
  stepRun(run, { ...IDLE, swapEdge: true }, data);
  p.pp = 100; c.pp = 5;
  stepRun(run, { ...IDLE, zEdge: true }, data);
  const zev2 = run.events.find((e) => e.t === 'zmove');
  assert.equal(zev2.id, 'thunderbolt-z');
  assert.equal(p.pp, 0);
  assert.equal(c.pp, 5);
});

test('技能机归上场侧：替补捡的进替补 B 槽，与主力互不共用', () => {
  const run = newRun();
  stepPedestal(run, 'companion:poliwag');
  const p = run.player, c = p.companion;
  stepRun(run, { ...IDLE, swapEdge: true }, data);
  // 替补捡第一台
  stepPedestal(run, 'tm-grass');
  assert.equal(c.moveB, 'grass-knot');
  assert.equal(c.tmItem, 'tm-grass');
  assert.equal(p.inv.passives.some((id) => id === 'tm-grass'), false, '不进主力背包');
  // 替补换一台 → tm-replace(side:companion)
  stepPedestal(run, 'tm-tri');
  assert.equal(c.moveB, 'tri-attack');
  const rep = run.events.find((e) => e.t === 'tm-replace');
  assert.ok(rep && rep.side === 'companion');
  // 换回主力捡 → 主力自己的 B 槽，替补的保留
  stepRun(run, { ...IDLE, swapEdge: true }, data);
  stepPedestal(run, 'tm-water');
  assert.equal(p.moveB, 'water-gun');
  assert.equal(c.moveB, 'tri-attack', '替补技能机不被主力覆盖');
});

test('Q 切槽门槛看上场侧自己的 B 槽', () => {
  const run = newRun();
  stepPedestal(run, 'companion:poliwag');
  const p = run.player, c = p.companion;
  stepRun(run, { ...IDLE, swapEdge: true }, data);
  assert.equal(p.activeSide, 'companion');
  // 替补没技能机：Q 从 A 切不动
  stepRun(run, { ...IDLE, slotEdge: true }, data);
  assert.equal(p.slot, 'A');
  // 给替补一台后可切入 B
  stepPedestal(run, 'tm-grass');
  stepRun(run, { ...IDLE, slotEdge: true }, data);
  assert.equal(p.slot, 'B');
  stepRun(run, { ...IDLE, fire: true }, data);
  assert.equal(run.projectiles.some((b) => b.owner === 'player' && b.moveId === 'grass-knot'), true, 'B 槽打替补自己的技能机');
});
