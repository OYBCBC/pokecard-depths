// 道具效果系统（纯函数）：背包 → 数值修饰 mods。引擎与测试共用。
import { damageStat, fireInterval } from './combat.js?v=m6a';

export const BASE_MODS = () => ({
  dmgUps: 0, dmgFlat: 0, dmgMul: 1,
  tears: 0, speedAdd: 0,
  rangeMul: 1, shotSpeedMul: 1, shotSpeedAdd: 0, sizeMul: 1,
  crit: 0, pierce: 0, split: false, homing: 0, bounce: 0,
  knockMul: 1, typeMul: {}, superBonus: 0,
  magnet: 0, killHeal: 0, flinch: 0, dodge: 0,
  regenRoom: 0, maxHpAdd: 0, blockChance: 0, hurtResist: 0,
  ppMul: 1, ppCost: 1, lethalGuard: false,
  lockB: false, tm: null,           // tm = B 槽招式 id
  // M5 第二批扩展
  burnChance: 0, poisonChance: 0, freezeChance: 0, slowOnHit: 0,
  auraDps: 0, auraR: 0, auraSelfHurt: 0, toxicSelf: 0,
  retaliate: 0, flyingMul: 1, hitRamp: 0,
  speciesDmgMul: [],                // [{species, mul}] 专属件（进化后 species 变化自动失效）
  enemyShotMul: 1,                  // 金色徽章：普通敌弹减速
  moneyMul: 1, luckAdd: 0, enemyMul: 1, iframesAdd: 0, echoHeal: 0,
  compass: false, bmSlots: 0,
  bossFullHeal: false, floorPp: false, chainShots: 0,
});

/** 背包 → mods。inv = { passives:[], trinket, badges:[] }
 *  ctx = { species, evolved }：专属件/进化奇石的条件上下文（缺省时条件件按已进化=不生效处理）。 */
export function applyItems(items, inv, ctx = {}) {
  const m = BASE_MODS();
  const all = [
    ...inv.passives.map((id) => items[id]).filter(Boolean),
    inv.trinket ? items[inv.trinket] : null,
    ...inv.badges.map((id) => items[id]).filter(Boolean),
  ].filter(Boolean);
  for (const it of all) {
    const e = it.effect || {};
    if (e.dmgUps) m.dmgUps += e.dmgUps;
    if (e.dmgFlat) m.dmgFlat += e.dmgFlat;
    if (e.dmgMul) m.dmgMul *= e.dmgMul;
    if (e.tears) m.tears += e.tears;
    if (e.speedAdd) m.speedAdd += e.speedAdd;
    if (e.maxHp) m.maxHpAdd += e.maxHp;
    if (e.crit) m.crit += e.crit;
    if (e.pierce) m.pierce += e.pierce;
    if (e.split) m.split = true;
    if (e.homing) m.homing = Math.min(0.35, m.homing + e.homing);
    if (e.sizeMul) m.sizeMul *= e.sizeMul;
    if (e.knockMul) m.knockMul *= e.knockMul;
    if (e.superBonus) m.superBonus += e.superBonus;
    if (e.magnet) m.magnet = Math.max(m.magnet, e.magnet);
    if (e.killHeal) m.killHeal += e.killHeal;
    if (e.flinch) m.flinch += e.flinch;
    if (e.dodge) m.dodge = Math.min(0.5, m.dodge + e.dodge);
    if (e.regenRoom) m.regenRoom += e.regenRoom;
    if (e.blockChance) m.blockChance += e.blockChance;
    if (e.hurtResist) m.hurtResist += e.hurtResist;
    if (e.ppMul) m.ppMul *= e.ppMul;
    if (e.ppCost) m.ppCost *= e.ppCost;
    if (e.lethalGuard) m.lethalGuard = true;
    if (e.lockB) m.lockB = true;
    if (e.tm) m.tm = e.tm;
    if (e.typeMul) for (const k of Object.keys(e.typeMul)) {
      m.typeMul[k] = (m.typeMul[k] || 1) * e.typeMul[k];
    }
    // M5 第二批
    if (e.burnChance) m.burnChance += e.burnChance;
    if (e.poisonChance) m.poisonChance += e.poisonChance;
    if (e.freezeChance) m.freezeChance += e.freezeChance;
    if (e.slowOnHit) m.slowOnHit = Math.max(m.slowOnHit, e.slowOnHit);
    if (e.auraDps) m.auraDps += e.auraDps;
    if (e.auraR) m.auraR = Math.max(m.auraR, e.auraR);
    if (e.auraSelfHurt) m.auraSelfHurt += e.auraSelfHurt;
    if (e.toxicSelf) m.toxicSelf = Math.max(m.toxicSelf, e.toxicSelf);
    if (e.retaliate) m.retaliate += e.retaliate;
    if (e.flyingMul) m.flyingMul *= e.flyingMul;
    if (e.hitRamp) m.hitRamp = Math.max(m.hitRamp, e.hitRamp);
    if (e.shotSpeedAdd) m.shotSpeedAdd += e.shotSpeedAdd;
    if (e.enemyShotMul) m.enemyShotMul *= e.enemyShotMul;
    if (e.moneyMul) m.moneyMul *= e.moneyMul;
    if (e.luckAdd) m.luckAdd += e.luckAdd;
    if (e.enemyMul) m.enemyMul *= e.enemyMul;
    if (e.iframesAdd) m.iframesAdd += e.iframesAdd;
    if (e.echoHeal) m.echoHeal = m.echoHeal ? Math.min(m.echoHeal, e.echoHeal) : e.echoHeal;
    if (e.compass) m.compass = true;
    if (e.bmSlots) m.bmSlots += e.bmSlots;
    if (e.bossFullHeal) m.bossFullHeal = true;
    if (e.floorPp) m.floorPp = true;
    if (e.chainShots) m.chainShots += e.chainShots;
    if (e.speciesDmgMul) m.speciesDmgMul.push(e.speciesDmgMul);
    // 进化奇石：未进化才有格挡
    if (e.unevolvedBlock && !ctx.evolved) m.blockChance += e.unevolvedBlock;
  }
  // 专属件：species 匹配才乘（皮卡丘的电气球进化成雷丘后失效——经典梗同款）
  for (const sd of m.speciesDmgMul) {
    if (ctx.species && sd.species === ctx.species) m.dmgMul *= sd.mul;
  }
  return m;
}

