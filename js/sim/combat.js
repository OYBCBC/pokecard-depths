// 伤害与射击公式（《01 GDD》§8）。纯函数，node 可测。
// 单发伤害 = 特攻 D × (威力/40) × 克制 × STAB × 特防修正 × 暴击
// 特攻成长 D = 3.5 × sqrt(Σ伤害提升×1.2+1) + Σ固定加成（以撒 Repentance 官方式）
// 出招间隔 = (16 − 6×sqrt(1.3T+1) + 1) / 30 秈（T=Σ射击加速值，可负）

export const BASE_DAMAGE = 3.5;

/** 特攻面板（以撒公式）。dmgUps=Σ伤害提升值（+1 道具记 1），flat=Σ固定加值 */
export function damageStat(dmgUps = 0, flat = 0) {
  return BASE_DAMAGE * Math.sqrt(dmgUps * 1.2 + 1) + flat;
}

/** 出招间隔（秒）。tears=Σ射击加速值；软上限 delay=5 ticks（≈5 发/秒，T≈1.82 到顶） */
export function fireInterval(tears = 0) {
  const inner = 1.3 * tears + 1;
  const delayTicks = Math.max(16 - 6 * Math.sqrt(Math.max(inner, 0)), 5);
  return (delayTicks + 1) / 30;
}

/** 克制系数：攻击属性 vs 防守方属性数组（双属性相乘；×4 / ×0.25 / ×0 均可出现） */
export function typeMultiplier(chart, atkType, defTypes) {
  const row = chart[atkType];
  if (!row) return 1;
  let m = 1;
  for (const t of defTypes) m *= (row[t] !== undefined ? row[t] : 1);
  return m;
}

/** STAB：招式属性在攻击方属性表内 → ×stabMul（官方 1.5） */
export function stabMultiplier(moveType, atkTypes, stabMul = 1.5) {
  return atkTypes.includes(moveType) ? stabMul : 1;
}

/** 单发伤害结算。返回 {dmg, mult, kind: 'super'|'normal'|'weak'|'immune'} */
export function computeHit({ D, power, moveType, atkTypes, defTypes, spdMod = 1, critChance = 0, rng01 = 0.5, stabMul = 1.5, chart }) {
  const mult = typeMultiplier(chart, moveType, defTypes);
  const stab = stabMultiplier(moveType, atkTypes, stabMul);
  const crit = rng01 < critChance ? 1.5 : 1;
  const raw = D * (power / 40) * mult * stab * spdMod * crit;
  const dmg = mult === 0 ? 0 : Math.max(raw, 0.1);   // 免疫=0；非免疫保底 0.1
  const kind = mult === 0 ? 'immune' : mult > 1 ? 'super' : mult < 1 ? 'weak' : 'normal';
  return { dmg, mult, kind };
}

/** 敌人种族值 → 房间战面板（换算公式入库便于复算与测试） */
export function enemyPanel(base) {
  const hp = 2 + base.hp / 8;
  const speed = 0.5 + base.spe / 100;
  const spdMod = Math.min(1.4, Math.max(0.6, Math.sqrt(70 / Math.max(base.spd, 1))));
  const touchDmg = (base.atk >= 100 || base.spa >= 100) ? 2 : 1;
  return { hp, speed, spdMod, touchDmg };
}
