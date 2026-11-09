// 启动入口 M3：楼层/多房间/道具/Boss 全链路。
import * as THREE from 'three';
import { detectTier, createRenderer, resize, viewportSize, TIERS } from './gfx/renderer.js?v=m7b';
import { createLights } from './gfx/lights.js?v=m7b';
import { createCamera } from './gfx/camera.js?v=m7b';
import { buildRoom, createProps, createTelegraphFx } from './gfx/scene.js?v=m7b';
import { createBillboard } from './gfx/sprites.js?v=m7b';
import { createEffects } from './gfx/effects.js?v=m8';
import { styleOf, TYPE_COLORS } from './gfx/vfxdefs.js?v=m8';
import { createPostfx } from './gfx/postfx.js?v=m7b';
import { createHud } from './ui/hud.js?v=m7b';
import { createCries } from './audio/cries.js?v=m7b';
import { createBgm } from './audio/bgm.js?v=m7b';
import { createSfx } from './audio/sfx.js?v=m7b';
import { createInput } from './core/input.js?v=m7b';
import { createRun, stepRun, recompute, goNextFloor, STEP } from './sim/engine.js?v=m7b';
import { enterRoom } from './sim/actors.js?v=m7b';
import { saveStore, deserializeRun, dailySeed, encodeChallenge, decodeChallenge } from './sim/save.js?v=m7b';
import { dexSpecies, dexApply, dexStore, DEX_EXTRA } from './sim/dex.js?v=m7b';
import { ACHVS, achvApply, achvStore, metaStore, starterUnlocked, achvProgress } from './sim/achv.js?v=m7b';

const hud = createHud();
const tier = detectTier();
const params = new URLSearchParams(location.search);
const debugOn = params.has('debug');
const selfcheckOn = params.has('selfcheck');

// ---- 换皮推演（ADR-15）：?pack=orig 用原创占位包整体替换表现层 ----
let manifest = null;
if (params.get('pack') === 'orig') {
  try {
    manifest = await loadJsonRaw('js/data/pack-orig.json');
    console.info('[pack] 换皮推演：' + manifest.name);
  } catch (e) { console.warn('[pack] manifest 加载失败，回退正式包', e); }
}
function loadJsonRaw(u) { return fetch(u).then((r) => r.json()); }

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

const ROOM_NAMES = { start: '出生房', combat: '洞窟', treasure: '宝箱房', shop: '友好商店', challenge: '挑战房', secret: '？？？', boss: '道馆', blackmarket: '火箭队黑市', altar: '吉利蛋祭坛', camp: '救援营地' };

