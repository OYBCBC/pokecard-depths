// 模拟层引擎：多层塔状态机。纯数据变换，无 DOM/three（node 可无头跑）。
// 坐标：模拟层 (x, y) 平面，y+ = 南；渲染层映射为 (x, 0, y)。
import { makeRng, rngNext } from './rng.js?v=m6a';
import { genMap } from './genmap.js?v=m6a';
import { applyItems, playerStats } from './items.js?v=m6a';
import { stepPlayer, stepEnemies, stepProjectiles, stepRoom, hurtPlayer, enterRoom } from './actors.js?v=m6a';
import { stepTelegraphs } from './boss.js?v=m6a';

export const STEP = 1 / 60;
export const ROOM_W = 17;
export const ROOM_H = 11;
export const DIRS = ['Down', 'DownRight', 'Right', 'UpRight', 'Up', 'UpLeft', 'Left', 'DownLeft'];
const DIR_VEC = [
  [0, 1], [Math.SQRT1_2, Math.SQRT1_2], [1, 0], [Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1], [-Math.SQRT1_2, -Math.SQRT1_2], [-1, 0], [-Math.SQRT1_2, Math.SQRT1_2],
];

export function dirOf(vx, vy) {
  let best = 0, bestDot = -2;
  for (let i = 0; i < 8; i++) {
    const d = vx * DIR_VEC[i][0] + vy * DIR_VEC[i][1];
    if (d > bestDot) { bestDot = d; best = i; }
  }
  return best;
}

export const MAX_FLOOR = 4;   // F4 晶核之间（梦幻终战）

export function createRun(data, seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0, speciesId = 'pikachu', difficulty = 'normal') {
  const rng = makeRng(seed);
  const rand = () => rngNext(rng);
  const floorNo = data.floorNo || 1;
  const floorCfg = data.floors[floorNo];
  const diff = (data.balance.difficulty && data.balance.difficulty[difficulty]) || data.balance.difficulty.normal;
  // 物种表缺项/旧形状（无物种表）兜底皮卡丘基线
  const spec = (speciesId && data.species[speciesId]) || data.species.pikachu
    || { types: ['electric'], moveA: 'thunder-shock', zmove: 'thunderbolt-z' };
  const baseHp = spec.maxHp || data.balance.player.maxHp;

  const map = genMap(rand, floorNo);
  const cells = new Map(map.cells.map((c) => [c.x + ',' + c.y, c]));

  const state = {
    v: 4, seed, dt: STEP, t: 0, floorNo, reverseT: 0,
    rng,                                        // 序列化用（rand 闭包引用它）
    rand, dirOf, events: [], nextId: 1,
    map: cells, cellKey: map.start.x + ',' + map.start.y,
    room: null, roomW: ROOM_W, roomH: ROOM_H,
    enemies: [], projectiles: [], pickups: [], pedestals: [], telegraphs: [],
    hpMul: floorCfg.hpMul * diff.hpMul, waves: floorCfg.waves,
    difficulty, warnMul: diff.warnMul, bossMul: diff.bossMul,   // 难度三档（《01》§11）
    over: false, win: false,
    player: {
      x: ROOM_W / 2, y: ROOM_H / 2 + 1.5, px: ROOM_W / 2, py: ROOM_H / 2 + 1.5,
      hp: baseHp, maxHp: baseHp, hpPaid: 0,              // hpPaid = 黑市交易支付的亲密度上限
      alive: true, deathT: 0,
      species: (speciesId && data.species[speciesId] && !data.species[speciesId].evolved) ? speciesId : 'pikachu',
      species0: (speciesId && data.species[speciesId] && !data.species[speciesId].evolved) ? speciesId : 'pikachu',   // 开局物种（挑战码用，进化不变）
      types: spec.types,                                 // STAB 用（攻击方属性）
      evolveTo: spec.evolveTo || null,                   // 进化目标（皮卡丘→雷丘；其余 null）
      zmove: spec.zmove || 'thunderbolt-z',
      zmoveEvolved: spec.zmoveEvolved || spec.zmove || 'thunderbolt-z',
      luckBase: spec.luck || 0,                          // 掉落运气（伊布）
      evolved: false,
      anim: 'Idle', dir: 0, moving: false, lastDir: { x: 0, y: 1 },
      iframes: 0, fireCd: 0, moveA: spec.moveA || 'thunder-shock', moveB: null, slot: 'A', pp: 0,
      dashActive: false, dashT: 0, dashDir: { x: 0, y: 1 },
      dashCharges: data.balance.player.dashCharges, dashRe: 0,
      money: data.balance.player.startMoney || 15,
      inv: { passives: [], trinket: null, consumable: null, badges: [] },
      mods: null, stats: null,
      lethalGuardUsed: false,
      companion: null,                                   // 救援营地替补 {eid, name, hp, maxHp, types, moveA}
      activeSide: 'main',                                // main | companion
      buffs: { speed: 0, dmg: 0, guard: 0, contact: 0 }, // 消耗品时限增益（秒）
      hitStreak: 0,                                      // 节拍器连击计数
      chainLeft: 0,                                      // 电气种子：剩余连锁弹数
    },
    bm: {
      route: null,          // 'blackmarket' | 'altar'（进过后锁定的路线，互斥）
      kind: null,           // 本层开放的特殊房（未开放为 null）
      bossHurt: false,      // 本层 Boss 战是否受伤（黑市计量条输入）
      auraDebt: 0,          // 火焰宝珠自伤累计（0.5/两房 → 满 1 扣 1 格）
      ashUsed: false,       // 圣灰：本层是否已用
      pendChain: 0,         // 电气种子：清房待发的连锁弹数
    },
    stats: {
      kills: 0, dmgDealt: 0, superHits: 0, shots: 0, t0: 0, coins: 0, roomsCleared: 0, items: 0, tRun: 0,
      streak: 0, maxStreak: 0,                           // 不受击连杀
      hurtFloors: [],                                    // 受过伤的楼层（无伤一层判定）
      dmgTaken: 0, spent: 0, secrets: 0, camps: 0,
    },
  };
  state.hurtPlayer = (dmg) => hurtPlayer(state, dmg, data);
  recompute(state, data);
  enterRoom(state, data, state.cellKey);
  return state;
}

