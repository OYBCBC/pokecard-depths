// 图鉴系统：遭遇/击杀点亮 + localStorage 持久化。纯数据层，node 可测。
// 条目来源：野生敌（enemies.dex>0，分裂子种合并）、玩家皮卡丘/雷丘、馆主搭档（boss-intro 的 ace）。
export const DEX_KEY = 'depths-dex';

// 玩家/馆主搭档的补充条目（不在 enemies 表里的物种）
export const DEX_EXTRA = {
  pikachu: { dex: 25, name: '皮卡丘', anim: 'pikachu', tag: '伙伴' },
  raichu: { dex: 26, name: '雷丘', anim: 'raichu', tag: '进化' },
  onix: { dex: 95, name: '大岩蛇', anim: 'onix', tag: '馆主搭档' },
  alakazam: { dex: 65, name: '胡地', anim: 'alakazam', tag: '馆主搭档' },
  eevee: { dex: 133, name: '伊布', anim: 'eevee', tag: '解锁伙伴' },
  cubone: { dex: 104, name: '卡拉卡拉', anim: 'cubone', tag: '解锁伙伴' },
  poliwhirl: { dex: 61, name: '蚊香君', anim: 'poliwhirl', tag: '解锁伙伴' },
};
// 分裂子种 → 本体（小臭泥并入臭泥）
export const DEX_ALIAS = { 'grimer-small': 'grimer' };

/** 图鉴物种表（按全国图鉴号排序）。data.enemies + DEX_EXTRA 去重合并。 */
export function dexSpecies(data) {
  const list = [];
  const seen = new Set();
  for (const [eid, e] of Object.entries(data.enemies)) {
    if (!e.dex || e.family === 'boss') continue;         // 馆主本人（训练家）不进图鉴
    const key = DEX_ALIAS[eid] || eid;
    if (seen.has(key)) continue;
    seen.add(key);
    const s = data.enemies[key];
    list.push({ eid: key, dex: s.dex, name: s.name, anim: s.anim, tag: '' });
  }
  for (const [eid, x] of Object.entries(DEX_EXTRA)) {
    if (seen.has(eid)) continue;
    seen.add(eid);
    list.push({ eid, ...x });
  }
  list.sort((a, b) => a.dex - b.dex);
  return list;
}

/** 消费 sim 事件 → 图鉴增量。不修改入参，返回 { dex, changed }。
 *  事件：spawn=遭遇；enemy-die=击杀；boss-intro(ace)=馆主搭档遭遇；evolve=雷丘；companion-join=结伴。 */
export function dexApply(dex, events) {
  const next = { ...dex };
  let changed = false;
  const touch = (eid) => {
    const key = DEX_ALIAS[eid] || eid;
    if (!next[key]) next[key] = { seen: 0, kills: 0 };
    else next[key] = { ...next[key] };
    return next[key];
  };
  for (const ev of events) {
    let e = null;
    if (ev.t === 'spawn') e = touch(ev.eid);
    else if (ev.t === 'enemy-die' && ev.eid) e = touch(ev.eid);
    else if (ev.t === 'boss-intro' && ev.ace) e = touch(ev.ace);
    else if (ev.t === 'evolve' && ev.to) e = touch(ev.to);
    else if (ev.t === 'companion-join' && ev.eid) e = touch(ev.eid);
    else if (ev.t === 'dex-seen' && ev.eid) e = touch(ev.eid);
    if (!e) continue;
    if (ev.t === 'enemy-die') { e.kills = (e.kills || 0) + 1; changed = true; }
    if (!e.seen) { e.seen = 1; changed = true; }
  }
  return { dex: next, changed };
}

export const dexStore = {
  read() {
    try { return JSON.parse(localStorage.getItem(DEX_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  },
  write(dex) {
    try { localStorage.setItem(DEX_KEY, JSON.stringify(dex)); } catch (e) { /* ignore */ }
  },
};
