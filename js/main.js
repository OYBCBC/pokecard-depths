// 启动入口 M3：楼层/多房间/道具/Boss 全链路。
import * as THREE from 'three';
import { detectTier, createRenderer, resize, viewportSize, TIERS } from './gfx/renderer.js?v=m4d';
import { createLights } from './gfx/lights.js?v=m4d';
import { createCamera } from './gfx/camera.js?v=m4d';
import { buildRoom, createProps, createTelegraphFx } from './gfx/scene.js?v=m4d';
import { createBillboard } from './gfx/sprites.js?v=m4d';
import { createEffects } from './gfx/effects.js?v=m4d';
import { createPostfx } from './gfx/postfx.js?v=m4d';
import { createHud } from './ui/hud.js?v=m4d';
import { createCries } from './audio/cries.js?v=m4d';
import { createInput } from './core/input.js?v=m4d';
import { createRun, stepRun, recompute, STEP } from './sim/engine.js?v=m4d';
import { enterRoom } from './sim/actors.js?v=m4d';
import { saveStore, deserializeRun, dailySeed } from './sim/save.js?v=m4d';
import { dexSpecies, dexApply, dexStore } from './sim/dex.js?v=m4d';

const hud = createHud();
const tier = detectTier();
const debugOn = new URLSearchParams(location.search).has('debug');

function loadTexture(url, { srgb = true, pixel = false, mip = false } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (pixel) {
        t.magFilter = THREE.NearestFilter;
        t.minFilter = mip ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
        t.generateMipmaps = mip;
      }
      t.needsUpdate = true;
      resolve(t);
    };
    img.onerror = () => reject(new Error(`纹理加载失败: ${url}`));
    img.src = url;
  });
}
const loadJson = async (u) => (await fetch(u)).json();

async function lightingSelfTest(THREE, renderer) {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 20);
  cam.position.z = 5;
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
  scene.add(box);
  const rt = new THREE.WebGLRenderTarget(64, 64);
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  const buf = new Uint8Array(64 * 64 * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, 64, 64, buf);
  renderer.setRenderTarget(null);
  rt.dispose(); box.geometry.dispose(); box.material.dispose();
  let red = 0;
  for (let i = 0; i < buf.length; i += 4) if (buf[i] > 100 && buf[i + 1] < 60) red++;
  return red > 100;
}
function composerWorks(renderer, composer, canvas) {
  try {
    composer.render(1 / 60);
    const probe = document.createElement('canvas');
    probe.width = 16; probe.height = 10;
    const ctx = probe.getContext('2d');
    ctx.drawImage(canvas, 0, 0, 16, 10);
    const d = ctx.getImageData(0, 0, 16, 10).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 45) lit++;
    return lit >= 8;
  } catch (e) {
    return false;   // 画布 0 尺寸等瞬时异常：当作探测失败，回退直渲染
  }
}

const ROOM_NAMES = { start: '出生房', combat: '洞窟', treasure: '宝箱房', shop: '友好商店', challenge: '挑战房', secret: '？？？', boss: '道馆' };

