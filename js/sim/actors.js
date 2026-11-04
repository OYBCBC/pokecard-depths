// 战斗与房间行为系统：玩家/弹体/敌人三族/波次/多房间楼层/拾取经济/台座。
// 全部纯数据变换；事件写进 state.events 供表现层消费。
import { computeHit } from './combat.js?v=m4d';
import { fireInterval } from './combat.js?v=m4d';
import { rollItem } from './items.js?v=m4d';
import { spawnBoss, stepBoss } from './boss.js?v=m4d';

const EPS = 1e-6;
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function roomSizeFor(type, data) {
  return type === 'boss' ? [24, 16] : [17, 11];
}

/** 进入房间（含首次内容生成）。cellKey = "x,y"。
 *  离开时未拾取的东西存在 cell.stash 里（拾取物/台座），重进原样恢复——
 *  否则 Boss 房重进没楼梯、宝箱房重进道具被重 roll。 */
export function enterRoom(state, data, cellKey) {
  // 先暂存旧房未拾取的东西（任何换房路径统一在此处理；goNextFloor 前会置 room=null 跳过）
  if (state.room) {
    const oldCell = state.map.get(state.cellKey);
    if (oldCell) oldCell.stash = {
      pickups: state.pickups.map((k) => ({ ...k })),
      pedestals: state.pedestals.filter((d) => !d.taken).map((d) => ({ ...d })),
    };
  }
  const cell = state.map.get(cellKey);
  const [w, h] = roomSizeFor(cell.type, data);
  state.cellKey = cellKey;
  state.roomW = w; state.roomH = h;
  state.enemies.length = 0;
  state.projectiles.length = 0;
  state.pickups.length = 0;
  state.pedestals.length = 0;
  state.telegraphs.length = 0;
  state.room = {
    type: cell.type, w, h, cleared: !!cell.cleared, waveIdx: 0,
    firstEntry: !cell.visited, doorOpen: !!cell.cleared,
  };
  cell.visited = true;
  const p = state.player;

  if (cell.type === 'start') {
    p.x = w / 2; p.y = h / 2 + 1.5;
  } else {
    // 从南门进（默认）；door 侧由 stepRoom 的传送定位
  }

  // 恢复暂存（曾进过的房）
  const stash = cell.stash;
  if (stash) {
    for (const k of stash.pickups) state.pickups.push({ ...k });
    for (const d of stash.pedestals) state.pedestals.push({ ...d });
  }

  if (cell.cleared) {
    // 保底：已击败的 Boss 房必有楼梯（非顶层）——防暂存缺失时卡死进度
    if (cell.type === 'boss' && state.floorNo < 3 && !state.over
      && !state.pickups.some((k) => k.kind === 'stairs')) {
      state.pickups.push(mkPickup(state, 'stairs', w / 2, h / 2));
    }
    state.events.push({ t: 'room-enter', cell: cellKey, type: cell.type, cleared: true });
    return;
  }

  switch (cell.type) {
    case 'combat':
    case 'challenge':
      spawnWave(state, data);
      if (cell.type === 'challenge') state.room.waveIdx = -1;   // 挑战房 3 波（负偏移计数用）
      break;
    case 'treasure':
      if (!stash) addPedestal(state, data, 'treasure', 0);      // 有暂存则恢复原道具（防重 roll 刷道具）
      break;
    case 'shop':
      if (!stash) for (let i = 0; i < 3; i++) addPedestal(state, data, 'shop', i);
      state.room.cleared = true; state.room.doorOpen = true;
      cell.cleared = true;
      break;
    case 'secret':
      if (!stash) {
        addPedestal(state, data, 'secret', 0);
        state.pickups.push(mkPickup(state, 'heart', w / 2, h / 2 + 1.5));
      }
      state.room.cleared = true; state.room.doorOpen = true;
      cell.cleared = true;
      break;
    case 'boss':
      spawnBoss(state, data);
      break;
    case 'camp':
      // 救援营地：3 只受困宝可梦（当层敌群抽取）结伴三选一
      if (!stash) for (let i = 0; i < 3; i++) addCampPedestal(state, data, i);
      state.room.cleared = true; state.room.doorOpen = true;
      cell.cleared = true;
      break;
    default: break;
  }
  state.events.push({ t: 'room-enter', cell: cellKey, type: cell.type, cleared: false });
}

function addCampPedestal(state, data, slotIdx) {
  // 从当层敌群抽物种（排除 boss/bomber 自爆型），做成结伴台座
  const pool = state.waves.flat().map((w) => w.id).filter((id) => {
    const f = data.enemies[id] && data.enemies[id].family;
    return f && f !== 'boss' && f !== 'bomber';
  });
  if (!pool.length) return;
  const eid = pool[Math.floor(state.rand() * pool.length)];
  const spec = data.enemies[eid];
  const [w, h] = [state.roomW, state.roomH];
  state.pedestals.push({
    id: state.nextId++, itemId: 'companion:' + eid, price: 0,
    x: w / 2 + (slotIdx - 1) * 2.6, y: h / 2 - 0.5, taken: false,
  });
}

