// Boss：小刚 & 大岩蛇（《01》§9.2）。两阶段：
//   P1 循环 [蓄势 → 钻地突袭 / 直线冲锋 / 落石三连]
//   P2（HP<50% 一次）：咆哮 + 周期岩石雨（预警圈）
// 预警圈写入 state.telegraphs（sim 权威，表现层只画圈）。

const T = 1 / 60;

export function spawnBoss(state, data) {
  const floorCfg = data.floors[state.floorNo];
  const spec = data.enemies[floorCfg.boss];
  const cfg = spec.boss;
  const ent = {
    id: state.nextId++, eid: floorCfg.boss, name: spec.name, types: spec.types,
    family: 'boss', radius: spec.radius, score: 0,
    hp: spec.hp * data.balance.boss.hpMul * (state.bossMul || 1),
    maxHp: spec.hp * data.balance.boss.hpMul * (state.bossMul || 1),
    touchDmg: spec.touchDmg, speed: spec.speed, spdMod: spec.spdMod,
    x: state.roomW / 2, y: 2.2, px: state.roomW / 2, py: 2.2, kx: 0, ky: 0,
    state: 'spawning', spawnT: 1.2, flash: 0, touchCd: 0,
    anim: 'Idle', dir: 0, moving: false,
    // boss 专属
    b: {
      phase: 1, phase2Done: false,
      mode: 'idle', modeT: 1.2,
      cfg,
      chargeDir: null, burrowAt: null, rainT: 0,
    },
  };
  // 各 Boss 专属运行字段
  if (ent.eid === 'surge') {
    ent.b.summonT = 2.5; ent.b.gridT = 4.0; ent.b.volleyT = 6.5;
  } else if (ent.eid === 'sabrina') {
    ent.b.mirrorT = 2.5; ent.b.tpT = 3.2;
  } else if (ent.eid === 'mew') {
    ent.b.tpT = 1.4; ent.b.ringT = 2.0; ent.b.volleyT = 4.0;
    ent.b.summonT = 3.0; ent.b.spikeT = 1.2; ent.b.phase3Done = false;
  }
  state.enemies.push(ent);
  state.events.push({ t: 'boss-intro', name: spec.name, ace: spec.anim });
}

function warn(state, x, y, r, delay, dmg, kind) {
  // 难度（深渊）压缩预警时间：更紧的反应窗口
  const mul = state.warnMul || 1;
  state.telegraphs.push({ x, y, r, t: delay * mul, dmg, kind: kind || 'rock' });
}

