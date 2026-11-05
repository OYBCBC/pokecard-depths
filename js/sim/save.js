// 存档系统：任意时刻把 run 序列化成纯 JSON（localStorage 友好）。
// 约定：函数字段（rand/dirOf/hurtPlayer）与数据引用（boss cfg、waves）不序列化，复活时重绑。
import { makeRng, rngNext } from './rng.js?v=m5b';
import { STEP, dirOf, recompute } from './engine.js?v=m5b';
import { hurtPlayer } from './actors.js?v=m5b';

export const SAVE_KEY = 'depths-save';
export const SAVE_VERSION = 1;

/** 序列化（纯数据，JSON 安全）。events 是瞬态不存。 */
export function serializeRun(state) {
  return {
    v: SAVE_VERSION, savedAt: Date.now(),
    seed: state.seed, t: state.t, floorNo: state.floorNo, reverseT: state.reverseT,
    rngS: state.rng.s >>> 0, nextId: state.nextId,
    cellKey: state.cellKey, room: state.room, roomW: state.roomW, roomH: state.roomH,
    difficulty: state.difficulty || 'normal',
    hpMul: state.hpMul, over: state.over, win: state.win,
    map: [...state.map.entries()],                       // [[key, cell], ...] cell 全纯数据
    enemies: state.enemies.map((e) => e.family === 'boss' && e.b
      ? { ...e, b: { ...e.b, cfg: undefined } } : e),
    projectiles: state.projectiles,
    pickups: state.pickups, pedestals: state.pedestals, telegraphs: state.telegraphs,
    player: state.player, stats: state.stats, isDaily: !!state.isDaily,
    bm: state.bm || undefined,                           // 黑市/祭坛路线与计量（M5）
  };
}

/** 反序列化：saved 必须先过 JSON.parse（即经过一轮 stringify 也不丢信息）。 */
export function deserializeRun(data, saved) {
  if (!saved || saved.v !== SAVE_VERSION || !saved.player || !saved.map) return null;
  try {
    const rng = makeRng(saved.rngS);
    const state = {
      v: 4, seed: saved.seed, dt: STEP, t: saved.t, floorNo: saved.floorNo, reverseT: saved.reverseT || 0,
      rng,
      rand: () => rngNext(rng), dirOf, events: [], nextId: saved.nextId,
      map: new Map(saved.map), cellKey: saved.cellKey,
      room: saved.room, roomW: saved.roomW, roomH: saved.roomH,
      enemies: saved.enemies || [], projectiles: saved.projectiles || [],
      pickups: saved.pickups || [], pedestals: saved.pedestals || [], telegraphs: saved.telegraphs || [],
      hpMul: saved.hpMul, waves: data.floors[saved.floorNo].waves,
      difficulty: saved.difficulty || 'normal',
      warnMul: (data.balance.difficulty && data.balance.difficulty[saved.difficulty || 'normal'] || {}).warnMul || 1,
      bossMul: (data.balance.difficulty && data.balance.difficulty[saved.difficulty || 'normal'] || {}).bossMul || 1,
      over: !!saved.over, win: !!saved.win,
        player: saved.player, stats: saved.stats,
      isDaily: !!saved.isDaily,
      bm: saved.bm || { route: null, kind: null, bossHurt: false, auraDebt: 0, ashUsed: false, pendChain: 0 },
      // _data 由 stepRoom 每帧重挂
    };
    state.hurtPlayer = (dmg) => hurtPlayer(state, dmg, data);
    for (const e of state.enemies) {
      if (e.family === 'boss' && e.b) e.b.cfg = data.enemies[e.eid].boss;   // 重绑数据引用
    }
    recompute(state, data);                              // mods/stats 由背包重算
    return state;
  } catch (err) {
    console.warn('存档损坏，已忽略', err);
    return null;
  }
}

/** 存/取/清（localStorage 不可用时静默） */
export const saveStore = {
  write(state) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(serializeRun(state))); return true; }
    catch (e) { return false; }
  },
  read() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  clear() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } },
};

/** 每日种子：yyyymmdd → uint32（同日所有人同图） */
export function dailySeed(d = new Date()) {
  return ((d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()) * 2654435761) >>> 0;
}