function mkPickup(state, kind, x, y, itemId) {
  return { id: state.nextId++, kind, itemId: itemId || null, x, y, px: x, py: y, bob: state.rand() * 6 };
}

function addPedestal(state, data, poolName, slotIdx) {
  let itemId;
  if (poolName === 'shop' && slotIdx === 2) {
    // 商店第三格保底消耗品（治疗树果）
    itemId = state.rand() < 0.5 ? 'sitrus-berry' : 'cheri-berry';
  } else {
    itemId = rollItem(data.items, data.itemPools, poolName, state.rand, { owned: state.player.inv.passives });
  }
  if (!itemId) return;
  const it = data.items[itemId];
  let price = 0;
  if (poolName === 'shop') {
    const base = data.balance.shop.basePrice[Math.min(slotIdx, 2)];
    price = Math.round(base + it.quality * 3);
    if (it.kind === 'consumable') price = 6;
    if (it.kind === 'stat') price = 12;
  }
  const [w, h] = [state.roomW, state.roomH];
  const x = w / 2 + (slotIdx - 1) * 2.6;
  const y = h / 2 - 0.5;
  state.pedestals.push({ id: state.nextId++, itemId, price, x, y, taken: false });
}

// ---------- 玩家 ----------

export function stepPlayer(state, input, data) {
  const p = state.player;
  const bal = data.balance.player;
  p.px = p.x; p.py = p.y;

  if (!p.alive) { p.deathT += state.dt; return; }

  // Q 切换 A/B 槽
  if (input.slotEdge) {
    if (p.slot === 'A' && p.moveB && !p.mods.lockB) p.slot = 'B';
    else p.slot = 'A';
  }
  // E 使用消耗品
  if (input.useEdge && p.inv.consumable) {
    const it = data.items[p.inv.consumable];
    if (it.effect.heal) p.hp = Math.min(p.maxHp, p.hp + it.effect.heal);
    if (it.effect.evolve && state.floorNo >= 2 && !p.evolved) {
      p.evolved = true; p.species = it.effect.evolve;
      engine_recompute(state, data);
      state.events.push({ t: 'evolve', to: it.effect.evolve, name: '雷丘' });
    }
    state.events.push({ t: 'use-consumable', id: p.inv.consumable, heal: it.effect.heal });
    p.inv.consumable = null;
  }

  // R：Z 招式（PP 满）或死亡重开由 main 处理
  if (input.zEdge && p.pp >= 100 * p.mods.ppCost) {
    const zid = p.evolved ? 'thunder-z' : 'thunderbolt-z';
    const zm = data.moves[zid];
    p.pp = 0;
    // 全场/近场 AoE：以玩家为圆心
    const D = p.stats.damage;
    let hits = 0;
    for (const e of state.enemies) {
      if (e.state === 'spawning' || e.state === 'dead') continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d <= zm.radius) {
        e.hp -= D * (zm.power / 40) * 0.5;            // AoE 打 5 折换覆盖面
        e.flash = 0.2;
        const kd = Math.hypot(e.x - p.x, e.y - p.y) || 1;
        e.kx = (e.x - p.x) / kd * 9; e.ky = (e.y - p.y) / kd * 9;
        if (e.hp <= 0) killEnemy(state, e, 'super');
        hits++;
      }
    }
    state.events.push({ t: 'zmove', id: zid, name: zm.name, x: p.x, y: p.y, radius: zm.radius, hits });
  }

  // F：换替补同行（换人瞬间无敌 0.5s）
  if (input.swapEdge && p.companion && p.companion.hp > 0) {
    p.activeSide = p.activeSide === 'main' ? 'companion' : 'main';
    p.iframes = Math.max(p.iframes, 0.5);
    state.events.push({ t: 'companion-swap', side: p.activeSide, name: p.activeSide === 'companion' ? p.companion.name : (p.evolved ? '雷丘' : '皮卡丘') });
  }

  // 冲刺
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
      vx = mv.x * k * p.stats.moveSpeed;
      vy = mv.y * k * p.stats.moveSpeed;
      p.lastDir = { x: mv.x * k, y: mv.y * k };
    }
  }
  p.x = clamp(p.x + vx * state.dt, 0.75, state.roomW - 0.75);
  p.y = clamp(p.y + vy * state.dt, 0.75, state.roomH - 0.75);
  p.moving = Math.hypot(vx, vy) > EPS;
  p.anim = p.moving || p.dashActive ? 'Walk' : 'Idle';
  if (p.moving) p.dir = state.dirOf(vx, vy);

  if (p.iframes > 0) p.iframes -= state.dt;

  // 冲刺撞隐藏房的裂缝墙 → 揭示
  if (p.dashActive) tryRevealSecret(state, data);

  // 射击
  p.fireCd -= state.dt;
  if (input.fire && p.fireCd <= 0) {
    const moveId = p.slot === 'B' && p.moveB && !p.mods.lockB ? p.moveB : p.moveA;
    const mv = data.moves[moveId];
    const aim = input.aim;
    const l = Math.hypot(aim.x, aim.y) || 1;
    const m = p.mods;
    state.projectiles.push({
      owner: 'player', id: state.nextId++, moveId,
      x: p.x, y: p.y, px: p.x, py: p.y,
      vx: aim.x / l * mv.speed * m.shotSpeedMul,
      vy: aim.y / l * mv.speed * m.shotSpeedMul,
      life: (mv.range * m.rangeMul) / mv.speed,
      radius: mv.radius * m.sizeMul,
      pierceLeft: m.pierce, hitIds: [],
    });
    p.fireCd = p.stats.fireInterval;
    state.stats.shots += 1;
    state.events.push({ t: 'shot', x: p.x, y: p.y, moveId });
  }
}