export function stepBoss(state, e, data) {
  const b = e.b, cfg = b.cfg, p = state.player;
  if (e.eid === 'surge') return stepSurge(state, e, data);
  if (e.eid === 'sabrina') return stepSabrina(state, e, data);
  if (e.eid === 'mew') return stepMew(state, e, data);
  e.px = e.x; e.py = e.y;
  if (e.flash > 0) e.flash -= T;

  // 阶段切换
  if (!b.phase2Done && e.hp < e.maxHp * cfg.phase2At) {
    b.phase2Done = true;
    b.phase = 2;
    b.mode = 'roar'; b.modeT = 1.0;
    state.events.push({ t: 'boss-phase2', x: e.x, y: e.y });
  }

  // P2 岩石雨（与当前攻击并行）
  if (b.phase === 2) {
    b.rainT -= T;
    if (b.rainT <= 0 && b.mode !== 'burrow') {
      b.rainT = cfg.rain.interval;
      for (let i = 0; i < 2; i++) {
        warn(state, 2.2 + state.rand() * (state.roomW - 4.4), 2.2 + state.rand() * (state.roomH - 4.4),
          cfg.rain.radius, cfg.rain.warn, cfg.rain.damage, 'rain');
      }
    }
  }

  b.modeT -= T;
  switch (b.mode) {
    case 'idle': {
      e.anim = 'Idle'; e.moving = false;
      // 缓慢面向玩家横移
      if (b.modeT <= 0) {
        const roll = state.rand();
        if (roll < 0.38) { b.mode = 'burrow-warn'; b.modeT = 0.4; }
        else if (roll < 0.72) { b.mode = 'charge-warn'; b.modeT = cfg.charge.windup; b.chargeDir = null; }
        else { b.mode = 'toss'; b.modeT = 0.5; }
      }
      break;
    }
    case 'roar': {
      e.anim = 'Attack';
      if (b.modeT <= 0) { b.mode = 'idle'; b.modeT = 1.6; }
      break;
    }
    case 'burrow-warn': {
      e.anim = 'Hurt';   // 蜷身预告
      if (b.modeT <= 0) {
        // 出土瞬间 == 预警圈结算瞬间（此前差 0.5s，惩罚空档反而吃延迟伤害）
        b.mode = 'burrow'; b.modeT = cfg.burrow.windup;
        e.anim = 'Idle'; e.hidden = true;
        b.burrowAt = { x: p.x, y: p.y };
        warn(state, p.x, p.y, cfg.burrow.radius, cfg.burrow.windup, cfg.burrow.damage, 'burrow');
      }
      break;
    }
    case 'burrow': {
      e.hidden = true; e.anim = 'Walk'; e.moving = true;
      // 钻地痕迹向玩家漂移
      const dx = b.burrowAt.x - e.x, dy = b.burrowAt.y - e.y;
      const l = Math.hypot(dx, dy) || 1;
      e.x += (dx / l) * 7 * T; e.y += (dy / l) * 7 * T;
      if (b.modeT <= 0) {
        e.hidden = false;
        e.x = b.burrowAt.x; e.y = Math.max(1.4, Math.min(state.roomH - 1.4, b.burrowAt.y));
        e.anim = 'Attack';
        b.mode = 'idle'; b.modeT = 1.8;
        e.touchCd = Math.max(e.touchCd, 0.6);   // 出土硬直：落石演出期不判身体接触（防落地秒撞）
        state.events.push({ t: 'boss-erupt', x: e.x, y: e.y });
      }
      break;
    }
    case 'charge-warn': {
      e.anim = 'Charge'; e.moving = false;
      // 对齐玩家方向（四向）
      if (!b.chargeDir) {
        b.chargeDir = Math.abs(p.x - e.x) > Math.abs(p.y - e.y)
          ? { x: Math.sign(p.x - e.x) || 1, y: 0 } : { x: 0, y: Math.sign(p.y - e.y) || 1 };
        b.chargeDone = false;
        // 冲锋路径标记（零伤害，纯预警；玩家看到轨迹，机器人垂直闪避）
        const step = 2.0;
        for (let d = 2; d < Math.max(state.roomW, state.roomH); d += step) {
          const mx = e.x + b.chargeDir.x * d, my = e.y + b.chargeDir.y * d;
          if (mx < 0.5 || mx > state.roomW - 0.5 || my < 0.5 || my > state.roomH - 0.5) break;
          warn(state, mx, my, 1.3, cfg.charge.windup + 0.15, 0, 'charge-line');
        }
      }
      if (b.modeT <= 0) { b.mode = 'charge'; b.modeT = 2.2; }
      break;
    }
    case 'charge': {
      e.anim = 'Charge'; e.moving = true;
      const nx = e.x + b.chargeDir.x * cfg.charge.speed * T;
      const ny = e.y + b.chargeDir.y * cfg.charge.speed * T;
      const hitWall = nx < 1.2 || nx > state.roomW - 1.2 || ny < 1.2 || ny > state.roomH - 1.2;
      e.x = Math.max(1.2, Math.min(state.roomW - 1.2, nx));
      e.y = Math.max(1.2, Math.min(state.roomH - 1.2, ny));
      e.dir = state.dirOf(b.chargeDir.x, b.chargeDir.y);
      if (hitWall || b.modeT <= 0) {
        e.anim = 'Hurt';
        state.events.push({ t: 'boss-slam', x: e.x, y: e.y });
        b.mode = 'idle'; b.modeT = 1.9;
      }
      break;
    }
    case 'toss': {
      e.anim = 'Attack'; e.moving = false;
      if (b.modeT <= 0) {
        for (let i = 0; i < cfg.toss.rocks; i++) {
          const tx = p.x + (state.rand() - 0.5) * 3.5;
          const ty = p.y + (state.rand() - 0.5) * 3.5;
          // 离墙 ≥2.2 留逃生走廊（贴墙生成会封死贴墙玩家的躲避路线）
          warn(state,
            Math.max(2.2, Math.min(state.roomW - 2.2, tx)),
            Math.max(2.2, Math.min(state.roomH - 2.2, ty)),
            cfg.toss.radius, cfg.toss.warn, cfg.toss.damage, 'rock');
        }
        b.mode = 'idle'; b.modeT = 2.0;
      }
      break;
    }
    default: break;
  }

  // 接触伤害
  e.touchCd -= T;
  if (p.alive && e.touchCd <= 0 && !e.hidden) {
    const rr = e.radius + 0.45;
    const dx = e.x - p.x, dy = e.y - p.y;
    if (dx * dx + dy * dy < rr * rr) {
      if (state.hurtPlayer(b.mode === 'charge' ? cfg.charge.damage : e.touchDmg)) e.touchCd = 0.9;
    }
  }
}

