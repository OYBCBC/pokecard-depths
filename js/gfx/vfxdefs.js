// M8 属性化特效配置：纯数据表（node 可 import 做配置校验）。
// 三层结构：
//   types  按属性的默认弹体行为（纹理名 / 自旋 / 脉动 / 尾迹 / 命中样式 / 混合模式）
//   moves  特型招式覆盖（骨头翻滚、星星自旋、三色球……），缺省回落到招式属性
//   trails 尾迹粒子行为；hitStyles 命中爆发样式
// styleOf(move)：moveId → 样式键；paletteOf(style)：该样式的配色数组。

export const TYPE_FX = {
  fire:     { tex: 'fire',     spin: 0,  pulse: [0.14, 9],  glow: true,  trail: 'ember',   hit: 'fire' },
  water:    { tex: 'water',    spin: 0,  pulse: [0.05, 6],  glow: true,  trail: 'drip',    hit: 'splash' },
  grass:    { tex: 'grass',    spin: 6,  pulse: 0,          glow: true,  trail: 'leaf',    hit: 'leaf' },
  electric: { tex: 'electric', spin: 3,  pulse: 0, jitter: 0.03, glow: true, trail: 'spark', hit: 'zap' },
  psychic:  { tex: 'psychic',  spin: 0,  pulse: [0.10, 6],  glow: true,  trail: 'wisp',    hit: 'ring' },
  ghost:    { tex: 'ghost',    spin: 0,  pulse: [0.20, 4],  glow: true,  trail: 'wisp',    hit: 'wisp' },
  poison:   { tex: 'poison',   spin: 0,  pulse: [0.06, 5],  glow: false, trail: 'bubble',  hit: 'goo' },
  ground:   { tex: 'ground',   spin: 2,  pulse: 0,          glow: false, trail: 'dust',    hit: 'dust' },
  rock:     { tex: 'rock',     spin: 4,  pulse: 0,          glow: false, trail: 'dust',    hit: 'chunk' },
  normal:   { tex: 'normal',   spin: 0,  pulse: [0.05, 7],  glow: true,  trail: 'streak',  hit: 'burst' },
  fighting: { tex: 'fighting', spin: 8,  pulse: 0,          glow: true,  trail: null,      hit: 'impact' },
  flying:   { tex: 'flying',   spin: 9,  pulse: 0,          glow: true,  trail: 'wisp',    hit: 'gust' },
  bug:      { tex: 'bug',      spin: 10, pulse: 0,          glow: true,  trail: 'leaf',    hit: 'leaf' },
  steel:    { tex: 'steel',    spin: 0,  pulse: [0.04, 8],  glow: true,  trail: 'spark',   hit: 'clink' },
  dragon:   { tex: 'dragon',   spin: 0,  pulse: [0.10, 7],  glow: true,  trail: 'ember',   hit: 'fire' },
  fairy:    { tex: 'fairy',    spin: 5,  pulse: [0.08, 6],  glow: true,  trail: 'twinkle', hit: 'ring' },
  ice:      { tex: 'ice',      spin: 2,  pulse: 0,          glow: true,  trail: 'drip',    hit: 'splash' },
  dark:     { tex: 'dark',     spin: 0,  pulse: [0.06, 5],  glow: false, trail: 'wisp',    hit: 'wisp' },
};

// 特型招式：纹理与行为覆盖（zmove 没有弹体，只取配色）
export const MOVE_FX = {
  'swift':       { tex: 'swift', spin: 9, pulse: 0 },
  'bone-club':   { tex: 'bone',  spin: 14, pulse: 0, hit: 'chunk' },
  'tri-attack':  { tex: 'tri',   spin: 7, pulse: 0.05 },
  'hyper-beam':  { tex: 'hyper', spin: 0, pulse: [0.16, 11], trail: 'ember', hit: 'fire' },
  'shadow-ball': { tex: 'ghostball', spin: 0, pulse: [0.22, 4], hit: 'wisp' },
  'splash':      { tex: 'splash', spin: 8, pulse: 0 },
  'lick':        { tex: 'wisp',  spin: 0, pulse: [0.15, 5] },
  'string-shot': { tex: 'silk',  spin: 0, pulse: 0, hit: 'leaf' },
  'sing-note':   { tex: 'note',  spin: 0, pulse: [0.12, 5], trail: 'twinkle', hit: 'ring' },
  'egg-bomb':    { tex: 'egg',   spin: 5, pulse: 0, hit: 'shell' },
};