function tryRevealSecret(state, data) {
  const cell = state.map.get(state.cellKey);
  const p = state.player;
  const GAP = 1.3;
  for (const [dkey, dtype] of Object.entries(cell.doors)) {
    if (dtype !== 'secret') continue;
    const [dx, dy] = dkey.split(',').map(Number);
    const atN = dy === -1 && p.y <= 1.0 && Math.abs(p.x - state.roomW / 2) < GAP;
    const atS = dy === 1 && p.y >= state.roomH - 1.0 && Math.abs(p.x - state.roomW / 2) < GAP;
    const atW = dx === -1 && p.x <= 1.0 && Math.abs(p.y - state.roomH / 2) < GAP;
    const atE = dx === 1 && p.x >= state.roomW - 1.0 && Math.abs(p.y - state.roomH / 2) < GAP;
    if (atN || atS || atW || atE) {
      cell.doors[dkey] = 'revealed';
      // 对面房也标记
      const other = state.map.get((cell.x + dx) + ',' + (cell.y + dy));
      if (other) other.doors[(-dx) + ',' + (-dy)] = 'revealed';
      state.events.push({ t: 'secret-reveal', side: dkey });
      state.events.push({ t: 'secret-found' });
      return;
    }
  }
}

export function hurtPlayer(state, dmg, data) {
  const p = state.player;
  if (!p.alive || p.iframes > 0 || p.dashActive) return false;
  const m = p.mods;
  // 闪避
  if (m.dodge > 0 && state.rand() < m.dodge) {
    state.events.push({ t: 'player-dodge', x: p.x, y: p.y });
    p.iframes = 0.4;
    return false;
  }
  // 格挡
  if (m.blockChance > 0 && state.rand() < m.blockChance) {
    state.events.push({ t: 'player-block', x: p.x, y: p.y });
    p.iframes = 0.4;
    return false;
  }
  if (m.hurtResist > 0 && state.rand() < m.hurtResist) dmg = Math.max(1, dmg - 1);
  // 替补同行承受伤害（激活侧为 companion 时先扣替补）
  if (p.activeSide === 'companion' && p.companion && p.companion.hp > 0) {
    p.companion.hp -= dmg;
    p.iframes = data.balance.player.iframesOnHurt;
    if (p.companion.hp <= 0) {
      state.events.push({ t: 'companion-faint', name: p.companion.name });
      p.activeSide = 'main';
      p.iframes = Math.max(p.iframes, 1.0);
    } else {
      state.events.push({ t: 'player-hurt', dmg, x: p.x, y: p.y, hp: Math.max(p.hp, 0), absorbed: p.companion.name });
    }
    return true;
  }
  p.hp -= dmg;
  p.iframes = data.balance.player.iframesOnHurt;
  state.events.push({ t: 'player-hurt', dmg, x: p.x, y: p.y, hp: Math.max(p.hp, 0) });
  if (p.hp <= 0) {
    // 气势披带：每层一次保命
    if (m.lethalGuard && !p.lethalGuardUsed) {
      p.lethalGuardUsed = true;
      p.hp = 1;
      state.events.push({ t: 'lethal-guard' });
    } else {
      p.hp = 0; p.alive = false; p.deathT = 0;
      state.events.push({ t: 'player-die', x: p.x, y: p.y });
    }
  }
  return true;
}

// ---------- 弹体 ----------