// ---------- 马志士：召唤雷电球 + 电网行/列 + 追踪弹幕 ----------
function stepSurge(state, e, data) {
  const b = e.b, cfg = b.cfg, p = state.player;
  e.px = e.x; e.py = e.y;
  if (e.flash > 0) e.flash -= T;
  if (!b.phase2Done && e.hp < e.maxHp * cfg.phase2At) {
    b.phase2Done = true; b.phase = 2;
    state.events.push({ t: 'boss-phase2', x: e.x, y: e.y });
  }
  // 缓慢绕场游走
  const ang = state.t * 0.35;
  const tx = state.roomW / 2 + Math.cos(ang) * (state.roomW / 3.2);
  const ty = state.roomH / 2 + Math.sin(ang) * (state.roomH / 3.4);
  const dx = tx - e.x, dy = ty - e.y, l = Math.hypot(dx, dy) || 1;
  if (l > 0.3) { e.x += dx / l * e.speed * T; e.y += dy / l * e.speed * T; }
  e.anim = 'Walk'; e.moving = true; e.dir = state.dirOf(dx, dy);
  e.hidden = false;

  // 召唤雷电球
  b.summonT -= T;
  const minions = state.enemies.filter((x) => x.eid === cfg.summon.id).length;
  if (b.summonT <= 0 && minions < cfg.summon.max) {
    b.summonT = cfg.summon.interval;
    const spec = data.enemies[cfg.summon.id];
    const sx = 1.5 + state.rand() * (state.roomW - 3);
    const sy = 1.5 + state.rand() * (state.roomH - 3);
    state.enemies.push({
      id: state.nextId++, eid: cfg.summon.id, name: spec.name, types: spec.types,
      family: spec.family, radius: spec.radius, score: spec.score,
      hp: spec.hp * 0.7, maxHp: spec.hp * 0.7, touchDmg: spec.touchDmg,
      speed: spec.speed, spdMod: spec.spdMod, x: sx, y: sy, px: sx, py: sy, kx: 0, ky: 0,
      state: 'spawning', spawnT: 0.4, flash: 0, touchCd: 0, stun: 0,
      anim: 'Idle', dir: 0, moving: false, wanderT: 0, wx: 0, wy: 0,
      bombRadius: spec.bombRadius, bombDmg: spec.bombDmg, fuse: spec.fuse,
    });
    state.events.push({ t: 'spawn', id: state.enemies[state.enemies.length - 1].id, eid: cfg.summon.id, x: sx, y: sy });
  }

  // 电网：随机 3 行/列预警 → 落雷
  b.gridT -= T;
  if (b.gridT <= 0) {
    b.gridT = b.phase === 2 ? 4.5 : 6.0;
    const vertical = state.rand() < 0.5;
    const used = new Set();
    for (let i = 0; i < cfg.grid.cols; i++) {
      let c;
      do { c = 1 + Math.floor(state.rand() * (vertical ? state.roomW - 2 : state.roomH - 2)); } while (used.has(c));
      used.add(c);
      for (let k = 1; k < (vertical ? state.roomH : state.roomW) - 1; k += 1.6) {
        warn(state, vertical ? c : k, vertical ? k : c, 0.85, cfg.grid.warn, cfg.grid.dmg, 'grid');
      }
    }
  }

  // 追踪弹幕：n 发瞄准弹
  b.volleyT -= T;
  if (b.volleyT <= 0) {
    b.volleyT = b.phase === 2 ? 3.5 : 5.0;
    const base = Math.atan2(p.y - e.y, p.x - e.x);
    for (let i = 0; i < cfg.volley.n; i++) {
      const a = base + (i - (cfg.volley.n - 1) / 2) * 0.22;
      state.projectiles.push({
        owner: 'enemy', id: state.nextId++, moveId: 'zap-bolt',
        x: e.x, y: e.y, px: e.x, py: e.y,
        vx: Math.cos(a) * cfg.volley.speed, vy: Math.sin(a) * cfg.volley.speed,
        life: 9 / cfg.volley.speed * 0.9, radius: 0.17,
      });
    }
    state.events.push({ t: 'enemy-shoot', x: e.x, y: e.y });
  }

  bossContact(state, e, 1);
  bossRain(state, e, cfg, b);
}

