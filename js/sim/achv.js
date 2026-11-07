// 成就系统：20 个首发成就 + 跨局 meta 计数 + 解锁宝可梦查询。纯数据层，node 可测。
// 评估模型：achvApply(已解锁集合, meta, { run, events, dexCount }) → { set, meta, unlocked }
//   - 每帧在表现层调用一次（与 dexApply 同位）；事件驱动 + 快照判定混合。
//   - meta = 跨局累计计数（runs/kills/secretRooms/...），由 metaApply 从事件流累计。
// 解锁联动：species.json 的 unlock 字段指向成就 id → starterUnlocked() 查询。
export const ACHV_KEY = 'depths-achv';
export const META_KEY = 'depths-meta';

// ---- 20 个首发成就（《04 内容清单》§6 示例表的可实现子集；黑市/金冠等 M5 系统就位后补第二批）
export const ACHVS = [
  { id: 'first-brock', name: '初次撼岩', desc: '击败尼比道馆的小刚' },
  { id: 'first-surge', name: '切断电流', desc: '击败发电厂的马志士' },
  { id: 'first-sabrina', name: '心灵制胜', desc: '击败遗迹的娜姿' },
  { id: 'champion', name: '三枚徽章', desc: '单局连闯三层通关' },
  { id: 'no-hurt-floor', name: '岩石般坚硬', desc: '无伤通过一整层（馆主战也不受伤）', unlock: 'cubone' },
  { id: 'items-10', name: '装备收藏家', desc: '单局拾取 10 件道具' },
  { id: 'secret-1', name: '裂缝发现者', desc: '找到一间隐藏房' },
  { id: 'secret-10', name: '隐藏房大师', desc: '累计进入 10 间隐藏房' },
  { id: 'zmove-room', name: 'Z 招式清场', desc: '一次 Z 招式命中 5 只以上' },
  { id: 'evolve-1', name: '进化时刻', desc: '第一次见证进化' },
  { id: 'evolve-3', name: '进化之路', desc: '累计见证 3 次进化' },
  { id: 'no-passive-win', name: '硬核通关', desc: '不带任何被动道具通关' },
  { id: 'streak-15', name: '连击 15', desc: '不受击连续击倒 15 只' },
  { id: 'dex-12', name: '观察力', desc: '图鉴点亮 12 种', unlock: 'eevee' },
  { id: 'dex-all', name: '晶穴图鉴完成', desc: '点亮图鉴全部条目' },
  { id: 'runs-25', name: '晶穴常客', desc: '累计游玩 25 局' },
  { id: 'kills-300', name: '洞窟清道夫', desc: '累计击倒 300 只' },
  { id: 'daily-done', name: '每日打卡', desc: '完成一局每日挑战（通关或战败均算）' },
  { id: 'camp-5', name: '结伴之谊', desc: '累计与 5 只受困宝可梦结伴', unlock: 'poliwhirl' },
  { id: 'companion-win', name: '搭档之力', desc: '有替补同行时击败馆主' },
  // M7 内容批
  { id: 'vault-1', name: '撬锁行家', desc: '打开一间上锁的宝物密室' },
  { id: 'elite-10', name: '精英猎手', desc: '累计击倒 10 只精英宝可梦' },
  { id: 'mewtwo-down', name: '超越了梦', desc: '在裂缝深处击败超梦' },
];
const BY_ID = new Map(ACHVS.map((a) => [a.id, a]));

/** 成就 id → 解锁的宝可梦（反向索引，species.json 的 unlock 字段同源） */
export const UNLOCK_SPECIES = { 'no-hurt-floor': 'cubone', 'dex-12': 'eevee', 'camp-5': 'poliwhirl' };

/** 物种是否可选（species.unlock 为空 = 默认解锁；否则查成就集合） */
export function starterUnlocked(species, achvSet) {
  if (!species.unlock) return true;
  return achvSet.has(species.unlock);
}

/** 事件流 → meta 累计（纯函数）。run 结束计数（runs/wins/deaths）由 end 标记事件驱动。 */
export function metaApply(meta, events, run) {
  const m = { ...meta };
  for (const ev of events) {
    switch (ev.t) {
      case 'enemy-die': m.kills = (m.kills || 0) + 1; break;
      case 'evolve': m.evolves = (m.evolves || 0) + 1; break;
      case 'companion-join': m.companions = (m.companions || 0) + 1; break;
      case 'room-enter': if (ev.type === 'secret') m.secretRooms = (m.secretRooms || 0) + 1; break;
      case 'item-take': m.items = (m.items || 0) + 1; break;
      case 'pickup': if (ev.kind === 'coin') m.coins = (m.coins || 0) + 1; if (ev.kind === 'coin2') m.coins = (m.coins || 0) + 2; break;
      case 'zmove': m.zmoves = (m.zmoves || 0) + 1; break;
      case 'vault-open': m.vaultOpens = (m.vaultOpens || 0) + 1; break;
      case 'enemy-die': if (ev.elite) m.eliteKills = (m.eliteKills || 0) + 1; break;
      default: break;
    }
  }
  // 局结束（死亡或通关）只记一次：以事件为锚，防止重复计数
  if (run && events.some((ev) => ev.t === 'player-die' || ev.t === 'floor-clear')) {
    const stamp = run.seed + ':' + run.t;
    if (m.lastRunStamp !== stamp) {
      m.lastRunStamp = stamp;
      m.runs = (m.runs || 0) + 1;
      if (run.win) m.wins = (m.wins || 0) + 1;
      else m.deaths = (m.deaths || 0) + 1;
    }
  }
  return m;
}

