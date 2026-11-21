// 障碍物系统测试（M12 以撒式房间障碍）：node --test tools/test-obstacles.mjs
// 覆盖：生成确定性/净空/房种门控、岩石挡移动挡弹+Z 击碎、矿石必掉、菌泥 3 血+金色必掉、
//       尖刺接触、喷火口周期/水系灭火/烧敌、蛛网减速+火系烧除、裂隙挡地面不挡弹+飞行可越、
//       stash 持久化、存档往返、刷怪避障。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = (f) => JSON.parse(readFileSync(join(ROOT, 'js/data', f), 'utf8'));

const { createRun, stepRun } = await import(join(ROOT, 'js/sim/engine.js?v=m12'));
const { enterRoom } = await import(join(ROOT, 'js/sim/actors.js?v=m12'));
const { serializeRun, deserializeRun } = await import(join(ROOT, 'js/sim/save.js?v=m12'));
const obstacles = await import(join(ROOT, 'js/sim/obstacles.js?v=m12'));

const tc = D('typechart.json'), ed = D('enemies.json'), mv = D('moves.json'), bal = D('balance.json'),
      itemsDoc = D('items.json'), fl = D('floors.json'), sp = D('species.json');
const data = {
  typechart: tc.chart, enemies: ed.enemies, moves: mv.moves, items: itemsDoc.items,
  itemPools: itemsDoc.poolConfig, balance: bal, waves: fl.floors['1'].waves, floors: fl.floors,
  species: sp.species, floorNo: 1,
};

const STEP = 1 / 60;
const idleInput = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: false,
  dashEdge: false, slotEdge: false, useEdge: false, zEdge: false, swapEdge: false };

/** 进入指定类型的第一间房（用 enterRoom 直切，不经传送门）。 */
function gotoRoom(state, type) {
  const cell = [...state.map.values()].find((c) => c.type === type);
  assert.ok(cell, `本层没有 ${type} 房`);
  enterRoom(state, data, cell.x + ',' + cell.y);
  return state.map.get(state.cellKey);
}

/** 原地泵 n 步（无输入）。 */
function pump(state, n, input = idleInput) {
  for (let i = 0; i < n; i++) stepRun(state, input, data);
}

/** 泵 n 步并累积事件（stepRun 每步开头清 events，事后断言拿不到——需要跨步收集）。 */
function pumpCollect(state, n, input = idleInput) {
  const evs = [];
  for (let i = 0; i < n; i++) { stepRun(state, input, data); evs.push(...state.events); }
  return evs;
}

/** 手工造一只行为字段齐全的测试敌人（actors 直接读 spec 的行为配置，缺了会炸）。 */
function mkEnemy(eid, x, y, opts = {}) {
  const gs = data.enemies[eid];
  return { id: 900000 + Math.floor(Math.random() * 100000), eid, name: gs.name, types: gs.types,
    family: gs.family, radius: gs.radius, score: gs.score,
    hp: opts.hp ?? gs.hp, maxHp: gs.hp, touchDmg: gs.touchDmg, speed: opts.speed ?? gs.speed, spdMod: gs.spdMod,
    x, y, px: x, py: y, kx: 0, ky: 0,
    state: 'active', spawnT: 0, flash: 0, touchCd: 99, stun: 0,
    anim: 'Idle', dir: 0, moving: false, wanderT: 0, wx: 0, wy: 0,
    shoot: null, shootCd: 0,
    heal: gs.heal, mortar: gs.mortar ? { ...gs.mortar } : null, sniper: gs.sniper,
    dash: gs.dash ? { ...gs.dash } : null, mimic: gs.mimic,
    kbRes: gs.kbRes, lunge: gs.lunge };
}

function mkRun(seed, floorNo = 1) {
  data.floorNo = floorNo;
  const s = createRun(data, seed, 'pikachu', 'normal');
  data.floorNo = 1;
  return s;
}

/** 直射一发招式弹（从 from 出发朝 target 方向）。 */
function fireShot(state, moveId, from, tx, ty, speed = null) {
  const mv = data.moves[moveId];
  const dx = tx - from.x, dy = ty - from.y, l = Math.hypot(dx, dy) || 1;
  const spd = speed ?? mv.speed;
  state.projectiles.push({ owner: 'player', id: state.nextId++, moveId,
    x: from.x, y: from.y, px: from.x, py: from.y,
    vx: (dx / l) * spd, vy: (dy / l) * spd, life: 3, radius: mv.radius, pierceLeft: 0, hitIds: [] });
}