// ---------- 娜姿：镜像弹幕环 + 瞬移 + 操作反转 ----------
function stepSabrina(state, e, data) {
  const b = e.b, cfg = b.cfg, p = state.player;
  e.px = e.x; e.py = e.y;
  if (e.flash > 0) e.flash -= state.dt;
  if (!b.phase2Done && e.hp < e.maxHp * cfg.phase2At) {
    b.phase2Done = true; b.phase = 2;
    state.events.push({ t: 'boss-phase2', x: e.x, y: e.y });
  }
  e.anim = 'Idle'; e.moving = false; e.hidden = false;

  // 镜像弹幕：双环散射（第二环错开半格）
  b.mirrorT -= T;
  if (b.mirrorT <= 0) {
    b.mirrorT = b.phase === 2 ? 3.2 : 4.2;
    for (let ring = 0; ring < cfg.mirror.rings; ring++) {
      const off = ring * Math.PI / cfg.mirror.burst;
      for (let i = 0; i < cfg.mirror.burst; i++) {
        const a = (i / cfg.mirror.burst) * Math.PI * 2 + off + state.rand() * 0.2;
        state.projectiles.push({
          owner: 'enemy', id: state.nextId++, moveId: 'psy-bolt',
          x: e.x, y: e.y, px: e.x, py: e.y,
          vx: Math.cos(a) * cfg.mirror.speed, vy: Math.sin(a) * cfg.mirror.speed,
          life: 8 / cfg.mirror.speed, radius: 0.16,
        });
      }
    }
    state.events.push({ t: 'enemy-shoot', x: e.x, y: e.y });
  }

  // 瞬移：随机点（远离玩家≥3）
  b.tpT -= T;
  if (b.tpT <= 0) {
    b.tpT = cfg.teleport.interval * (0.8 + state.rand() * 0.4);
    for (let tries = 0; tries < 12; tries++) {
      const nx = 1.5 + state.rand() * (state.roomW - 3);
      const ny = 1.5 + state.rand() * (state.roomH - 3);
      if (Math.hypot(nx - p.x, ny - p.y) > 3.2) {
        state.events.push({ t: 'boss-tp', from: [e.x, e.y], to: [nx, ny] });
        e.x = nx; e.y = ny; e.px = nx; e.py = ny;
        break;
      }
    }
  }

  // 二阶段：操作反转（短促、非惩罚性——有 HUD 提示与紫边提示）
  if (b.phase === 2) {
    b.revT = (b.revT || 0) - T;
    if (b.revT <= 0 && state.reverseT <= 0) {
      b.revT = 7.0;
      state.reverseT = cfg.reverse.duration;
      state.events.push({ t: 'reverse-start', duration: cfg.reverse.duration });
    }
  }

  bossContact(state, e, 1);
  bossRain(state, e, cfg, b);
}

