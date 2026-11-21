// 障碍物系统（M12）：以撒式房间障碍——岩石/发光矿石/菌泥堆/尖刺/喷火口/蛛网/晶穴裂隙。
// 纯数据变换 + 注入 rand（同种子逐位一致），node 可无头测。
//
// 规格（参照以撒 Rock/Tinted Rock/Poop/Spikes/Fire Place/Cobweb/Pit 的转译）：
//   仅战斗房/挑战房生成；格点布点 + 抖动；门口与出生点 KEEP 半径必空（不卡门不卡出生）；
//   离房 stash 持久化（拆了就没了——进 actors.enterRoom）；
//   rock/ore 挡移动挡弹，只有 Z 招式能碎（ore 必掉奖励）；
//   muck 3 血，弹/近战可碎，概率掉落（金色变体必掉 2 币）；
//   spikes 不挡路不挡弹，接触扣 1；vent 周期喷火敌我都烧，水系弹一击熄灭；
//   web 不挡路，玩家黏滞减速，火系弹/Z 烧除；pit 挡地面单位，弹可越过，飞行系敌人可越。
// 全部数值在 balance.json 的 obstacles 块（热更不动代码）。
// 循环导入说明：actors.js ↔ 本模块（engine↔actors 已有先例）——只在调用期引用，模块初始化不触碰。

import { killEnemy } from './actors.js?v=m9d';

const DEFAULTS = {
  rooms: ['combat', 'challenge'],
  baseChance: 0.75,
  countBase: 3, countVar: 3, countPerFloor: 0.5,
  spacing: 2.1,
  keepClear: 2.6,
  table: [['rock', 56], ['ore', 6], ['muck', 16], ['spikes', 8], ['vent', 6], ['web', 6], ['pit', 8]],
  minFloor: { spikes: 2, vent: 2, web: 3, pit: 3 },
  rock: { r: 0.55 },
  ore: { r: 0.55 },
  muck: { r: 0.5, hp: 3, goldChance: 0.18, dropChance: 0.4 },
  spikes: { r: 0.62, dmg: 1 },
  vent: { r: 0.5, hp: 4, idle: 1.7, erupt: 0.9, enemyDmg: 2, enemyTick: 0.6 },
  web: { r: 0.7, slow: 0.45 },
  pit: { r: 0.55 },
};

function cfgOf(data) {
  const cfg = (data && data.balance && data.balance.obstacles) || {};
  return { ...DEFAULTS, ...cfg };
}

function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

/** 生成一间房的障碍场（首进调用；重进走 stash 恢复）。返回数组（可为空）。 */
export function genObstacles(state, data, cell) {
  const cfg = cfgOf(data);
  if (!cfg.rooms.includes(cell.type)) return [];
  const [w, h] = [state.roomW, state.roomH];
  if (state.rand() >= cfg.baseChance) return [];

  // 目标数量：基础 + 随机浮动 + 层深爬升
  const target = Math.max(1, Math.round(cfg.countBase + state.rand() * cfg.countVar
    + (state.floorNo - 1) * (cfg.countPerFloor)));

  // 净空区：门洞中心（含锁门/裂缝门/隐藏门——门侧永远要留冲刺/走路通道）+ 出生点
  const KEEP2 = cfg.keepClear * cfg.keepClear;
  const zones = [[w / 2, h / 2 + 1.5]];        // 出生房中心偏南（enterRoom 出生位）
  for (const dkey of Object.keys(cell.doors || {})) {
    const [dx, dy] = dkey.split(',').map(Number);
    if (dy === -1) zones.push([w / 2, 0]);
    else if (dy === 1) zones.push([w / 2, h]);
    else if (dx === -1) zones.push([0, h / 2]);
    else zones.push([w, h / 2]);
  }

  // 格点候选（内圈 3.2 起步）+ 抖动，洗牌后依次取够 target 个
  const spots = [];
  for (let gx = 3.2; gx <= w - 3.19; gx += cfg.spacing) {
    for (let gy = 3.2; gy <= h - 3.19; gy += cfg.spacing) {
      spots.push([gx + (state.rand() - 0.5) * 0.5, gy + (state.rand() - 0.5) * 0.5]);
    }
  }
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(state.rand() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }

  // 该层可选种类表（minFloor 过滤）
  const table = (cfg.table || DEFAULTS.table).filter(([kind]) => (cfg.minFloor[kind] || 1) <= state.floorNo);
  if (!table.length) return [];
  const totalW = table.reduce((a, [, w2]) => a + w2, 0);
  const rollKind = () => {
    let r = state.rand() * totalW;
    for (const [kind, kw] of table) { r -= kw; if (r <= 0) return kind; }
    return table[table.length - 1][0];
  };

  const out = [];
  for (const [gx, gy] of spots) {
    if (out.length >= target) break;
    if (zones.some(([zx, zy]) => dist2(gx, gy, zx, zy) < KEEP2)) continue;
    out.push(mkObstacle(state, rollKind(), gx, gy, cfg, data));
  }
  return out;
}

