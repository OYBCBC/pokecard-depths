// 无头平衡模拟：机器人通整层（探图→清房→购物→Boss），输出节奏/生存/经济。
// 用法：node tools/sim.mjs [局数] [种子基数]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';
const D = (f) => JSON.parse(readFileSync(join(ROOT, 'js/data', f), 'utf8'));
const { createRun, stepRun, STEP } = await import(join(ROOT, 'js/sim/engine.js?v=m4h'));

const tc = D('typechart.json'), ed = D('enemies.json'), mv = D('moves.json'), bal = D('balance.json'), itemsDoc = D('items.json');
const fl = D('floors.json');
const data = {
  typechart: tc.chart, enemies: ed.enemies, moves: mv.moves, items: itemsDoc.items,
  itemPools: itemsDoc.poolConfig, balance: bal, waves: fl.floors['1'].waves, floors: fl.floors,
  species: { player: { types: ['electric'] } }, floorNo: 1,
};

const GAMES = Number(process.argv[2] || 20);
const SEED0 = Number(process.argv[3] || 1000);
const DIRS4 = { '0,-1': [0, -1], '0,1': [0, 1], '-1,0': [-1, 0], '1,0': [1, 0] };

function botInput(run, mode) {
  const p = run.player;
  const w = run.roomW, h = run.roomH;
  let nearest = null, nd = 1e9;
  for (const e of run.enemies) {
    if (e.state === 'spawning' || e.family === 'boss') continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < nd) { nd = d; nearest = e; }
  }
  const boss = run.enemies.find((e) => e.family === 'boss');
  const tgt = nearest || boss;
  let move = { x: 0, y: 0 };
  let goal = null;

  if (tgt) {
    const dx = tgt.x - p.x, dy = tgt.y - p.y, l = Math.hypot(dx, dy) || 1;
    if (boss) {
      // 钻地期改绕“出土点”保持 3+ 距离（绕地下位置会被吸回吃出土接触）
      const anchor = boss.hidden && boss.b.burrowAt ? boss.b.burrowAt : boss;
      const adx = anchor.x - p.x, ady = anchor.y - p.y, al = Math.hypot(adx, ady) || 1;
      // Boss 战：近身 2.5 格内纯径向逃离（防墙角贴脸），否则 5~6.5 格环绕
      if (al < (boss.hidden ? 3.0 : 2.5)) { move = { x: -adx / al, y: -ady / al }; }
      else {
      // 常驻离墙：贴墙时向房心混 35%（防被逼进角落吃接触）
      const tang = ((p.x * 0.7 + p.y * 1.3) % 2 + 2) % 2 < 1 ? 1 : -1;
      const ideal = 5.8;
      const radial = l < ideal - 0.8 ? 1 : l > ideal + 0.8 ? -1 : 0;
      move = { x: (-dx / l) * radial + (-dy / l) * tang, y: (-dy / l) * radial + (dx / l) * tang };
      const wallMix = (p.x < 2.2 || p.x > w - 2.2 || p.y < 2.2 || p.y > h - 2.2) ? 0.35 : 0;
      if (wallMix) {
        const cx = w / 2 - p.x, cy = h / 2 - p.y, cl = Math.hypot(cx, cy) || 1;
        move = { x: move.x * (1 - wallMix) + (cx / cl) * wallMix, y: move.y * (1 - wallMix) + (cy / cl) * wallMix };
      }
      // 冲锋进行中：垂直于冲锋方向规避
      if (boss.b.mode === 'charge' && boss.b.chargeDir) {
        const cd = boss.b.chargeDir;
        const side = (p.x * 0.3 + p.y * 0.7) % 1 < 0.5 ? 1 : -1;
        move = { x: -cd.y * side, y: cd.x * side };
      }
      }
    } else if (mode === 'kite') {
      if (l < 2.6) move = { x: -dx / l, y: -dy / l };
      else if (l > 4.5) move = { x: dx / l, y: dy / l };
    } else if (l > 5.2) move = { x: dx / l, y: dy / l };
    // 强躲预警圈 / 敌弹（覆盖其它意图；伤害圈优先于纯预警的冲锋线）
    let fled = false;
    const sorted = [...run.telegraphs].sort((a, c) => (c.dmg > 0) - (a.dmg > 0));
    for (const t of sorted) {
      const tx = t.x - p.x, ty = t.y - p.y, tl = Math.hypot(tx, ty);
      if (t.kind === 'charge-line' && tl < t.r + 1.6) {
        // 冲锋线：垂直方向逃离（若同帧还有伤害圈则交给下一轮）
        if (sorted.some((o) => o.dmg > 0 && Math.hypot(o.x - p.x, o.y - p.y) < o.r + 1.4)) continue;
        const px = -ty / (tl || 1), py = tx / (tl || 1);
        const side = (p.x * 0.3 + p.y * 0.7) % 1 < 0.5 ? 1 : -1;
        move = { x: px * side, y: py * side };
        fled = true; break;
      }
      if (t.dmg > 0 && tl < t.r + 1.4) {
        let ex = tx / (tl || 1), ey = ty / (tl || 1);
        // 贴墙时混入朝房心分量（0.5），并归一化保满速
        const cxw = w / 2 - p.x, cyw = h / 2 - p.y;
        if (p.x < 2.5 || p.x > w - 2.5 || p.y < 2.5 || p.y > h - 2.5) {
          const cl2 = Math.hypot(cxw, cyw) || 1;
          ex = ex * 0.5 + (cxw / cl2) * 0.5;
          ey = ey * 0.5 + (cyw / cl2) * 0.5;
        }
        const el = Math.hypot(ex, ey) || 1;
        move = { x: ex / el, y: ey / el }; fled = true; break;
      }
    }
    if (fled) void move;
    for (const b of run.projectiles) {
      if (b.owner !== 'enemy') continue;
      const bx = b.x - p.x, by = b.y - p.y, bl = Math.hypot(bx, by);
      if (bl < 1.6) { move = { x: bx / (bl || 1), y: by / (bl || 1) }; break; }
    }
  } else if ((run.room.cleared || ['treasure', 'shop', 'secret'].includes(run.room.type)) && !run.over) {
    // 优先级：钱/免费台座 > 可支付台座 > 未清房间的门
    for (const k of run.pickups) {
      const d = Math.hypot(k.x - p.x, k.y - p.y);
      if (!goal || d < goal.d) goal = { x: k.x, y: k.y, d };
    }
    if (!goal) {
      for (const d of run.pedestals) {
        if (d.taken || d.price > p.money) continue;
        const dist = Math.hypot(d.x - p.x, d.y - p.y);
        if (!goal || dist < goal.d) goal = { x: d.x, y: d.y, d: dist };
      }
    }
    if (!goal) {
      // 图 BFS：当前房 → 最近的目标房（未清非 Boss 优先，其次未清 Boss）
      const startKey = run.cellKey;
      const needHeal = p.hp < 4;
      const targetOf = (c) => {
        if (!c.cleared && c.type !== 'boss') return 1;
        if (!c.cleared && c.type === 'boss') return needHeal ? 0.5 : 2;   // 血少时降权，绕路清房
        return 0;
      };
      const prev = new Map([[startKey, null]]);
      const q = [startKey];
      let found = null, foundBoss = null;
      while (q.length && !found) {
        const ck = q.shift();
        const c = run.map.get(ck);
        if (ck !== startKey) {
          const tv = targetOf(c);
          if (tv >= 1) { found = ck; break; }
          if (tv > 0 && !foundBoss) foundBoss = ck;
        }
        for (const dkey of Object.keys(c.doors)) {
          if (c.doors[dkey] === 'secret') continue;
          const [dx, dy] = dkey.split(',').map(Number);
          const nk = (c.x + dx) + ',' + (c.y + dy);
          if (!run.map.has(nk) || prev.has(nk)) continue;
          prev.set(nk, ck);
          q.push(nk);
        }
      }
      if (!found && foundBoss && !needHeal) found = foundBoss;
      if (found) {
        // 回溯到第一步
        let step = found;
        while (prev.get(step) !== startKey) step = prev.get(step);
        const [sxp, syp] = step.split(',').map(Number);
        const cell = run.map.get(startKey);
        const dx = sxp - cell.x, dy = syp - cell.y;
        goal = {
          x: dx === 0 ? w / 2 : (dx < 0 ? 0.5 : w - 0.5),
          y: dy === 0 ? h / 2 : (dy < 0 ? 0.5 : h - 0.5),
          d: 1, toDoor: true,
        };
      }
    }
    if (goal) {
      const dx = goal.x - p.x, dy = goal.y - p.y, l = Math.hypot(dx, dy);
      if (l > 0.25) move = { x: dx / l, y: dy / l };
    }
  }
  // 防出界（过门目标豁免：传送必须压到 0.78 以内）
  const toDoor = goal && goal.toDoor;
  if (!toDoor) {
    if (p.x < 1.4 && move.x <= 0) move.x = 0.6;
  if (p.x > w - 1.4 && move.x >= 0) move.x = -0.6;
  if (p.y < 1.4 && move.y <= 0) move.y = 0.6;
  if (p.y > h - 1.4 && move.y >= 0) move.y = -0.6;
  }
  const aim = tgt ? { x: tgt.x - p.x, y: tgt.y - p.y } : { x: move.x || 0, y: move.y || -1 };
  // 保命冲刺：最近敌人 <1.6，或 Boss 出土/冲锋贴身 <2.4（冲刺有无敌帧，主动躲招）
  let dash = false;
  if (tgt && p.dashCharges >= 1) {
    const dd = Math.hypot(tgt.x - p.x, tgt.y - p.y);
    if (dd < 1.6) dash = true;
    else if (boss && !boss.hidden && dd < 2.4 && (boss.b.mode === 'charge' || (boss.b.mode === 'idle' && boss.b.modeT > 1.5))) dash = true;
  }
  const z = tgt && p.pp >= 100 * p.mods.ppCost;
  return { move, aim, fire: !!tgt, dashEdge: dash, slotEdge: false, useEdge: p.hp <= 2 && !!p.inv.consumable, zEdge: z };
}

