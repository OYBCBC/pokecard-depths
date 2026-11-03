// 战斗行为系统：玩家射击/冲刺、弹体、敌人三族 AI、波次与房间状态机。
// 全部纯数据变换；事件写进 state.events 供表现层消费。
import { computeHit, damageStat, fireInterval, typeMultiplier } from './combat.js?v=m2d';

const EPS = 1e-6;

function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ---------- 玩家 ----------

export function stepPlayer(state, input, data) {
  const p = state.player;
  const bal = data.balance.player;
  p.px = p.x; p.py = p.y;

  if (!p.alive) { p.deathT += state.dt; return; }

  // 冲刺：edge 触发，充能 2 层
  if (input.dashEdge && p.dashCharges >= 1 && !p.dashActive) {
    const mv = input.move;
    let dx = mv.x, dy = mv.y;
    if (Math.hypot(dx, dy) < EPS) { dx = p.lastDir.x; dy = p.lastDir.y; }
    const l = Math.hypot(dx, dy) || 1;
    p.dashActive = true;
    p.dashT = bal.dashDuration;
    p.dashDir = { x: dx / l, y: dy / l };
    p.dashCharges -= 1;
    state.events.push({ t: 'dash', x: p.x, y: p.y });
  }
  if (p.dashCharges < bal.dashCharges) {
    p.dashRe += state.dt;
    if (p.dashRe >= bal.dashRecharge) { p.dashRe = 0; p.dashCharges += 1; }
  }

  let vx = 0, vy = 0;
  if (p.dashActive) {
    p.dashT -= state.dt;
    vx = p.dashDir.x * bal.dashSpeed;
    vy = p.dashDir.y * bal.dashSpeed;
    if (p.dashT <= 0) p.dashActive = false;
  } else {
    const mv = input.move;
    const l = Math.hypot(mv.x, mv.y);
    if (l > EPS) {
      const k = l > 1 ? 1 / l : 1;
      vx = mv.x * k * bal.moveSpeed;
      vy = mv.y * k * bal.moveSpeed;
      p.lastDir = { x: mv.x * k, y: mv.y * k };
    }
  }
  p.x = clamp(p.x + vx * state.dt, 0.75, state.roomW - 0.75);
  p.y = clamp(p.y + vy * state.dt, 0.75, state.roomH - 0.75);
  p.moving = Math.hypot(vx, vy) > EPS;
  p.anim = p.moving || p.dashActive ? 'Walk' : 'Idle';
  if (p.moving) p.dir = state.dirOf(vx, vy);

  // 无敌帧
  if (p.iframes > 0) p.iframes -= state.dt;

  // 射击（按住连发）
  p.fireCd -= state.dt;
  if (input.fire && p.fireCd <= 0) {
    const aim = input.aim;
    const l = Math.hypot(aim.x, aim.y) || 1;
    const mv = data.moves[p.moveId];
    state.projectiles.push({
      owner: 'player', id: state.nextId++,
      x: p.x, y: p.y, px: p.x, py: p.y,
      vx: aim.x / l * mv.speed, vy: aim.y / l * mv.speed,
      life: mv.range / mv.speed, radius: mv.radius, moveId: p.moveId,
    });
    p.fireCd = fireInterval(0);
    state.stats.shots += 1;
    state.events.push({ t: 'shot', x: p.x, y: p.y, aimx: aim.x / l, aimy: aim.y / l });
  }
}

export function hurtPlayer(state, dmg, data) {
  const p = state.player;
  if (!p.alive || p.iframes > 0 || p.dashActive) return false;
  p.hp -= dmg;
  p.iframes = data.balance.player.iframesOnHurt;
  state.events.push({ t: 'player-hurt', dmg, x: p.x, y: p.y, hp: Math.max(p.hp, 0) });
  if (p.hp <= 0) {
    p.hp = 0; p.alive = false; p.deathT = 0;
    state.events.push({ t: 'player-die', x: p.x, y: p.y });
  }
  return true;
}

// ---------- 弹体 ----------

export function stepProjectiles(state, data) {
  const bal = data.balance;
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const b = state.projectiles[i];
    b.px = b.x; b.py = b.y;
    b.x += b.vx * state.dt;
    b.y += b.vy * state.dt;
    b.life -= state.dt;
    let dead = b.life <= 0;
    // 撞墙
    if (b.x < 0.55 || b.x > state.roomW - 0.55 || b.y < 0.55 || b.y > state.roomH - 0.55) {
      dead = true;
      state.events.push({ t: 'shot-die', x: b.x, y: b.y, wall: true });
    }
    if (dead) { state.projectiles.splice(i, 1); continue; }

    if (b.owner === 'player') {
      // 弹 × 敌
      for (const e of state.enemies) {
        if (e.state === 'spawning') continue;
        const rr = b.radius + e.radius;
        if (dist2(b.x, b.y, e.x, e.y) < rr * rr) {
          applyHit(state, e, b, data);
          state.projectiles.splice(i, 1);
          break;
        }
      }
    } else {
      // 敌弹 × 玩家
      const p = state.player;
      if (p.alive) {
        const rr = b.radius + 0.45;
        if (dist2(b.x, b.y, p.x, p.y) < rr * rr) {
          if (hurtPlayer(state, 1, data)) {
            state.projectiles.splice(i, 1);
            continue;
          }
        }
      }
    }
  }
}