async function boot() {
  hud.progress(0.05, '读取数据…');
  const [tcD, edD, mvD, bal, itemsD, floorsD, spD] = await Promise.all([
    loadJson('js/data/typechart.json'), loadJson('js/data/enemies.json'),
    loadJson('js/data/moves.json'), loadJson('js/data/balance.json'), loadJson('js/data/items.json'),
    loadJson('js/data/floors.json'), loadJson('js/data/species.json'),
  ]);
  const data = {
    typechart: tcD.chart, enemies: edD.enemies, moves: mvD.moves, items: itemsD.items,
    itemPools: itemsD.poolConfig, balance: bal, waves: floorsD.floors['1'].waves,
    floors: floorsD.floors, species: spD.species, floorNo: 1,
  };
  // ---- MOD 工房（M7）：localStorage 包，开机应用（名字替换 + 数值乘区）----
  const MOD_LIST_KEY = 'depths-mods', MOD_ACTIVE_KEY = 'depths-mod-active';
  function modList() { try { return JSON.parse(localStorage.getItem(MOD_LIST_KEY) || '[]') || []; } catch (e) { return []; } }
  function modSave(list) { try { localStorage.setItem(MOD_LIST_KEY, JSON.stringify(list.slice(0, 12))); } catch (e) { /* ignore */ } }
  function activeMod() {
    const id = localStorage.getItem(MOD_ACTIVE_KEY);
    return (id && modList().find((m) => m.id === id)) || null;
  }
  // 应用到 data（boot 装载后、createRun 前）：引擎零感知，纯数据层
  function applyMod(data, mod) {
    if (!mod || !mod.cfg) return;
    const c = mod.cfg;
    const ehp = +c.enemyHp || 1, esp = +c.enemySpeed || 1, etouch = +c.enemyTouch || 1;
    for (const e of Object.values(data.enemies)) {
      if (e.family === 'boss') continue;
      e.hp *= ehp; e.speed *= esp;
      if (etouch !== 1) e.touchDmg = Math.max(1, Math.round(e.touchDmg * etouch));
    }
    const pb = data.balance.player;
    pb.baseDamage *= +c.playerDmg || 1;
    pb.moveSpeed *= +c.playerSpeed || 1;
    pb.maxHp = Math.max(2, Math.round(pb.maxHp + (+c.playerHpAdd || 0)));
    pb.startMoney = Math.max(0, Math.round((pb.startMoney || 15) * (+c.money || 1)));
    for (const [eid, nm] of Object.entries(c.names || {})) {
      if (data.enemies[eid]) data.enemies[eid].name = nm;
      if (data.species[eid]) data.species[eid].name = nm;
    }
  }
  let modApplied = null;
  try {
    if (localStorage.getItem(MOD_ACTIVE_KEY) && !selfcheckOn && !params.get('pack')) modApplied = activeMod();
  } catch (e) { /* ignore */ }

  // 换皮：manifest 覆盖名字/图集映射（数据层替换，引擎零改动——ADR-15）
  if (manifest) {
    for (const [k, v] of Object.entries(manifest.entries)) {
      if (data.enemies[k]) { data.enemies[k].name = v.name; data.enemies[k].anim = v.anim; }
      if (data.species[k]) { data.species[k].name = v.name; data.species[k].anim = v.anim; }
    }
  }
  if (modApplied) applyMod(data, modApplied);
  const atlasDir = manifest ? manifest.atlasDir : 'assets/atlas';

  hud.progress(0.15, '读取图集…');
  // 图集需求从数据推导（含换皮覆盖后的 anim），不再手写清单；单张缺失不炸启动（视图层兜底）
  const slugSet = new Set();
  for (const s of Object.values(data.species)) if (s.anim) slugSet.add(s.anim);
  for (const [eid, e] of Object.entries(data.enemies)) slugSet.add(e.anim || eid);
  const slugs = [...slugSet].filter(Boolean);
  const atlases = {};
  await Promise.all(slugs.map(async (slug) => {
    atlases[slug] = await loadJson(`${atlasDir}/${slug}.json`).catch(() => null);
  }));

  hud.progress(0.3, '加载纹理…');
  const iconSlugs = Object.values(itemsD.items).map((it) => it.icon);
  const themes = ['cave', 'plant', 'ruins'];
  const [texList, themeTexList, flameTex, shadowTex, orbBolt, orbAcid, doorTex, crackTex, coinTex, heartTex, ringTex, iconTexList] = await Promise.all([
    Promise.all(slugs.map((s) => loadTexture(`${atlasDir}/${s}.png`, { pixel: true }).catch(() => null))),
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
  // 视口适配（M6）：渲染尺寸 + 窄屏相机（放宽 fov/拉远）+ 雾随相机多拉的距离补偿
  function fitView() {
    resize(THREE, renderer, camCtl.camera);
    const extra = camCtl.fit(camCtl.camera.aspect);
    scene.fog.near = 26 + extra;
    scene.fog.far = 60 + extra;
  }
  fitView();

  const curTheme = () => data.floors[run.floorNo].theme;
  const tex = {
    flame: flameTex, door: doorTex, crack: crackTex, coin: coinTex, heart: heartTex,
  };
  Object.defineProperty(tex, 'floor', { get: () => themeTex[curTheme()].floor });
  Object.defineProperty(tex, 'floorBoss', { get: () => themeTex[curTheme()].floorBoss });
  Object.defineProperty(tex, 'wall', { get: () => themeTex[curTheme()].wall });
  Object.defineProperty(tex, 'wallTop', { get: () => themeTex[curTheme()].wallTop });
  const fx = createEffects(THREE, scene, ringTex, { flashLights: tier !== 'low' });
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
  const criesOn = !(manifest && manifest.cries === false);   // 换皮包关闭叫声
  if (criesOn) {
    cries.load(25, 'assets/cries/25.ogg');
    for (const c of [133, 104, 61, 151]) cries.load(c, `assets/cries/${c}.ogg`);   // 解锁搭档+梦幻预载
  }
  const cry = (id, opts) => { if (criesOn) cries.play(id, opts); };
  const bgm = createBgm({ ensureCtx: () => cries.ensureCtx(), onLog: (m) => console.info(m) });
  const sfx = createSfx({ ensureCtx: () => cries.ensureCtx() });
  sfx.setMuted(bgm.muted);                                     // 静音跨局记忆：音效与 BGM 同步（原来只记住了 BGM）
  const sfxOn = !(manifest && manifest.cries === false);      // 换皮推演关叫声时静音
  const splay = (n) => { if (sfxOn && !selfcheckOn) sfx.play(n); };
  const input = createInput();
  input.onFirstInteraction(() => { cries.ensureCtx(); if (!selfcheckOn) bgm.start(); });
  input.onPadConnect((id) => hud.toast('手柄已连接', (id || '').slice(0, 30)));
  // 音频解锁（M6）：touchend/click/keydown 才算浏览器认可的"用户激活"（touchstart 不算）；
  // 每次都试到 BGM 真正跑起来为止（iOS 来电/切后台后 ctx 变 interrupted 也靠这里恢复）
  const unlockAudio = () => { cries.ensureCtx(); if (!selfcheckOn && !bgm.running) bgm.start(); };
  for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, unlockAudio, { capture: true, passive: true });
  document.addEventListener('gesturestart', (e) => e.preventDefault());   // iOS Safari 双指缩放
  // 按键提示随输入方式切换（触屏没有 Q/F/E 键）
  const KEY_HINT = { KeyQ: ['按 Q ', '点「切招」'], KeyF: ['按 F ', '点「换队」'], KeyE: ['按 E ', '点「道具」'] };
  const keyHint = (code) => (KEY_HINT[code] || ['', ''])[input.touchMode ? 1 : 0];
  const buzz = (ms) => {                                       // 触屏震动反馈（安卓；iOS 无此 API 静默）
    if (input.touchMode && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } }
  };
  // 全屏（安卓 Chrome 等；iPhone Safari 不支持元素全屏 → 改提示"添加到主屏幕"）
  const fsRoot = document.documentElement;
  const fsActive = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const fsAvailable = () => input.touchMode
    && !!(fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen || document.exitFullscreen || document.webkitExitFullscreen);
  function goFullscreen() {
    if (fsActive()) {
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      if (ex) { try { const pr = ex.call(document); if (pr && pr.catch) pr.catch(() => {}); } catch (e) { /* ignore */ } }
      return;
    }
    const req = fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen;
    if (!req) return;
    const lock = () => {
      try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* ignore */ }
    };
    try {
      const pr = req.call(fsRoot, { navigationUI: 'hide' });
      if (pr && pr.then) pr.then(lock, () => {}); else lock();
    } catch (e) { /* 不支持静默 */ }
  }
  const isIPhone = /iPhone|iPod/.test(navigator.userAgent || '');
  const standalone = navigator.standalone === true
    || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

  // ---- 局与视图 ----
  let run = createRun(data);
  let playerSlug = 'pikachu';
  const pkAnim = (data.species.pikachu && data.species.pikachu.anim) || 'pikachu';   // 换皮后指向占位图集
  let player = createBillboard(THREE, texBySlug[pkAnim], atlases[pkAnim], shadowTex);
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

  window.__depths = { run, renderer, scene, camera: camCtl.camera, cries, sfx, tier, postfx, input, lightOk, data,
    get roomView() { return roomView; },
    get views() { return enemyViews; },          // selfcheck 按 id 精确取面片
    get player() { return player; }, pump: null,
    get dexState() { return dexState; },
    restart: () => restartRun(),                  // 与胜负页"重新出发"同一路径（beginRun：started/精灵/横幅齐全）
    goRoom: (key) => { enterRoom(run, data, key); window.__depths.run = run; rebuildRoom(); },   // ?debug 传送
    goFloor: (n) => { while (run.floorNo < n && goNextFloor(run, data)) {} window.__depths.run = run; rebuildRoom(); },   // ?debug 跳层
    // 自动化截图专用（M7）：同步渲染一帧并在同一任务里 toDataURL。
    // 失焦/后台标签的合成器截图拿不到 WebGL 帧（present 被浏览器丢弃）——坑⑫的正解；
    // preserveDrawingBuffer=false 下缓冲在合成后即清，所以渲染与采样必须同任务（M1 踩坑）。
    snap: (scale = 0.5) => {
      if (postfx) postfx.composer.render(1 / 60);
      else renderer.render(scene, camCtl.camera);
      const src = document.getElementById('game');
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(src.width * scale));
      c.height = Math.max(1, Math.round(src.height * scale));
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    },
    give: (id) => { run.player.inv.passives.push(id); recompute(run, data); hud.slots(effMoveA(run), effMoveB(run), run.player.slot, run.player.mods.lockB); } };

  // ---- 存档与本机榜 ----
  const BOARD_KEY = 'depths-board';
  function saveNow() { if (!selfcheckOn && started && !run.over && run.player.alive) saveStore.write(run); }
  const clearSave = () => { if (!selfcheckOn) saveStore.clear(); };   // selfcheck 会走死亡/重开路径：不许清掉玩家真存档
  function recordBoard() {
    if (selfcheckOn) return;
    try {
      const list = JSON.parse(localStorage.getItem(BOARD_KEY) || '[]');
      list.push({
        seed: run.seed >>> 0, daily: !!run.isDaily, difficulty: run.difficulty || 'normal',
        floor: run.floorNo, win: !!run.win,
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

  // ---- Service Worker（M5）：离线缓存；selfcheck/调试不注册防旧缓存挡新代码 ----
  // 换版本自动刷新（M7.1）：新 SW 接管时重载一次——否则用户要手动刷两次才能拿到新资源
  // （旧 SW 先用缓存答完本次加载，新 SW 要等下一次导航才生效）。首次安装不刷。
  if ('serviceWorker' in navigator && !selfcheckOn && !params.has('nosw')) {
    try {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          try {
            if (sessionStorage.getItem('depths-sw-reload')) return;
            sessionStorage.setItem('depths-sw-reload', '1');
            location.reload();
          } catch (e) { location.reload(); }
        });
      }
    } catch (e) { /* ignore */ }
    try { navigator.serviceWorker.register('sw.js').catch((e) => console.info('[sw] 注册失败（不影响游戏）', e)); }
    catch (e) { /* ignore */ }
  }

  // ---- 成就 / 跨局 meta（M4）----
  let achvSet = achvStore.read();
  let meta = metaStore.read();
  const dexCountNow = () => dexList.reduce((n, c) => n + (dexState[c.eid] && dexState[c.eid].seen ? 1 : 0), 0);
  function refreshAchv() {
    hud.achv(ACHVS, achvSet, {
      progress: (id) => achvProgress(id, { meta, dexCount: dexCountNow(), dexTotal: dexList.length }),
      speciesName: (sid) => (data.species[sid] && data.species[sid].name) || sid,
    });
  }
  function applyAchv() {
    const r = achvApply(achvSet, meta, { run, events: run.events, dexCount: dexCountNow(), dexTotal: dexList.length });
    meta = r.meta;
    if (!selfcheckOn) metaStore.write(meta);
    if (r.unlocked.length) {
      achvSet = r.set;
      if (!selfcheckOn) achvStore.write(achvSet);
      for (const a of r.unlocked) {
        const sp = a.unlock && data.species[a.unlock];
        splay('achv');
        hud.toast(`🏅 成就解锁：${a.name}`, sp ? `新搭档「${sp.name}」可选！` : a.desc);
      }
      if (hud.achvOpen) refreshAchv();
    }
  }

  // ---- 开始界面：继续 / 新开（选搭档）/ 每日 / 图鉴 / 成就 / 存档管理 ----
  let started = false;
  function beginRun(freshRun) {
    run = freshRun;
    window.__depths.run = run;
    playerSlug = '';
    setPlayerSprite(run.player.species);
    rebuildRoom();
    hud.slots(effMoveA(run), effMoveB(run), run.player.slot, run.player.mods.lockB);
    // 图鉴点亮所选搭档
    const dr0 = dexApply(dexState, [{ t: 'dex-seen', eid: run.player.species }]);
    if (dr0.changed) { dexState = dr0.dex; dexStore.write(dexState); }
    // 出生房 room-enter 在开始界面期间已被消费——补一发让引导横幅（三选一）能出现
    if (run.room && run.room.type === 'start') {
      run.events.push({ t: 'room-enter', cell: run.cellKey, type: 'start', cleared: true });
    }
    started = true;
  }
  const starterList = Object.entries(data.species)
    .filter(([, s]) => !s.evolved)
    .map(([id, s]) => ({
      id, name: s.name, role: s.role || '', desc: s.desc || '', anim: s.anim, unlock: s.unlock || null,
      lockName: s.unlock ? `解锁：${(ACHVS.find((a) => a.id === s.unlock) || {}).name || s.unlock}` : null,
    }));
  let selectedDiff = 'normal';
  const diffList = Object.entries(data.balance.difficulty || {})
    .filter(([k]) => !k.startsWith('_'))
    .map(([id, d]) => ({ id, label: d.label, desc: d.desc }));
  function pickStarter(daily) {
    hud.starterPick({
      list: starterList, thumbs: dexThumbs,
      isUnlocked: (s) => starterUnlocked(s, achvSet),
      title: daily ? '每日挑战 · 选择搭档' : '选择搭档',
      difficulties: diffList, difficulty: selectedDiff,
      hideDifficulty: daily,
      onRedraw: () => showStart(),                                        // 「← 回标题」
      onDifficulty: (did) => { selectedDiff = did; pickStarter(daily); },   // 重绘选中态
      onPick: (sid) => {
        saveStore.clear();
        const diff = daily ? 'normal' : selectedDiff;          // 每日挑战全服同图：固定普通
        const r = daily ? createRun(data, dailySeed(), sid, 'normal') : createRun(data, undefined, sid, diff);
        if (daily) r.isDaily = true;
        beginRun(r);
        const dn = (data.balance.difficulty[diff] || {}).label || '';
        if (daily) hud.banner('每日挑战', '今日全服同图 · 种子 ' + (dailySeed() >>> 0) + ' · ' + data.species[sid].name, 2600);
        else hud.banner('宝可梦 · 晶穴深处', `${data.species[sid].name}，就决定是你了！${dn !== '普通' ? '（' + dn + '）' : ''}`, 2600);
      },
    });
  }
  function showStart() {
    const raw = saveStore.read();
    const ok = (raw && deserializeRun(data, raw)) || null;      // 顺便校验
    if (raw && !ok) saveStore.clear();                          // 损坏/旧版存档清掉
    hud.startScreen({
      save: ok ? { floorNo: ok.floorNo, name: data.floors[ok.floorNo].name } : null,
      board: readBoard(),
      achvCount: `${achvSet.size}/${ACHVS.length}`,
      quality: tier,
      fullscreen: fsAvailable(), onFullscreen: () => { goFullscreen(); },
      iosTip: isIPhone && !standalone,
      modName: modApplied ? modApplied.name : null,
      onRedraw: () => showStart(),
      onMods: () => {
        hud.modWorkshop({
          list: modList(), activeId: modApplied ? modApplied.id : null,
          onSave: (m) => { const l = modList(); l.push(m); modSave(l); try { localStorage.setItem(MOD_ACTIVE_KEY, m.id); } catch (e) {} hud.toast('MOD 已保存并启用', m.name + ' · 新开的局生效'); showStart(); },
          onDelete: (id) => { modSave(modList().filter((m) => m.id !== id)); if (modApplied && modApplied.id === id) { try { localStorage.removeItem(MOD_ACTIVE_KEY); } catch (e) {} } showStart(); },
          onUse: (id) => { try { localStorage.setItem(MOD_ACTIVE_KEY, id); } catch (e) {} const m = modList().find((x) => x.id === id); hud.toast('MOD 已启用', (m && m.name) || id + ' · 新开的局生效'); showStart(); },
          onClearUse: () => { try { localStorage.removeItem(MOD_ACTIVE_KEY); } catch (e) {} hud.toast('MOD 已停用', '数值恢复原版'); showStart(); },
          onExport: (id) => {
            const m = modList().find((x) => x.id === id);
            if (!m) return;
            const text = JSON.stringify(m);
            const done = () => hud.toast('MOD 代码已复制', '发给朋友粘贴导入即可');
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
            else done();
          },
          onImport: (text) => {
            try {
              const m = JSON.parse(text);
              if (!m || !m.cfg || typeof m.name !== 'string') throw new Error('格式');
              const l = modList(); l.push({ id: 'mod_' + Date.now().toString(36), name: m.name.slice(0, 16), cfg: m.cfg });
              modSave(l);
              hud.toast('MOD 已导入', m.name + ' · 在列表里点「启用」');
              showStart();
            } catch (e) { hud.toast('导入失败', '不是有效的 MOD 代码'); }
          },
        });
      },
      onQuality: (q) => {
        try { localStorage.setItem('depths-quality', q); } catch (e) { /* ignore */ }
        location.reload();                                     // 渲染器/后处理链随档位重建
      },
      onContinue: () => beginRun(ok),
      onNew: () => pickStarter(false),
      onDaily: () => pickStarter(true),
      onChallenge: (code) => {
        const ch = decodeChallenge(code);
        if (!ch || !data.species[ch.species]) {
          hud.toast('挑战码无效', '格式应如 DPT1.xxxx（胜负页可复制本局码）');
          showStart();
          return;
        }
        saveStore.clear();
        const r = createRun(data, ch.seed, ch.species, ch.difficulty);
        beginRun(r);
        const dn = (data.balance.difficulty[ch.difficulty] || {}).label || '';
        hud.banner('挑战码开局', `${data.species[ch.species].name} · 种子 ${ch.seed >>> 0}${dn !== '普通' ? ' · ' + dn : ''}`, 3000);
      },
      onDex: () => refreshDex(),
      onAchv: () => refreshAchv(),
      onExport: () => {
        const rawSave = saveStore.read();
        if (!rawSave) return;
        const blob = new Blob([JSON.stringify(rawSave, null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `depths-save-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        hud.toast('存档已导出', a.download);
      },
      onImport: (text) => {
        try {
          const parsed = JSON.parse(text);
          const okRun = deserializeRun(data, parsed);
          if (!okRun) throw new Error('格式不符');
          saveStore.write(okRun);
          hud.toast('存档已导入', `第 ${okRun.floorNo} 层 · ${data.floors[okRun.floorNo].name}`);
          showStart();                                           // 重开界面让"继续"出现
        } catch (e) {
          hud.toast('导入失败', '不是有效的晶穴存档 JSON');
        }
      },
    });
    return ok;
  }
  showStart();

  // ---- 重开 / 回标题 / 暂停（M6：手机没有 R/Esc，全部要有按钮路径） ----
  // 重开沿用开局物种 species0（进化后 species=raichu，原 R 路径会拿雷丘面板开一只皮卡丘）与本局难度
  function restartRun() {
    clearSave();
    hud.hideVictory(); hud.hideDeath();
    setPaused(false);
    beginRun(createRun(data, undefined, run.player.species0 || run.player.species, run.difficulty || 'normal'));
  }
  function backToTitle() {
    saveNow();                                     // 局中返回：存档，标题页出现"继续探险"
    paused = false; sheetToggle = false;
    hud.pauseMenu(false); hud.hideDex(); hud.hideAchv();
    hud.hideDeath(); hud.hideVictory(); hud.hideBossBar();
    started = false;
    showStart();
  }
  hud.bindEnd({ retry: restartRun, title: backToTitle });

  let paused = false, sheetToggle = false;
  const canPause = () => started && run.player.alive && !run.over;
  function toggleMute() {
    const m = bgm.toggleMute();
    sfx.setMuted(m);
    hud.toast('声音 ' + (m ? '已静音' : '开启'), input.touchMode ? '暂停菜单可再切换' : 'M 键或暂停菜单切换（BGM 与音效一起）');
  }
  function showPauseMenu() {
    hud.pauseMenu(true, {
      muted: bgm.muted, quality: tier, fullscreen: fsAvailable(), fullscreenOn: fsActive(),
      on: (a) => {
        if (a === 'resume') setPaused(false);
        else if (a === 'mute') { toggleMute(); showPauseMenu(); }
        else if (a === 'dex') refreshDex();
        else if (a === 'achv') refreshAchv();
        else if (a === 'fs') { goFullscreen(); setPaused(false); }
        else if (a === 'restart') { restartRun(); }
        else if (a === 'title') backToTitle();
      },
      onQuality: (q) => {
        if (q === tier) return;
        saveNow();                                 // 重载前存档：回来点"继续探险"接着打
        try { localStorage.setItem('depths-quality', q); } catch (e) { /* ignore */ }
        location.reload();
      },
    });
  }
  function setPaused(on) {
    paused = !!on && canPause();
    if (paused) { saveNow(); showPauseMenu(); }
    else hud.pauseMenu(false);
  }

  // 竖屏提示（触屏 + 竖屏）：可"仍然竖屏玩"（相机 fit 会放宽视野）
  let rotateDismissed = false;
  function updateRotate() {
    const [w, h] = viewportSize();
    hud.rotateHint(input.touchMode && h > w * 1.05 && !rotateDismissed, () => { rotateDismissed = true; updateRotate(); });
  }
  updateRotate();
  input.onModeChange(() => updateRotate());

  // A/B 槽与 PP 显示：替补上场时显示替补自己的招式与 PP 条（两侧各自独立）
  const effMoveA = (r) => (r.player.activeSide === 'companion' && r.player.companion)
    ? r.player.companion.moveA : r.player.moveA;
  const effMoveB = (r) => (r.player.activeSide === 'companion' && r.player.companion)
    ? (r.player.companion.moveB || null) : r.player.moveB;
  const effSide = (r) => (r.player.activeSide === 'companion' && r.player.companion)
    ? r.player.companion : r.player;

  // 触屏瞄准辅助（M6）：右摇杆方向 ±10° 内有敌人就对准它——拇指推方向的精度远不如鼠标
  const ASSIST_COS = Math.cos(10 * Math.PI / 180);
  function assistAim(v) {
    const p = run.player;
    const l = Math.hypot(v.x, v.y) || 1;
    const ux = v.x / l, uy = v.y / l;
    let best = null, bestScore = Infinity;
    for (const e of run.enemies) {
      if (e.state !== 'active' || e.hidden) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
      if (d < 0.3 || d > 10) continue;
      const cos = (dx * ux + dy * uy) / d;
      if (cos < ASSIST_COS) continue;
      const score = (1 - cos) * 60 + d * 0.02;      // 角度优先，距离次之
      if (score < bestScore) { bestScore = score; best = { x: dx, y: dy }; }
    }
    return best || { x: v.x, y: v.y };
  }

  function aimVector() {
    const ta = input.touchAim();
    if (ta) return assistAim(ta);                   // 触屏右摇杆：朝推动方向射击（带轻度吸附）
    const pa = input.padAim();
    if (pa) return { x: pa.x, y: pa.y };            // 手柄右摇杆：朝推动方向射击
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
    if (d.event === 'gacha') {
      return { name: '？？？晶石', quality: 0, icon: null, price: d.price, desc: '赌石：开了才知道是什么（道具/树果/……或空气）' };
    }
    if (d.event === 'forge') {
      const it = data.items[d.itemId];
      return { name: it.name + '（重铸）', quality: it.quality, icon: it.icon, price: d.price,
        desc: '烧掉一件随机被动道具，铸成这件' };
    }
    if (d.event === 'blood') {
      const it = data.items[d.itemId];
      return { name: it.name, quality: it.quality, icon: it.icon, price: 0, priceHp: d.priceHp,
        desc: it.desc, hpShort: d.priceHp > 0 && run.player.maxHp - d.priceHp < 2 };
    }
    if (d.event === 'gift') {
      const it = data.items[d.itemId];
      return { name: it.name, quality: it.quality, icon: it.icon, price: 0, free: true, desc: it.desc };
    }
    if (d.itemId.startsWith('companion:')) {
      const spec = data.enemies[d.itemId.slice('companion:'.length)];
      return spec ? {
        name: spec.name + '（受困）', quality: 1, icon: null, price: 0, free: true,
        desc: `踏上台座免费结伴：${keyHint('KeyF')}换它上场，替你承受伤害`,
      } : null;
    }
    const it = data.items[d.itemId];
    if (!it) return null;
    const priceHp = d.priceHp > 0 ? '♥'.repeat(d.priceHp) : null;
    return {
      name: it.name, desc: it.desc, quality: it.quality, icon: it.icon, kind: it.kind,
      price: d.price, free: d.price === 0 && !d.priceHp, priceHp,
      hpShort: d.priceHp > 0 && run.player.maxHp - d.priceHp < 2,   // 上限不足
    };
  }

  const fading = [];
  // 属性特效辅助：事件里的 moveId → 样式键与配色
  const mvType = (id) => ((data.moves[id] || {}).type);
  function consumeEvents() {
    for (const ev of run.events) {
      switch (ev.t) {
        case 'room-enter': {
          if (ev.cell !== run.cellKey) break;
          rebuildRoom();
          saveNow();
          if (ev.type === 'boss') {
            const bSpec = data.enemies[data.floors[run.floorNo].boss];
            hud.banner(`${data.floors[run.floorNo].name} · ${bSpec.name}`, bSpec.intro || '馆主的试炼！', 3000);
          }
          else if (ev.type === 'start' && run.pedestals.some((d) => d.choice === 'start-tm' && !d.taken)) {
            hud.banner('免费技能机 · 三选一', `踏上台座装填 B 槽 · ${keyHint('KeyQ')}随时切换招式`, 3400);
          }
          else if (ev.type === 'shop') hud.banner('友好商店', '踩上商品即可购买', 1800);
          else if (ev.type === 'treasure') hud.banner('宝箱房', '免费的强化在等你', 1600);
          else if (ev.type === 'secret') hud.banner('隐藏房！', '你发现了秘密', 2000);
          else if (ev.type === 'camp') hud.banner('救援营地', '受困的宝可梦在等你（免费结伴）', 2200);
          else if (ev.type === 'blackmarket') hud.banner('火箭队黑市', '用亲密度上限交易高级货（♥×2 一件）', 2600);
          else if (ev.type === 'altar') hud.banner('吉利蛋祭坛', '捐献金钱换取守护 · 还有免费回复', 2600);
          else if (ev.type === 'vault') hud.banner('🔑 宝物密室', '锁着的房间总有理由', 2000);
          else if (ev.type === 'fissure') {
            const bs = data.enemies.mewtwo;
            hud.banner(`？？？ · ${bs.name}`, bs.intro || '幻之宝可梦在等你', 3200);
          }
          else if (ev.type === 'forge') hud.banner('⚒ 重铸工房', '¥14：烧掉一件随机被动，铸成台座上的新件', 2800);
          else if (ev.type === 'gacha') hud.banner('◈ 赌石台', '¥8 开一块晶石——开了才知道是什么', 2400);
          else if (ev.type === 'blood') hud.banner('🩸 血祭坛', '♥1 上限换一件高级货（保底 2 格）', 2600);
          else if (ev.type === 'gift') hud.banner('❁ 神秘礼物', '有人留在洞窟里的免费礼物', 2200);
          break;
        }
        case 'room-transition': hud.flash(); splay('door'); break;
        case 'dash': splay('dash'); break;
        case 'shot': {
          splay('shot');
          const mt = mvType(ev.moveId);
          fx.muzzle(ev.x, ev.y, styleOf(ev.moveId, mt), mt);
          break;
        }
        case 'spawn': {
          const spec = data.enemies[ev.eid];
          const anim = (spec && spec.anim) || ev.eid;
          if (!enemyViews.has(ev.id) && atlases[anim] && texBySlug[anim]) {   // 已有视图不重建（变身保 id）；图集缺失→无视图
            const bb = createBillboard(THREE, texBySlug[anim], atlases[anim], shadowTex);
            bb.place(ev.x, ev.y); bb.setSpawnK(0.2);
            if (ev.elite && bb.mesh) bb.mesh.scale.multiplyScalar(1.15);      // 精英体形
            scene.add(bb.group);
            enemyViews.set(ev.id, bb);
          }
          fx.burst(ev.x, ev.y, ev.elite ? 10 : 6, ev.elite ? 0xc79fff : 0x9fb8d8);
          break;
        }
        case 'enemy-skin': {
          // 原位变身（鲤鱼王→暴鲤龙）：丢旧视图，同步循环按新 eid 重建
          const old = enemyViews.get(ev.id);
          if (old) { scene.remove(old.group); old.dispose(); enemyViews.delete(ev.id); }
          fx.burst(ev.x, ev.y, 14, 0xff9a4a);
          splay('bossIntro');
          hud.toast('怒化！', '鲤鱼王变成了暴鲤龙！');
          break;
        }
        case 'enemy-hurt': case 'enemy-die': {
          const bb = enemyViews.get(ev.id);
          if (bb) bb.flash(0.12);
          splay(ev.t === 'enemy-hurt' ? (ev.kind === 'super' ? 'superhit' : ev.kind === 'weak' ? 'weakhit' : 'hit') : 'kill');
          const mt = mvType(ev.moveId);
          fx.hitFx(ev.x, ev.y, styleOf(ev.moveId, mt), mt, ev.kind);
          if (ev.t === 'enemy-die') {
            fx.burst(ev.x, ev.y, 10, (TYPE_COLORS[mt] || TYPE_COLORS.normal)[0], { spd: 3.4, up: 3, grav: 5, life: 0.55 });   // 击杀补一发属性色大爆发
            hitStopT = Math.max(hitStopT, feel.hitStopKill);
            camCtl.shake(ev.name === '小刚' ? 0.5 : feel.shakeKill, 0.25);
            if (ev.kind === 'super') damageNum(ev.x, ev.y, '克制!', 'super');
            if (bb) { fading.push({ bb, t: 0.3 }); }
          } else {
            damageNum(ev.x, ev.y, ev.dmg >= 10 ? Math.round(ev.dmg) : ev.dmg.toFixed(1), ev.kind);
          }
          break;
        }
        case 'boss-intro': {
          splay('bossIntro');
          // 馆主搭档登场叫声：ace anim（onix/alakazam/mew…）→ 图鉴号
          const dexNo = (DEX_EXTRA[ev.ace] || {}).dex;
          if (dexNo) cry(dexNo, { volume: 0.5 });
          break;
        }
        case 'boss-phase2': case 'boss-phase3': {
          splay('bossIntro');
          const bSpec = data.enemies[data.floors[run.floorNo].boss];
          const line = bSpec && bSpec.lines && bSpec.lines[ev.t.slice(5)];
          if (line) hud.banner(bSpec.name, line, 2200);
          camCtl.shake(0.4, 0.5);
          break;
        }
        case 'mew-purify': {
          // 净化结局：白光长闪 + 梦幻叫声 + 演出横幅
          hud.flash();
          setTimeout(() => hud.flash(), 350);
          camCtl.shake(0.6, 0.9);
          cry(151, { volume: 0.9, rateJitter: false });
          splay('win');
          fx.burst(ev.x, ev.y, 40, 0xffffff);
          hud.banner('梦幻被净化了……', '柔和的光芒充满晶穴，一切躁动归于宁静', 3600);
          break;
        }
        case 'boss-slam': splay('slam'); camCtl.shake(0.3, 0.25); break;
        case 'vault-open':
          splay('tm');
          hud.banner('🔑 密室开启！', '宝物与金币归你了', 2200);
          fx.burst(ev.x, ev.y, 12, 0xffd24a);
          break;
        case 'door-locked':
          hud.toast('门锁着', '需要钥匙 🔑（Boss 保底掉 1 把 · 战斗房也可能捡到）');
          splay('hurt');
          break;
        case 'fissure-open':
          hud.banner('裂缝深处……', '有什么东西一直在看着你', 2600);
          camCtl.shake(0.35, 0.4);
          splay('bossIntro');
          break;
        case 'heal-pulse':
          fx.burst(ev.x, ev.y, 8, 0x9fe070);
          splay('heart');
          break;
        case 'sniper-windup':
          fx.burst(ev.x, ev.y, 4, 0xffd24a);
          splay('windup');
          break;
        case 'forge-trade': {
          const lostName = ev.lost ? ((data.items[ev.lost] || {}).name || ev.lost) : null;
          const gainName = (data.items[ev.gain] || {}).name || ev.gain;
          hud.banner('⚒ 重铸完成', `${lostName ? lostName + ' → ' : ''}${gainName}`, 2400);
          splay('tm');
          break;
        }
        case 'forge-blocked':
          hud.toast('没有可重铸的被动', '先收集一些被动道具再来');
          break;
        case 'mewtwo-down':
          hud.banner('超梦被击败了！', '它的力量认可了你：本局伤害 ×1.15 · 去净化梦幻吧', 3600);
          camCtl.shake(0.6, 0.9);
          fx.burst(ev.x, ev.y, 40, 0xc79fff);
          splay('win');
          playDexCry({ dex: 150 });
          break;
        case 'event-room':
          hud.toast({ forge: '重铸工房出现了', gacha: '赌石台出现了', blood: '血祭坛出现了', gift: '神秘礼物出现了' }[ev.kind] || '奇遇出现了',
            '在本层某处的死路尽头');
          break;
        case 'telegraph-hit': splay('slam'); fx.burst(ev.x, ev.y, 10, 0xc88a70); break;
        case 'player-hurt':
          splay('hurt');
          buzz(35);
          hitStopT = Math.max(hitStopT, feel.hitStopHurt);
          camCtl.shake(feel.shakeHurt, 0.3);
          player.flash(0.1);
          break;
        case 'player-dodge': splay('dodge'); damageNum(ev.x, ev.y, '闪避', 'immune'); break;
        case 'player-block': splay('block'); damageNum(ev.x, ev.y, '格挡', 'super'); break;
        case 'lethal-guard': hud.banner('气势披带！', '保住了一命', 1400); break;
        case 'player-die':
          buzz(160);
          clearSave();
          recordBoard();
          splay('death');
          camCtl.shake(0.5, 0.5);
          cry((data.species[run.player.species] || {}).cry ?? 25, { volume: 0.7, rateJitter: false });
          run.stats.tRun = run.t;
          run.stats.floorNo = run.floorNo;
          hud.showDeath(run.stats, run.seed, (data.species[run.player.species] || {}).name || '搭档', {
            challenge: encodeChallenge({ seed: run.seed, difficulty: run.difficulty, species: run.player.species0 || run.player.species }),
          });
          break;
        case 'item-take':
          splay(ev.kind === 'passive' && ev.id && ev.id.startsWith('tm-') ? 'tm' : 'item');
          props && props.removePedestal(run.pedestals.find((d) => d.itemId === ev.id)?.id ?? -1);
          hud.itemCard(ev.name, ev.desc, ev.quality, ev.icon, ev.id && data.items[ev.id] ? data.items[ev.id].kind : ev.kind);
          hud.slots(effMoveA(run), effMoveB(run), run.player.slot, run.player.mods.lockB);
          break;
        case 'choice-vanish':   // 三选一台座联动消失
          props && props.removePedestal(ev.id);
          break;
        case 'pickup':
          if (ev.kind === 'coin' || ev.kind === 'coin2') splay('coin');
          else if (ev.kind === 'heart') { splay('heart'); damageNum(ev.x, ev.y, '+1', 'super'); }
          else if (ev.kind === 'consumable') splay('item');
          break;
        case 'secret-reveal':
          roomView && roomView.revealSecret();
          hud.banner('墙上有裂缝……开了！', '', 1800);
          splay('achv');
          break;
        case 'boss-clear': {
          const bSpec = data.enemies[data.floors[ev.floor].boss];
          hud.banner(`${bSpec.name} 被击败了！`, '楼梯出现了——去下一层', 3000);
          hud.hideBossBar();
          const aceCry = (DEX_EXTRA[bSpec.anim] || {}).dex;      // 馆主搭档弱化叫声
          if (aceCry) cry(aceCry, { volume: 0.35 });
          break;
        }
        case 'badge-take':
          splay('item');
          hud.banner(`${ev.name} GET！`, '馆主徽章：本局全程生效', 2600);
          hud.slots(effMoveA(run), effMoveB(run), run.player.slot, run.player.mods.lockB);
          break;
        case 'bm-open':
          splay('achv');
          hud.toast(ev.kind === 'blackmarket' ? '黑市的门开着……' : '祭坛的光在召唤……',
            ev.kind === 'blackmarket' ? '本层某处出现了火箭队黑市' : '本层某处出现了吉利蛋祭坛');
          break;
        case 'bm-deal':
          damageNum(run.player.x, run.player.y, '-♥' + ev.hpCost, 'weak');
          splay('coin');
          break;
        case 'ash-heal':
          hud.banner('圣灰的恩泽', '亲密度回满了！', 1800);
          splay('heart');
          break;
        case 'toxic-selfhurt': case 'aura-selfhurt':
          damageNum(ev.x, ev.y, '-1', 'poison');
          splay('selfdot');
          player.flash(0.08);
          break;
        case 'enemy-freeze':
          fx.burst(ev.x, ev.y, 6, 0xa8dcf5);
          damageNum(ev.x, ev.y, '冰冻', 'weak');
          splay('freeze');
          break;
        case 'enemy-burn': fx.burst(ev.x, ev.y, 3, 0xff9a4a); splay('burn'); break;
        case 'enemy-poison':
          fx.burst(ev.x, ev.y, 3, 0xb478d8);
          splay('poison');
          break;
        case 'retaliate':
          damageNum(ev.x, ev.y, ev.dmg, 'super');
          splay('hit');
          break;
        case 'chain-hit':
          fx.bolt(ev.from[0], ev.from[1], ev.to[0], ev.to[1]);
          splay('chain');
          break;
        case 'chain-ready': hud.toast('电气种子', `本房前 ${ev.n} 发弹带连锁闪电`); break;
        case 'pp-full': splay('heart'); break;
        case 'teleport': hud.flash(); splay('door'); break;
        case 'cured': splay('item'); hud.toast('木子果', '异常状态全部解除'); break;
        case 'regen': if (ev.echo) { splay('regen'); damageNum(run.player.x, run.player.y, '+1', 'super'); } break;
        case 'floor-next':
          saveNow();
          hud.banner(ev.name, '回 2 格亲密度 · 敌人更强了', 3200);
          camCtl.shake(0.35, 0.4);
          break;
        case 'evolve':
          splay('evolve');
          setPlayerSprite(ev.to);
          hud.banner(`进化！${ev.from || '搭档'} → ${ev.name}`, '面板成长 + Z 招式升级', 3600);
          camCtl.shake(0.4, 0.6);
          cry((data.species[ev.to] || {}).cry ?? 25, { volume: 0.8 });
          fx.burst(run.player.x, run.player.y, 20, 0xffffff);
          break;
        case 'zmove':
          splay('zmove');
          buzz(60);
          hud.flash();
          camCtl.shake(0.5, 0.5);
          hitStopT = Math.max(hitStopT, 0.18);
          fx.zmoveFx(ev.x, ev.y, mvType(ev.id), ev.radius);
          damageNum(ev.x, ev.y, ev.name + '！', 'super');
          break;
        case 'companion-join': {
          hud.banner(`${ev.name} 加入了同行！`, `${keyHint('KeyF')}随时切换`, 2600);
          const cSpec = data.enemies[ev.eid];                    // 结伴叫声
          if (cSpec && cSpec.dex) cry(cSpec.dex, { volume: 0.55 });
          break;
        }
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
          clearSave();
          recordBoard();
          hud.hideBossBar();
          if (run.floorNo >= 4) {
            const m2 = run.flags && run.flags.mewtwoDown;
            hud.banner('传说之物，化作了光……', m2 ? '《晶穴深处》真·通关！' : '《晶穴深处》通关！', 4000);
            run.stats.floorNo = run.floorNo;
            const dl = ((data.balance.difficulty || {})[run.difficulty] || {}).label;
            setTimeout(() => hud.showVictory(run.stats, run.seed, {
              title: m2 ? '你连超梦都超越了' : '晶穴的传说，落下帷幕',
              sub: m2 ? '被净化的梦幻与被认可的力量——晶穴再无秘密。' : '被净化的梦幻，在光中对你眨了眨眼——下次冒险再见。',
              difficultyLabel: dl,
              challenge: encodeChallenge({ seed: run.seed, difficulty: run.difficulty, species: run.player.species0 || run.player.species }),
            }), 2000);
          }
          break;
        case 'clear': hud.minimap(run.map, run.cellKey); saveNow(); break;
        case 'use-blocked':
          hud.toast('雷之石没有反应…', ev.reason === 'floor' ? '进化要从第 2 层开始——石头先收好，到下层再用'
            : ev.reason === 'evolved' ? '已经进化过了，石头先收好'
            : '这只搭档没有进化链，石头留在背包里');
          break;
        case 'tm-replace': {
          const lostName = (data.items[ev.lost] || {}).name || ev.lost;
          const gainName = (data.items[ev.gain] || {}).name || ev.gain;
          if (ev.side === 'companion') {
            const who = (run.player.companion && run.player.companion.name) || '替补';
            hud.toast(`${who} 的技能机已替换`, `${lostName} → ${gainName}（替补 B 槽与主力互不共用）`);
          } else {
            hud.toast('B 槽技能机已替换', `${lostName} → ${gainName}（B 槽一台，旧的已回收）`);
          }
          break;
        }
        case 'consumable-swap': {
          const lostName2 = (data.items[ev.lost] || {}).name || ev.lost;
          hud.toast(`换下的 ${lostName2} 掉在脚边`, 'E 槽一件消耗品 · 用掉后再回来捡');
          break;
        }
        case 'trinket-swap': {
          const lostName3 = (data.items[ev.lost] || {}).name || ev.lost;
          hud.toast(`换下的 ${lostName3} 掉在脚边`, '纪念品单件 · 想换回来到脚边捡');
          break;
        }
        default: break;
      }
    }
    // 图鉴：本帧事件批量点亮 + 持久化
    const dr = dexApply(dexState, run.events);
    if (dr.changed) { dexState = dr.dex; if (!selfcheckOn) dexStore.write(dexState); }
    // 成就：同批事件评估（解锁弹 toast）
    applyAchv();
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
  let peekPedId = -1, sheetOn = false, sheetT = 0, ingameSeen = null;
  // 边沿输入跨帧暂存（M6）：一帧可能跑 0 个模拟步（120/144Hz 高刷屏；60Hz 的 rAF 时间抖动）或多步（掉帧）。
  // 原来边沿直接塞给本帧所有步：0 步帧按键被吞（冲刺/切招"偶尔没反应"），2 步帧 Q/F 切两次=没切。
  // 现在边沿先进 pend，只交给下一个真正执行的模拟步，消费即清。
  const pend = { dash: false, slot: false, use: false, z: false, swap: false };
  const clearPend = () => { pend.dash = pend.slot = pend.use = pend.z = pend.swap = false; };
  // 触屏引导：幽灵底座附文字，直到两根摇杆都用够 6 秒
  let touchTut = (() => { try { return localStorage.getItem('depths-touch-tut') !== '1'; } catch (e) { return true; } })();
  const tutUse = { l: 0, r: 0 };
  // 动态分辨率（M6，仅触屏）：2.5s 平均帧率 <45 就逐级降像素比（不重载、不丢局）；
  // 降了不见效（系统省电锁 30 帧等）就回退一级并停用，免得白糊
  const DRS_STEPS = [1, 0.8, 0.67, 0.55];
  const drs = { base: renderer.getPixelRatio(), lv: 0, t: 0, n: 0, cool: 4, prevFps: 0, off: selfcheckOn || params.has('nodrs'), warned: false };
  function drsApply() {
    renderer.setPixelRatio(Math.max(0.6, drs.base * DRS_STEPS[drs.lv]));
    fitView();
    if (postfx) postfx.setSize(...viewportSize());
  }
  function drsTick(rawDt, simPaused) {
    // 无焦点（后台标签/内嵌浏览器未激活）时 rAF 会被节流，慢帧不是性能信号
    if (drs.off || !input.touchMode || !started || simPaused || document.hidden || !document.hasFocus()) return;
    if (rawDt > 0.2) return;
    if (drs.cool > 0) { drs.cool -= rawDt; return; }
    drs.t += rawDt; drs.n++;
    if (drs.t < 2.5) return;
    const fps = drs.n / drs.t;
    drs.t = 0; drs.n = 0;
    if (drs.prevFps) {
      const helped = fps >= drs.prevFps * 1.08;
      drs.prevFps = 0;
      if (!helped) { drs.lv--; drsApply(); drs.off = true; return; }
    }
    if (fps >= 45) return;
    if (drs.lv >= DRS_STEPS.length - 1) {
      if (fps < 32 && !drs.warned) { drs.warned = true; hud.toast('画面仍然吃力', '暂停菜单里把画质切到「低」会流畅很多'); }
      return;
    }
    drs.prevFps = fps;
    drs.lv++;
    drsApply();
    drs.cool = 2;
    if (drs.lv === 1) hud.toast('已自动降低渲染分辨率', '保持流畅（暂停菜单可切画质）');
  }

  function frame(now, forcedDt) {
    requestAnimationFrame(frame);
    if (!Number.isFinite(camCtl.camera.aspect)) fitView();
    let dt = forcedDt ?? (now - last) / 1000;
    if (dt < 0) dt = 0;
    if (dt > 0.25) dt = 0.25;
    last = now;
    const rawDt = dt;
    if (hitStopT > 0) { hitStopT -= dt; dt *= 0.08; }

    input.poll();                                             // 手柄：帧首统一轮询
    if (input.consumePress('KeyC')) cry((data.species[run.player.species] || {}).cry ?? 25);
    if (input.consumePress('KeyM')) toggleMute();
    // Esc：先关浮层（图鉴/成就/触屏面板），都没开就切暂停；B 仍是图鉴，P 也能暂停
    if (input.consumePress('Escape')) {
      if (hud.dexOpen) hud.hideDex();
      else if (hud.achvOpen) hud.hideAchv();
      else if (sheetToggle) sheetToggle = false;
      else if (paused) setPaused(false);
      else if (canPause()) setPaused(true);
    }
    if (input.consumePress('KeyP')) setPaused(!paused);
    if (input.consumePress('KeyB')) {
      if (hud.dexOpen) hud.hideDex();
      else if (hud.achvOpen) hud.hideAchv();
      else refreshDex();
    }
    if (input.consumePress('KeyJ')) {
      if (hud.achvOpen) hud.hideAchv();
      else refreshAchv();
    }
    const digit = ['Digit1', 'Digit2', 'Digit3'].find((c) => input.consumePress(c));
    if (digit) {
      const map = { Digit1: 'high', Digit2: 'med', Digit3: 'low' };
      const u = new URL(location.href);
      u.searchParams.set('q', map[digit]);
      saveNow();
      location.replace(u);
    }
    if (debugOn) {
      if (input.consumePress('KeyK')) for (const e of run.enemies) e.hp = 0;
    }
    // R：活着=Z 招式；胜负页显示中=重开（只认页面已弹出——死亡当帧连按 Z 不会跳过战绩页）。
    // 触屏 Z 按钮发 ZMove，永远不触发重开
    const rPressed = input.consumePress('KeyR');
    const zPressed = input.consumePress('ZMove');
    if (rPressed && started && hud.endOpen) restartRun();
    const live = run.player.alive && !run.over;
    if (!started || !live) sheetToggle = false;

    if (input.consumePress('Space')) pend.dash = true;
    if (input.consumePress('KeyQ')) pend.slot = true;
    if (input.consumePress('KeyE')) pend.use = true;
    if (input.consumePress('KeyF')) pend.swap = true;
    if ((rPressed || zPressed) && live) pend.z = true;
    const gameInput = {
      move: input.getMove(),
      aim: aimVector(),
      fire: (input.fire || !!input.touchAim() || !!input.padAim() || input.padFire()) && live,
      dashEdge: pend.dash, slotEdge: pend.slot, useEdge: pend.use, zEdge: pend.z, swapEdge: pend.swap,
    };

    // 模拟暂停：开始界面 / 图鉴 / 成就 / 暂停菜单 / 竖屏提示 / 触屏地图面板（Tab 长按的以撒式面板不停）
    const simPaused = !started || hud.dexOpen || hud.achvOpen || paused || hud.rotateOpen || sheetToggle;
    if (simPaused) { acc = 0; steps = 0; clearPend(); }
    else {
      acc += dt;
      steps = 0;
      while (acc >= STEP && steps < 4) {
        stepRun(run, gameInput, data);
        if (steps === 0) {                                    // 边沿只交给第一步
          clearPend();
          gameInput.dashEdge = gameInput.slotEdge = gameInput.useEdge = gameInput.zEdge = gameInput.swapEdge = false;
        }
        acc -= STEP;
        steps++;
      }
      if (steps === 4) acc = 0;
    }
    input.endFrame();
    consumeEvents();
    stepFading(dt);
    drsTick(rawDt, simPaused);
    // BGM 场景驱动：探索（默认）/战斗（房内有敌）/Boss（馆主在场）/黑市祭坛（房间变奏）
    bgm.setScene({
      floorNo: run.floorNo,
      combat: !simPaused && run.player.alive && !run.over && run.enemies.length > 0,
      boss: started && !run.over && run.player.alive && run.enemies.some((e) => e.family === 'boss'),
      roomType: run.room ? run.room.type : null,
    });

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
        if (!atlases[anim] || !texBySlug[anim]) continue;   // 图集缺失→无视图（模拟照跑）
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
      if (e.elite) bb.mesh.scale.multiplyScalar(1.15);   // 精灵体形 ×1.15（每帧幂等：setSpawnK 先归一）
      bb.setPose(e.flash > 0 && e.family !== 'boss' ? 'Hurt' : e.anim, e.dir);
      if (e.stealth && e.flash <= 0 && !e.fleeing) bb.mesh.material.opacity = 0.45;
      else if (bb.mesh.material.opacity !== 1) bb.mesh.material.opacity = 1;
      bb.mesh.material.transparent = bb.mesh.material.opacity < 1;
      bb.update(dt);
      bb.place(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha);
    }
    const liveIds = new Set(run.enemies.map((e) => e.id));
    for (const [id, bb] of enemyViews) if (!liveIds.has(id) && !fading.some((f) => f.bb === bb)) { scene.remove(bb.group); bb.dispose(); enemyViews.delete(id); }

    // Boss 条（馆主名 · 搭档物种名）
    const boss = run.enemies.find((e) => e.family === 'boss');
    if (boss) {
      const aceAnim = (data.enemies[boss.eid] || {}).anim;
      const aceName = (aceAnim && ((DEX_EXTRA[aceAnim] || {}).name || (data.enemies[aceAnim] || {}).name)) || '';
      hud.bossBar(aceName && aceName !== boss.name ? `${boss.name} · ${aceName}` : boss.name, boss.hp / boss.maxHp);   // 梦幻自身即搭档：不重复
    }
    else if (!run.over) hud.hideBossBar();

    fx.syncProjectiles(run.projectiles, alpha, dt, data);
    teleFx.sync(run.telegraphs);
    fx.update(dt);
    hud.setCompass(!!(run.player.mods && run.player.mods.compass));   // 洞窟罗盘：隐藏房上图
    if (roomView) {
      roomView.update(dt, clock.t, simPaused || hud.endOpen || !p.alive);   // 浮层打开时火光不频闪
      const open = run.room.cleared || ['shop', 'secret', 'start', 'blackmarket', 'altar', 'camp', 'forge', 'gacha', 'blood', 'gift', 'vault'].includes(run.room.type);
      if (open !== doorOpenSeen) { doorOpenSeen = open; roomView.setDoorOpen(open); }
    }
    if (props) {
      // 台座/拾取同步（taken 也要过一遍 hud.price——它的 taken 分支负责删价格牌 DOM，
      // 否则被拿走的"免费/♥♥/¥"标签残留在旧屏幕坐标上随相机漂移）
      const pedLive = new Set(run.pedestals.filter((d) => !d.taken).map((d) => d.id));
      for (const d of run.pedestals) {
        if (d.taken) { props.removePedestal(d.id); hud.price(d, 0, 0); continue; }
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

    // 触屏层（M6）：ingame 类控制按键/幽灵底座显隐；摇杆跟手；按键状态（冲刺格/PP 环/B 槽/道具图标/替补）
    const ingame = started && p.alive && !run.over && !paused && !hud.dexOpen && !hud.achvOpen;
    if (ingame !== ingameSeen) { ingameSeen = ingame; document.body.classList.toggle('ingame', ingame); }
    if (input.touchMode) {
      const stks = input.sticks();
      if (touchTut && ingame) {
        if (stks.l) tutUse.l += rawDt;
        if (stks.r) tutUse.r += rawDt;
        if (tutUse.l > 6 && tutUse.r > 6) {
          touchTut = false;
          if (!selfcheckOn) { try { localStorage.setItem('depths-touch-tut', '1'); } catch (e) { /* ignore */ } }
        }
      }
      hud.sticks(stks, touchTut);
      if (ingame) hud.touchPad({
        dash: p.dashCharges, dashMax: data.balance.player.dashCharges,
        pp: (effSide(run).pp || 0) / (100 * p.mods.ppCost),
        zReady: (effSide(run).pp || 0) >= 100 * p.mods.ppCost,
        hasB: !!effMoveB(run), slot: p.slot, lockB: !!p.mods.lockB,
        useIcon: p.inv.consumable ? ((data.items[p.inv.consumable] || {}).icon || 'kings-rock') : null,
        hasComp: !!(p.companion && p.companion.hp > 0), compActive: p.activeSide === 'companion',
      });
    }

    // Tab 长按（键鼠/手柄 Start）或触屏「地图」开关：数据面板（全层地图 + 面板 + 道具收藏）
    const sheetWant = (input.held('Tab') || sheetToggle) && started && !run.over && p.alive;
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
    hud.game(p.hp, p.maxHp, (effSide(run).pp || 0), p.dashCharges, data.balance.player.dashCharges,
      `第${run.floorNo}层·${data.floors[run.floorNo].name}｜${roomLabel}`, p.money,
      p.companion ? (p.activeSide === 'companion' ? `${p.companion.name} ${p.companion.hp}❤` : `替补:${p.companion.name}`) : '',
      (effSide(run).pp || 0) >= 100 * p.mods.ppCost, p.inv.keys || 0);
    hud.slots(effMoveA(run), effMoveB(run), p.slot, p.mods.lockB);

    const info = renderer.info.render;
    hud.frame(dt, {
      tier: `${TIERS[tier].label}(${tier})`, dpr: renderer.getPixelRatio().toFixed(2),
      calls: info.calls, tris: info.triangles,
      enemies: run.enemies.length, projs: run.projectiles.length, steps,
      x: p.x, y: p.y, hp: p.hp, pp: (effSide(run).pp || 0), cry: cries.statusOf(25),
      postfx: postfx ? '开' : (postfxFallback ? '关（composer黑图已回退直渲染）' : '关（低档）'),
      light: lightOk ? '正常' : '异常（请用 Chrome/Safari）',
    });
  }
  requestAnimationFrame(frame);
  const onViewport = () => {
    fitView();
    if (postfx) postfx.setSize(...viewportSize());
    updateRotate();
  };
  window.addEventListener('resize', onViewport);
  window.addEventListener('orientationchange', () => setTimeout(onViewport, 120));   // iOS 转屏后尺寸晚一拍
  window.addEventListener('beforeunload', saveNow);
  window.addEventListener('pagehide', saveNow);              // iOS Safari 不可靠触发 beforeunload
  // 切后台：存档 + 自动暂停（回来先看到菜单，不会一回来就挨打）；?debug 下不自动停（帧泵测试会被打断）
  const autoPause = !selfcheckOn && (!debugOn || params.has('autopause'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      saveNow();
      if (autoPause && canPause() && !paused) setPaused(true);
    } else cries.ensureCtx();
  });
  // 触屏按键（M6）：pointerdown 即触发（不等 click 抬手），按住不连发；地图=开关、暂停=菜单
  const padBtn = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    const on = (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
    if (window.PointerEvent) el.addEventListener('pointerdown', on);
    else el.addEventListener('touchstart', on, { passive: false });   // 老安卓内核兜底
  };
  padBtn('tb-dash', () => input.pressButton('Space'));
  padBtn('tb-z', () => input.pressButton('ZMove'));
  padBtn('tb-slot', () => input.pressButton('KeyQ'));
  padBtn('tb-use', () => input.pressButton('KeyE'));
  padBtn('tb-swap', () => input.pressButton('KeyF'));
  padBtn('tb-map', () => { sheetToggle = !sheetToggle; });
  padBtn('tb-pause', () => setPaused(true));
  hud.onSheetTap(() => { sheetToggle = false; });
  window.__depths.pump = (n = 1, dtMs = 1000 / 60) => {
    let t = performance.now();
    for (let i = 0; i < n; i++) { t += dtMs; frame(t, dtMs / 1000); input.endFrame(); }
  };

  // ---- selfcheck（?selfcheck=1）：开机自检 + 换皮推演证据。
  // 不写任何 localStorage（存档/榜/成就/meta 全部跳过），跑完把结果写进 DOM。
  if (selfcheckOn) {
    const out = { pack: manifest ? manifest.name : 'pkmn', errors: [] };
    try {
      document.getElementById('start').classList.add('hidden');
      beginRun(createRun(data, 424242, 'pikachu'));
      window.__depths.pump(90);
      const keyOf = (type) => [...run.map.entries()].find(([, c]) => c.type === type)?.[0];
      window.__depths.goRoom(keyOf('combat'));
      window.__depths.pump(90);
      out.enemiesCombat = run.enemies.length;
      out.viewsCombat = run.enemies.filter((e) => enemyViews.has(e.id)).length;   // 精灵视图必须在（orig 包纹理路径漏参数化时全空）
      for (let w = 0; w < 6 && !run.room.cleared; w++) {   // 逐波清空（F1 共 4 波，含抛射/治疗新敌）
        for (const e of run.enemies) e.hp = 0;             // debug 击杀路径
        window.__depths.pump(75);
      }
      // M7 抛射观测（确定性）：手动放一只小拳石，帧泵 3.6s > firstDelay1.6+warn1.15
      out.mortarSeen = false;
      {
        const gs = data.enemies.geodude;
        run.enemies.push({ id: run.nextId++, eid: 'geodude', name: gs.name, types: gs.types, family: gs.family,
          radius: gs.radius, score: gs.score, hp: gs.hp, maxHp: gs.hp, touchDmg: gs.touchDmg, speed: gs.speed, spdMod: gs.spdMod,
          x: run.player.x + 3, y: run.player.y, px: run.player.x + 3, py: run.player.y, kx: 0, ky: 0,
          state: 'active', spawnT: 0, flash: 0, touchCd: 0, stun: 0,
          anim: 'Idle', dir: 0, moving: false, wanderT: 0, wx: 0, wy: 0,
          shoot: null, shootCd: 0, mortar: { ...gs.mortar } });
        for (let i = 0; i < 18 && !out.mortarSeen; i++) {
          window.__depths.pump(12);
          if (run.telegraphs.some((t) => t.kind === 'rock')) out.mortarSeen = true;
        }
        for (const e of run.enemies) e.hp = 0;
        window.__depths.pump(60);                            // 清场（含鲤鱼王变身链路不出错）
      }
      out.combatCleared = run.room.cleared;
      out.playerAlive = run.player.alive;
      window.__depths.goRoom(keyOf('boss'));
      window.__depths.pump(200);
      out.bossSpawned = run.enemies.some((e) => e.family === 'boss');
      out.playerAlive2 = run.player.alive;
      // Boss 面片可见性（onix 图集越界→UV 负值隐形的回归断言）：按 id 取视图，不受 Boss 移动影响
      const bossE = run.enemies.find((e) => e.family === 'boss');
      out.bossMeshOk = false;
      if (bossE) {
        const bb = enemyViews.get(bossE.id);
        if (bb && bb.mesh && bb.mesh.geometry.attributes.uv && bb.mesh.scale.x > 0.05) {
          const uv = bb.mesh.geometry.attributes.uv;
          out.bossMeshOk = true;
          for (let i = 0; i < uv.count; i++) {
            const u = uv.getX(i), v = uv.getY(i);
            if (u < -0.001 || u > 1.001 || v < -0.001 || v > 1.001) out.bossMeshOk = false;
          }
        }
      }
      out.calls = renderer.info.render.calls;
      out.tris = renderer.info.render.triangles;

      // ---- M6 输入/流程回归（出生房无敌人，不受 Boss 干扰） ----
      window.__depths.goRoom(keyOf('start'));
      window.__depths.pump(5);
      const p0 = run.player;
      p0.moveB = p0.moveB || 'water-gun';
      p0.slot = 'A';
      // ① 边沿不丢不重：144Hz（多数帧 0 步）与 40ms 掉帧（一帧 2 步）下按 Q 必须恰好切一次
      out.edgesOk = true;
      for (const dtMs of [1000 / 144, 1000 / 144, 1000 / 144, 40, 40, 1000 / 60]) {
        const before = p0.slot;
        input.pressButton('KeyQ');
        window.__depths.pump(1, dtMs);
        window.__depths.pump(3, 1000 / 144);              // 0 步帧暂存的边沿在这里兑现
        if (p0.slot === before) out.edgesOk = false;
      }
      // ② 触屏按键路径：pointerdown → 模拟按键边沿（隐藏状态下事件照常派发）
      const slotBefore = p0.slot;
      document.getElementById('tb-slot').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      window.__depths.pump(2);
      out.padOk = p0.slot !== slotBefore;
      // ③ 暂停冻结模拟、继续恢复
      setPaused(true);
      const t0 = run.t;
      window.__depths.pump(20);
      out.pauseOk = paused && hud.pauseOpen && run.t === t0;
      setPaused(false);
      window.__depths.pump(5);
      out.pauseOk = out.pauseOk && !hud.pauseOpen && run.t > t0;
      // ③b 触屏「地图」按钮开面板 → 点面板关闭（用户反馈回归：旧版按钮坏的）
      const tbMap = document.getElementById('tb-map');
      tbMap.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      window.__depths.pump(2);
      out.sheetOk = !document.getElementById('sheet').classList.contains('hidden');
      document.getElementById('sheet').click();
      window.__depths.pump(2);
      out.sheetOk = out.sheetOk && document.getElementById('sheet').classList.contains('hidden');
      // ③c 图鉴打开 → ✕ 关闭（触屏无 B/Esc，✕ 必须可用）
      refreshDex();
      const dxClose = document.querySelector('#dex .ov-close');
      out.dexCloseOk = !!dxClose;
      if (dxClose) dxClose.click();
      window.__depths.pump(1);
      out.dexCloseOk = out.dexCloseOk && document.getElementById('dex').classList.contains('hidden');
      // ④ 死亡 → 胜负页"重新出发"按钮（手机没有 R 键）→ 新局开打
      p0.iframes = 0;
      run.hurtPlayer(99);
      consumeEvents();                                      // 步外注入的事件要立刻消费（下一步 stepRun 会清 events）
      window.__depths.pump(3);
      out.deathShown = hud.endOpen;
      const deadRun = run;
      document.querySelector('#death [data-end="retry"]').click();
      window.__depths.pump(5);
      out.retryOk = run !== deadRun && window.__depths.run === run && run.player.alive && !hud.endOpen
        && run.difficulty === deadRun.difficulty && run.player.species === deadRun.player.species0;

      out.ok = out.enemiesCombat > 0 && out.viewsCombat > 0 && out.combatCleared && out.playerAlive && out.playerAlive2 && out.bossSpawned && out.bossMeshOk && out.calls > 0
        && out.edgesOk && out.padOk && out.pauseOk && out.deathShown && out.retryOk && out.mortarSeen
        && out.sheetOk && out.dexCloseOk;
    } catch (e) {
      out.ok = false;
      out.errors.push(String((e && e.stack) || e));
    }
    const el = document.createElement('div');
    el.id = 'selfcheck';
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;background:rgba(0,0,0,.85);color:' + (out.ok ? '#7dff9b' : '#ff7d7d') + ';padding:8px 12px;font:12px monospace;white-space:pre;border-radius:4px';
    el.textContent = 'SELFCHECK ' + (out.ok ? 'PASS' : 'FAIL') + ' ' + JSON.stringify(out);
    document.body.appendChild(el);
    document.title = 'SELFCHECK ' + (out.ok ? 'PASS' : 'FAIL');
    console.info('[selfcheck]', out);
  }
}

boot().catch((e) => {
  hud.progress(1, '启动失败');
  const errBox = document.getElementById('load-err');
  errBox.textContent = String(e && e.stack || e);
  errBox.style.display = 'block';
});