/** 单个障碍实例（kind 决定行为字段；variant 是表现层变体）。 */
export function mkObstacle(state, kind, x, y, cfgLike, data) {
  const cfg = cfgLike || cfgOf(data);
  const kc = cfg[kind] || DEFAULTS[kind] || { r: 0.55 };
  const o = {
    id: state.nextId++, kind, x, y, r: kc.r,
    hp: kc.hp || 0,                     // muck/vent 有血量，其余 0=不可击伤
    variant: null,
    dead: false,
  };
  if (kind === 'muck') {
    o.hp = kc.hp;
    if (state.rand() < (kc.goldChance || 0)) o.variant = 'gold';
  }
  if (kind === 'vent') {
    o.hp = kc.hp;
    o.erupt = false;
    o.ph = (kc.idle || 1.7) * (0.4 + state.rand() * 0.6);   // 各口错峰（相位随机起步）
    o.tickCd = 0;
  }
  return o;
}

// ---------- 碰撞 ----------

/** 圆推挤解算：把 who 推出所有阻挡障碍。flying=true 可越裂隙；ghost=true 无视全部（鬼斯穿墙）。 */
export function resolveObstacles(state, who, r, opts = {}) {
  const obs = state.obstacles;
  if (!obs || !obs.length) return;
  for (const o of obs) {
    if (o.dead) continue;
    if (o.kind === 'web' || o.kind === 'spikes') continue;      // 不挡路
    if (o.kind === 'pit' && opts.flying) continue;              // 飞行系越裂隙
    const dx = who.x - o.x, dy = who.y - o.y;
    const rr = r + o.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2);
    if (d < 1e-5) { who.x += rr; continue; }                    // 圆心重合：向 +x 弹出（退化态）
    const push = rr - d;
    who.x += (dx / d) * push;
    who.y += (dy / d) * push;
  }
}

/** 玩家是否站在蛛网里（步进前查一次，速度乘 slow）。 */
export function webSlowAt(state, x, y, r) {
  const cfg = DEFAULTS.web;
  const obs = state.obstacles;
  if (!obs || !obs.length) return 1;
  for (const o of obs) {
    if (o.dead || o.kind !== 'web') continue;
    if (dist2(x, y, o.x, o.y) < (o.r + r * 0.4) * (o.r + r * 0.4)) return cfg.slow;
  }
  return 1;
}

// ---------- 弹体命中 ----------

