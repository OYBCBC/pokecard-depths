// 模拟层引擎：多层塔状态机。纯数据变换，无 DOM/three（node 可无头跑）。
// 坐标：模拟层 (x, y) 平面，y+ = 南；渲染层映射为 (x, 0, y)。
import { makeRng, rngNext } from './rng.js?v=m4g';
import { genMap } from './genmap.js?v=m4g';
import { applyItems, playerStats } from './items.js?v=m4g';
import { stepPlayer, stepEnemies, stepProjectiles, stepRoom, hurtPlayer, enterRoom } from './actors.js?v=m4g';
import { stepTelegraphs } from './boss.js?v=m4g';

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

export const MAX_FLOOR = 3;

export function createRun(data, seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0, speciesId = 'pikachu') {
  const rng = makeRng(seed);
  const rand = () => rngNext(rng);
  const floorNo = data.floorNo || 1;
  const floorCfg = data.floors[floorNo];
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
    hpMul: floorCfg.hpMul, waves: floorCfg.waves,
    over: false, win: false,
    player: {
      x: ROOM_W / 2, y: ROOM_H / 2 + 1.5, px: ROOM_W / 2, py: ROOM_H / 2 + 1.5,
      hp: baseHp, maxHp: baseHp,
      alive: true, deathT: 0,
      species: (speciesId && data.species[speciesId] && !data.species[speciesId].evolved) ? speciesId : 'pikachu',
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
  p.mods = applyItems(data.items, p.inv);
  const spec = (data.species && data.species[p.species]) || {};
  p.stats = playerStats(p.mods, { moveSpeed: spec.moveSpeed });
  if (p.types == null) p.types = spec.types || ['electric'];   // 旧存档兜底
  if (p.evolved) p.stats.damage *= 1.25;                 // 进化面板成长
  const baseHp = spec.maxHp || data.balance.player.maxHp;
  const newMax = baseHp + p.mods.maxHpAdd + (p.evolved ? 2 : 0);
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
  state.cellKey = map.start.x + ',' + map.start.y;
  state.hpMul = floorCfg.hpMul;
  state.waves = floorCfg.waves;
  state.enemies.length = 0;
  state.projectiles.length = 0;
  state.pickups.length = 0;
  state.telegraphs.length = 0;
  state.reverseT = 0;
  state.player.lethalGuardUsed = false;                  // 气势披带每层一次
  const heal = 2;
  state.player.hp = Math.min(state.player.maxHp, state.player.hp + heal);
  if (state.player.companion) state.player.companion.hp = state.player.companion.maxHp;
  state.room = null;                                  // 旧图已弃：跳过 enterRoom 的离房暂存
  enterRoom(state, data, state.cellKey);
  state.events.push({ t: 'floor-next', floor: next, name: floorCfg.name, heal });
  return true;
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
