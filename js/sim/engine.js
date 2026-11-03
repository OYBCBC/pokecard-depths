// 模拟层引擎：楼层状态机。纯数据变换，无 DOM/three（node 可无头跑）。
// 坐标：模拟层 (x, y) 平面，y+ = 南；渲染层映射为 (x, 0, y)。
import { makeRng, rngNext } from './rng.js?v=m3f';
import { genMap } from './genmap.js?v=m3f';
import { applyItems, playerStats } from './items.js?v=m3f';
import { stepPlayer, stepEnemies, stepProjectiles, stepRoom, hurtPlayer, enterRoom } from './actors.js?v=m3f';
import { stepTelegraphs } from './boss.js?v=m3f';

export const STEP = 1 / 60;
export const ROOM_W = 17;
export const ROOM_H = 11;
export const BOSS_W = 24;
export const BOSS_H = 16;
export const DIRS = ['Down', 'DownRight', 'Right', 'UpRight', 'Up', 'UpLeft', 'Left', 'DownLeft'];
const DIR_VEC = [
  [0, 1], [Math.SQRT1_2, Math.SQRT1_2], [1, 0], [Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1], [-Math.SQRT1_2, -Math.SQRT1_2], [-1, 0], [-Math.SQRT1_2, Math.SQRT1_2],
];

function dirOf(vx, vy) {
  let best = 0, bestDot = -2;
  for (let i = 0; i < 8; i++) {
    const d = vx * DIR_VEC[i][0] + vy * DIR_VEC[i][1];
    if (d > bestDot) { bestDot = d; best = i; }
  }
  return best;
}

export function createRun(data, seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) {
  const rng = makeRng(seed);
  const rand = () => rngNext(rng);

  const map = genMap(rand, data.floorNo || 1);
  const cells = new Map(map.cells.map((c) => [c.x + ',' + c.y, c]));

  const state = {
    v: 3, seed, dt: STEP, t: 0, floorNo: data.floorNo || 1,
    rand, dirOf, events: [], nextId: 1,
    map: cells, cellKey: map.start.x + ',' + map.start.y,
    room: null,
    enemies: [], projectiles: [], pickups: [], pedestals: [], telegraphs: [],
    hpMul: data.balance.enemy.hpMul,
    over: false, win: false,
    player: {
      x: ROOM_W / 2, y: ROOM_H / 2 + 1.5, px: ROOM_W / 2, py: ROOM_H / 2 + 1.5,
      hp: data.balance.player.maxHp, maxHp: data.balance.player.maxHp,
      alive: true, deathT: 0,
      anim: 'Idle', dir: 0, moving: false, lastDir: { x: 0, y: 1 },
      iframes: 0, fireCd: 0, moveA: 'thunder-shock', moveB: null, slot: 'A', pp: 0,
      dashActive: false, dashT: 0, dashDir: { x: 0, y: 1 },
      dashCharges: data.balance.player.dashCharges, dashRe: 0,
      money: data.balance.player.startMoney || 5,
      inv: { passives: [], trinket: null, consumable: null, badges: [] },
      mods: null, stats: null,
      lethalGuardUsed: false,
    },
    stats: { kills: 0, dmgDealt: 0, superHits: 0, shots: 0, t0: 0, coins: 0, roomsCleared: 0, items: 0 },
  };
  state.hurtPlayer = (dmg) => hurtPlayer(state, dmg, data);
  recompute(state, data);
  enterRoom(state, data, state.cellKey);
  return state;
}

export function recompute(state, data) {
  const p = state.player;
  p.mods = applyItems(data.items, p.inv);
  p.stats = playerStats(p.mods);
  const newMax = data.balance.player.maxHp + p.mods.maxHpAdd;
  if (newMax > p.maxHp) p.hp += (newMax - p.maxHp);      // 加上限同时回满增加部分
  p.maxHp = newMax;
  p.hp = Math.min(p.hp, p.maxHp);
  // B 槽跟随最新技能机
  p.moveB = p.mods.tm || null;
  if (p.slot === 'B' && (!p.moveB || p.mods.lockB)) p.slot = 'A';
}

// data: { typechart, enemies, moves, items, itemPools, balance, waves, species, floorNo }
export function stepRun(state, input, data) {
  state.events.length = 0;
  state.t += STEP;

  stepPlayer(state, input, data);
  stepEnemies(state, input, data);
  stepProjectiles(state, data);
  stepTelegraphs(state, data);
  stepRoom(state, input, data);
  return state;
}
