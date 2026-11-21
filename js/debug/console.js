// 以撒式 Debug 控制台（M11）：?debug（任意值）下按 ` 呼出；触屏走右下 ⌘ 按钮。
// 命令总线统一走 exec(str)——main.js 挂 __depths.debug 后，debug.html 经 ?auto=cmd|cmd 深链复用。
// 命令只改 sim 状态（纯数据层），执行后由 main.js pump 少量帧刷新事件/视图。

import { recompute, goNextFloor, MAX_FLOOR } from '../sim/engine.js?v=m9d';
import { achvStore, ACHVS } from '../sim/achv.js?v=m9d';
import { dexStore, dexSpecies } from '../sim/dex.js?v=m9d';
import { encodeChallenge } from '../sim/save.js?v=m9d';

const HELP = [
  ['help [命令]', '命令列表 / 单条详细说明'],
  ['stage <1-' + MAX_FLOOR + '>', '向前跳层（保留成长，逐层 goNextFloor）'],
  ['restart [层号]', '重开一局（可指定起始层，需再 stage 微调）'],
  ['goto <房型>', '传送到本层该类型房：boss/shop/treasure/challenge/secret/camp/blackmarket/altar/vault/fissure/forge/gacha/blood/gift/start/combat'],
  ['boss <eid>', '直开 Boss 战：进 boss/裂缝房并 spawn 指定 Boss（如 brock/mew/mewtwo/agatha/darkrai）'],
  ['fissure', '本层强制生成裂缝房（邻出生房）并传送过去'],
  ['spawn <eid> [n]', '在玩家周围刷 n 只敌（默认 1，可用金冠名如 rattata）'],
  ['give <itemId>', '道具直接入包（TM/徽章/纪念品/消耗品按 kind 落位）'],
  ['take <itemId>', '移除一件已持有道具'],
  ['killall', '全场敌人 HP 清零（走正常死亡结算，含 Boss 奖励/结局判定）'],
  ['clear', '当前房直接置清（无死亡结算，用于看门/路线）'],
  ['heal / hp <n>', '回满 / 设置当前亲密度'],
  ['pp <n> / ppfull', '设置 / 回满 PP'],
  ['money <n> / keys <n>', '设置金钱 / 钥匙'],
  ['god', '无敌切换（受击无效）'],
  ['speed <0.25-4>', '模拟时间倍率'],
  ['hud', 'HUD 显隐（截图用）'],
  ['seed', '打印种子 / 层 / 挑战码'],
  ['species <id>', '切换搭档（含未解锁；重置 A/Z 招式与属性）'],
  ['difficulty <normal|hard|abyss>', '局内切换难度三档'],
  ['dex / achv', '图鉴全开 / 成就全开（含未上线的结局成就位）'],
  ['win', '直接结算胜利（走结局演出）'],
  ['ending <1-4>', '结局条件模拟（M11-C 实装终焉宝箱后生效）'],
];

