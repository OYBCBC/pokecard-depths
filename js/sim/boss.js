// Boss：小刚 & 大岩蛇（《01》§9.2）。两阶段：
//   P1 循环 [蓄势 → 钻地突袭 / 直线冲锋 / 落石三连]
//   P2（HP<50% 一次）：咆哮 + 周期岩石雨（预警圈）
// 预警圈写入 state.telegraphs（sim 权威，表现层只画圈）。

const T = 1 / 60;

export function spawnBoss(state, data) {
  const spec = data.enemies.brock;
  const cfg = spec.boss;
  state.enemies.push({
    id: state.nextId++, eid: 'brock', name: spec.name, types: spec.types,
    family: 'boss', radius: spec.radius, score: 0,
    hp: spec.hp * data.balance.boss.hpMul, maxHp: spec.hp * data.balance.boss.hpMul,
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
  });
  state.events.push({ t: 'boss-intro', name: spec.name });
}

function warn(state, x, y, r, delay, dmg, kind) {
  state.telegraphs.push({ x, y, r, t: delay, dmg, kind: kind || 'rock' });
}

export function stepBoss(state, e, data) {
  const b = e.b, cfg = b.cfg, p = state.player;
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
        warn(state, 1.5 + state.rand() * (state.roomW - 3), 1.5 + state.rand() * (state.roomH - 3),
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
        b.mode = 'burrow'; b.modeT = 0.7;
        e.anim = 'Idle'; e.hidden = true;
        b.burrowAt = { x: p.x, y: p.y };
        warn(state, p.x, p.y, cfg.burrow.radius, cfg.burrow.windup + 0.7, cfg.burrow.damage, 'burrow');
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
          warn(state,
            Math.max(1, Math.min(state.roomW - 1, tx)),
            Math.max(1, Math.min(state.roomH - 1, ty)),
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