export function stepProjectiles(state, data) {
  const bal = data.balance;
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const b = state.projectiles[i];
    b.px = b.x; b.py = b.y;
    // 追踪
    if (b.owner === 'player' && state.player.mods.homing > 0) {
      let tgt = null, nd = 1e9;
      for (const e of state.enemies) {
        if (e.state === 'spawning' || e.state === 'dead') continue;
        const d = dist2(b.x, b.y, e.x, e.y);
        if (d < nd) { nd = d; tgt = e; }
      }
      if (tgt) {
        const sp = Math.hypot(b.vx, b.vy);
        const dx = tgt.x - b.x, dy = tgt.y - b.y;
        const l = Math.hypot(dx, dy) || 1;
        const turn = state.player.mods.homing;
        b.vx += (dx / l * sp - b.vx) * turn;
        b.vy += (dy / l * sp - b.vy) * turn;
        const ns = Math.hypot(b.vx, b.vy) || 1;
        b.vx = b.vx / ns * sp; b.vy = b.vy / ns * sp;
      }
    }
    b.x += b.vx * state.dt;
    b.y += b.vy * state.dt;
    b.life -= state.dt;
    let dead = b.life <= 0;
    if (b.x < 0.55 || b.x > state.roomW - 0.55 || b.y < 0.55 || b.y > state.roomH - 0.55) {
      // 弹力球：反弹
      if (b.owner === 'player' && state.player.mods.bounce > 0 && b.bounces == null) b.bounces = 0;
      if (b.owner === 'player' && b.bounces != null && b.bounces < state.player.mods.bounce) {
        b.bounces++;
        if (b.x < 0.55 || b.x > state.roomW - 0.55) b.vx = -b.vx;
        if (b.y < 0.55 || b.y > state.roomH - 0.55) b.vy = -b.vy;
        b.x = clamp(b.x, 0.6, state.roomW - 0.6);
        b.y = clamp(b.y, 0.6, state.roomH - 0.6);
        dead = false;
      } else {
        dead = true;
        state.events.push({ t: 'shot-die', x: b.x, y: b.y, wall: true });
      }
    }
    if (dead) { state.projectiles.splice(i, 1); continue; }

    if (b.owner === 'player') {
      for (const e of state.enemies) {
        if (e.state === 'spawning' || e.state === 'dead') continue;
        if (b.hitIds && b.hitIds.includes(e.id)) continue;
        const rr = b.radius + e.radius;
        if (dist2(b.x, b.y, e.x, e.y) < rr * rr) {
          applyHit(state, e, b, data);
          if (b.pierceLeft > 0) {
            b.pierceLeft -= 1;
            b.hitIds.push(e.id);
          } else {
            state.projectiles.splice(i, 1);
          }
          break;
        }
      }
    } else {
      const p = state.player;
      if (p.alive) {
        const rr = b.radius + 0.45;
        if (dist2(b.x, b.y, p.x, p.y) < rr * rr) {
          if (state.hurtPlayer(1)) { state.projectiles.splice(i, 1); continue; }
        }
      }
    }
  }
}

function applyHit(state, e, b, data) {
  const p = state.player;
  const mv = data.moves[b.moveId];
  const m = p.mods;
  const species = data.species.player;
  let spdMod = e.spdMod;
  const hit = computeHit({
    D: p.stats.damage, power: mv.power, moveType: mv.type,
    atkTypes: species.types, defTypes: e.types, spdMod,
    critChance: m.crit, rng01: state.rand(),
    stabMul: 1.5, chart: data.typechart,
    immuneFloor: e.family === 'boss' ? 0.5 : 0,      // 防卡关：Boss 免疫按 ×0.5
  });
  let dmg = hit.dmg;
  // 属性增伤道具（木炭/磁铁/神秘水滴）
  if (m.typeMul[mv.type]) dmg *= m.typeMul[mv.type];
  // 克制加成（达人带）
  if (hit.kind === 'super') dmg *= 1 + m.superBonus;
  // 打草结：对重型敌加成
  if (mv.heavyBonus && e.score >= 4) dmg *= mv.heavyBonus;
  // 分裂子弹伤害衰减
  if (b.splitChild) dmg *= 0.4;

  e.hp -= dmg;
  e.flash = 0.12;
  const kl = Math.hypot(b.vx, b.vy) || 1;
  e.kx = (b.vx / kl) * data.balance.enemy.knockback * m.knockMul;
  e.ky = (b.vy / kl) * data.balance.enemy.knockback * m.knockMul;
  // 畏缩（王者之证）
  if (m.flinch > 0 && state.rand() < m.flinch && e.family !== 'boss') e.stun = 0.6;
  state.stats.dmgDealt += dmg;
  if (hit.kind === 'super') state.stats.superHits += 1;
  state.player.pp = Math.min(100, state.player.pp + dmg * data.balance.player.ppPerDamage * (hit.kind === 'super' ? data.balance.player.ppSuperMul : 1) * m.ppMul);

  // 分裂种子
  if (m.split && !b.splitChild && e.hp > 0) {
    const a0 = Math.atan2(b.vy, b.vx);
    for (const da of [-0.5, 0.5]) {
      state.projectiles.push({
        owner: 'player', id: state.nextId++, moveId: b.moveId,
        x: b.x, y: b.y, px: b.x, py: b.y,
        vx: Math.cos(a0 + da) * Math.hypot(b.vx, b.vy),
        vy: Math.sin(a0 + da) * Math.hypot(b.vx, b.vy),
        life: 0.3, radius: b.radius * 0.7, pierceLeft: 0, hitIds: [], splitChild: true,
      });
    }
  }

  if (e.hp <= 0) {
    killEnemy(state, e, hit.kind);
    // 大根茎：击杀回血
    if (m.killHeal > 0 && state.rand() < m.killHeal && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + 1);
      state.events.push({ t: 'kill-heal', x: e.x, y: e.y });
    }
  } else {
    state.events.push({ t: 'enemy-hurt', id: e.id, x: e.x, y: e.y, dmg: b.splitChild ? dmg : dmg, kind: hit.kind });
  }
}

