// 模拟层 M1：固定步长、玩家移动、房间边界、八向动画意图。
// 纯数据变换，无 DOM/three 依赖（可在 node 无头跑）。渲染层只读状态做插值。
// 坐标：模拟层 (x, y) 平面，y+ = 南；渲染层映射为 (x, 0, y)。
import { makeRng } from './rng.js?v=m1i';

export const STEP = 1 / 60;
export const ROOM_W = 17;            // 战斗区宽（tile=世界单位）
export const ROOM_H = 11;            // 战斗区高
export const PLAYER_SPEED = 4.2;     // 单位/秒（初值；M2 挂到面板属性 speed）
export const MARGIN = 0.75;          // 与墙的碰撞半径（玩家取 0.75 格身位）

// 图集方向行序（与 SpriteCollab 一致）
export const DIRS = ['Down', 'DownRight', 'Right', 'UpRight', 'Up', 'UpLeft', 'Left', 'DownLeft'];
const DIR_VEC = [
  [0, 1], [Math.SQRT1_2, Math.SQRT1_2], [1, 0], [Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1], [-Math.SQRT1_2, -Math.SQRT1_2], [-1, 0], [-Math.SQRT1_2, Math.SQRT1_2],
];

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function createRun(seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) {
  return {
    v: 1,
    seed,
    rng: makeRng(seed),
    t: 0,
    player: {
      x: ROOM_W / 2, y: ROOM_H / 2 + 1.5,     // 出生点：房间中心偏南
      px: ROOM_W / 2, py: ROOM_H / 2 + 1.5,   // 上一步位置（渲染插值用）
      anim: 'Idle',                            // 渲染层按图集动画推进
      dir: 0,                                  // 方向行索引（DIRS 下标）
      moving: false,
    },
    events: [],
  };
}

// input: {x, y} 归一化移动意图（x+ 右 / y+ 南），无输入传 {x:0, y:0}
export function stepRun(state, input) {
  const p = state.player;
  p.px = p.x;
  p.py = p.y;

  let mx = input.x, my = input.y;
  const len = Math.hypot(mx, my);
  if (len > 1e-4) {
    const k = len > 1 ? 1 / len : 1;          // 允许小幅模拟摇杆，超长归一
    mx *= k; my *= k;
    p.x = clamp(p.x + mx * PLAYER_SPEED * STEP, MARGIN, ROOM_W - MARGIN);
    p.y = clamp(p.y + my * PLAYER_SPEED * STEP, MARGIN, ROOM_H - MARGIN);
    p.moving = true;
    p.anim = 'Walk';
    // 八向量化：取点积最大的方向
    let best = 0, bestDot = -2;
    for (let i = 0; i < 8; i++) {
      const d = mx * DIR_VEC[i][0] + my * DIR_VEC[i][1];
      if (d > bestDot) { bestDot = d; best = i; }
    }
    p.dir = best;
  } else {
    p.moving = false;
    p.anim = 'Idle';
  }

  state.t += STEP;
}
