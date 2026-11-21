// 招式分类与近战横扫回归（M9）：node --test tools/test-moves.mjs
// 数据约束：每个弹道招式都标物攻/特攻/变化 + 近战/远程；近战=物攻且带扇形参数。
// 行为：近战走扇形瞬发判定（扇内全体命中、背后/扇外不中、不生成弹体、击退沿径向）；远程弹道不变。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';
const D = (f) => JSON.parse(readFileSync(join(ROOT, 'js/data', f), 'utf8'));
const { createRun, stepRun } = await import(join(ROOT, 'js/sim/engine.js?v=m9'));

const tc = D('typechart.json'), ed = D('enemies.json'), mv = D('moves.json'), bal = D('balance.json'), itemsDoc = D('items.json');
const fl = D('floors.json');
const data = {
  typechart: tc.chart, enemies: ed.enemies, moves: mv.moves, items: itemsDoc.items,
  itemPools: itemsDoc.poolConfig, balance: bal, waves: fl.floors['1'].waves, floors: fl.floors,
  species: D('species.json').species, floorNo: 1,
};
const IDLE = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: false };
const MELEE = ['bite', 'body-slam', 'bone-club', 'horn-attack', 'karate-chop', 'lick'];

function newRun(species = 'cubone') {
  const run = createRun(data, 20261109, species);
  for (const d of run.pedestals) d.taken = true;     // 出生房技能机台座别干扰
  run.enemies.length = 0;
  run.projectiles.length = 0;
  return run;
}
// 站桩靶（同靶场 makeDummy 形状）：相对玩家 (dx,dy) 放置，100 血、无接触伤害、吃击退
function addDummy(run, dx, dy, eid = 'rattata') {
  const spec = data.enemies[eid], p = run.player;
  const e = {
    id: run.nextId++, eid, name: spec.name, types: spec.types, family: 'tank',
    radius: spec.radius, score: spec.score, spdMod: spec.spdMod,
    hp: 100, maxHp: 100, touchDmg: 0, speed: 0,
    x: p.x + dx, y: p.y + dy, px: p.x + dx, py: p.y + dy, kx: 0, ky: 0,
    state: 'active', spawnT: 0, flash: 0, touchCd: 9, stun: 0,
    anim: 'Idle', dir: 0, moving: false, wanderT: 0, wx: 0, wy: 0,
    shoot: null, shootCd: 9, kbRes: 0,
  };
  run.enemies.push(e);
  return e;
}
const polar = (deg, d) => [Math.cos(deg * Math.PI / 180) * d, Math.sin(deg * Math.PI / 180) * d];

// ---------- 数据约束 ----------
test('每个弹道招式都标了攻防类别与距离类型；Z 招式不标', () => {
  for (const [id, m] of Object.entries(mv.moves)) {
    if (m.kind === 'zmove') {
      assert.equal(m.category, undefined, `${id}：Z 招式不标 category`);
      continue;
    }
    assert.ok(['physical', 'special', 'status'].includes(m.category), `${id}：category=${m.category}`);
    assert.ok(['melee', 'ranged'].includes(m.reach), `${id}：reach=${m.reach}`);
  }
});

test('近战=物攻，且带扇形参数；弹体字段保留（百变怪复制 A 槽仍按弹体发射）', () => {
  const melee = Object.entries(mv.moves).filter(([, m]) => m.reach === 'melee').map(([id]) => id).sort();
  assert.deepEqual(melee, MELEE);
  for (const id of melee) {
    const m = mv.moves[id];
    assert.equal(m.category, 'physical', `${id} 应为物攻`);
    assert.ok(m.sweepR > 0 && m.sweepDeg > 0 && m.sweepDeg <= 180, `${id} 扇形参数 r=${m.sweepR} deg=${m.sweepDeg}`);
    assert.ok(m.speed > 0 && m.range > 0 && m.radius > 0, `${id} 保留弹体字段`);
    assert.ok(!m.enemyShot, `${id} 是玩家招式`);
  }
});

test('所有搭档/替补/技能机招式都已分类', () => {
  const ids = new Set();
  for (const s of Object.values(data.species)) if (s.moveA) ids.add(s.moveA);
  for (const e of Object.values(data.enemies)) if (e.moveA) ids.add(e.moveA);
  for (const it of Object.values(data.items)) if (it.effect && it.effect.tm) ids.add(it.effect.tm);
  for (const id of ids) {
    const m = mv.moves[id];
    assert.ok(m, `${id} 存在`);
    assert.ok(m.category && m.reach, `${id} 已分类`);
  }
});