function killEnemy(state, e, kind = 'normal') {
  if (e.state === 'dead') return;
  // 分裂（臭泥）：死时裂两只小的
  if (e.splitOnDeath && state.enemies && !e.isSplitChild) {
    const spec = state._data && state._data.enemies && state._data.enemies[e.splitOnDeath];
    if (spec) {
      for (let i = 0; i < 2; i++) {
        const ang = state.rand() * Math.PI * 2;
        state.enemies.push({
          id: state.nextId++, eid: e.splitOnDeath, name: spec.name, types: spec.types,
          family: spec.family, radius: spec.radius * 0.7, score: spec.score,
          hp: spec.hp * state.hpMul, maxHp: spec.hp * state.hpMul,
          touchDmg: spec.touchDmg, speed: spec.speed * 1.3, spdMod: spec.spdMod,
          x: clamp(e.x + Math.cos(ang) * 0.5, 0.7, state.roomW - 0.7),
          y: clamp(e.y + Math.sin(ang) * 0.5, 0.7, state.roomH - 0.7),
          px: e.x, py: e.y, kx: 0, ky: 0,
          state: 'spawning', spawnT: 0.3, flash: 0, touchCd: 0, stun: 0,
          anim: 'Idle', dir: 0, moving: false, wanderT: 0, wx: 0, wy: 0,
          shoot: spec.shoot ? { ...spec.shoot } : null, shootCd: 1.2,
          isSplitChild: true,
        });
        state.events.push({ t: 'spawn', id: state.enemies[state.enemies.length - 1].id, eid: e.splitOnDeath,
          x: state.enemies[state.enemies.length - 1].x, y: state.enemies[state.enemies.length - 1].y });
      }
    }
  }
  e.state = 'dead';
  state.stats.kills += 1;
  state.events.push({ t: 'enemy-die', id: e.id, eid: e.eid, x: e.x, y: e.y, kind, name: e.name });
}

// ---------- 敌人 ----------