const TRACE = process.argv.includes('--trace');
function playGame(seed, mode, maxSeconds = 420) {
  const run = createRun(data, seed);
  let t = 0;
  const roomTimes = new Map();
  let lastTrace = -2;
  while (t < maxSeconds) {
    stepRun(run, botInput(run, mode), data);
    t += STEP;
    if (TRACE) {
      for (const ev of run.events) {
        if (ev.t === 'player-hurt') {
          const bs = run.enemies.find((e) => e.family === 'boss');
          const pb = run.player;
          const inTele = run.telegraphs.filter((tt) => Math.hypot(tt.x - pb.x, tt.y - pb.y) < tt.r + 0.6).map((tt) => tt.kind + 'd' + tt.dmg + '剩' + tt.t.toFixed(2));
          const justHit = run.events.filter((ev) => ev.t === 'telegraph-hit' && Math.hypot(ev.x - pb.x, ev.y - pb.y) < ev.r + 0.15).map((ev) => '★' + ev.kind);
          console.log(`    [受击] t=${t.toFixed(1)} ${ev.dmg}格 hp→${run.player.hp} @(${pb.x.toFixed(1)},${pb.y.toFixed(1)}) boss=${bs ? bs.b.mode + '/hp' + Math.round(bs.hp) + '@(' + bs.x.toFixed(1) + ',' + bs.y.toFixed(1) + ')' + (bs.hidden ? '/钻地' : '') : '-'} 圈内=[${inTele.join(' ')}] 同帧结算=[${justHit.join(' ')}]`);
        }
      }
    }
    if (TRACE && t - lastTrace >= 2) {
      lastTrace = t;
      const cell = run.map.get(run.cellKey);
      console.log(`  t=${t.toFixed(0).padStart(3)} 房[${cell.type}]@${run.cellKey} hp=${run.player.hp}/${run.player.maxHp} 敌=${run.enemies.length} 波=${run.room.waveIdx} 钱=${run.player.money} 台=${run.pedestals.filter(d=>!d.taken).length} 事件=[${run.events.map(e=>e.t).slice(0,4)}]`);
    }
    if (!run.player.alive || run.over) break;
    const ck = run.cellKey;
    if (!roomTimes.has(ck)) roomTimes.set(ck, t);
  }
  // 死因统计：最后一次受击时的 boss 模式
  const bs = run.enemies.find((e) => e.family === 'boss');
  if (!run.player.alive) {
    const inBoss = run.map.get(run.cellKey)?.type === 'boss';
    deathCauses.push({ seed, t: Math.round(t), inBoss, bossMode: bs ? bs.b.mode : (inBoss ? '已死' : '-'), hidden: bs ? !!bs.hidden : false, hpLeft: bs ? Math.round(bs.hp) + '/' + bs.maxHp : '-' });
  }
  if (TRACE && !run.player.alive) {
    const hurt = run.events.filter((e) => e.t === 'player-hurt');
    console.log('  死亡。最后受击:', hurt.slice(-3).map((e) => e.dmg + '格@' + e.x.toFixed(0) + ',' + e.y.toFixed(0)).join(' '), '时长', t.toFixed(0));
  }
  return {
    t, dead: !run.player.alive, win: run.win,
    rooms: run.stats.roomsCleared, kills: run.stats.kills, items: run.stats.items,
    money: run.player.money, hp: run.player.hp, maxHp: run.player.maxHp,
    passives: run.player.inv.passives.length,
    bossTime: (() => { const b = [...roomTimes.entries()].find(([k]) => run.map.get(k)?.type === 'boss'); return b ? run.t - b[1] : null; })(),
  };
}

