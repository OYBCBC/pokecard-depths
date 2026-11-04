// 成就系统 + 解锁宝可梦（物种泛化）回归测试：node --test tools/test-achv.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b} (±${eps})`);
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = (f) => JSON.parse(readFileSync(join(ROOT, 'js/data', f), 'utf8'));

const { ACHVS, achvApply, metaApply, starterUnlocked, UNLOCK_SPECIES, achvProgress } =
  await import(join(ROOT, 'js/sim/achv.js?v=m4e'));
const { createRun, stepRun } = await import(join(ROOT, 'js/sim/engine.js?v=m4e'));
const { enterRoom, combatNeighborNotNeeded } = await import(join(ROOT, 'js/sim/actors.js?v=m4e'));
const { serializeRun, deserializeRun } = await import(join(ROOT, 'js/sim/save.js?v=m4e'));
const { dexSpecies, dexApply } = await import(join(ROOT, 'js/sim/dex.js?v=m4e'));

const tc = D('typechart.json');
const ed = D('enemies.json');
const itemsRaw = D('items.json');
const bal = D('balance.json');
const fl = D('floors.json');
const data = {
  typechart: tc.chart, enemies: ed.enemies, moves: D('moves.json').moves, balance: bal,
  items: itemsRaw.items, itemPools: itemsRaw.poolConfig,
  waves: fl.floors['1'].waves, floors: fl.floors,
  species: D('species.json').species,
};

const idle = { move: { x: 0, y: 0 }, aim: { x: 0, y: -1 }, fire: false, dashEdge: false, slotEdge: false, useEdge: false, zEdge: false, swapEdge: false };

// ---------- 成就定义 ----------
test('ACHVS：恰好 20 个，id 唯一，3 个带物种解锁', () => {
  assert.equal(ACHVS.length, 20);
  assert.equal(new Set(ACHVS.map((a) => a.id)).size, 20);
  const withUnlock = ACHVS.filter((a) => a.unlock);
  assert.deepEqual(withUnlock.map((a) => a.id).sort(), ['camp-5', 'dex-12', 'no-hurt-floor']);
  assert.deepEqual({ ...UNLOCK_SPECIES }, { 'no-hurt-floor': 'cubone', 'dex-12': 'eevee', 'camp-5': 'poliwhirl' });
});

test('starterUnlocked：皮卡丘默认解锁；三只解锁位由成就控制', () => {
  const empty = new Set();
  assert.equal(starterUnlocked(data.species.pikachu, empty), true);
  assert.equal(starterUnlocked(data.species.eevee, empty), false);
  assert.equal(starterUnlocked(data.species.eevee, new Set(['dex-12'])), true);
  assert.equal(starterUnlocked(data.species.cubone, new Set(['no-hurt-floor'])), true);
  assert.equal(starterUnlocked(data.species.poliwhirl, new Set(['camp-5'])), true);
});

// ---------- 物种泛化 ----------
test('createRun(species)：面板/招式/属性按物种表', () => {
  const pk = createRun(data, 11, 'pikachu');
  assert.equal(pk.player.types.join(','), 'electric');
  assert.equal(pk.player.moveA, 'thunder-shock');
  near(pk.player.maxHp, 6);

  const ev = createRun(data, 11, 'eevee');
  assert.equal(ev.player.types.join(','), 'normal');
  assert.equal(ev.player.moveA, 'swift');
  near(ev.player.stats.moveSpeed, 4.4, 1e-9);
  near(ev.player.luckBase, 0.12);

  const cb = createRun(data, 11, 'cubone');
  near(cb.player.maxHp, 8);
  near(cb.player.stats.moveSpeed, 3.9);
  assert.equal(cb.player.moveA, 'bone-club');
  assert.equal(cb.player.evolveTo, null);

  const pw = createRun(data, 11, 'poliwhirl');
  assert.equal(pw.player.types.join(','), 'water');
  near(pw.player.maxHp, 7);

  // 未知物种兜底皮卡丘；进化形不允许直接开局
  assert.equal(createRun(data, 11, 'no-such').player.moveA, 'thunder-shock');
  assert.equal(createRun(data, 11, 'raichu').player.species, 'pikachu');
});

test('Z 招式走属性克制：卡拉卡拉地震 ×2 打雷电球', () => {
  const run = createRun(data, 42, 'cubone');
  enterRoom(run, data, combatKeyOf(run));
  // 直接摆一只雷电球在脸上
  run.enemies.length = 0;
  const spec = data.enemies.voltorb;
  run.enemies.push({
    id: 900, eid: 'voltorb', name: spec.name, types: spec.types, family: spec.family,
    radius: spec.radius, score: spec.score, hp: 50, maxHp: 50, touchDmg: 1,
    speed: spec.speed, spdMod: spec.spdMod, x: run.player.x + 1, y: run.player.y,
    px: run.player.x + 1, py: run.player.y, kx: 0, ky: 0, state: 'active', spawnT: 0,
    flash: 0, touchCd: 0, stun: 0, anim: 'Idle', dir: 0, moving: false, wanderT: 0, wx: 0, wy: 0, shoot: null, shootCd: 9,
  });
  const hp0 = run.enemies[0].hp;
  run.player.pp = 100;
  stepRun(run, { ...idle, zEdge: true }, data);
  const zv = run.events.find((e) => e.t === 'zmove');
  assert.ok(zv, 'zmove 事件发出');
  assert.equal(zv.id, 'earthquake-z', '卡拉卡拉用地震 Z');
  assert.equal(zv.hits, 1);
  const dealt = hp0 - (run.enemies[0] ? run.enemies[0].hp : 0);
  // 地面 ×2 电系 + STAB 1.5：D=3.5 → 3.5×(220*0.5/40)×2×1.5×spdMod
  const spec2 = data.enemies.voltorb;
  const expect = 3.5 * (220 * 0.5 / 40) * 2 * 1.5 * spec2.spdMod;
  near(dealt, expect, 1e-6);
});