export function stepEnemies(state, input, data) {
  const p = state.player;
  const bal = data.balance.enemy;
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    e.px = e.x; e.py = e.y;
    if (e.hp <= 0 && e.state !== 'dead') killEnemy(state, e);
    if (e.state === 'dead') {
      // Boss 死亡 → 楼层通关
      if (e.family === 'boss') {
        state.room.cleared = true;
        state.map.get(state.cellKey).cleared = true;
        state.stats.tRun = state.t - state.stats.t0;
        if (state.floorNo >= 3) {
          state.over = true; state.win = true;
          state.events.push({ t: 'floor-clear', x: e.x, y: e.y });
        } else {
          state.events.push({ t: 'boss-clear', floor: state.floorNo, x: e.x, y: e.y });
          // 楼梯 + 撒钱
          state.pickups.push(mkPickup(state, 'stairs', state.roomW / 2, state.roomH / 2));
          for (let k = 0; k < 6; k++) {
            state.pickups.push(mkPickup(state, 'coin', e.x + (state.rand() - 0.5) * 2.5, e.y + (state.rand() - 0.5) * 2.5));
          }
        }
      }
      state.enemies.splice(i, 1);
      continue;
    }
    if (e.flash > 0) e.flash -= state.dt;

    // 出生状态转移对所有族（含 Boss）生效——否则 Boss 永远无敌（弹体跳过 spawning）
    if (e.state === 'spawning') {
      e.spawnT -= state.dt;
      if (e.spawnT <= 0) e.state = 'active';
      continue;
    }

    if (e.family === 'boss') { stepBoss(state, e, data); continue; }
    if (e.stun > 0) { e.stun -= state.dt; e.anim = 'Hurt'; e.moving = false; continue; }

    if (Math.abs(e.kx) > EPS || Math.abs(e.ky) > EPS) {
      e.x += e.kx * state.dt; e.y += e.ky * state.dt;
      const decay = Math.max(0, 1 - bal.knockbackDecay * state.dt);
      e.kx *= decay; e.ky *= decay;
    }

    let vx = 0, vy = 0;
    if (e.family === 'bomber') {
      // 追击 → 进入半径进入引信 → 爆炸（预警圈）后死亡
      const dx = p.x - e.x, dy = p.y - e.y;
      const l = Math.hypot(dx, dy) || 1;
      if (!e.fusing) {
        vx = dx / l * e.speed; vy = dy / l * e.speed;
        if (l < e.bombRadius * 0.75) {
          e.fusing = e.fuse;
          state.telegraphs.push({ x: e.x, y: e.y, r: e.bombRadius, t: e.fuse, dmg: e.bombDmg, kind: 'bomb', owner: e.id });
          state.events.push({ t: 'bomb-fuse', id: e.id, x: e.x, y: e.y, r: e.bombRadius });
        }
      } else {
        e.fusing -= state.dt;
        vx = dx / l * e.speed * 0.35; vy = dy / l * e.speed * 0.35;   // 引信期仍缓慢逼近
        // 同步预警圈位置
        for (const t of state.telegraphs) if (t.owner === e.id) { t.x = e.x; t.y = e.y; }
        if (e.fusing <= 0) { e.hp = 0; killEnemy(state, e, 'normal'); }
      }
    } else if (e.family === 'thief') {
      // 接近→偷钱→逃向门口方向；stealth（变隐龙）接触前半透明
      const dx = p.x - e.x, dy = p.y - e.y;
      const l = Math.hypot(dx, dy) || 1;
      if (!e.fleeing) {
        vx = dx / l * e.speed; vy = dy / l * e.speed;
        if (l < 0.95 && p.money > 0) {
          const amt = Math.min(p.money, e.steal || 1);
          p.money -= amt;
          e.fleeing = true;
          state.events.push({ t: 'steal', id: e.id, amt, x: e.x, y: e.y });
        }
      } else {
        vx = -dx / l * e.speed * 1.2; vy = -dy / l * e.speed * 1.2;
      }
    } else if (e.family === 'blinker') {
      // 周期瞬移到玩家附近 → 射击
      e.blinkT = (e.blinkT || e.blinkCooldown) - state.dt;
      if (e.blinkT <= 0) {
        e.blinkT = e.blinkCooldown * (0.85 + state.rand() * 0.3);
        const a = state.rand() * Math.PI * 2;
        const nx = clamp(p.x + Math.cos(a) * 3.2, 1.2, state.roomW - 1.2);
        const ny = clamp(p.y + Math.sin(a) * 3.2, 1.2, state.roomH - 1.2);
        state.events.push({ t: 'blink', id: e.id, from: [e.x, e.y], to: [nx, ny] });
        e.x = nx; e.y = ny; e.px = nx; e.py = ny;
      }
      if (e.shoot) {
        e.shootCd -= state.dt;
        if (e.shootCd <= 0 && p.alive) {
          const base = Math.atan2(p.y - e.y, p.x - e.x);
          const mv = data.moves[e.shoot.move];
          state.projectiles.push({
            owner: 'enemy', id: state.nextId++, moveId: e.shoot.move,
            x: e.x, y: e.y, px: e.x, py: e.y,
            vx: Math.cos(base) * mv.speed, vy: Math.sin(base) * mv.speed,
            life: mv.range / mv.speed, radius: mv.radius,
          });
          e.shootCd = e.shoot.cooldown * (0.85 + state.rand() * 0.3);
        }
      }
    } else if (e.family === 'charger') {
      const dx = p.x - e.x, dy = p.y - e.y;
      const l = Math.hypot(dx, dy) || 1;
      if (e.lunge) {
        // 扑击循环：蓄 0.8s → 冲 0.35s（×2.6 速）
        e.lungeT = (e.lungeT === undefined ? 1.0 : e.lungeT) - state.dt;
        if (e.lungeT <= -0.35) e.lungeT = 0.8 + state.rand() * 0.5;
        const lunging = e.lungeT <= 0;
        const spd = e.speed * (lunging ? 2.6 : 0.5);
        vx = dx / l * spd; vy = dy / l * spd;
      } else {
        vx = dx / l * e.speed; vy = dy / l * e.speed;
      }
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
            owner: 'enemy', id: state.nextId++, moveId: e.shoot.move,
            x: e.x, y: e.y, px: e.x, py: e.y,
            vx: Math.cos(a) * mv.speed, vy: Math.sin(a) * mv.speed,
            life: mv.range / mv.speed, radius: mv.radius,
          });
        }
        e.shootCd = e.shoot.cooldown * (0.85 + state.rand() * 0.3);
        state.events.push({ t: 'enemy-shoot', x: e.x, y: e.y });
      }
    }

    if (e.passWalls) {
      // 鬼斯穿墙：超界从另一侧回卷
      e.x = ((e.x + vx * state.dt) % state.roomW + state.roomW) % state.roomW;
      e.y = ((e.y + vy * state.dt) % state.roomH + state.roomH) % state.roomH;
    } else {
      e.x = clamp(e.x + vx * state.dt, 0.7, state.roomW - 0.7);
      e.y = clamp(e.y + vy * state.dt, 0.7, state.roomH - 0.7);
    }
    e.moving = Math.hypot(vx, vy) > EPS;
    e.anim = e.moving ? 'Walk' : 'Idle';
    if (e.moving) e.dir = state.dirOf(vx, vy);

    e.touchCd -= state.dt;
    if (p.alive && e.touchCd <= 0) {
      const rr = e.radius + 0.45;
      if (dist2(e.x, e.y, p.x, p.y) < rr * rr) {
        if (state.hurtPlayer(e.touchDmg)) e.touchCd = bal.contactCooldown;
      }
    }
  }

  // 敌人分离
  for (let i = 0; i < state.enemies.length; i++) {
    const a = state.enemies[i];
    if (a.state !== 'active' || a.family === 'boss') continue;
    for (let j = i + 1; j < state.enemies.length; j++) {
      const b = state.enemies[j];
      if (b.state !== 'active' || b.family === 'boss') continue;
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

// ---------- 波次 / 房间 / 传送 / 拾取 / 台座 ----------

export function spawnWave(state, data) {
  const cell = state.map.get(state.cellKey);
  const waves = state.waves || data.waves;
  const waveDef = waves[Math.min(Math.max(state.room.waveIdx, 0), waves.length - 1)];
  for (const { id, n } of waveDef) {
    for (let k = 0; k < n; k++) {
      const spec = data.enemies[id];
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
        state: 'spawning', spawnT: 0.55, flash: 0, touchCd: 0, stun: 0,
        anim: 'Idle', dir: 0, moving: false, wanderT: 0, wx: 0, wy: 0,
        shoot: spec.shoot ? { ...spec.shoot } : null,
        shootCd: spec.shoot ? spec.shoot.firstDelay : 0,
      });
      state.events.push({ t: 'spawn', id: state.enemies[state.enemies.length - 1].id, eid: id, x, y });
    }
  }
  state.events.push({ t: 'wave-start', wave: state.room.waveIdx + 1 });
}