/** 弹体撞障碍：返回 true=弹体被消耗。muck/vent 扣血；rock/ore 纯挡；火系弹顺带烧穿蛛网。 */
export function shotBlockedBy(state, b, data) {
  const obs = state.obstacles;
  if (!obs || !obs.length) return false;
  const mv = b.moveId && data.moves ? data.moves[b.moveId] : null;
  const moveType = mv ? mv.type : null;
  for (const o of obs) {
    if (o.dead) continue;
    // 蛛网：火系弹烧除（弹继续飞）；其他属性穿过
    if (o.kind === 'web') {
      if (b.owner === 'player' && moveType === 'fire' && dist2(b.x, b.y, o.x, o.y) < (o.r + b.radius) * (o.r + b.radius)) {
        breakObstacle(state, o, data, { cause: 'burn' });
      }
      continue;
    }
    const blocking = o.kind === 'rock' || o.kind === 'ore' || o.kind === 'muck' || o.kind === 'vent';
    if (!blocking) continue;
    const rr = b.radius + o.r * 0.9;        // 判定略缩（视觉宽容）
    if (dist2(b.x, b.y, o.x, o.y) >= rr * rr) continue;
    if (o.kind === 'muck' || o.kind === 'vent') {
      damageObstacle(state, o, moveType === 'water' && o.kind === 'vent' ? o.hp : 1, data, { byPlayer: b.owner === 'player' });
    }
    state.events.push({ t: 'obst-hit', id: o.id, kind: o.kind, x: b.x, y: b.y });
    return true;
  }
  return false;
}

/** 近战横扫/喷息 tick 的障碍结算：只伤 muck/vent（岩石头太硬，拳头敲不动——Z 招式才是炸弹）。 */
export function meleeBlockedBy(state, x, y, r, data) {
  const obs = state.obstacles;
  if (!obs || !obs.length) return;
  for (const o of obs) {
    if (o.dead || (o.kind !== 'muck' && o.kind !== 'vent')) continue;
    if (dist2(x, y, o.x, o.y) >= (r + o.r) * (r + o.r)) continue;
    damageObstacle(state, o, 1, data, { byPlayer: true });
    state.events.push({ t: 'obst-hit', id: o.id, kind: o.kind, x: o.x, y: o.y });
  }
}

/** Z 招式（AoE）：范围内 rock/ore/muck/web/vent 全部破坏——Z 就是本作的炸弹。 */
export function smashObstaclesAt(state, x, y, radius, data) {
  const obs = state.obstacles;
  if (!obs || !obs.length) return 0;
  let n = 0;
  for (const o of obs) {
    if (o.dead || o.kind === 'spikes' || o.kind === 'pit') continue;
    if (dist2(x, y, o.x, o.y) > (radius + o.r) * (radius + o.r)) continue;
    breakObstacle(state, o, data, { cause: 'zmove' });
    n++;
  }
  return n;
}

// ---------- 血量 / 破坏 / 掉落 ----------

export function damageObstacle(state, o, n, data, opts = {}) {
  if (o.dead || !o.hp) return;
  o.hp -= n;
  if (o.hp <= 0) breakObstacle(state, o, data, opts);
}

export function breakObstacle(state, o, data, opts = {}) {
  if (o.dead) return;
  o.dead = true;
  const cfg = cfgOf(data);
  const drop = (kind, x, y) => {
    state.pickups.push({
      id: state.nextId++, kind, itemId: null,
      x: Math.min(state.roomW - 1.2, Math.max(1.2, x)), y: Math.min(state.roomH - 1.2, Math.max(1.2, y)),
      px: x, py: y, bob: state.rand() * 6, holdT: 0,
    });
    state.events.push({ t: 'coin-drop', x, y });
  };
  // 掉落表（以撒转译：tinted rock 必掉 / poop 概率掉 / red fire 灭了掉）：
  if (o.kind === 'ore') {
    drop('coin2', o.x, o.y);
    if (state.rand() < 0.4) drop('heart', o.x + 0.7, o.y);
  } else if (o.kind === 'muck') {
    if (o.variant === 'gold') {
      drop('coin2', o.x, o.y);
      drop('coin2', o.x + 0.6, o.y + 0.4);
    } else if (state.rand() < (cfg.muck.dropChance || 0)) {
      drop(state.rand() < 0.7 ? 'coin' : 'heart', o.x, o.y);
    }
  } else if (o.kind === 'vent' && opts.cause !== 'zmove') {
    // 只有「打灭」（水系/弹幕）才掉奖励；Z 轰掉的不掉（以撒炸弹拆火掉落同款规则）
    const r = state.rand();
    if (r < 0.3) drop('heart', o.x, o.y);
    else if (r < 0.6) drop('coin', o.x, o.y);
  } else if (o.kind === 'web' && opts.cause === 'zmove' && state.rand() < 0.2) {
    drop('coin', o.x, o.y);                       // 网里偶尔挂着东西
  }
  state.events.push({ t: 'obst-break', id: o.id, kind: o.kind, variant: o.variant, x: o.x, y: o.y, cause: opts.cause || 'shot' });
}