// ---------- 近战行为 ----------
test('骨棒横扫：扇内两只都中，背后/扇外/够不着的不中，不生成弹体', () => {
  const run = newRun('cubone');
  const m = mv.moves['bone-club'];
  const inL = addDummy(run, ...polar(40, 1.8));        // 扇内（120° 扇 → 半角 60°）
  const inR = addDummy(run, ...polar(-40, 1.8));
  const back = addDummy(run, ...polar(180, 1.6));      // 背后
  const side = addDummy(run, ...polar(100, 1.8));      // 扇外侧面
  const far = addDummy(run, ...polar(0, m.sweepR + 1.5));   // 正前方但够不着
  stepRun(run, { ...IDLE, fire: true }, data);
  assert.ok(inL.hp < 100 && inR.hp < 100, `扇内应命中：${inL.hp} / ${inR.hp}`);
  assert.equal(back.hp, 100, '背后不中');
  assert.equal(side.hp, 100, '扇外不中');
  assert.equal(far.hp, 100, '超出半径不中');
  assert.equal(run.projectiles.filter((b) => b.owner === 'player').length, 0, '近战不生成弹体');
  const sw = run.events.find((ev) => ev.t === 'swing');
  assert.ok(sw, '发出 swing 事件');
  assert.equal(sw.hits, 2);
  assert.equal(sw.moveId, 'bone-club');
  assert.ok(!run.events.some((ev) => ev.t === 'shot'), '近战不发 shot 事件');
  assert.equal(run.stats.shots, 1, '一次挥击记 1');
});

test('贴身重叠的敌人无视角度也会被挥中', () => {
  const run = newRun('cubone');
  const hug = addDummy(run, ...polar(180, 0.3));       // 正背后但重叠
  stepRun(run, { ...IDLE, fire: true }, data);
  assert.ok(hug.hp < 100, '贴身应命中');
});

test('击退沿玩家→敌人径向（不是瞄准方向）', () => {
  const run = newRun('cubone');
  const p = run.player;
  const e = addDummy(run, ...polar(45, 1.6));
  const x0 = e.x, y0 = e.y;
  stepRun(run, { ...IDLE, fire: true }, data);
  const mx = e.x - x0, my = e.y - y0, ml = Math.hypot(mx, my);
  assert.ok(ml > 0, '应被击退');
  const rx = x0 - p.x, ry = y0 - p.y, rl = Math.hypot(rx, ry);
  assert.ok((mx * rx + my * ry) / (ml * rl) > 0.99, '位移方向应与径向一致');
});

test('挥击后进入冷却：紧接一帧不会再挥', () => {
  const run = newRun('cubone');
  const e = addDummy(run, ...polar(0, 1.5));
  stepRun(run, { ...IDLE, fire: true }, data);
  const hp1 = e.hp;
  stepRun(run, { ...IDLE, fire: true }, data);
  assert.equal(e.hp, hp1, '冷却内不重复结算');
  assert.ok(!run.events.some((ev) => ev.t === 'swing'));
});

test('远程不变：皮卡丘电击照常发弹体与 shot 事件', () => {
  const run = newRun('pikachu');
  stepRun(run, { ...IDLE, fire: true }, data);
  assert.ok(run.projectiles.some((b) => b.owner === 'player' && b.moveId === 'thunder-shock'));
  assert.ok(run.events.some((ev) => ev.t === 'shot'));
  assert.ok(!run.events.some((ev) => ev.t === 'swing'));
});

// ---------- 蓄力射线（破坏光线 M12.1：官方描述「蓄力后发射强大的光束，随后必须休息」） ----------
const { recompute } = await import(join(ROOT, 'js/sim/engine.js?v=m12'));

function rayRun(species = 'lucario') {
  const run = newRun(species);
  for (const d of run.pedestals) d.taken = true;
  run.player.inv.passives.push('tm-hyper');          // B 槽=破坏光线
  recompute(run, data);
  run.player.slot = 'B';
  return run;
}

test('破坏光线：按下先蓄力不瞬发（rayCh + ray-charge 事件，无弹体无 ray-fire）', () => {
  const run = rayRun();
  stepRun(run, { ...IDLE, fire: true }, data);
  assert.ok(run.player.rayCh, '应进入蓄力状态');
  assert.equal(run.player.rayCh.moveId, 'hyper-beam');
  assert.ok(Math.abs(run.player.rayCh.t - 0.55) < 1e-9, '蓄力时长 0.55s');
  assert.ok(run.events.some((ev) => ev.t === 'ray-charge'), '发出 ray-charge 事件');
  assert.ok(!run.events.some((ev) => ev.t === 'ray-fire'), '蓄力期不发射');
  assert.equal(run.projectiles.filter((b) => b.owner === 'player').length, 0, '射线不是弹体');
  for (let i = 0; i < 10; i++) stepRun(run, { ...IDLE, fire: true }, data);
  assert.ok(run.player.rayCh && run.player.rayCh.t > 0, '0.17s 时仍在蓄力');
  assert.ok(!run.events.some((ev) => ev.t === 'ray-fire'), '未蓄满不发射');
});

// 蓄满发射驱动：起手一帧 → 泵到 rayCh 清空（发射帧的事件保持在本帧，随后帧会清 events）
function fireRay(run, input) {
  stepRun(run, input, data);
  let guard = 0;
  while (run.player.rayCh && guard++ < 90) stepRun(run, input, data);
  return guard + 1;
}