const deathCauses = [];
for (const mode of ['aim', 'kite']) {
  const rs = [];
  for (let g = 0; g < GAMES; g++) rs.push(playGame((SEED0 + g * 7919) >>> 0, mode));
  const avg = (f) => (rs.reduce((s, r) => s + f(r), 0) / rs.length);
  const wins = rs.filter((r) => r.win).length;
  const bossTimes = rs.map((r) => r.bossTime).filter((v) => v != null);
  console.log(`[${mode}] ${GAMES} 局：通关率 ${(wins / GAMES * 100).toFixed(0)}%  死亡 ${rs.filter(r => r.dead).length}  ` +
    `均时长 ${avg(r => r.t).toFixed(0)}s  清房 ${avg(r => r.rooms).toFixed(1)}  击杀 ${avg(r => r.kills).toFixed(1)}  ` +
    `道具 ${avg(r => r.items).toFixed(1)}  余钱 ${avg(r => r.money).toFixed(0)}`);
  if (bossTimes.length) console.log(`        Boss 战时长 ${avg0(bossTimes).toFixed(0)}s（目标 45-90s）区间 ${Math.min(...bossTimes).toFixed(0)}~${Math.max(...bossTimes).toFixed(0)}s`);
  if (deathCauses.length) {
    const inBossDeaths = deathCauses.filter(d => d.inBoss);
    console.log(`        死因（Boss 房内 ${inBossDeaths.length}/${deathCauses.length}）：` +
      Object.entries(inBossDeaths.reduce((m, d) => { const k = d.bossMode + (d.hidden ? '(钻地)' : ''); m[k] = (m[k] || 0) + 1; return m; }, {}))
        .map(([k, v]) => k + '×' + v).join(' ') +
      (inBossDeaths.length ? ' | Boss 剩血中位 ' + med(inBossDeaths.map(d => typeof d.hpLeft === 'string' ? parseInt(d.hpLeft) : 0)) : ''));
  }
}
function avg0(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
function med(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; }