// 尾迹粒子（池化）：rate 每秒每弹体发射数；grav 重力；rise 额外升力；
// life 寿命秒；flicker=透明度随机闪烁；shrink=淡出时缩小
export const TRAILS = {
  ember:   { rate: 44, spd: 0.5, up: 1.1,  grav: -0.5, life: 0.55, flicker: true,  shrink: true,  colors: ['#ff5a1f', '#ff9a3c', '#ffe66e'] },
  drip:    { rate: 30, spd: 0.3, up: -0.9, grav: 6,    life: 0.5,  shrink: true,  colors: ['#3fa9ff', '#7cc4ff', '#cfeeff'] },
  leaf:    { rate: 20, spd: 0.5, up: 0.4,  grav: 1.2,  life: 0.5,  shrink: true,  colors: ['#7ec850', '#4f8f2e', '#b8e878'] },
  spark:   { rate: 30, spd: 1.2, up: 0.2,  grav: 0,    life: 0.24, flicker: true,  colors: ['#fff36b', '#ffd23c', '#fff8c8'] },
  wisp:    { rate: 24, spd: 0.15, up: 0.7, grav: -0.4, life: 0.8,  shrink: true,  colors: ['#8f7fd8', '#a08fd0', '#c9b8f2'] },
  bubble:  { rate: 14, spd: 0.2, up: 0.8,  grav: -1.2, life: 0.6,  shrink: true,  colors: ['#a868d8', '#d9b8f0'] },
  dust:    { rate: 24, spd: 0.4, up: 0.5,  grav: 2.5,  life: 0.5,  shrink: true,  colors: ['#b09868', '#86663f'] },
  twinkle: { rate: 24, spd: 0.6, up: 0.5,  grav: -0.3, life: 0.5,  flicker: true,  shrink: true,  colors: ['#ffb8e8', '#fff2fa'] },
  streak:  { rate: 20, spd: 0.25, up: 0.1, grav: 0,    life: 0.22, shrink: true,  colors: ['#fff8dc', '#f5e9c8'] },   // 一般系速度残影（电光一闪类）
};

// 命中样式：粒子组（可多组）+ 附加层（ring 地面冲击环 / bolt 电弧 / flash 点光）
// burst 为兜底样式——颜色在 hitFx 里按属性配色覆盖（TYPE_COLORS[moveType]），保证每系命中都有属性识别度
export const HIT_FX = {
  fire:   { parts: [{ n: 10, spd: 3.4, up: 2.2, grav: 4, life: 0.5, colors: ['#ff5a1f', '#ff9a3c'] },
                    { n: 5, spd: 1.6, up: 3.2, grav: 2, life: 0.6, colors: ['#ffe66e'] }],
            flash: ['#ff9a3c', 26, 5] },
  splash: { parts: [{ n: 12, spd: 3.6, up: 3.4, grav: 14, life: 0.55, colors: ['#3fa9ff', '#7cc4ff'] },
                    { n: 3, spd: 2, up: 2, grav: 10, life: 0.5, colors: ['#e8f8ff'] }],
            flash: ['#3fa9ff', 20, 4] },
  leaf:   { parts: [{ n: 9, spd: 3.2, up: 2.4, grav: 7, life: 0.5, colors: ['#7ec850', '#4f8f2e'] }], flash: ['#7ec850', 14, 4] },
  zap:    { parts: [{ n: 7, spd: 3.8, up: 2, grav: 2, life: 0.3, flicker: true, colors: ['#fff36b', '#fff8c8'] }],
            bolt: 2, flash: ['#fff36b', 30, 5] },
  ring:   { parts: [{ n: 8, spd: 2.6, up: 1.8, grav: 1, life: 0.45, colors: ['#ff9fe0', '#ffb8ea'] }],
            ring: ['#ff7fd0', 2.6, 0.4], flash: ['#ff9fe0', 20, 5] },
  wisp:   { parts: [{ n: 9, spd: 1.8, up: 1.6, grav: -1.5, life: 0.7, colors: ['#a08fd0', '#c9b8f2'] }],
            ring: ['#8f7fd8', 1.8, 0.5] },
  goo:    { parts: [{ n: 10, spd: 2.6, up: 2.6, grav: 9, life: 0.55, colors: ['#c882e8', '#a868d8', '#e8ccf8'] }], flash: ['#c882e8', 14, 4] },
  dust:   { parts: [{ n: 11, spd: 2.8, up: 2, grav: 8, life: 0.55, colors: ['#b09868', '#86663f'] }], flash: ['#b09868', 10, 4] },
  chunk:  { parts: [{ n: 10, spd: 3, up: 2.8, grav: 12, life: 0.65, colors: ['#a8a29a', '#6f6a63', '#d0ccc4'] }], flash: ['#a8a29a', 12, 4] },
  impact: { parts: [{ n: 8, spd: 3.6, up: 2.6, grav: 10, life: 0.45, colors: ['#ffb08a', '#e8604a'] },
                    { n: 4, spd: 1.4, up: 3, grav: 5, life: 0.5, colors: ['#fff0c8'] }],
            flash: ['#ffb08a', 18, 4] },
  gust:   { parts: [{ n: 10, spd: 4.2, up: 1.4, grav: 2, life: 0.4, colors: ['#f0faff', '#c8ecff'] }],
            flash: ['#dff2ff', 12, 5] },
  clink:  { parts: [{ n: 8, spd: 3.8, up: 2.4, grav: 8, life: 0.35, flicker: true, colors: ['#f4f9fd', '#c8d4e0'] }],
            flash: ['#f4f9fd', 22, 4] },
  shell:  { parts: [{ n: 10, spd: 3, up: 3, grav: 12, life: 0.6, colors: ['#fdf6e8', '#e8d8b8', '#fffdf4'] }],
            flash: ['#fdf6e8', 14, 4] },
  burst:  { parts: [{ n: 8, spd: 3, up: 2.4, grav: 6, life: 0.4, colors: ['#ffe9a0', '#fff8dc'] }], flash: ['#fff4d8', 12, 4] },   // 有属性信息时颜色按属性覆盖
};