export function recompute(state, data) {
  const p = state.player;
  p.mods = applyItems(data.items, p.inv, { species: p.species, evolved: p.evolved });
  const spec = (data.species && data.species[p.species]) || {};
  p.stats = playerStats(p.mods, { moveSpeed: spec.moveSpeed });
  if (p.types == null) p.types = spec.types || ['electric'];   // 旧存档兜底
  if (p.evolved) p.stats.damage *= 1.25;                 // 进化面板成长
  const baseHp = spec.maxHp || data.balance.player.maxHp;
  const newMax = baseHp + p.mods.maxHpAdd + (p.evolved ? 2 : 0) - (p.hpPaid || 0);
  if (newMax > p.maxHp) p.hp += (newMax - p.maxHp);
  p.maxHp = newMax;
  p.hp = Math.min(p.hp, p.maxHp);
  p.moveB = p.mods.tm || null;
  if (p.slot === 'B' && (!p.moveB || p.mods.lockB)) p.slot = 'A';
}

// 进入下一层（Boss 房楼梯触发）。保留成长，重置地图。
export function goNextFloor(state, data) {
  const next = state.floorNo + 1;
  if (next > MAX_FLOOR) return false;
  const floorCfg = data.floors[next];
  state.floorNo = next;
  const map = genMap(state.rand, next);
  state.map = new Map(map.cells.map((c) => [c.x + ',' + c.y, c]));

  // ---- 黑市/祭坛检定（《01》§7.4：以撒恶魔/天使房转译）----
  // 计量：基础 1% + 刚打完这层 Boss 战无伤 35% + 这层全程无伤 99%；路线互斥（进过黑市则只出黑市）
  if (!state.bm) state.bm = { route: null, kind: null, bossHurt: false, auraDebt: 0, ashUsed: false, pendChain: 0 };
  const bmIn = state.bm;
  const justDone = next - 1;                             // 刚通关的层号
  const floorNoHit = !(state.stats.hurtFloors || []).includes(justDone);
  const chance = 0.01 + (bmIn.bossHurt ? 0 : 0.35) + (floorNoHit ? 0.99 : 0);
  bmIn.kind = null;
  if (state.rand() < chance && next >= 2) {
    let kind;
    if (bmIn.route) kind = bmIn.route;
    else kind = state.rand() < 0.7 ? 'blackmarket' : 'altar';
    // 把一个剩余死端（普通战斗房）替换为黑市/祭坛
    const replaced = replaceDeadEnd(state.map, kind);
    if (replaced) {
      bmIn.kind = kind;
      state.events.push({ t: 'bm-open', kind, x: replaced.x, y: replaced.y });
    }
  }
  bmIn.bossHurt = false;                                // 新层重新累计
  bmIn.ashUsed = false;
  bmIn.auraDebt = 0;

  state.cellKey = map.start.x + ',' + map.start.y;
  const diff = (data.balance.difficulty && data.balance.difficulty[state.difficulty]) || { hpMul: 1 };
  state.hpMul = floorCfg.hpMul * diff.hpMul;
  state.waves = floorCfg.waves;
  state.enemies.length = 0;
  state.projectiles.length = 0;
  state.pickups.length = 0;
  state.telegraphs.length = 0;
  state.reverseT = 0;
  state.player.lethalGuardUsed = false;                  // 气势披带每层一次
  const heal = 2;
  state.player.hp = Math.min(state.player.maxHp, state.player.hp + heal);
  // 月之石：进新层 PP 回满 + 回 1 格
  if (state.player.mods && state.player.mods.floorPp) {
    state.player.pp = 100;
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + 1);
  }
  if (state.player.companion) state.player.companion.hp = state.player.companion.maxHp;
  state.room = null;                                  // 旧图已弃：跳过 enterRoom 的离房暂存
  enterRoom(state, data, state.cellKey);
  state.events.push({ t: 'floor-next', floor: next, name: floorCfg.name, heal });
  return true;
}

// 死端替换：找一个恰好 1 邻居的普通战斗房改成特殊房（返回该格）
function replaceDeadEnd(map, kind) {
  const N = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const c of map.values()) {
    if (c.type !== 'combat') continue;
    const n = N.filter(([dx, dy]) => map.has((c.x + dx) + ',' + (c.y + dy))).length;
    if (n === 1) {
      c.type = kind;
      return c;
    }
  }
  return null;
}

// data: { typechart, enemies, moves, items, itemPools, balance, waves, floors, species, floorNo }
export function stepRun(state, input, data) {
  state.events.length = 0;
  state.t += STEP;
  if (state.reverseT > 0) state.reverseT -= STEP;

  // 操作反转（娜姿）：移动/瞄准取反
  let move = input.move;
  let aim = input.aim;
  if (state.reverseT > 0) { move = { x: -move.x, y: -move.y }; aim = { x: -aim.x, y: -aim.y }; }

  stepPlayer(state, { ...input, move, aim }, data);
  stepEnemies(state, input, data);
  stepProjectiles(state, data);
  stepTelegraphs(state, data);
  stepRoom(state, input, data);
  return state;
}