// ---------- 每步行为（喷火周期 / 尖刺与火焰接触伤害） ----------

export function stepObstacles(state, data) {
  const obs = state.obstacles;
  if (!obs || !obs.length) return;
  const cfg = cfgOf(data);
  const p = state.player;
  for (const o of obs) {
    if (o.dead) continue;
    if (o.kind === 'vent') {
      // 喷火节律：idle ↔ erupt 交替（ph 归零翻转）；喷发期烫玩家与敌人
      o.ph -= state.dt;
      if (o.ph <= 0) {
        o.erupt = !o.erupt;
        o.ph = o.erupt ? (cfg.vent.erupt || 0.9) : (cfg.vent.idle || 1.7);
      }
      if (!o.erupt) continue;
      const fr = o.r + 0.55;                     // 火舌半径
      if (p.alive && p.iframes <= 0 && !p.dashActive && dist2(p.x, p.y, o.x, o.y) < fr * fr) {
        state.hurtPlayer(cfg.spikes.dmg || 1);
      }
      o.tickCd = (o.tickCd || 0) - state.dt;     // 敌方伤害走独立节拍（防一波怪被秒熔）
      if (o.tickCd <= 0) {
        o.tickCd = cfg.vent.enemyTick || 0.6;
        for (const e of state.enemies) {
          if (e.state === 'spawning' || e.state === 'dead' || e.family === 'boss') continue;
          if (dist2(e.x, e.y, o.x, o.y) < (fr + e.radius) * (fr + e.radius)) {
            e.hp -= cfg.vent.enemyDmg || 2;
            e.flash = 0.12;
            state.events.push({ t: 'enemy-burn', id: e.id, x: e.x, y: e.y });
            // 引爆自爆虫：喷火口点燃引信（与接触引信同款表现），随后的击杀走完整掉落管线
            if (e.family === 'bomber' && e.hp <= 0 && !e.fusing) {
              e.fusing = e.fuse || 1.0;
              state.telegraphs.push({ x: e.x, y: e.y, r: e.bombRadius, t: e.fusing, dmg: e.bombDmg, kind: 'bomb', owner: e.id });
            }
            if (e.hp <= 0) killEnemy(state, e, 'fire');
          }
        }
      }
    } else if (o.kind === 'spikes') {
      // 尖刺：接触扣 1（iframes 自然限频；冲刺无敌可穿过——以撒同款冲刺博弈）
      if (p.alive && p.iframes <= 0 && !p.dashActive && dist2(p.x, p.y, o.x, o.y) < (o.r + 0.2) * (o.r + 0.2)) {
        state.hurtPlayer(cfg.spikes.dmg || 1);
        state.events.push({ t: 'spike-hit', x: p.x, y: p.y });
      }
    }
  }
}

// ---------- 存取（离房 stash 恢复用） ----------

/** 存进 cell.stash 的纯数据副本（dead 的不留——拆了就没了）。 */
export function stashObstacles(state) {
  return (state.obstacles || []).filter((o) => !o.dead).map((o) => {
    const c = { ...o };
    delete c.tickCd;
    return c;
  });
}