async function boot() {
  hud.progress(0.05, '读取数据…');
  const [tcD, edD, mvD, bal, itemsD, floorsD] = await Promise.all([
    loadJson('js/data/typechart.json'), loadJson('js/data/enemies.json'),
    loadJson('js/data/moves.json'), loadJson('js/data/balance.json'), loadJson('js/data/items.json'),
    loadJson('js/data/floors.json'),
  ]);
  const data = {
    typechart: tcD.chart, enemies: edD.enemies, moves: mvD.moves, items: itemsD.items,
    itemPools: itemsD.poolConfig, balance: bal, waves: floorsD.floors['1'].waves,
    floors: floorsD.floors, species: { player: { types: ['electric'] } }, floorNo: 1,
  };

  hud.progress(0.15, '读取图集…');
  const slugs = ['pikachu', 'rattata', 'caterpie', 'oddish', 'onix', 'raichu', 'voltorb', 'magnemite', 'grimer', 'koffing', 'poliwag', 'meowth', 'electrode', 'magneton', 'abra', 'gastly', 'sandshrew', 'machop', 'rhyhorn', 'kecleon', 'sandslash', 'gengar', 'alakazam', 'eevee', 'cubone', 'politoed'];
  const atlases = {};
  await Promise.all(slugs.map(async (slug) => { atlases[slug] = await loadJson(`assets/atlas/${slug}.json`); }));

  hud.progress(0.3, '加载纹理…');
  const iconSlugs = Object.values(itemsD.items).map((it) => it.icon);
  const themes = ['cave', 'plant', 'ruins'];
  const [texList, themeTexList, flameTex, shadowTex, orbBolt, orbAcid, doorTex, crackTex, coinTex, heartTex, ringTex, iconTexList] = await Promise.all([
    Promise.all(slugs.map((s) => loadTexture(`assets/atlas/${s}.png`, { pixel: true }).catch(() => null))),
    Promise.all(themes.flatMap((th) => [
      loadTexture(`assets/tiles/${th}-floor.png`, { pixel: true, mip: true }),
      loadTexture(`assets/tiles/${th}-floor-boss.png`, { pixel: true, mip: true }),
      loadTexture(`assets/tiles/${th}-wall.png`, { pixel: true, mip: true }),
      loadTexture(`assets/tiles/${th}-wall-top.png`, { pixel: true, mip: true }),
    ])),
    loadTexture('assets/tiles/flame.png', { pixel: true }),
    loadTexture('assets/tiles/shadow.png', { pixel: true }),
    loadTexture('assets/tiles/orb-bolt.png', { pixel: true }),
    loadTexture('assets/tiles/orb-acid.png', { pixel: true }),
    loadTexture('assets/tiles/door.png', { pixel: true }),
    loadTexture('assets/tiles/crack.png', { pixel: true }),
    loadTexture('assets/tiles/coin.png', { pixel: true }),
    loadTexture('assets/tiles/heart.png', { pixel: true }),
    loadTexture('assets/tiles/ring.png', { pixel: true }),
    Promise.all(iconSlugs.map((s) => loadTexture(`assets/items/${s}.png`, { pixel: true }).catch(() => null))),
  ]);
  const texBySlug = {}; slugs.forEach((s, i) => { texBySlug[s] = texList[i]; });
  const iconTex = {}; iconSlugs.forEach((s, i) => { iconTex[s] = iconTexList[i]; });
  const themeTex = {};
  themes.forEach((th, i) => {
    themeTex[th] = { floor: themeTexList[i * 4], floorBoss: themeTexList[i * 4 + 1], wall: themeTexList[i * 4 + 2], wallTop: themeTexList[i * 4 + 3] };
    themeTex[th].wall.wrapS = themeTex[th].wall.wrapT = THREE.RepeatWrapping;
    themeTex[th].wallTop.wrapS = themeTex[th].wallTop.wrapT = THREE.RepeatWrapping;
  });
  flameTex.wrapS = THREE.RepeatWrapping; flameTex.repeat.set(1 / 4, 1);

  hud.progress(0.5, '装配场景…');
  const canvas = document.getElementById('game');
  const renderer = createRenderer(THREE, canvas, tier);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e18);
  scene.fog = new THREE.Fog(0x0b0e18, 26, 60);
  const lights = createLights(THREE, scene, tier, 24, 16);
  function applyFloorPalette() {
    const L = data.floors[run.floorNo].lights;
    lights.hemi.color.set(L.hemi); lights.hemi.groundColor.set(L.ground);
    lights.dir.color.set(L.dir);
    const bg = data.floors[run.floorNo].bg;
    scene.background.set(bg);
    scene.fog.color.set(bg);
  }
  const camCtl = createCamera(THREE);
  resize(THREE, renderer, camCtl.camera);

  const curTheme = () => data.floors[run.floorNo].theme;
  const tex = {
    flame: flameTex, door: doorTex, crack: crackTex, coin: coinTex, heart: heartTex,
  };
  Object.defineProperty(tex, 'floor', { get: () => themeTex[curTheme()].floor });
  Object.defineProperty(tex, 'floorBoss', { get: () => themeTex[curTheme()].floorBoss });
  Object.defineProperty(tex, 'wall', { get: () => themeTex[curTheme()].wall });
  Object.defineProperty(tex, 'wallTop', { get: () => themeTex[curTheme()].wallTop });
  const fx = createEffects(THREE, scene, { bolt: orbBolt, acid: orbAcid });
  const teleFx = createTelegraphFx(THREE, scene, ringTex);

  hud.progress(0.65, '后处理链…');
  let postfx = await createPostfx(THREE, renderer, scene, camCtl.camera, tier);
  let postfxFallback = false;
  if (postfx) {
    postfx.setFocusTarget(null);
    postfx.setSize(window.innerWidth, window.innerHeight);
    if (!composerWorks(renderer, postfx.composer, canvas)) { postfx = null; postfxFallback = true; renderer.setRenderTarget(null); }
  }
  hud.progress(0.75, '光照自检…');
  const lightOk = await lightingSelfTest(THREE, renderer);

  hud.progress(0.85, '叫声（可降级）…');
  const cries = createCries();
  cries.load(25, 'assets/cries/25.ogg');
  const input = createInput();
  input.onFirstInteraction(() => cries.ensureCtx());

  // ---- 局与视图 ----
  let run = createRun(data);
  let playerSlug = 'pikachu';
  let player = createBillboard(THREE, texBySlug.pikachu, atlases.pikachu, shadowTex);
  scene.add(player.group);
  function setPlayerSprite(slug) {
    const eff = slug === 'grimer-small' ? 'grimer' : slug;
    if (eff === playerSlug || !texBySlug[eff] || !atlases[eff]) return;
    playerSlug = eff;
    const old = player;
    const px = old.group.position.x, pz = old.group.position.z;
    scene.remove(old.group);
    old.dispose();
    player = createBillboard(THREE, texBySlug[eff], atlases[eff], shadowTex);
    player.place(px, pz);
    scene.add(player.group);
    if (postfx && postfx.setFocusTarget) postfx.setFocusTarget(player.mesh);
  }
  const enemyViews = new Map();
  let roomView = null, props = null;

  // ---- 图鉴：物种表 + 精灵缩略图（从图集 Idle 首帧裁剪） ----
  const dexList = dexSpecies(data);
  let dexState = (() => {
    const st = dexStore.read();
    const r = dexApply(st, [{ t: 'dex-seen', eid: 'pikachu' }]);
    if (r.changed) dexStore.write(r.dex);
    return r.dex;
  })();
  const dexThumbs = {};
  for (const c of dexList) {
    try {
      const at = atlases[c.anim];
      const tex = texBySlug[c.anim];
      if (!at || !tex || !at.anims) continue;
      const a = at.anims.Idle || at.anims.Walk;
      const f = a.frames[0][0];
      const cv = document.createElement('canvas');
      cv.width = a.frameW; cv.height = a.frameH;
      cv.getContext('2d').drawImage(tex.image, f.x, f.y, a.frameW, a.frameH, 0, 0, a.frameW, a.frameH);
      dexThumbs[c.anim] = cv.toDataURL();
    } catch (e) { /* 缩略图失败仅影响显示 */ }
  }
  function refreshDex() { hud.dex(dexList, dexState, dexThumbs, { onCry: playDexCry }); }
  function playDexCry(c) {
    const go = () => cries.play(c.dex, { volume: 0.7, rateJitter: false });
    if (cries.statusOf(c.dex) === 'ok') go();
    else cries.load(c.dex, `assets/cries/${c.dex}.ogg`).then(go);
  }
  let hitStopT = 0;
  const feel = data.balance.feel;
  const v3 = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  function roomCfg(cell) {
    const doors = {};
    for (const [k, v] of Object.entries(cell.doors)) doors[k] = v;
    return { type: cell.type, w: run.roomW, h: run.roomH, doors };
  }
  function rebuildRoom() {
    applyFloorPalette();
    if (roomView) roomView.dispose();
    if (props) props.dispose();
    for (const [, bb] of enemyViews) { scene.remove(bb.group); bb.dispose(); }
    enemyViews.clear();
    hud.clearPrices();
    const cell = run.map.get(run.cellKey);
    roomView = buildRoom(THREE, scene, tex, lights, tier, roomCfg(cell));
    props = createProps(THREE, scene, { coin: coinTex, heart: heartTex });
    for (const d of run.pedestals) if (!d.taken) {
      const def = data.items[d.itemId];
      props.addPedestal(d.id, d.x, d.y, def ? iconTex[def.icon] : iconTex['kings-rock']);
    }
    for (const k of run.pickups) props.addPickup(k.id, k.kind, k.x, k.y);
    hud.minimap(run.map, run.cellKey);
    hud.flash();
    if (postfx && postfx.setFocusTarget) postfx.setFocusTarget(player.mesh);
  }
  rebuildRoom();

  window.__depths = { run, renderer, scene, camera: camCtl.camera, cries, tier, postfx, input, lightOk, data,
    get roomView() { return roomView; },
    get player() { return player; }, pump: null,
    get dexState() { return dexState; },
    restart: () => { saveStore.clear(); run = createRun(data); window.__depths.run = run; hud.hideVictory(); hud.hideDeath(); rebuildRoom(); },
    goRoom: (key) => { enterRoom(run, data, key); window.__depths.run = run; rebuildRoom(); },   // ?debug 传送
    give: (id) => { run.player.inv.passives.push(id); recompute(run, data); hud.slots(run.player.moveA, run.player.moveB, run.player.slot, run.player.mods.lockB); } };

  // ---- 存档与本机榜 ----
  const BOARD_KEY = 'depths-board';
  function saveNow() { if (started && !run.over && run.player.alive) saveStore.write(run); }
  function recordBoard() {
    try {
      const list = JSON.parse(localStorage.getItem(BOARD_KEY) || '[]');
      list.push({
        seed: run.seed >>> 0, daily: !!run.isDaily, floor: run.floorNo, win: !!run.win,
        time: Math.round(run.stats.tRun || run.t), kills: run.stats.kills, items: run.stats.items, date: Date.now(),
      });
      list.sort((a, b) => (b.win - a.win) || (b.floor - a.floor) || (a.time - b.time));
      localStorage.setItem(BOARD_KEY, JSON.stringify(list.slice(0, 8)));
    } catch (e) { /* ignore */ }
  }
  function readBoard() {
    try { return JSON.parse(localStorage.getItem(BOARD_KEY) || '[]'); } catch (e) { return []; }
  }

  hud.progress(1, '出发！');
  hud.ready();

  // ---- 开始界面：继续 / 新开 / 每日 ----
  let started = false;
  function beginRun(freshRun) {
    run = freshRun;
    window.__depths.run = run;
    playerSlug = '';
    setPlayerSprite(run.player.species);
    rebuildRoom();
    hud.slots(run.player.moveA, run.player.moveB, run.player.slot, run.player.mods.lockB);
    started = true;
  }
  const savedRaw = saveStore.read();
  const savedOk = (savedRaw && deserializeRun(data, savedRaw)) || null;   // 顺便校验
  if (savedRaw && !savedOk) saveStore.clear();                    // 损坏/旧版存档清掉
  hud.startScreen({
    save: savedOk ? { floorNo: savedOk.floorNo, name: data.floors[savedOk.floorNo].name } : null,
    board: readBoard(),
    onContinue: () => beginRun(savedOk),
    onNew: () => { saveStore.clear(); beginRun(createRun(data)); hud.banner('宝可梦 · 晶穴深处', '洞窟层 · 找到小刚的道馆', 2600); },
    onDaily: () => { saveStore.clear(); const r = createRun(data, dailySeed()); r.isDaily = true; beginRun(r); hud.banner('每日挑战', '今日全服同图 · 种子 ' + (dailySeed() >>> 0), 2600); },
    onDex: () => refreshDex(),
  });

  function aimVector() {
    const ta = input.touchAim();
    if (ta) return { x: ta.x, y: ta.y };            // 触屏右摇杆：朝推动方向射击
    raycaster.setFromCamera(input.mouse, camCtl.camera);
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
      const dx = hitPoint.x - run.player.x, dz = hitPoint.z - run.player.y;
      if (Math.hypot(dx, dz) > 0.05) return { x: dx, y: dz };
    }
    return { x: run.player.lastDir.x, y: run.player.lastDir.y };
  }

  function damageNum(worldX, worldY, txt, kind) {
    if (txt === '' || txt == null) return;
    v3.set(worldX, 1.2, worldY).project(camCtl.camera);
    hud.damageNum((v3.x + 1) / 2 * window.innerWidth, (1 - (v3.y + 1) / 2) * window.innerHeight, txt, kind);
  }

  // 台座详情（靠近 2.8 格内最近未拿台座）
  function peekInfo(d) {
    if (d.itemId.startsWith('companion:')) {
      const spec = data.enemies[d.itemId.slice('companion:'.length)];
      return spec ? {
        name: spec.name + '（受困）', quality: 1, icon: null, price: 0, free: true,
        desc: '踏上台座免费结伴：按 F 换它上场，替你承受伤害',
      } : null;
    }
    const it = data.items[d.itemId];
    if (!it) return null;
    return { name: it.name, desc: it.desc, quality: it.quality, icon: it.icon, price: d.price, free: d.price === 0 };
  }

  const fading = [];
  function consumeEvents() {
    for (const ev of run.events) {
      switch (ev.t) {
        case 'room-enter': {
          if (ev.cell !== run.cellKey) break;
          rebuildRoom();
          saveNow();
          const nm = ROOM_NAMES[ev.type] || '';
          if (ev.type === 'boss') hud.banner('尼比道馆 · 小刚', '岩石般坚硬的意志！', 3000);
          else if (ev.type === 'shop') hud.banner('友好商店', '踩上商品即可购买', 1800);
          else if (ev.type === 'treasure') hud.banner('宝箱房', '免费的强化在等你', 1600);
          else if (ev.type === 'secret') hud.banner('隐藏房！', '你发现了秘密', 2000);
          else if (ev.type === 'camp') hud.banner('救援营地', '受困的宝可梦在等你（免费结伴）', 2200);
          break;
        }
        case 'room-transition': hud.flash(); break;
        case 'spawn': {
          const spec = data.enemies[ev.eid];
          const anim = spec.anim || ev.eid;
          const bb = createBillboard(THREE, texBySlug[anim], atlases[anim], shadowTex);
          bb.place(ev.x, ev.y); bb.setSpawnK(0.2);
          scene.add(bb.group);
          enemyViews.set(ev.id, bb);
          fx.burst(ev.x, ev.y, 6, 0x9fb8d8);
          break;
        }
        case 'enemy-hurt': case 'enemy-die': {
          const bb = enemyViews.get(ev.id);
          if (bb) bb.flash(0.12);
          const color = ev.kind === 'super' ? 0xffd24a : ev.kind === 'weak' ? 0x9aa7bd : 0xffe9a0;
          fx.burst(ev.x, ev.y, ev.t === 'enemy-die' ? 14 : 6, color);
          if (ev.t === 'enemy-die') {
            hitStopT = Math.max(hitStopT, feel.hitStopKill);
            camCtl.shake(ev.name === '小刚' ? 0.5 : feel.shakeKill, 0.25);
            if (ev.kind === 'super') damageNum(ev.x, ev.y, '克制!', 'super');
            if (bb) { fading.push({ bb, t: 0.3 }); }
          } else {
            damageNum(ev.x, ev.y, ev.dmg >= 10 ? Math.round(ev.dmg) : ev.dmg.toFixed(1), ev.kind);
          }
          break;
        }
        case 'boss-intro': break;
        case 'boss-phase2':
          hud.banner('小刚', '「岩石，也要认真起来了！」', 2200);
          camCtl.shake(0.4, 0.5);
          break;
        case 'boss-slam': camCtl.shake(0.3, 0.25); break;
        case 'telegraph-hit': fx.burst(ev.x, ev.y, 10, 0xc88a70); break;
        case 'player-hurt':
          hitStopT = Math.max(hitStopT, feel.hitStopHurt);
          camCtl.shake(feel.shakeHurt, 0.3);
          player.flash(0.1);
          break;
        case 'player-dodge': damageNum(ev.x, ev.y, '闪避', 'immune'); break;
        case 'player-block': damageNum(ev.x, ev.y, '格挡', 'super'); break;
        case 'lethal-guard': hud.banner('气势披带！', '保住了一命', 1400); break;
        case 'player-die':
          saveStore.clear();
          recordBoard();
          camCtl.shake(0.5, 0.5);
          cries.play(25, { volume: 0.7, rateJitter: false });
          run.stats.tRun = run.t;
          hud.showDeath(run.stats, run.seed);
          break;
        case 'item-take':
          props && props.removePedestal(run.pedestals.find((d) => d.itemId === ev.id)?.id ?? -1);
          hud.itemCard(ev.name, ev.desc, ev.quality, ev.icon);
          hud.slots(run.player.moveA, run.player.moveB, run.player.slot, run.player.mods.lockB);
          break;
        case 'pickup':
          if (ev.kind === 'heart') damageNum(ev.x, ev.y, '+1', 'super');
          break;
        case 'secret-reveal':
          roomView && roomView.revealSecret();
          hud.banner('墙上有裂缝……开了！', '', 1800);
          break;
        case 'boss-clear':
          hud.banner(`第 ${ev.floor} 枚徽章 GET！`, '楼梯出现了——去下一层', 3000);
          hud.hideBossBar();
          break;
        case 'floor-next':
          saveNow();
          hud.banner(ev.name, '回 2 格亲密度 · 敌人更强了', 3200);
          camCtl.shake(0.35, 0.4);
          break;
        case 'evolve':
          setPlayerSprite('raichu');
          hud.banner('进化！皮卡丘 → 雷丘', '面板成长 + Z 招式升级为「打雷」', 3600);
          camCtl.shake(0.4, 0.6);
          cries.play(25, { volume: 0.8 });
          fx.burst(run.player.x, run.player.y, 20, 0xffffff);
          break;
        case 'zmove':
          hud.flash();
          camCtl.shake(0.5, 0.5);
          hitStopT = Math.max(hitStopT, 0.18);
          fx.burst(ev.x, ev.y, 26, 0xffe24a);
          damageNum(ev.x, ev.y, ev.name + '！', 'super');
          break;
        case 'companion-join':
          hud.banner(`${ev.name} 加入了同行！`, '按 F 随时切换', 2600);
          break;
        case 'companion-swap':
          hud.banner(ev.name + '，就决定是你了！', '', 1400);
          break;
        case 'companion-faint':
          hud.banner(`${ev.name} 体力不支退场`, '主力回归', 2000);
          break;
        case 'steal':
          damageNum(ev.x, ev.y, '-¥' + ev.amt, 'weak');
          break;
        case 'reverse-start':
          document.body.classList.add('reversed');
          hud.banner('精神领域！', '操作反转 2 秒', 1600);
          setTimeout(() => document.body.classList.remove('reversed'), ev.duration * 1000);
          break;
        case 'boss-tp': case 'blink':
          fx.burst(ev.to[0], ev.to[1], 6, 0xc79fff);
          break;
        case 'bomb-fuse':
          fx.burst(ev.x, ev.y, 4, 0xffb36b);
          break;
        case 'floor-clear':
          run.stats.tRun = run.t;
          saveStore.clear();
          recordBoard();
          hud.hideBossBar();
          hud.banner('灰色徽章 GET！', '《晶穴深处·第一章》完', 4000);
          setTimeout(() => hud.showVictory(run.stats, run.seed), 1800);
          break;
        case 'clear': hud.minimap(run.map, run.cellKey); saveNow(); break;
        default: break;
      }
    }
    // 图鉴：本帧事件批量点亮 + 持久化
    const dr = dexApply(dexState, run.events);
    if (dr.changed) { dexState = dr.dex; dexStore.write(dexState); }
  }

  function stepFading(dt) {
    for (let i = fading.length - 1; i >= 0; i--) {
      const f = fading[i];
      f.t -= dt;
      f.bb.setSpawnK(Math.max(f.t / 0.3, 0.05));
      if (f.t <= 0) { scene.remove(f.bb.group); f.bb.dispose(); fading.splice(i, 1); }
    }
  }

  // ---- 主循环 ----
  let last = performance.now(), acc = 0, steps = 0;
  const clock = { t: 0 };
  let doorOpenSeen = null;
  let peekPedId = -1, sheetOn = false, sheetT = 0;

  function frame(now, forcedDt) {
    requestAnimationFrame(frame);
    if (!Number.isFinite(camCtl.camera.aspect)) resize(THREE, renderer, camCtl.camera);
    let dt = forcedDt ?? (now - last) / 1000;
    if (dt < 0) dt = 0;
    if (dt > 0.25) dt = 0.25;
    last = now;
    if (hitStopT > 0) { hitStopT -= dt; dt *= 0.08; }

    if (input.consumePress('KeyC')) cries.play(25);
    if (input.consumePress('KeyB') || input.consumePress('Escape')) {
      if (hud.dexOpen) hud.hideDex();
      else refreshDex();
    }
    const dexPaused = hud.dexOpen;
    const digit = ['Digit1', 'Digit2', 'Digit3'].find((c) => input.consumePress(c));
    if (digit) {
      const map = { Digit1: 'high', Digit2: 'med', Digit3: 'low' };
      const u = new URL(location.href);
      u.searchParams.set('q', map[digit]);
      location.replace(u);
    }
    if (debugOn) {
      if (input.consumePress('KeyK')) for (const e of run.enemies) e.hp = 0;
    }
    const rPressed = input.consumePress('KeyR');
    if (rPressed && (!run.player.alive || run.over)) {
      saveStore.clear();
      run = createRun(data);
      window.__depths.run = run;
      hud.hideVictory(); hud.hideDeath();
      playerSlug = '';
      setPlayerSprite(run.player.species);
      rebuildRoom();
      hud.slots(run.player.moveA, run.player.moveB, run.player.slot, run.player.mods.lockB);
    }

    const gameInput = {
      move: input.getMove(),
      aim: aimVector(),
      fire: (input.fire || !!input.touchAim()) && run.player.alive && !run.over,
      dashEdge: input.consumePress('Space'),
      slotEdge: input.consumePress('KeyQ'),
      useEdge: input.consumePress('KeyE'),
      zEdge: rPressed && run.player.alive && !run.over,
      swapEdge: input.consumePress('KeyF'),
    };

    if (!started || dexPaused) { acc = 0; steps = 0; }
    else {
      acc += dt;
      steps = 0;
      while (acc >= STEP && steps < 4) {
        stepRun(run, gameInput, data);
        acc -= STEP;
        steps++;
      }
      if (steps === 4) acc = 0;
    }
    input.endFrame();
    consumeEvents();
    stepFading(dt);

    const alpha = acc / STEP;
    const p = run.player;

    // 玩家（进化/替补激活时换精灵）
    setPlayerSprite(p.activeSide === 'companion' && p.companion ? p.companion.eid : p.species);
    const rx = p.px + (p.x - p.px) * alpha, ry = p.py + (p.y - p.py) * alpha;
    player.setPose(p.anim, p.dir);
    player.update(dt);
    player.place(rx, ry);
    player.mesh.visible = p.alive && (p.iframes <= 0 || Math.floor(run.t * 18) % 2 === 0);
    player.shadow.visible = p.alive;

    // 敌人
    for (const e of run.enemies) {
      let bb = enemyViews.get(e.id);
      if (!bb) {
        const anim = data.enemies[e.eid]?.anim || e.eid;
        bb = createBillboard(THREE, texBySlug[anim], atlases[anim], shadowTex);
        scene.add(bb.group);
        enemyViews.set(e.id, bb);
      }
      if (e.family === 'boss') {
        bb.mesh.visible = !e.hidden;
        bb.shadow.visible = !e.hidden;
      }
      if (e.state === 'spawning') bb.setSpawnK(Math.max(0.2, 1 - e.spawnT / 0.55 * 0.8));
      else bb.setSpawnK(1);
      bb.setPose(e.flash > 0 && e.family !== 'boss' ? 'Hurt' : e.anim, e.dir);
      if (e.stealth && e.flash <= 0 && !e.fleeing) bb.mesh.material.opacity = 0.45;
      else if (bb.mesh.material.opacity !== 1) bb.mesh.material.opacity = 1;
      bb.mesh.material.transparent = bb.mesh.material.opacity < 1;
      bb.update(dt);
      bb.place(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha);
    }
    const live = new Set(run.enemies.map((e) => e.id));
    for (const [id, bb] of enemyViews) if (!live.has(id) && !fading.some((f) => f.bb === bb)) { scene.remove(bb.group); bb.dispose(); enemyViews.delete(id); }

    // Boss 条
    const boss = run.enemies.find((e) => e.family === 'boss');
    if (boss) hud.bossBar(`${boss.name} · 大岩蛇`, boss.hp / boss.maxHp);
    else if (!run.over) hud.hideBossBar();

    fx.syncProjectiles(run.projectiles, alpha);
    teleFx.sync(run.telegraphs);
    fx.update(dt);
    if (roomView) {
      roomView.update(dt, clock.t);
      const open = run.room.cleared || ['shop', 'secret', 'start'].includes(run.room.type);
      if (open !== doorOpenSeen) { doorOpenSeen = open; roomView.setDoorOpen(open); }
    }
    if (props) {
      // 台座/拾取同步
      const pedLive = new Set(run.pedestals.filter((d) => !d.taken).map((d) => d.id));
      for (const d of run.pedestals) {
        if (d.taken) { props.removePedestal(d.id); continue; }
        v3.set(d.x, 1.0, d.y).project(camCtl.camera);
        hud.price(d, (v3.x + 1) / 2 * window.innerWidth, (1 - (v3.y + 1) / 2) * window.innerHeight);
      }
      props.syncPickups(run.pickups);
      props.update(clock.t);
    }

    // 台座详情卡：靠近时显示
    {
      let best = null, bd = 2.8 * 2.8;
      if (p.alive && !run.over) {
        for (const d of run.pedestals) {
          if (d.taken) continue;
          const dx = d.x - p.x, dy = d.y - p.y, dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; best = d; }
        }
      }
      const wantId = best ? best.id : -1;
      if (wantId !== peekPedId) {
        peekPedId = wantId;
        if (best) { const info = peekInfo(best); if (info) hud.peek(info); else hud.peek(null); }
        else hud.peek(null);
      }
    }

    // 触屏虚拟摇杆同步
    {
      const stks = input.sticks();
      for (const [id, key] of [['stick-l', 'l'], ['stick-r', 'r']]) {
        const el = document.getElementById(id);
        if (!el) continue;
        const o = stks[key];
        if (o) {
          el.style.display = 'block';
          el.style.left = o.ox + 'px';
          el.style.top = o.oy + 'px';
          el.firstElementChild.style.transform = `translate(${Math.round(o.kx * 34)}px, ${Math.round(o.ky * 34)}px)`;
        } else el.style.display = 'none';
      }
    }

    // Tab 长按：数据面板（全层地图 + 面板 + 道具收藏）
    const sheetWant = input.held('Tab') && !run.over && p.alive;
    if (sheetWant !== sheetOn) {
      sheetOn = sheetWant;
      hud.sheet(sheetOn, run, data);
      sheetT = clock.t;
    } else if (sheetOn && clock.t - sheetT > 0.25) {
      sheetT = clock.t;
      hud.sheet(true, run, data);
    }
    clock.t += dt;

    const moving = p.moving ? 1 : 0;
    camCtl.update(dt, rx, ry, (p.x - p.px) / STEP * moving * 0.2, (p.y - p.py) / STEP * moving * 0.2);

    if (postfx) postfx.composer.render(dt);
    else renderer.render(scene, camCtl.camera);

    const cell = run.map.get(run.cellKey);
    const roomLabel = run.over ? '通关！' :
      run.room.type === 'combat' || run.room.type === 'challenge'
        ? `${ROOM_NAMES[cell.type]} · 波 ${Math.min(run.room.waveIdx + 1, 3)}/3`
        : ROOM_NAMES[cell.type];
    hud.game(p.hp, p.maxHp, p.pp, p.dashCharges, data.balance.player.dashCharges,
      `第${run.floorNo}层·${data.floors[run.floorNo].name}｜${roomLabel}`, p.money,
      p.companion ? (p.activeSide === 'companion' ? `${p.companion.name} ${p.companion.hp}❤` : `替补:${p.companion.name}`) : '',
      p.pp >= 100 * p.mods.ppCost);
    hud.slots(p.moveA, p.moveB, p.slot, p.mods.lockB);

    const info = renderer.info.render;
    hud.frame(dt, {
      tier: `${TIERS[tier].label}(${tier})`, dpr: renderer.getPixelRatio().toFixed(2),
      calls: info.calls, tris: info.triangles,
      enemies: run.enemies.length, projs: run.projectiles.length, steps,
      x: p.x, y: p.y, hp: p.hp, pp: p.pp, cry: cries.statusOf(25),
      postfx: postfx ? '开' : (postfxFallback ? '关（composer黑图已回退直渲染）' : '关（低档）'),
      light: lightOk ? '正常' : '异常（请用 Chrome/Safari）',
    });
  }
  requestAnimationFrame(frame);
  window.addEventListener('resize', () => {
    resize(THREE, renderer, camCtl.camera);
    if (postfx) postfx.setSize(...viewportSize());
  });
  window.addEventListener('beforeunload', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  for (const [id, code] of [['btn-dash', 'Space'], ['btn-dex', 'KeyB'], ['btn-sheet', 'Tab']]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); input.pressButton(code); }, { passive: false });
  }
  window.__depths.pump = (n = 1, dtMs = 1000 / 60) => {
    let t = performance.now();
    for (let i = 0; i < n; i++) { t += dtMs; frame(t, dtMs / 1000); input.endFrame(); }
  };
}

boot().catch((e) => {
  hud.progress(1, '启动失败');
  const errBox = document.getElementById('load-err');
  errBox.textContent = String(e && e.stack || e);
  errBox.style.display = 'block';
});
