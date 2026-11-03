// 可序列化的种子随机数（mulberry32），与 gym-run / gym-pixel 同实现
export function makeRng(seed) {
  const state = { s: seed >>> 0 };
  return state;
}

export function rngNext(state) {
  state.s = (state.s + 0x6D2B79F5) | 0;
  let t = state.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rngInt(state, n) {
  return Math.floor(rngNext(state) * n);
}