export function createDebugConsole(deps) {
  // deps: { getRun, data, goFloor, goRoom, restart, pump, setOpen(v), isOpen(), hudEl }
  const data = deps.data;

  // ---------- DOM ----------
  const style = document.createElement('style');
  style.textContent = `
  #dbg-console { position: fixed; left: 0; right: 0; bottom: 0; z-index: 60;
    background: rgba(6, 9, 18, 0.94); border-top: 1px solid rgba(127, 212, 255, 0.35);
    font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace; color: #cfd8ea; display: none; }
  #dbg-console.open { display: block; }
  #dbg-log { max-height: 180px; overflow-y: auto; padding: 8px 12px 4px; }
  #dbg-log div { white-space: pre-wrap; padding: 0.5px 0; }
  #dbg-log .ok { color: #7dff9b; } #dbg-log .err { color: #ff9a9a; } #dbg-log .dim { color: #7d8aa5; }
  #dbg-row { display: flex; align-items: center; gap: 8px; padding: 6px 12px 10px; }
  #dbg-row .prompt { color: #ffe9a0; }
  #dbg-input { flex: 1; background: #10141f; color: #dfe6f2; border: 1px solid #2a3550;
    border-radius: 4px; padding: 4px 8px; font: inherit; outline: none; }
  #dbg-input:focus { border-color: #7fd4ff; }
  #dbg-btn { position: fixed; right: 10px; bottom: 10px; z-index: 59; width: 34px; height: 34px;
    border-radius: 8px; background: rgba(10, 14, 26, 0.8); color: #7fd4ff; font-size: 16px;
    border: 1px solid rgba(127, 212, 255, 0.4); cursor: pointer; user-select: none; }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'dbg-console';
  root.innerHTML = '<div id="dbg-log"></div>'
    + '<div id="dbg-row"><span class="prompt">›</span><input id="dbg-input" spellcheck="false" autocomplete="off"'
    + ' placeholder="help 看命令 · ` 关闭"></div>';
  document.body.appendChild(root);

  const btn = document.createElement('div');
  btn.id = 'dbg-btn';
  btn.textContent = '⌘';
  btn.title = '调试控制台（`）';
  document.body.appendChild(btn);

  const logEl = root.querySelector('#dbg-log');
  const input = root.querySelector('#dbg-input');
  const history = [];
  let histIdx = -1;

  function print(text, cls = '') {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.childElementCount > 400) logEl.removeChild(logEl.firstChild);
  }

  function open() { root.classList.add('open'); deps.setOpen(true); setTimeout(() => input.focus(), 0); }
  function close() { root.classList.remove('open'); deps.setOpen(false); input.blur(); }
  function toggle() { root.classList.contains('open') ? close() : open(); }
  function isVisible() { return root.classList.contains('open'); }

  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); toggle(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cmd = input.value.trim();
      if (cmd) { history.push(cmd); histIdx = history.length; input.value = ''; exec(cmd); }
      e.preventDefault();
    } else if (e.key === 'Escape') { close(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { if (histIdx > 0) { histIdx--; input.value = history[histIdx] || ''; } e.preventDefault(); }
    else if (e.key === 'ArrowDown') {
      if (histIdx < history.length) { histIdx++; input.value = history[histIdx] || ''; }
      e.preventDefault();
    }
    e.stopPropagation();   // 不让游戏输入层收到控制台键入
  });

  // ---------- 工具 ----------
  const err = (m) => print(m, 'err');
  const ok = (m) => print(m, 'ok');
  const dim = (m) => print(m, 'dim');

  function findCell(state, type) {
    for (const c of state.map.values()) if (c.type === type) return c;
    return null;
  }

  function gotoCell(state, cell) {
    if (!cell) return err('本层没有该房型');
    deps.goRoom(cell.x + ',' + cell.y);
    return null;
  }

  // ---------- 命令表 ----------
  const commands = {
    help(arg) {
      if (!arg) { for (const [c, d] of HELP) print(c.padEnd(38, '　') + d); return; }
      const row = HELP.find(([c]) => c.split(' ')[0] === arg);
      row ? print(row[0] + ' — ' + row[1]) : err('未知命令：' + arg);
    },

    stage(arg) {
      const n = parseInt(arg, 10);
      if (!(n >= 1 && n <= MAX_FLOOR)) return err('用法：stage <1-' + MAX_FLOOR + '>');
      const state = deps.getRun();
      if (n < state.floorNo) return err('只支持向前跳层（当前 F' + state.floorNo + '）；往回用 restart ' + n);
      while (state.floorNo < n) {
        if (!goNextFloor(state, data)) return err('goNextFloor 失败（F' + state.floorNo + '→' + (state.floorNo + 1) + '）');
      }
      deps.rebuildRoom();
      ok('→ F' + n + ' ' + (data.floors[n] || {}).name);
    },

    restart(arg) {
      const n = parseInt(arg, 10);
      if (n >= 1 && n <= MAX_FLOOR) data.floorNo = n; else delete data.floorNo;
      deps.restart();
      delete data.floorNo;   // 只影响这一局；残留会让标题页后续「新的探险」也从该层开始
      ok(n ? '重开 @ F' + n : '重开 @ F1');
    },

    goto(arg) {
      if (!arg) return err('用法：goto <房型>（help goto 看列表）');
      const state = deps.getRun();
      const cell = findCell(state, arg);
      if (!cell) return err('本层没有 ' + arg + ' 房（可用 fissure 命令强制生成裂缝房）');
      gotoCell(state, cell);
      ok('→ ' + arg + ' @ ' + cell.x + ',' + cell.y);
    },

    boss(arg) {
      if (!arg || !data.enemies[arg]) return err('用法：boss <eid>（brock/surge/sabrina/agatha/mew/mewtwo/darkrai…）');
      const state = deps.getRun();
      const cell = findCell(state, 'fissure') || findCell(state, 'boss');
      if (!cell) return err('本层没有 boss/裂缝房（先 goto combat 或 fissure 命令）');
      if (cell.cleared) { cell.cleared = false; cell.stash = null; }   // 已清房也强制重开
      state.pendingBoss = arg;
      deps.goRoom(cell.x + ',' + cell.y);
      ok('Boss 战 @ ' + cell.type + '：' + data.enemies[arg].name);
    },

    fissure() {
      const state = deps.getRun();
      const start = findCell(state, 'start');
      const N4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (const [dx, dy] of N4) {
        const k = (start.x + dx) + ',' + (start.y + dy);
        if (state.map.has(k)) continue;
        const cell = { x: start.x + dx, y: start.y + dy, type: 'fissure', cleared: false, visited: false, doors: {} };
        cell.doors[(-dx) + ',' + (-dy)] = 'fissure';
        start.doors[dx + ',' + dy] = 'fissure';
        state.map.set(k, cell);
        deps.goRoom(k);
        return ok('裂缝房生成 @ ' + k);
      }
      err('出生房四周已满');
    },

    spawn(arg) {
      const [eid, nStr] = (arg || '').split(/\s+/);
      const spec = data.enemies[eid];
      if (!spec) return err('未知 eid：' + eid + '（例：spawn rattata 3）');
      const n = Math.min(8, Math.max(1, parseInt(nStr, 10) || 1));
      const state = deps.getRun();
      const p = state.player;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + state.rand() * 0.5;
        const x = Math.max(1.2, Math.min(state.roomW - 1.2, p.x + Math.cos(a) * 3.2));
        const y = Math.max(1.2, Math.min(state.roomH - 1.2, p.y + Math.sin(a) * 3.2));
        state.enemies.push({
          id: state.nextId++, eid, name: spec.name, types: spec.types,
          family: spec.family, radius: spec.radius, score: spec.score,
          hp: spec.hp * state.hpMul, maxHp: spec.hp * state.hpMul,
          touchDmg: spec.touchDmg, speed: spec.speed, spdMod: spec.spdMod,
          x, y, px: x, py: y, kx: 0, ky: 0,
          state: 'spawning', spawnT: 0.4, flash: 0, touchCd: 0, stun: 0,
          anim: 'Idle', dir: 0, moving: false, wanderT: 0, wx: 0, wy: 0,
          shoot: spec.shoot ? { ...spec.shoot } : null, shootCd: 1.2,
          lunge: spec.lunge || undefined,
          splitOnDeath: spec.splitOnDeath || undefined,
          dropHearts: spec.dropHearts || undefined,
          bombRadius: spec.bombRadius, bombDmg: spec.bombDmg, fuse: spec.fuse,
          transformT: spec.transformT, transformTo: spec.transformTo,
        });
        state.events.push({ t: 'spawn', id: state.enemies[state.enemies.length - 1].id, eid, x, y });
      }
      ok('spawn ' + eid + ' ×' + n);
    },

    give(arg) {
      const id = arg;
      const it = data.items[id];
      if (!it) return err('未知 itemId：' + id + '（例：give tm-hyper / give hp-up）');
      const state = deps.getRun();
      const inv = state.player.inv;
      if (it.kind === 'trinket') inv.trinket = id;
      else if (it.kind === 'consumable') inv.consumable = id;
      else if (it.kind === 'badge') { if (!inv.badges.includes(id)) inv.badges.push(id); }
      else inv.passives.push(id);
      recompute(state, data);
      ok('give ' + (it.name || id) + '（' + id + '）');
    },

    take(arg) {
      const state = deps.getRun();
      const inv = state.player.inv;
      let idx = inv.passives.indexOf(arg);
      if (idx >= 0) { inv.passives.splice(idx, 1); }
      else if (inv.trinket === arg) inv.trinket = null;
      else if (inv.consumable === arg) inv.consumable = null;
      else {
        const bi = inv.badges.indexOf(arg);
        if (bi >= 0) inv.badges.splice(bi, 1); else return err('未持有：' + arg);
      }
      recompute(state, data);
      ok('take ' + arg);
    },

    killall() {
      const state = deps.getRun();
      const n = state.enemies.filter((e) => e.state !== 'dead').length;
      for (const e of state.enemies) if (e.state !== 'dead') e.hp = 0;
      deps.pump(4);   // 死亡结算（含 Boss 奖励/结局分支）在 stepEnemies 的清尸扫描里
      ok('killall ×' + n);
    },

    clear() {
      const state = deps.getRun();
      const cell = state.map.get(state.cellKey);
      cell.cleared = true;
      state.room.cleared = true;
      state.room.doorOpen = true;
      state.enemies.length = 0;
      state.projectiles.length = 0;
      state.telegraphs.length = 0;
      ok('clear ' + state.cellKey);
    },

    heal() { const p = deps.getRun().player; p.hp = p.maxHp; ok('heal → ' + p.hp + '/' + p.maxHp); },

    hp(arg) {
      const p = deps.getRun().player;
      const n = parseInt(arg, 10);
      if (!(n >= 0)) return err('用法：hp <格数>');
      p.hp = Math.min(p.maxHp, n);
      if (p.hp <= 0) p.hp = 1;   // 直接归零会走死亡流程，调试用 heal 更合适
      ok('hp → ' + p.hp + '/' + p.maxHp);
    },

    ppfull() { const p = deps.getRun().player; p.pp = 100; ok('pp → 100'); },

    pp(arg) {
      const p = deps.getRun().player;
      const n = parseInt(arg, 10);
      if (!(n >= 0)) return err('用法：pp <0-100>');
      p.pp = Math.min(100, n);
      ok('pp → ' + p.pp);
    },

    money(arg) {
      const n = parseInt(arg, 10);
      if (!(n >= 0)) return err('用法：money <数量>');
      deps.getRun().player.money = n;
      ok('money → ' + n);
    },

    keys(arg) {
      const n = parseInt(arg, 10);
      if (!(n >= 0)) return err('用法：keys <数量>');
      deps.getRun().player.inv.keys = n;
      ok('keys → ' + n);
    },

    god() {
      const state = deps.getRun();
      state.godMode = !state.godMode;
      ok('无敌 ' + (state.godMode ? 'ON' : 'OFF'));
    },

    speed(arg) {
      const mul = parseFloat(arg);
      if (!(mul >= 0.25 && mul <= 4)) return err('用法：speed <0.25-4>（当前 ' + deps.speedMul() + '）');
      deps.setSpeedMul(mul);
      ok('速度 ×' + mul);
    },

    hud() {
      const el = deps.hudEl();
      if (!el) return err('HUD 元素不可用');
      const hidden = el.style.display === 'none';
      el.style.display = hidden ? '' : 'none';
      ok('HUD ' + (hidden ? '显示' : '隐藏'));
    },

    seed() {
      const state = deps.getRun();
      const code = encodeChallenge({ seed: state.seed, difficulty: state.difficulty, species: state.player.species0 || state.player.species });
      print('seed=' + state.seed + ' · F' + state.floorNo + ' @ ' + state.cellKey + ' · 难度 ' + state.difficulty, 'dim');
      ok(code);
    },

    species(arg) {
      const spec = data.species[arg];
      if (!spec) return err('未知 species：' + arg + '（pikachu/eevee/cubone/poliwhirl/charizard/scizor/lucario/rayquaza…）');
      const state = deps.getRun();
      const p = state.player;
      p.species = arg;
      p.types = spec.types;
      p.moveA = spec.moveA || p.moveA;
      p.zmove = spec.zmove || p.zmove;
      p.zmoveEvolved = spec.zmoveEvolved || spec.zmove || p.zmove;
      p.evolveTo = spec.evolveTo || null;
      p.evolved = !!spec.evolved;
      p.luckBase = spec.luck || 0;
      if (p.companion) p.companion = null;
      recompute(state, data);
      deps.rebuildRoom();
      ok('搭档 → ' + spec.name);
    },

    difficulty(arg) {
      const diffs = ['normal', 'hard', 'abyss'];
      if (!diffs.includes(arg)) return err('用法：difficulty <normal|hard|abyss>');
      const state = deps.getRun();
      const diff = data.balance.difficulty[arg];
      state.difficulty = arg;
      state.hpMul = (data.floors[state.floorNo] || {}).hpMul * diff.hpMul;
      state.bossMul = diff.bossMul;
      state.warnMul = diff.warnMul;
      ok('难度 → ' + diff.label + '（敌血 ×' + diff.hpMul + '）');
    },

    dex() {
      const list = dexSpecies(data);
      const dex = dexStore.read();
      for (const s of list) dex[s.eid] = { seen: 1, kills: (dex[s.eid] || {}).kills || 1 };
      dexStore.write(dex);
      ok('图鉴全开 ×' + list.length + '（HUD 内重开图鉴面板可见）');
    },

    achv() {
      const set = deps.achvSet();
      for (const a of ACHVS) set.add(a.id);
      achvStore.save(set);
      ok('成就全开 ×' + ACHVS.length);
    },

    win() {
      const state = deps.getRun();
      state.over = true; state.win = true;
      state.stats.tRun = state.t - (state.stats.t0 || 0);
      state.events.push({ t: 'mew-purify', x: state.player.x, y: state.player.y, name: 'debug' });
      state.events.push({ t: 'floor-clear', x: state.player.x, y: state.player.y });
      ok('win 强制结算');
    },

    ending(arg) {
      dim('ending 命令将在 M11-C（终焉宝箱 + 四结局）实装后生效；当前 ' + (arg || '') + ' 仅记录。');
    },
  };

  function exec(line) {
    const lineStr = String(line || '').trim();
    if (!lineStr) return;
    print('› ' + lineStr, 'dim');
    const sp = lineStr.indexOf(' ');
    const name = (sp < 0 ? lineStr : lineStr.slice(0, sp)).toLowerCase();
    const arg = sp < 0 ? '' : lineStr.slice(sp + 1).trim();
    const fn = commands[name];
    if (!fn) { err('未知命令：' + name + '（help 看列表）'); return; }
    try { fn(arg); } catch (e) { err('执行出错：' + (e && e.message || e)); }
  }

  return { exec, open, close, toggle, isVisible, print };
}