export function stepRoom(state, input, data) {
  state._data = data;
  const r = state.room;
  const cell = state.map.get(state.cellKey);
  const p = state.player;

  // 波次推进
  if (!r.cleared && p.alive && state.enemies.length === 0 && (cell.type === 'combat' || cell.type === 'challenge')) {
    const totalWaves = cell.type === 'challenge' ? 3 : data.waves.length;
    if (r.waveIdx + 1 >= totalWaves) {
      clearRoom(state, data, cell);
    } else {
      r.waveIdx += 1;
      spawnWave(state, data);
    }
  }
  // 非战斗房直接算清空（treasure 拿完台座清、shop/secret 入内即清）
  if (!r.cleared && cell.type === 'treasure' && state.pedestals.every((d) => d.taken)) {
    clearRoom(state, data, cell);
  }

  // 拾取
  stepPickups(state, data);

  // 台座交互（接触购买/拾取）
  for (const d of state.pedestals) {
    if (d.taken) continue;
    if (dist2(p.x, p.y, d.x, d.y) < 0.85 * 0.85 && p.alive) {
      if (d.price > 0) {
        if (p.money >= d.price) {
          p.money -= d.price;
          takePedestal(state, data, d);
        }
      } else {
        takePedestal(state, data, d);
      }
    }
  }

  // 门传送（清空后才开门）
  if (!r.cleared || !p.alive) return;
  const GAP = 1.3;
  for (const [dkey, dtype] of Object.entries(cell.doors)) {
    if (dtype === 'secret') continue;             // 未揭示的隐藏门不可通行
    const [dx, dy] = dkey.split(',').map(Number);
    let hit = false;
    if (dy === -1) hit = p.y <= 0.78 && Math.abs(p.x - r.w / 2) < GAP;
    if (dy === 1) hit = p.y >= r.h - 0.78 && Math.abs(p.x - r.w / 2) < GAP;
    if (dx === -1) hit = p.x <= 0.78 && Math.abs(p.y - r.h / 2) < GAP;
    if (dx === 1) hit = p.x >= r.w - 0.78 && Math.abs(p.y - r.h / 2) < GAP;
    if (!hit) continue;
    const nk = (cell.x + dx) + ',' + (cell.y + dy);
    const prevH = r.h, prevW = r.w;
    enterRoom(state, data, nk);
    // 从对侧门进入
    p.x = clamp(p.x, 1.5, state.roomW - 1.5);
    p.y = clamp(p.y, 1.5, state.roomH - 1.5);
    if (dy !== 0) p.y = dy === -1 ? state.roomH - 1.4 : 1.4;
    if (dx !== 0) p.x = dx === -1 ? state.roomW - 1.4 : 1.4;
    p.px = p.x; p.py = p.y;
    state.events.push({ t: 'room-transition', from: cell.x + ',' + cell.y, to: nk, dir: dkey });
    return;
  }
}