/** 当前面板（结算用）。base.moveSpeed = 物种基线移速（缺省 4.2） */
export function playerStats(mods, base = {}) {
  return {
    damage: damageStat(mods.dmgUps, mods.dmgFlat) * mods.dmgMul,
    fireInterval: fireInterval(mods.tears),
    moveSpeed: (base.moveSpeed != null ? base.moveSpeed : 4.2) + mods.speedAdd,
  };
}

/** 抽池：按 poolConfig 权重选一件未拥有的。
 *  opts.learnBy=物种 id → 技能机只出该物种可学的（learn 表，贴正作可学性）。 */
export function rollItem(items, poolConfig, poolName, rand, opts = {}) {
  const weights = poolConfig[poolName] || poolConfig.drop;
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = rand() * total;
  let chosenPool = 'O';
  for (const [k, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) { chosenPool = k; break; }
  }
  const owned = new Set(opts.owned || []);
  const learnable = (it) => !it.effect || !it.effect.tm || !it.learn
    || !opts.learnBy || it.learn.includes(opts.learnBy);
  const cands = Object.entries(items).filter(([id, it]) =>
    it.pools.includes(chosenPool) && !owned.has(id) && learnable(it)
    && (!opts.kinds || opts.kinds.includes(it.kind)));
  if (!cands.length) {
    // 池空：从全部未拥有里兜底
    const all = Object.entries(items).filter(([id, it]) => !owned.has(id));
    return all.length ? all[Math.floor(rand() * all.length)][0] : null;
  }
  // 品质加权：高品质稍稀有（1 / (0.6 + quality*0.35)）
  const qW = cands.map(([, it]) => 1 / (0.6 + it.quality * 0.35));
  const qTotal = qW.reduce((a, b) => a + b, 0);
  let r2 = rand() * qTotal;
  for (let i = 0; i < cands.length; i++) {
    r2 -= qW[i];
    if (r2 <= 0) return cands[i][0];
  }
  return cands[cands.length - 1][0];
}