test('进化守卫：伊布吃雷之石不进化也不消耗', () => {
  const run = createRun(data, 43, 'eevee');
  run.player.inv.consumable = 'thunder-stone';
  run.floorNo = 2;
  stepRun(run, { ...idle, useEdge: true }, data);
  assert.equal(run.player.evolved, false, '伊布不进化');
  assert.equal(run.player.inv.consumable, 'thunder-stone', '雷之石未被消耗');
  assert.ok(run.events.some((e) => e.t === 'use-blocked'));
  // 对照：皮卡丘正常进化
  const pk = createRun(data, 43, 'pikachu');
  pk.player.inv.consumable = 'thunder-stone';
  pk.floorNo = 2;
  stepRun(pk, { ...idle, useEdge: true }, data);
  assert.equal(pk.player.evolved, true);
  assert.equal(pk.player.species, 'raichu');
  const ev2 = pk.events.find((e) => e.t === 'evolve');
  assert.equal(ev2.from, '皮卡丘');
  assert.equal(ev2.name, '雷丘');
});

test('存档兼容：伊布局序列化往返保物种/属性/招式', () => {
  const run = createRun(data, 77, 'eevee');
  const saved = JSON.parse(JSON.stringify(serializeRun(run)));
  const back = deserializeRun(data, saved);
  assert.ok(back);
  assert.equal(back.player.species, 'eevee');
  assert.deepEqual(back.player.types, ['normal']);
  assert.equal(back.player.moveA, 'swift');
  near(back.player.luckBase, 0.12);
});

// ---------- 连杀/无伤层统计 ----------
test('连杀统计：击杀累加、受击清零', () => {
  const run = createRun(data, 8);
  run.stats.streak = 5; run.stats.maxStreak = 5;
  run.events.length = 0;
  // 直接构造一次击杀：放两只残血敌在弹道上
  enterRoom(run, data, combatKeyOf(run));
  for (const e of run.enemies) { e.hp = 0.01; e.state = 'active'; }
  const fire = { ...idle, fire: true, aim: { x: 1, y: 0 } };
  for (let i = 0; i < 240 && run.stats.kills === 0; i++) stepRun(run, fire, data);
  assert.ok(run.stats.kills > 0, '有击杀');
  assert.ok(run.stats.streak >= 1 && run.stats.maxStreak >= 1);
  // 受击清零
  run.stats.streak = 9;
  run.player.iframes = 0;
  run.hurtPlayer(1);
  assert.equal(run.stats.streak, 0, '受击断连杀');
  assert.ok(run.stats.hurtFloors.includes(1), '楼层记入受伤表');
});

// ---------- achvApply ----------
test('achvApply：馆主击杀/无伤层/搭档之力', () => {
  const run = createRun(data, 100);
  run.player.companion = { eid: 'poliwag', name: '蚊香蝌蚪', hp: 3, maxHp: 4 };
  const r = achvApply(new Set(), {}, { run, events: [{ t: 'boss-clear', floor: 1 }] });
  assert.deepEqual([...r.set].sort(), ['companion-win', 'first-brock', 'no-hurt-floor'].sort());
  // 受过伤的同层不再给无伤成就
  const run2 = createRun(data, 100);
  run2.stats.hurtFloors = [1];
  const r2 = achvApply(new Set(), {}, { run: run2, events: [{ t: 'boss-clear', floor: 1 }] });
  assert.equal(r2.set.has('no-hurt-floor'), false);
  // 有替补但已在集合 → 不重复
  const r3 = achvApply(r.set, r.meta, { run, events: [{ t: 'boss-clear', floor: 1 }] });
  assert.deepEqual([...r3.set], [...r.set]);
  assert.equal(r3.unlocked.length, 0);
});

test('achvApply：通关/硬核/每日', () => {
  const run = createRun(data, 101);
  run.isDaily = true; run.win = true;
  const r = achvApply(new Set(), {}, { run, events: [{ t: 'floor-clear' }] });
  for (const id of ['champion', 'no-passive-win', 'daily-done']) assert.equal(r.set.has(id), true, id);
  assert.equal(r.meta.runs, 1, '局数 +1');
  // 带被动道具通关不给硬核
  const run2 = createRun(data, 101);
  run2.player.inv.passives = ['magnet'];
  const r2 = achvApply(new Set(), {}, { run: run2, events: [{ t: 'floor-clear' }] });
  assert.equal(r2.set.has('no-passive-win'), false);
});