function clearRoom(state, data, cell) {
  state.room.cleared = true;
  state.room.doorOpen = true;
  cell.cleared = true;
  state.stats.roomsCleared += 1;
  // 剩饭：每清一房回血
  const m = state.player.mods;
  if (m.regenRoom > 0 && state.player.hp < state.player.maxHp) {
    const heal = Math.min(m.regenRoom, state.player.maxHp - state.player.hp);
    state.player.hp += heal;
    state.events.push({ t: 'regen', heal });
  }
  // 挑战房奖励
  if (cell.type === 'challenge') addPedestal(state, data, 'challenge', 1);
  // 掉落（普通战斗房）
  if (cell.type === 'combat') rollDrop(state, data);
  state.events.push({ t: 'clear', cell: state.cellKey, type: cell.type });
}

function rollDrop(state, data) {
  const luck = 0;
  const roll = state.rand() + luck * 0.1;
  for (const [limit, kind] of data.balance.pickup.dropBands) {
    if (roll < limit) {
      if (kind) {
        const [w, h] = [state.roomW, state.roomH];
        let x = 2 + state.rand() * (w - 4), y = 2 + state.rand() * (h - 4);
        state.pickups.push(mkPickup(state, kind, x, y));
      }
      return;
    }
  }
}

function stepPickups(state, data) {
  const p = state.player;
  const m = p.mods;
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const k = state.pickups[i];
    k.px = k.x; k.py = k.y;
    const dx = p.x - k.x, dy = p.y - k.y;
    const d = Math.hypot(dx, dy);
    if (m.magnet > 0 && d < m.magnet && d > 0.01) {
      k.x += (dx / d) * data.balance.pickup.magnetSpeed * state.dt;
      k.y += (dy / d) * data.balance.pickup.magnetSpeed * state.dt;
    }
    if (d < 0.55 && p.alive) {
      let taken = true;
      switch (k.kind) {
        case 'stairs':
          goNextFloor(state, data);
          return;                                     // 房间已重建，拾取列表已清
        case 'coin': p.money += 1; state.stats.coins += 1; break;
        case 'coin2': p.money += 2; state.stats.coins += 2; break;
        case 'heart':
          if (p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + data.balance.pickup.heartHeal); state.events.push({ t: 'heal', heal: data.balance.pickup.heartHeal }); }
          else taken = false;
          break;
        case 'consumable':
          if (!p.inv.consumable) p.inv.consumable = k.itemId;
          else taken = false;
          break;
        default: break;
      }
      if (taken) {
        state.events.push({ t: 'pickup', kind: k.kind, itemId: k.itemId, x: k.x, y: k.y });
        state.pickups.splice(i, 1);
      }
    }
  }
}

function takePedestal(state, data, d) {
  const p = state.player;
  // 结伴台座（救援营地）——itemId 形如 companion:poliwag，不在 items 表
  if (d.itemId.startsWith('companion:')) {
    const eid = d.itemId.slice('companion:'.length);
    const spec = data.enemies[eid];
    if (spec) {
      p.companion = {
        eid, name: spec.name, types: spec.types,
        hp: 4 + Math.floor(spec.score), maxHp: 4 + Math.floor(spec.score),
        moveA: spec.shoot ? spec.shoot.move : 'quick-attack',
      };
      state.events.push({ t: 'companion-join', name: spec.name, eid });
    }
    d.taken = true;
    return;
  }
  const it = data.items[d.itemId];
  d.taken = true;
  switch (it.kind) {
    case 'passive':
      if (it.effect.tm) {
        // 只保留最新技能机
        p.inv.passives = p.inv.passives.filter((id) => !data.items[id].effect.tm);
      }
      p.inv.passives.push(d.itemId);
      break;
    case 'stat':
      p.inv.passives.push(d.itemId);
      if (it.effect.maxHp) p.hp += it.effect.maxHp;      // 血上限类立即回满增量
      break;
    case 'consumable':
      if (d.itemId === 'thunder-stone') {
        // 雷之石：即拾即用（第 2 层起进化）
        if (state.floorNo >= 2 && !p.evolved) {
          p.evolved = true; p.species = 'raichu';
          engine_recompute(state, data);
          state.events.push({ t: 'evolve', to: 'raichu', name: '雷丘' });
        } else {
          p.inv.consumable = d.itemId;                 // 不满足条件先存着
          state.events.push({ t: 'item-take', id: d.itemId, name: it.name, desc: state.floorNo < 2 ? '（第 2 层起可用）' : it.desc, icon: it.icon, quality: it.quality, kind: it.kind, price: 0 });
          return;
        }
        break;
      }
      p.inv.consumable = d.itemId; break;
    case 'trinket': p.inv.trinket = d.itemId; break;
    case 'badge': p.inv.badges.push(d.itemId); break;
    default: break;
  }
  state.stats.items += 1;
  state.events.push({ t: 'item-take', id: d.itemId, name: it.name, desc: it.desc, icon: it.icon, quality: it.quality, kind: it.kind, price: d.price });
  // 重新计算面板
  engine_recompute(state, data);
}

// 规避循环 import：engine.recompute 通过事件总线由调用方重算——这里直接内联等价逻辑
import { recompute as engine_recompute, goNextFloor } from './engine.js?v=m4d';