function killEnemy(state, e, kind = 'normal') {
  if (e.state === 'dead') return;
  e.state = 'dead';
  state.stats.kills += 1;
  state.events.push({ t: 'enemy-die', id: e.id, x: e.x, y: e.y, kind, name: e.name });
}

function applyHit(state, e, b, data) {
  const p = state.player;
  const mv = data.moves[b.moveId];
  const species = data.species.player;                      // 玩家宝可梦属性（M2 只有皮卡丘）
  const hit = computeHit({
    D: damageStat(0, 0), power: mv.power, moveType: mv.type,
    atkTypes: species.types, defTypes: e.types, spdMod: e.spdMod,
    chart: data.typechart,
  });
  e.hp -= hit.dmg;
  e.flash = 0.12;                                           // 受击闪白（秒）
  const kl = Math.hypot(b.vx, b.vy) || 1;
  e.kx = (b.vx / kl) * data.balance.enemy.knockback;
  e.ky = (b.vy / kl) * data.balance.enemy.knockback;
  state.stats.dmgDealt += hit.dmg;
  if (hit.kind === 'super') state.stats.superHits += 1;
  // PP 积累：伤害 ×0.25，克制再 ×1.5
  state.player.pp = Math.min(100, state.player.pp + hit.dmg * data.balance.player.ppPerDamage * (hit.kind === 'super' ? data.balance.player.ppSuperMul : 1));
  if (e.hp <= 0) {
    killEnemy(state, e, hit.kind);
  } else {
    state.events.push({ t: 'enemy-hurt', id: e.id, x: e.x, y: e.y, dmg: hit.dmg, kind: hit.kind });
  }
}

// ---------- 敌人 ----------

export function stepEnemies(state, input, data) {
  const p = state.player;
  const bal = data.balance.enemy;
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    e.px = e.x; e.py = e.y;
    if (e.hp <= 0 && e.state !== 'dead') killEnemy(state, e);
    if (e.state === 'dead') { state.enemies.splice(i, 1); continue; }
    if (e.flash > 0) e.flash -= state.dt;

    if (e.state === 'spawning') {
      e.spawnT -= state.dt;
      if (e.spawnT <= 0) e.state = 'active';
      continue;
    }

    // 击退衰减
    if (Math.abs(e.kx) > EPS || Math.abs(e.ky) > EPS) {
      e.x += e.kx * state.dt; e.y += e.ky * state.dt;
      const decay = Math.max(0, 1 - bal.knockbackDecay * state.dt);
      e.kx *= decay; e.ky *= decay;
    }

    let vx = 0, vy = 0;
    if (e.family === 'charger') {
      const dx = p.x - e.x, dy = p.y - e.y;
      const l = Math.hypot(dx, dy) || 1;
      vx = dx / l * e.speed; vy = dy / l * e.speed;
    } else if (e.family === 'wanderer') {
      e.wanderT -= state.dt;
      if (e.wanderT <= 0) {
        const a = state.rand() * Math.PI * 2;
        e.wx = Math.cos(a); e.wy = Math.sin(a);
        e.wanderT = 0.7 + state.rand() * 1.0;
      }
      vx = e.wx * e.speed; vy = e.wy * e.speed;
    } else if (e.family === 'shooter') {
      e.shootCd -= state.dt;
      if (e.shootCd <= 0 && p.alive) {
        const dx = p.x - e.x, dy = p.y - e.y;
        const base = Math.atan2(dy, dx);
        const arc = (e.shoot.spread > 1 ? e.shoot.arcDeg * Math.PI / 180 : 0);
        const mv = data.moves[e.shoot.move];
        for (let s = 0; s < e.shoot.spread; s++) {
          const a = base + (e.shoot.spread > 1 ? (s / (e.shoot.spread - 1) - 0.5) * arc : 0);
          state.projectiles.push({
            owner: 'enemy', id: state.nextId++,
            x: e.x, y: e.y, px: e.x, py: e.y,
            vx: Math.cos(a) * mv.speed, vy: Math.sin(a) * mv.speed,
            life: mv.range / mv.speed, radius: mv.radius, moveId: e.shoot.move,
          });
        }
        e.shootCd = e.shoot.cooldown * (0.85 + state.rand() * 0.3);
        state.events.push({ t: 'enemy-shoot', x: e.x, y: e.y });
      }
    }

    e.x = clamp(e.x + vx * state.dt, 0.7, state.roomW - 0.7);
    e.y = clamp(e.y + vy * state.dt, 0.7, state.roomH - 0.7);
    e.moving = Math.hypot(vx, vy) > EPS;
    e.anim = e.moving ? 'Walk' : 'Idle';
    if (e.moving) e.dir = state.dirOf(vx, vy);

    // 接触伤害
    e.touchCd -= state.dt;
    if (p.alive && e.touchCd <= 0) {
      const rr = e.radius + 0.45;
      if (dist2(e.x, e.y, p.x, p.y) < rr * rr) {
        if (hurtPlayer(state, e.touchDmg, data)) e.touchCd = bal.contactCooldown;
      }
    }
  }

  // 敌人间轻量分离（防堆叠）
  for (let i = 0; i < state.enemies.length; i++) {
    const a = state.enemies[i];
    if (a.state !== 'active') continue;
    for (let j = i + 1; j < state.enemies.length; j++) {
      const b = state.enemies[j];
      if (b.state !== 'active') continue;
      const rr = a.radius + b.radius;
      const d2 = dist2(a.x, a.y, b.x, b.y);
      if (d2 < rr * rr && d2 > EPS) {
        const d = Math.sqrt(d2);
        const push = (rr - d) * 0.5 * data.balance.enemy.separation;
        const nx = (a.x - b.x) / d, ny = (a.y - b.y) / d;
        a.x += nx * push; a.y += ny * push;
        b.x -= nx * push; b.y -= ny * push;
      }
    }
  }
}