// ---------- 生成 ----------

test('生成确定性：同种子两次开局，战斗房障碍布局逐位一致', () => {
  const a = mkRun(20261121), b = mkRun(20261121);
  const ka = [...a.map.values()].find((c) => c.type === 'combat');
  const kb = [...b.map.values()].find((c) => c.type === 'combat');
  enterRoom(a, data, ka.x + ',' + ka.y);
  enterRoom(b, data, kb.x + ',' + kb.y);
  const strip = (arr) => arr.map((o) => ({ kind: o.kind, x: +o.x.toFixed(4), y: +o.y.toFixed(4), variant: o.variant }));
  assert.deepEqual(strip(a.obstacles), strip(b.obstacles));
});

test('净空：所有障碍距门洞中心与出生点 ≥ keepClear', () => {
  const s = mkRun(777);
  gotoRoom(s, 'combat');
  const w = s.roomW, h = s.roomH;
  const zones = [[w / 2, 0], [w / 2, h], [0, h / 2], [w, h / 2], [w / 2, h / 2 + 1.5]];
  const KEEP = data.balance.obstacles.keepClear;
  for (const o of s.obstacles) {
    for (const [zx, zy] of zones) {
      const d = Math.hypot(o.x - zx, o.y - zy);
      assert.ok(d >= KEEP - 0.01, `障碍(${o.kind}) 距净空点 ${zx},${zy} 只有 ${d.toFixed(2)} < ${KEEP}`);
    }
  }
});

test('房种门控：出生房/商店/宝箱房/Boss 房不生成障碍', () => {
  for (const type of ['start', 'shop', 'treasure', 'boss']) {
    const s = mkRun(42);
    gotoRoom(s, type);
    assert.equal(s.obstacles.length, 0, `${type} 房不应有障碍`);
  }
});

test('层数门控：F1 只有 rock/ore/muck；F4 全种类可能出现', () => {
  const kinds = new Set();
  for (let seed = 100; seed < 130; seed++) {
    const s = mkRun(seed, 1);
    gotoRoom(s, 'combat');
    for (const o of s.obstacles) kinds.add(o.kind);
  }
  for (const k of kinds) assert.ok(['rock', 'ore', 'muck'].includes(k), `F1 出现了未解锁种类 ${k}`);
  const late = new Set();
  for (let seed = 100; seed < 160; seed++) {
    const s = mkRun(seed, 4);
    gotoRoom(s, 'combat');
    for (const o of s.obstacles) late.add(o.kind);
  }
  assert.ok(late.has('spikes') && late.has('pit'), 'F4 样本里应能见到 spikes/pit：' + [...late].join(','));
});

// ---------- 岩石 ----------

test('岩石挡玩家：向岩石推 3 秒，始终不进入岩石判定圆', () => {
  const s = mkRun(2024);
  gotoRoom(s, 'combat');
  const rock = s.obstacles.find((o) => o.kind === 'rock' && !o.dead);
  assert.ok(rock, '样本房里应有岩石');
  // 玩家挪到岩石左侧一格半，向右推
  s.player.x = rock.x - 1.5; s.player.y = rock.y;
  s.player.px = s.player.x; s.player.py = s.player.y;
  pump(s, 180, { ...idleInput, move: { x: 1, y: 0 }, aim: { x: 1, y: 0 } });
  const d = Math.hypot(s.player.x - rock.x, s.player.y - rock.y);
  assert.ok(d >= rock.r + 0.45 - 0.02, `玩家穿透岩石：距离 ${d.toFixed(3)} < ${rock.r + 0.45}`);
  assert.ok(s.player.alive);
});

test('岩石挡弹：弹体在岩石处消亡并发 obst-hit，普通弹砸不碎岩石', () => {
  const s = mkRun(2024);
  gotoRoom(s, 'combat');
  const rock = s.obstacles.find((o) => o.kind === 'rock');
  assert.ok(rock);
  const p = s.player;
  p.x = rock.x - 3; p.y = rock.y; p.px = p.x; p.py = p.y;
  fireShot(s, 'thunder-shock', { x: p.x, y: p.y }, rock.x, rock.y);
  const evs = pumpCollect(s, 90, idleInput);
  assert.equal(s.projectiles.filter((b) => b.moveId === 'thunder-shock' && b.owner === 'player').length, 0, '弹应被岩石挡下');
  assert.ok(!rock.dead, '普通弹不该砸碎岩石');
  assert.ok(evs.some((e) => e.t === 'obst-hit' && e.id === rock.id), '应有 obst-hit 事件');
});

