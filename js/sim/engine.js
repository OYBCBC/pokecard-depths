// 模拟层引擎：固定步长主状态机。纯数据变换，无 DOM/three（node 可无头跑）。
// 坐标：模拟层 (x, y) 平面，y+ = 南；渲染层映射为 (x, 0, y)。
import { makeRng, rngNext } from './rng.js?v=m2d';
import { stepPlayer, stepEnemies, stepProjectiles, stepRoom, spawnWave } from './actors.js?v=m2d';

export const STEP = 1 / 60;
export const ROOM_W = 17;
export const ROOM_H = 11;
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

// data: { typechart, enemies, moves, balance, waves, species:{player:{types:['electric']}} }
export function createRun(data, seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) {
  const rng = makeRng(seed);
  const state = {
    v: 2, seed, dt: STEP, t: 0,
    rand: () => rngNext(rng),
    roomW: ROOM_W, roomH: ROOM_H, dirOf,
    events: [], nextId: 1,
    hpMul: data.balance.enemy.hpMul,
    player: {
      x: ROOM_W / 2, y: ROOM_H / 2 + 1.5, px: ROOM_W / 2, py: ROOM_H / 2 + 1.5,
      hp: data.balance.player.maxHp, maxHp: data.balance.player.maxHp,
      alive: true, deathT: 0,
      anim: 'Idle', dir: 0, moving: false, lastDir: { x: 0, y: 1 },
      iframes: 0, fireCd: 0, moveId: 'thunder-shock', pp: 0,
      dashActive: false, dashT: 0, dashDir: { x: 0, y: 1 },
      dashCharges: data.balance.player.dashCharges, dashRe: 0,
    },
    enemies: [], projectiles: [],
    room: { n: 1, waveIdx: 0, state: 'combat', clearT: 0 },
    stats: { kills: 0, dmgDealt: 0, superHits: 0, shots: 0, t0: 0 },
  };
  spawnWave(state, data);
  return state;
}

// input: { move:{x,y}, aim:{x,y}(世界方向), fire:bool, dashEdge:bool }
export function stepRun(state, input, data) {
  state.events.length = 0;
  state.t += STEP;

  stepPlayer(state, input, data);
  stepEnemies(state, input, data);
  stepProjectiles(state, data);
  stepRoom(state, input, data);
  return state;
}