// ---------- 波次 / 房间状态机 ----------

export function stepRoom(state, input, data) {
  const r = state.room;
  if (state.player.alive && r.state === 'combat' && state.enemies.length === 0) {
    // 当前波清空
    r.waveIdx += 1;
    if (r.waveIdx >= data.waves.length) {
      r.state = 'cleared';
      r.clearT = 0;
      state.events.push({ t: 'clear', room: r.n });
    } else {
      spawnWave(state, data);
    }
  }
  if (r.state === 'cleared') {
    r.clearT += state.dt;
    // 门开：走进北门缺口 → 下一房间（重置波次，敌人增强）
    const p = state.player;
    if (p.alive && r.clearT > 0.6 && p.y < 1.05 && Math.abs(p.x - state.roomW / 2) < 1.3) {
      r.n += 1;
      r.waveIdx = 0;
      r.state = 'combat';
      state.hpMul = data.balance.enemy.hpMul * Math.pow(data.balance.enemy.hpMulPerRoom, r.n - 1);
      p.y = state.roomH - 1.2;
      spawnWave(state, data);
      state.events.push({ t: 'room-next', room: r.n });
    }
  }
}

export function spawnWave(state, data) {
  const r = state.room;
  const wave = data.waves[Math.min(r.waveIdx, data.waves.length - 1)];
  for (const { id, n } of wave) {
    for (let k = 0; k < n; k++) {
      const spec = data.enemies[id];
      // 出生点：离玩家 ≥3.2、离其他敌人 ≥1.4、边距 1.5
      let x = 0, y = 0, ok = false;
      for (let tries = 0; tries < 24 && !ok; tries++) {
        x = 1.5 + state.rand() * (state.roomW - 3);
        y = 1.5 + state.rand() * (state.roomH - 3);
        ok = dist2(x, y, state.player.x, state.player.y) > 3.2 * 3.2
          && state.enemies.every((e) => dist2(x, y, e.x, e.y) > 1.4 * 1.4);
      }
      state.enemies.push({
        id: state.nextId++, eid: id, name: spec.name, types: spec.types,
        family: spec.family, radius: spec.radius, score: spec.score,
        hp: spec.hp * state.hpMul, maxHp: spec.hp * state.hpMul,
        touchDmg: spec.touchDmg, speed: spec.speed, spdMod: spec.spdMod,
        x, y, px: x, py: y, kx: 0, ky: 0,
        state: 'spawning', spawnT: 0.55, flash: 0, touchCd: 0,
        anim: 'Idle', dir: 0, moving: false, wanderT: 0, wx: 0, wy: 0,
        shoot: spec.shoot ? { ...spec.shoot } : null,
        shootCd: spec.shoot ? spec.shoot.firstDelay : 0,
      });
      state.events.push({ t: 'spawn', id: state.enemies[state.enemies.length - 1].id, eid: id, x, y });
    }
  }
  state.events.push({ t: 'wave-start', wave: r.waveIdx + 1, room: r.n });
}