// ---------- 梦幻：三段终战（P1 幻影闪现弹幕 / P2 镜像军团 / P3 晶核爆发） ----------
function stepMew(state, e, data) {
  const b = e.b, cfg = b.cfg, p = state.player;
  e.px = e.x; e.py = e.y;
  if (e.flash > 0) e.flash -= T;

  // 三段切换
  if (!b.phase2Done && e.hp < e.maxHp * cfg.phase2At) {
    b.phase2Done = true; b.phase = 2;
    nova(state, e, cfg, 1);                                   // 切段清场环
    state.events.push({ t: 'boss-phase2', x: e.x, y: e.y });
  }
  if (!b.phase3Done && e.hp < e.maxHp * cfg.phase3At) {
    b.phase3Done = true; b.phase = 3;
    nova(state, e, cfg, 2);
    state.events.push({ t: 'boss-phase3', x: e.x, y: e.y });
  }

  // 移动：P1/P2 悬浮游走；P3 缓慢追击
  if (b.phase === 3) {
    const dx = p.x - e.x, dy = p.y - e.y, l = Math.hypot(dx, dy) || 1;
    if (l > 1.6) { e.x += dx / l * cfg.chaseSpeed * T; e.y += dy / l * cfg.chaseSpeed * T; }
    e.anim = 'Walk'; e.moving = true;
  } else {
    const ang = state.t * 0.5;
    const tx = state.roomW / 2 + Math.cos(ang) * (state.roomW / 3.0);
    const ty = state.roomH / 2 + Math.sin(ang * 1.3) * (state.roomH / 3.4);
    const dx = tx - e.x, dy = ty - e.y, l = Math.hypot(dx, dy) || 1;
    if (l > 0.3) { e.x += dx / l * e.speed * T; e.y += dy / l * e.speed * T; }
    e.anim = 'Idle'; e.moving = false;
  }
  e.hidden = false;

  // 瞬移（P1 常态 / P2 加密 / P3 稀疏）
  b.tpT -= T;
  if (b.tpT <= 0) {
    b.tpT = (b.phase === 1 ? cfg.tp.interval : b.phase === 2 ? cfg.tp.interval * 0.75 : cfg.tp.interval * 1.8) * (0.85 + state.rand() * 0.3);
    for (let tries = 0; tries < 12; tries++) {
      const nx = 1.5 + state.rand() * (state.roomW - 3);
      const ny = 1.5 + state.rand() * (state.roomH - 3);
      if (Math.hypot(nx - p.x, ny - p.y) > 3.0) {
        state.events.push({ t: 'boss-tp', from: [e.x, e.y], to: [nx, ny] });
        e.x = nx; e.y = ny; e.px = nx; e.py = ny;
        break;
      }
    }
  }

  // 环形弹幕（瞬移后常驻节拍；P2 双环）
  b.ringT -= T;
  if (b.ringT <= 0) {
    b.ringT = b.phase === 1 ? 2.6 : b.phase === 2 ? 2.1 : 1.7;
    const rings = b.phase === 2 ? 2 : 1;
    for (let ring = 0; ring < rings; ring++) {
      const off = ring * Math.PI / cfg.ring.burst + state.rand() * 0.3;
      for (let i = 0; i < cfg.ring.burst; i++) {
        const a = (i / cfg.ring.burst) * Math.PI * 2 + off;
        state.projectiles.push({
          owner: 'enemy', id: state.nextId++, moveId: 'psy-bolt',
          x: e.x, y: e.y, px: e.x, py: e.y,
          vx: Math.cos(a) * cfg.ring.speed, vy: Math.sin(a) * cfg.ring.speed,
          life: 9 / cfg.ring.speed, radius: 0.16,
        });
      }
    }
    state.events.push({ t: 'enemy-shoot', x: e.x, y: e.y });
  }

  // 瞄准弹幕（P1 单发扇 / P3 三连扇）
  b.volleyT -= T;
  if (b.volleyT <= 0) {
    b.volleyT = b.phase === 3 ? 2.4 : 4.2;
    const base = Math.atan2(p.y - e.y, p.x - e.x);
    for (let i = 0; i < cfg.volley.n; i++) {
      const a = base + (i - (cfg.volley.n - 1) / 2) * 0.2;
      state.projectiles.push({
        owner: 'enemy', id: state.nextId++, moveId: 'psy-bolt',
        x: e.x, y: e.y, px: e.x, py: e.y,
        vx: Math.cos(a) * cfg.volley.speed, vy: Math.sin(a) * cfg.volley.speed,
        life: 9 / cfg.volley.speed, radius: 0.17,
      });
    }
    state.events.push({ t: 'enemy-shoot', x: e.x, y: e.y });
  }

  // P2：镜像军团（ Gastly 幻影 ×2）
  if (b.phase === 2) {
    b.summonT -= T;
    const minions = state.enemies.filter((x) => x.eid === cfg.summon.id && x.isPhantom).length;
    if (b.summonT <= 0 && minions < cfg.summon.max) {
      b.summonT = cfg.summon.interval;
      const spec = data.enemies[cfg.summon.id];
      const sx = 1.5 + state.rand() * (state.roomW - 3);
      const sy = 1.5 + state.rand() * (state.roomH - 3);
      state.enemies.push({
        id: state.nextId++, eid: cfg.summon.id, name: spec.name + '·幻影', types: spec.types,
        family: spec.family, radius: spec.radius * 0.9, score: spec.score,
        hp: spec.hp * 0.5 * state.hpMul, maxHp: spec.hp * 0.5 * state.hpMul,
        touchDmg: spec.touchDmg, speed: spec.speed * 1.2, spdMod: spec.spdMod,
        x: sx, y: sy, px: sx, py: sy, kx: 0, ky: 0,
        state: 'spawning', spawnT: 0.4, flash: 0, touchCd: 0, stun: 0,
        anim: 'Idle', dir: 0, moving: false, wanderT: 0, wx: 0, wy: 0, isPhantom: true,
      });
      state.events.push({ t: 'spawn', id: state.enemies[state.enemies.length - 1].id, eid: cfg.summon.id, x: sx, y: sy });
    }
  }

  // P3：晶核爆发（预警圈连击：玩家位置 + 十字延伸）
  if (b.phase === 3) {
    b.spikeT -= T;
    if (b.spikeT <= 0) {
      b.spikeT = cfg.spikes.interval;
      warn(state, p.x, p.y, cfg.spikes.radius, cfg.spikes.warn, cfg.spikes.damage, 'mew');
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        warn(state,
          Math.max(1.6, Math.min(state.roomW - 1.6, p.x + dx * 2.4)),
          Math.max(1.6, Math.min(state.roomH - 1.6, p.y + dy * 2.4)),
          cfg.spikes.radius * 0.85, cfg.spikes.warn + 0.25, cfg.spikes.damage, 'mew');
      }
    }
    bossRain(state, e, cfg, b);
  }

  bossContact(state, e, 1);
}