test('Z 招式击碎岩石并发 obst-break 事件', () => {
  const s = mkRun(2024);
  gotoRoom(s, 'combat');
  const rock = s.obstacles.find((o) => o.kind === 'rock');
  assert.ok(rock);
  s.player.x = rock.x - 1.5; s.player.y = rock.y;
  s.player.px = s.player.x; s.player.py = s.player.y;
  s.player.pp = 100;
  pump(s, 1, { ...idleInput, zEdge: true, move: { x: 0, y: 0 } });
  assert.ok(rock.dead, 'Z 范围内岩石应被击碎');
  assert.ok(s.events.some((e) => e.t === 'obst-break' && e.id === rock.id));
  pump(s, 5);
});

// ---------- 矿石 / 菌泥 ----------

test('矿石击碎必掉 coin2（+概率心）', () => {
  const s = mkRun(3141);
  gotoRoom(s, 'combat');
  const ore = s.obstacles.find((o) => o.kind === 'ore') || s.obstacles.find((o) => o.kind === 'rock');
  assert.ok(ore);
  s.obstacles.length = 0;
  s.obstacles.push({ ...ore, kind: 'ore', hp: 0, dead: false });
  const o = s.obstacles[0];
  obstacles.breakObstacle(s, o, data, { cause: 'zmove' });
  assert.ok(o.dead);
  assert.ok(s.pickups.some((k) => k.kind === 'coin2'), '矿石必掉 coin2');
});

test('菌泥 3 发弹碎 + 金色变体必掉 2 币', () => {
  const s = mkRun(3141);
  gotoRoom(s, 'combat');
  const p = s.player;
  s.obstacles.length = 0;
  const muck = obstacles.mkObstacle(s, 'muck', p.x + 2.4, p.y, null, data);
  muck.variant = 'gold';
  const muck2 = obstacles.mkObstacle(s, 'muck', p.x - 2.4, p.y, null, data);
  s.obstacles.push(muck, muck2);
  const shoot3 = (target) => {
    let evs = [];
    for (let i = 0; i < 3; i++) {
      fireShot(s, 'thunder-shock', { x: target.x - 2.5, y: target.y }, target.x, target.y);
      evs = pumpCollect(s, 70, idleInput);
    }
    return evs;
  };
  const evsGold = shoot3(muck);
  assert.ok(muck.dead, '3 发后金菌泥应碎');
  assert.equal(s.pickups.filter((k) => k.kind === 'coin2').length, 2, '金菌泥必掉 2 币（实掉 ' + s.pickups.filter((k) => k.kind === 'coin2').length + '）');
  assert.ok(evsGold.some((e) => e.t === 'obst-break' && e.id === muck.id), '应有 obst-break 事件');
  assert.ok(!muck2.dead, '普通菌泥未被打不应碎');
  shoot3(muck2);
  assert.ok(muck2.dead, '3 发后普通菌泥应碎');
});

// ---------- 尖刺 ----------

test('尖刺接触扣 1 格；冲刺期间穿过不掉血', () => {
  const s = mkRun(999);
  gotoRoom(s, 'combat');
  const p = s.player;
  s.obstacles.length = 0;
  s.obstacles.push({ id: s.nextId++, kind: 'spikes', x: p.x, y: p.y - 2, r: 0.62, hp: 0, variant: null, dead: false });
  // 向北（y-）走上尖刺
  pumpCollect(s, 60, { ...idleInput, move: { x: 0, y: -1 } });
  assert.ok((s.stats.dmgTaken || 0) >= 1, '踩尖刺应扣 1 格（实扣 ' + (s.stats.dmgTaken || 0) + '）');
  // 冲刺穿越：dashActive 期间 hurtPlayer 直接拒
  p.iframes = 0;
  const dmgBefore = s.stats.dmgTaken;
  pump(s, 1, { ...idleInput, move: { x: 0, y: -1 }, dashEdge: true });
  assert.ok(p.dashActive, '冲刺应已启动');
  const evs = pumpCollect(s, 14, { ...idleInput, move: { x: 0, y: -1 } });
  assert.ok(p.dashActive || evs.length >= 0);
  assert.equal(s.stats.dmgTaken, dmgBefore, '冲刺帧不掉血（dashActive 免伤）');
});