/** 成就评估（纯函数）。dexCount = 图鉴已点亮数；返回新集合、新 meta 与本次解锁的成就定义。 */
export function achvApply(achvSet, meta, { run = null, events = [], dexCount = 0, dexTotal = 0 } = {}) {
  const m = metaApply(meta, events, run);
  const set = new Set(achvSet);
  const unlocked = [];
  const grant = (id) => {
    if (set.has(id) || !BY_ID.has(id)) return;
    set.add(id);
    unlocked.push(BY_ID.get(id));
  };
  const p = run && run.player;
  for (const ev of events) {
    switch (ev.t) {
      case 'boss-clear':
        if (ev.floor === 1) grant('first-brock');
        if (ev.floor === 2) grant('first-surge');
        if (ev.floor === 3) grant('first-sabrina');
        if (run && !(run.stats.hurtFloors || []).includes(ev.floor)) grant('no-hurt-floor');
        if (p && p.companion) grant('companion-win');
        break;
      case 'floor-clear':
        grant('champion');
        if (p && (p.inv.passives || []).length === 0) grant('no-passive-win');
        break;
      case 'room-enter':
        if (ev.type === 'secret') { grant('secret-1'); if ((m.secretRooms || 0) >= 10) grant('secret-10'); }
        break;
      case 'zmove':
        if ((ev.hits || 0) >= 5) grant('zmove-room');
        break;
      case 'evolve':
        grant('evolve-1');
        if ((m.evolves || 0) >= 3) grant('evolve-3');
        break;
      case 'companion-join':
        if ((m.companions || 0) >= 5) grant('camp-5');
        break;
      case 'enemy-die':
        if (run && (run.stats.maxStreak || 0) >= 15) grant('streak-15');
        if (ev.elite && (m.eliteKills || 0) >= 10) grant('elite-10');
        break;
      case 'vault-open': grant('vault-1'); break;
      case 'mewtwo-down': grant('mewtwo-down'); break;
      case 'item-take':
        if (run && (run.stats.items || 0) >= 10) grant('items-10');
        break;
      case 'player-die': case 'floor-clear-end': break;
      default: break;
    }
  }
  // 局终结算（每日打卡）
  if (run && events.some((e) => e.t === 'player-die' || e.t === 'floor-clear') && run.isDaily) grant('daily-done');
  // 累计类（事件无关，每帧校验成本可控）
  if ((m.runs || 0) >= 25) grant('runs-25');
  if ((m.kills || 0) >= 300) grant('kills-300');
  if (dexCount >= 12) grant('dex-12');
  if (dexTotal > 0 && dexCount >= dexTotal) grant('dex-all');
  return { set, meta: m, unlocked };
}

export const achvStore = {
  read() {
    try { return new Set(JSON.parse(localStorage.getItem(ACHV_KEY) || '[]')); }
    catch (e) { return new Set(); }
  },
  write(set) {
    try { localStorage.setItem(ACHV_KEY, JSON.stringify([...set])); } catch (e) { /* ignore */ }
  },
};

export const metaStore = {
  read() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  },
  write(meta) {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ }
  },
};

/** 成就进度描述（面板用）：返回 { done, cur, need } 或 null（无进度条概念） */
export function achvProgress(id, { meta = {}, dexCount = 0, dexTotal = 0 } = {}) {
  switch (id) {
    case 'secret-10': return { cur: Math.min(meta.secretRooms || 0, 10), need: 10 };
    case 'evolve-3': return { cur: Math.min(meta.evolves || 0, 3), need: 3 };
    case 'runs-25': return { cur: Math.min(meta.runs || 0, 25), need: 25 };
    case 'kills-300': return { cur: Math.min(meta.kills || 0, 300), need: 300 };
    case 'camp-5': return { cur: Math.min(meta.companions || 0, 5), need: 5 };
    case 'elite-10': return { cur: Math.min(meta.eliteKills || 0, 10), need: 10 };
    case 'dex-12': return { cur: Math.min(dexCount, 12), need: 12 };
    case 'dex-all': return dexTotal ? { cur: dexCount, need: dexTotal } : null;
    default: return null;
  }
}