// 命中克制加成：super 追加金色粒子组 / weak 减量（hitFx 处理）
// 弹体主配色（尾迹兜底 / Z 招式爆发 / muzzle 枪口闪）
export const TYPE_COLORS = {
  fire: ['#ff5a1f', '#ff9a3c', '#ffe66e'], water: ['#3fa9ff', '#7cc4ff', '#cfeeff'],
  grass: ['#7ec850', '#4f8f2e', '#b8e878'], electric: ['#ffd23c', '#fff36b', '#fff8c8'],
  psychic: ['#ff7fd0', '#ffb8ea', '#ffe0f4'], ghost: ['#a08fd0', '#c9b8f2', '#efe8ff'],
  poison: ['#a868d8', '#7a4ba8', '#d9b8f0'], ground: ['#b09868', '#86663f'],
  rock: ['#a8a29a', '#6f6a63', '#d0ccc4'], normal: ['#f5e9c8', '#fff8dc'],
  fighting: ['#e8604a', '#ffb08a'], flying: ['#dff2ff', '#9fd8ff'],
  bug: ['#b8e878', '#eaffc8'], steel: ['#c8d4e0', '#f4f9fd'],
  dragon: ['#f0a858', '#ffe0a8', '#7a5af0'], fairy: ['#ffb8e8', '#fff2fa'],
  ice: ['#a8e8f5', '#e8fbff'], dark: ['#8a7aa5', '#5a4a72'],
};

/** moveId → 弹体样式键（特型覆盖优先，回落属性） */
export function styleOf(moveId, moveType) {
  if (moveId && MOVE_FX[moveId]) return moveId;
  if (moveType && TYPE_FX[moveType]) return moveType;
  return 'normal';
}

/** 样式键 → 完整弹体行为（特型合并属性默认） */
export function styleDef(styleKey, moveType) {
  const base = TYPE_FX[moveType || 'normal'] || TYPE_FX.normal;
  const over = MOVE_FX[styleKey];
  return over ? { ...base, ...over } : base;
}

/** 样式键 → 配色（尾迹有专属色表则优先） */
export function paletteOf(styleKey, moveType) {
  const def = styleDef(styleKey, moveType);
  if (def.trail && TRAILS[def.trail]) return TRAILS[def.trail].colors;
  return TYPE_COLORS[moveType || 'normal'] || TYPE_COLORS.normal;
}