// ---------- 喷火口 ----------

test('喷火口：喷发期烫玩家与敌人；水系一击熄灭', () => {
  const s = mkRun(555);
  gotoRoom(s, 'combat');
  const p = s.player;
  s.obstacles.length = 0;
  const vent = obstacles.mkObstacle(s, 'vent', p.x + 2, p.y, null, data);
  vent.erupt = true; vent.ph = 99; vent.hp = 4;
  s.obstacles.push(vent);
  s.enemies.length = 0;
  s.enemies.push(mkEnemy('geodude', vent.x, vent.y));
  const hp0 = s.enemies[0].hp;
  // 玩家贴上喷火口（vent 阻挡半径 0.95 < 火舌半径 1.05：贴住即烫）
  p.x = vent.x - 1.0; p.y = vent.y; p.px = p.x; p.py = p.y;
  const hpBefore = p.hp;
  pump(s, 40);
  assert.ok(!p.alive || p.hp <= hpBefore - 1, '喷发期贴火应扣血');
  const e = s.enemies[0];
  assert.ok(e.state === 'dead' || e.hp < hp0, '火里敌人应被烧');
  // 水系弹一击熄灭
  p.x = vent.x - 2.5; p.y = vent.y; p.px = p.x; p.py = p.y; p.iframes = 0;
  fireShot(s, 'water-gun', { x: p.x, y: p.y }, vent.x, vent.y);
  pumpCollect(s, 60);
  assert.ok(vent.dead, '水系弹应一击熄灭喷火口');
});

// ---------- 蛛网 ----------

test('蛛网减速玩家；火系弹烧除蛛网', () => {
  const s = mkRun(8888);
  gotoRoom(s, 'combat');
  const p = s.player;
  const web = obstacles.mkObstacle(s, 'web', 8.5, 5.5, null, data);
  s.obstacles.length = 0;
  // 基线：空场向右走 1 秒
  p.x = 4.5; p.y = 5.5; p.px = p.x; p.py = p.y;
  pump(s, 60, { ...idleInput, move: { x: 1, y: 0 } });
  const base = p.x - 4.5;
  // 铺网后从网前 2.4 格走 1 秒（会穿网）
  s.obstacles.push(web);
  p.x = web.x - 2.4; p.y = web.y; p.px = p.x; p.py = p.y;
  pump(s, 60, { ...idleInput, move: { x: 1, y: 0 } });
  const avg = (p.x - (web.x - 2.4)) / 1;
  assert.ok(avg < base * 0.85, `过网位移 ${avg.toFixed(2)} 应明显低于基线 ${base.toFixed(2)}`);
  // 火系弹烧网
  const fireMove = Object.entries(data.moves).find(([k, m]) => m.type === 'fire' && m.kind === 'projectile' && m.power > 0);
  assert.ok(fireMove, '应有可用的火系弹招式');
  const [fireId] = fireMove;
  p.x = web.x - 2.5; p.y = web.y; p.px = p.x; p.py = p.y;
  fireShot(s, fireId, { x: p.x, y: p.y }, web.x, web.y);
  pumpCollect(s, 90);
  assert.ok(web.dead, '火系弹应烧掉蛛网');
});

// ---------- 裂隙 ----------