test('metaApply：局数只记一次（同 run 快照重复结算不重复计数）', () => {
  const run = createRun(data, 102);
  run.seed = 555; run.t = 10;
  let m = metaApply({}, [{ t: 'player-die' }], run);
  assert.equal(m.runs, 1); assert.equal(m.deaths, 1);
  m = metaApply(m, [{ t: 'player-die' }], run);                    // 同一快照重放（重复消费场景）
  assert.equal(m.runs, 1, '同 seed+时刻戳去重');
  m = metaApply(m, [{ t: 'player-die' }], { ...run, seed: 556 });
  assert.equal(m.runs, 2, '新局才 +1');
});

test('achvApply：累计类（击倒/局数/结伴/隐藏房/进化/Z 清场）', () => {
  let set = new Set(), meta = {};
  // 击倒 300
  meta.kills = 299;
  let r = achvApply(set, meta, { events: [{ t: 'enemy-die', eid: 'rattata' }] });
  assert.equal(r.set.has('kills-300'), true);
  set = r.set; meta = r.meta;
  // 25 局
  meta.runs = 25;
  r = achvApply(set, meta, { events: [] });
  assert.equal(r.set.has('runs-25'), true);
  set = r.set; meta = r.meta;
  // 结伴 5 次 → camp-5（解锁蚊香君）
  meta.companions = 4;
  r = achvApply(set, meta, { events: [{ t: 'companion-join', eid: 'eevee', name: '伊布' }] });
  assert.equal(r.set.has('camp-5'), true);
  assert.equal(r.meta.companions, 5);
  // 隐藏房 1 → secret-1；10 → secret-10（跨多次调用累计）
  set = r.set; meta = r.meta;
  meta.secretRooms = 9;
  r = achvApply(set, meta, { events: [{ t: 'room-enter', type: 'secret', cell: '1,1' }] });
  assert.equal(r.set.has('secret-1'), true);
  assert.equal(r.set.has('secret-10'), true);
  assert.equal(r.meta.secretRooms, 10);
  // 进化 3 次
  set = r.set; meta = r.meta;
  meta.evolves = 2;
  r = achvApply(set, meta, { events: [{ t: 'evolve', to: 'raichu' }] });
  assert.equal(r.set.has('evolve-1'), true);
  assert.equal(r.set.has('evolve-3'), true);
  // Z 清场
  set = r.set;
  r = achvApply(set, r.meta, { events: [{ t: 'zmove', hits: 5 }] });
  assert.equal(r.set.has('zmove-room'), true);
  assert.equal(achvApply(set, r.meta, { events: [{ t: 'zmove', hits: 4 }] }).set.has('zmove-room'), false, '4 只不算');
});

test('achvApply：图鉴类（12 种 / 全收录）', () => {
  const r1 = achvApply(new Set(), {}, { events: [], dexCount: 12, dexTotal: 26 });
  assert.equal(r1.set.has('dex-12'), true);
  assert.equal(r1.set.has('dex-all'), false);
  const r2 = achvApply(new Set(), {}, { events: [], dexCount: 26, dexTotal: 26 });
  assert.equal(r2.set.has('dex-all'), true);
});

test('achvApply：连杀 15 / 单局 10 道具（读 run.stats）', () => {
  const run = createRun(data, 103);
  run.stats.maxStreak = 15; run.stats.items = 10;
  const r = achvApply(new Set(), {}, { run, events: [{ t: 'enemy-die' }, { t: 'item-take' }] });
  assert.equal(r.set.has('streak-15'), true);
  assert.equal(r.set.has('items-10'), true);
});

test('achvProgress：进度条数值', () => {
  assert.deepEqual(achvProgress('kills-300', { meta: { kills: 120 } }), { cur: 120, need: 300 });
  assert.deepEqual(achvProgress('dex-12', { dexCount: 7, dexTotal: 26 }), { cur: 7, need: 12 });
  assert.equal(achvProgress('first-brock', {}), null);
});

// ---------- 图鉴联动 ----------
test('dexSpecies：解锁伙伴入图鉴（eevee/cubone/poliwhirl）', () => {
  const list = dexSpecies(data);
  const ids = list.map((s) => s.eid);
  for (const e of ['eevee', 'cubone', 'poliwhirl', 'pikachu', 'raichu']) assert.ok(ids.includes(e), e);
  const st = dexApply({}, [{ t: 'dex-seen', eid: 'eevee' }]);
  assert.equal(st.dex.eevee.seen, 1);
});

// ---------- 工具 ----------
function combatKeyOf(run) {
  const cell = run.map.get(run.cellKey);
  for (const [dk] of Object.entries(cell.doors)) {
    const [dx, dy] = dk.split(',').map(Number);
    const nb = run.map.get((cell.x + dx) + ',' + (cell.y + dy));
    if (nb && nb.type === 'combat') return (cell.x + dx) + ',' + (cell.y + dy);
  }
  return run.cellKey;
}