test('破坏光线：蓄满自动发射——线上全中、线外/背后/超程不中，落长冷却', () => {
  const run = rayRun();
  run.player.x = 1.4; run.player.px = 1.4;     // 靠西墙站位：+10.5 仍在房内且超出射程 9.5
  const onLine = addDummy(run, 3, 0);          // 线上
  const nearEnd = addDummy(run, 9.0, 0.1);     // 射程末端内
  const offLine = addDummy(run, 3, 1.6);       // 线外（横向 1.6 > 半宽 0.55+身位）
  const behind = addDummy(run, -1, 0);         // 背后
  const tooFar = addDummy(run, 10.5, 0);       // 超出射程 9.5（且在房内，不会被墙 clamp 回射程）
  fireRay(run, { ...IDLE, fire: true });
  assert.ok(onLine.hp < 100, `线上应命中（hp=${onLine.hp}）`);
  assert.ok(nearEnd.hp < 100, '射程末端应命中');
  assert.equal(offLine.hp, 100, '线外不中');
  assert.equal(behind.hp, 100, '背后不中');
  assert.equal(tooFar.hp, 100, '超出射程不中');
  const fire = run.events.find((ev) => ev.t === 'ray-fire');
  assert.ok(fire, '发出 ray-fire 事件');
  assert.equal(fire.moveId, 'hyper-beam');
  assert.ok(fire.hits >= 2, `至少线上两只 ${fire.hits}`);
  assert.ok(Math.abs(fire.len - 9.5) < 0.5, `射线长度=${fire.len}`);
  assert.ok(run.player.fireCd > run.player.stats.fireInterval, '发射后落 intervalMul 长冷却');
  assert.ok(onLine.kx > 0, '击退沿射线方向');
  assert.ok(!run.player.rayCh, '发射后蓄力状态清空');
});

test('破坏光线：岩石挡线——岩后敌人不中、射线截断在岩石面前（M12 口径）', () => {
  const run = rayRun();
  run.obstacles.push({ id: run.nextId++, kind: 'rock', x: run.player.x + 2, y: run.player.y, r: 0.55, hp: 0, variant: null, dead: false });
  const before = addDummy(run, 1.2, 0);        // 岩前（截断点 1.67 之前）
  const after = addDummy(run, 3.4, 0);         // 岩后
  fireRay(run, { ...IDLE, fire: true });
  assert.ok(before.hp < 100, '岩前应命中');
  assert.equal(after.hp, 100, '岩后不中');
  const fire = run.events.find((ev) => ev.t === 'ray-fire');
  assert.ok(fire && fire.len < 2.2, `射线被岩石截断（len=${fire && fire.len}）`);
  assert.ok(run.events.some((ev) => ev.t === 'obst-hit' && ev.kind === 'rock'), '岩石受击事件');
});

test('破坏光线：菌泥被碾碎、岩石背后的菌泥不受影响', () => {
  const run = rayRun();
  run.obstacles.push({ id: run.nextId++, kind: 'muck', x: run.player.x + 2, y: run.player.y, r: 0.5, hp: 3, variant: null, dead: false });
  run.obstacles.push({ id: run.nextId++, kind: 'rock', x: run.player.x + 3, y: run.player.y, r: 0.55, hp: 0, variant: null, dead: false });
  run.obstacles.push({ id: run.nextId++, kind: 'muck', x: run.player.x + 4.2, y: run.player.y, r: 0.5, hp: 3, variant: null, dead: false });
  fireRay(run, { ...IDLE, fire: true });
  const mucks = run.obstacles.filter((o) => o.kind === 'muck');
  assert.ok(mucks[0].dead, '岩前菌泥被碾碎');
  assert.ok(!mucks[1].dead, '岩后菌泥不受影响');
});

test('蓄力期间大幅减速（0.35×）；切走招式取消蓄力', () => {
  const charge = rayRun();
  stepRun(charge, { ...IDLE, fire: true }, data);            // 进入蓄力
  const x0 = charge.player.x;
  for (let i = 0; i < 20; i++) stepRun(charge, { move: { x: 1, y: 0 }, aim: { x: 1, y: 0 }, fire: true }, data);
  const dCharge = charge.player.x - x0;

  const base = rayRun();
  base.player.slot = 'A';                                    // 普通招式（不蓄力）
  stepRun(base, { ...IDLE }, data);
  const bx0 = base.player.x;
  for (let i = 0; i < 20; i++) stepRun(base, { move: { x: 1, y: 0 }, aim: { x: 1, y: 0 }, fire: false }, data);
  const dBase = base.player.x - bx0;
  assert.ok(dCharge < dBase * 0.6, `蓄力位移 ${dCharge.toFixed(2)} 应 < 常态 ${dBase.toFixed(2)} ×0.6`);

  const cancel = rayRun();
  stepRun(cancel, { ...IDLE, fire: true }, data);
  assert.ok(cancel.player.rayCh, '蓄力中');
  cancel.player.slot = 'A';                                  // 切回 A 槽
  stepRun(cancel, { ...IDLE }, data);
  assert.equal(cancel.player.rayCh, null, '切走招式取消蓄力');
});