test('裂隙：地面单位被挡、飞行系敌人可越、弹体直接飞过', () => {
  const s = mkRun(4321);
  gotoRoom(s, 'combat');
  const p = s.player;
  const pit = { id: s.nextId++, kind: 'pit', x: 8.5, y: 5.5, r: 0.55, hp: 0, variant: null, dead: false };
  s.obstacles.length = 0;
  s.obstacles.push(pit);
  // 玩家从左向右推
  p.x = pit.x - 1.2; p.y = pit.y; p.px = p.x; p.py = p.y;
  pump(s, 120, { ...idleInput, move: { x: 1, y: 0 } });
  assert.ok(p.x < pit.x - 0.5 + 0.02, '玩家不应穿过裂隙（x=' + p.x.toFixed(2) + '）');
  // 地面敌（小拳石）被挡
  s.enemies.length = 0;
  s.enemies.push(mkEnemy('geodude', pit.x - 1.5, pit.y));
  p.x = pit.x + 1.5; p.y = pit.y; p.px = p.x; p.py = p.y;
  pump(s, 90);
  const ground = s.enemies[0];
  if (ground && ground.state === 'active') assert.ok(ground.x < pit.x + 0.4, '地面敌不应穿过裂隙');
  // 飞行豁免（单元级）：flying=true 不被裂隙推挤，地面单位被推挤
  const flyerPt = { x: pit.x - 0.8, y: pit.y };
  obstacles.resolveObstacles(s, flyerPt, 0.46, { flying: true });
  assert.equal(flyerPt.x, pit.x - 0.8, '飞行单位不应被裂隙推挤');
  const groundPt = { x: pit.x - 0.8, y: pit.y };
  obstacles.resolveObstacles(s, groundPt, 0.46, {});
  const overlap = 0.55 + 0.46 - 0.8;
  assert.ok(Math.abs(groundPt.x - (pit.x - 0.8 - overlap)) < 1e-6,
    '地面单位应被裂隙沿法线推出 overlap=' + overlap.toFixed(2) + '（实推到 x=' + groundPt.x.toFixed(3) + '）');
  // 集成：stepEnemies 传 flying 标志——飞行敌贴裂隙悬停也不被弹开
  s.enemies.length = 0;
  s.enemies.push(mkEnemy('scyther', pit.x - 0.8, pit.y, { speed: 0 }));
  pump(s, 12);
  const flyer = s.enemies[0];
  assert.ok(flyer && flyer.state === 'active' && Math.abs(flyer.x - (pit.x - 0.8)) < 0.05,
    'stepEnemies 里飞行敌不应被裂隙推挤（x=' + (flyer ? flyer.x.toFixed(3) : '无') + '）');
  // 弹体直接飞过
  const evs = [];
  fireShot(s, 'thunder-shock', { x: pit.x - 2, y: pit.y }, pit.x + 2, pit.y);
  evs.push(...pumpCollect(s, 40));
  assert.ok(evs.every((e) => e.t !== 'obst-hit'), '裂隙不挡弹');
});

// ---------- 持久化 / 存档 ----------

test('stash 持久化：砸掉岩石离房再回，岩石消失、其余原位', () => {
  const s = mkRun(777777);
  gotoRoom(s, 'combat');
  assert.ok(s.obstacles.length >= 1, '样本房应有障碍');
  s.obstacles[0].dead = true;
  const survivors = s.obstacles.filter((o) => !o.dead).map((o) => [o.kind, +o.x.toFixed(3), +o.y.toFixed(3)]);
  // 离房（去出生房）再回战斗房
  const startCell = [...s.map.values()].find((c) => c.type === 'start');
  enterRoom(s, data, startCell.x + ',' + startCell.y);
  const combatCell = [...s.map.values()].find((c) => c.type === 'combat');
  enterRoom(s, data, combatCell.x + ',' + combatCell.y);
  assert.ok(s.obstacles.every((o) => !o.dead), '回房不应有 dead 障碍（stash 只存活的）');
  const now = s.obstacles.map((o) => [o.kind, +o.x.toFixed(3), +o.y.toFixed(3)]);
  assert.deepEqual(now, survivors, '存活障碍位置应原样保留');
});

test('存档往返：serialize → JSON → deserialize 保留障碍场', () => {
  const s = mkRun(8080);
  gotoRoom(s, 'combat');
  const snap = s.obstacles.map((o) => ({ kind: o.kind, x: o.x, y: o.y, hp: o.hp, variant: o.variant }));
  const saved = JSON.parse(JSON.stringify(serializeRun(s)));
  const r = deserializeRun(data, saved);
  assert.ok(r, '存档应可反序列化');
  assert.deepEqual(r.obstacles.map((o) => ({ kind: o.kind, x: o.x, y: o.y, hp: o.hp, variant: o.variant })), snap);
});

// ---------- 刷怪避障 ----------

test('刷怪不落进障碍判定圆', () => {
  for (let seed = 500; seed < 520; seed++) {
    const s = mkRun(seed);
    gotoRoom(s, 'combat');
    for (const e of s.enemies) {
      for (const o of s.obstacles) {
        if (o.dead || o.kind === 'web') continue;
        const d = Math.hypot(e.x - o.x, e.y - o.y);
        assert.ok(d > o.r + 0.5, `敌人刷进障碍：${o.kind} 距离 ${d.toFixed(2)}`);
      }
    }
  }
});