// 阶段切换清场环（双环 nova）
function nova(state, e, cfg, waves) {
  for (let w = 0; w < waves; w++) {
    const off = w * Math.PI / cfg.nova.burst;
    for (let i = 0; i < cfg.nova.burst; i++) {
      const a = (i / cfg.nova.burst) * Math.PI * 2 + off;
      state.projectiles.push({
        owner: 'enemy', id: state.nextId++, moveId: 'psy-bolt',
        x: e.x, y: e.y, px: e.x, py: e.y,
        vx: Math.cos(a) * cfg.nova.speed, vy: Math.sin(a) * cfg.nova.speed,
        life: 10 / cfg.nova.speed, radius: 0.16,
      });
    }
  }
  state.events.push({ t: 'enemy-shoot', x: e.x, y: e.y });
}

function bossContact(state, e, dmg) {
  const p = state.player;
  e.touchCd -= T;
  if (p.alive && e.touchCd <= 0 && !e.hidden) {
    const rr = e.radius + 0.45;
    if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 < rr * rr) {
      if (state.hurtPlayer(dmg)) e.touchCd = 0.9;
    }
  }
}

function bossRain(state, e, cfg, b) {
  if (b.phase !== 2 || !cfg.rain) return;
  b.rainT = (b.rainT || 0) - T;
  if (b.rainT <= 0) {
    b.rainT = cfg.rain.interval;
    for (let i = 0; i < 2; i++) {
      warn(state, 2.2 + state.rand() * (state.roomW - 4.4), 2.2 + state.rand() * (state.roomH - 4.4),
        cfg.rain.radius, cfg.rain.warn, cfg.rain.dmg, 'rain');
    }
  }
}

// 预警圈结算（任何来源）
export function stepTelegraphs(state, data) {
  const p = state.player;
  for (let i = state.telegraphs.length - 1; i >= 0; i--) {
    const t = state.telegraphs[i];
    t.t -= T;
    if (t.t <= 0) {
      if (p.alive && t.dmg > 0) {
        const dx = p.x - t.x, dy = p.y - t.y;
        if (dx * dx + dy * dy < t.r * t.r) state.hurtPlayer(t.dmg);
      }
      state.events.push({ t: 'telegraph-hit', x: t.x, y: t.y, r: t.r, kind: t.kind });
      state.telegraphs.splice(i, 1);
    }
  }
}
