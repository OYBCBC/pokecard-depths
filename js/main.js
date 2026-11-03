// 启动入口 M3：楼层/多房间/道具/Boss 全链路。
import * as THREE from 'three';
import { detectTier, createRenderer, resize, viewportSize, TIERS } from './gfx/renderer.js?v=m3f';
import { createLights } from './gfx/lights.js?v=m3f';
import { createCamera } from './gfx/camera.js?v=m3f';
import { buildRoom, createProps, createTelegraphFx } from './gfx/scene.js?v=m3f';
import { createBillboard } from './gfx/sprites.js?v=m3f';
import { createEffects } from './gfx/effects.js?v=m3f';
import { createPostfx } from './gfx/postfx.js?v=m3f';
import { createHud } from './ui/hud.js?v=m3f';
import { createCries } from './audio/cries.js?v=m3f';
import { createInput } from './core/input.js?v=m3f';
import { createRun, stepRun, recompute, STEP } from './sim/engine.js?v=m3f';

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
  composer.render(1 / 60);
  const probe = document.createElement('canvas');
  probe.width = 16; probe.height = 10;
  const ctx = probe.getContext('2d');
  ctx.drawImage(canvas, 0, 0, 16, 10);
  const d = ctx.getImageData(0, 0, 16, 10).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 45) lit++;
  return lit >= 8;
}

const ROOM_NAMES = { start: '出生房', combat: '洞窟', treasure: '宝箱房', shop: '友好商店', challenge: '挑战房', secret: '？？？', boss: '道馆' };

async function boot() {
  hud.progress(0.05, '读取数据…');
  const [tcD, edD, mvD, bal, itemsD] = await Promise.all([
    loadJson('js/data/typechart.json'), loadJson('js/data/enemies.json'),
    loadJson('js/data/moves.json'), loadJson('js/data/balance.json'), loadJson('js/data/items.json'),
  ]);
  const data = {
    typechart: tcD.chart, enemies: edD.enemies, moves: mvD.moves, items: itemsD.items,
    itemPools: itemsD.poolConfig, balance: bal, waves: edD.waves,
    species: { player: { types: ['electric'] } }, floorNo: 1,
  };

  hud.progress(0.15, '读取图集…');
  const slugs = ['pikachu', 'rattata', 'caterpie', 'oddish', 'onix'];
  const atlases = {};
  await Promise.all(slugs.map(async (slug) => { atlases[slug] = await loadJson(`assets/atlas/${slug}.json`); }));

  hud.progress(0.3, '加载纹理…');
  const iconSlugs = Object.values(itemsD.items).map((it) => it.icon);
  const [texList, floorTex, floorBossTex, wallTex, wallTopTex, flameTex, shadowTex, orbBolt, orbAcid, doorTex, crackTex, coinTex, heartTex, ringTex, iconTexList] = await Promise.all([
    Promise.all(slugs.map((s) => loadTexture(`assets/atlas/${s}.png`, { pixel: true }))),
    loadTexture('assets/tiles/cave-floor.png', { pixel: true, mip: true }),
    loadTexture('assets/tiles/cave-floor-boss.png', { pixel: true, mip: true }),
    loadTexture('assets/tiles/cave-wall.png', { pixel: true, mip: true }),
    loadTexture('assets/tiles/cave-wall-top.png', { pixel: true, mip: true }),
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
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTopTex.wrapS = wallTopTex.wrapT = THREE.RepeatWrapping;
  flameTex.wrapS = THREE.RepeatWrapping; flameTex.repeat.set(1 / 4, 1);

  hud.progress(0.5, '装配场景…');
  const canvas = document.getElementById('game');
  const renderer = createRenderer(THREE, canvas, tier);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e18);
  scene.fog = new THREE.Fog(0x0b0e18, 26, 60);
  const lights = createLights(THREE, scene, tier, 24, 16);
  const camCtl = createCamera(THREE);
  resize(THREE, renderer, camCtl.camera);

  const tex = {
    floor: floorTex, floorBoss: floorBossTex, wall: wallTex, wallTop: wallTopTex,
    flame: flameTex, door: doorTex, crack: crackTex, coin: coinTex, heart: heartTex,
  };
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
  const player = createBillboard(THREE, texBySlug.pikachu, atlases.pikachu, shadowTex);
  scene.add(player.group);
  const enemyViews = new Map();
  let roomView = null, props = null;
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
    if (roomView) roomView.dispose();
    if (props) props.dispose();
    for (const [, bb] of enemyViews) { scene.remove(bb.group); bb.dispose(); }
    enemyViews.clear();
    hud.clearPrices();
    const cell = run.map.get(run.cellKey);
    roomView = buildRoom(THREE, scene, tex, lights, tier, roomCfg(cell));
    props = createProps(THREE, scene, { coin: coinTex, heart: heartTex });
    for (const d of run.pedestals) if (!d.taken) props.addPedestal(d.id, d.x, d.y, iconTex[data.items[d.itemId].icon]);
    for (const k of run.pickups) props.addPickup(k.id, k.kind, k.x, k.y);
    hud.minimap(run.map, run.cellKey);
    hud.flash();
    if (postfx && postfx.setFocusTarget) postfx.setFocusTarget(player.mesh);
  }
  rebuildRoom();

  window.__depths = { run, player, renderer, scene, camera: camCtl.camera, cries, tier, postfx, input, lightOk, data,
    get roomView() { return roomView; }, pump: null,
    restart: () => { run = createRun(data); window.__depths.run = run; hud.hideVictory(); hud.hideDeath(); rebuildRoom(); },
    give: (id) => { run.player.inv.passives.push(id); recompute(run, data); hud.slots(run.player.moveA, run.player.moveB, run.player.slot, run.player.mods.lockB); } };

  hud.progress(1, '出发！');
  hud.ready();
  hud.banner('宝可梦 · 晶穴深处', '洞窟层 · 找到小刚的道馆', 2600);

  function aimVector() {
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

  const fading = [];
  function consumeEvents() {
    for (const ev of run.events) {
      switch (ev.t) {
        case 'room-enter': {
          if (ev.cell !== run.cellKey) break;
          rebuildRoom();
          const nm = ROOM_NAMES[ev.type] || '';
          if (ev.type === 'boss') hud.banner('尼比道馆 · 小刚', '岩石般坚硬的意志！', 3000);
          else if (ev.type === 'shop') hud.banner('友好商店', '踩上商品即可购买', 1800);
          else if (ev.type === 'treasure') hud.banner('宝箱房', '免费的强化在等你', 1600);
          else if (ev.type === 'secret') hud.banner('隐藏房！', '你发现了秘密', 2000);
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
        case 'floor-clear':
          run.stats.tRun = run.t;
          hud.hideBossBar();
          hud.banner('灰色徽章 GET！', '《晶穴深处·第一章》完', 4000);
          setTimeout(() => hud.showVictory(run.stats, run.seed), 1800);
          break;
        case 'clear': hud.minimap(run.map, run.cellKey); break;
        default: break;
      }
    }
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

  function frame(now, forcedDt) {
    requestAnimationFrame(frame);
    if (!Number.isFinite(camCtl.camera.aspect)) resize(THREE, renderer, camCtl.camera);
    let dt = forcedDt ?? (now - last) / 1000;
    if (dt < 0) dt = 0;
    if (dt > 0.25) dt = 0.25;
    last = now;
    if (hitStopT > 0) { hitStopT -= dt; dt *= 0.08; }

    if (input.consumePress('KeyC')) cries.play(25);
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
    if (input.consumePress('KeyR') && (!run.player.alive || run.over)) {
      run = createRun(data);
      window.__depths.run = run;
      hud.hideVictory(); hud.hideDeath();
      rebuildRoom();
      hud.slots(run.player.moveA, run.player.moveB, run.player.slot, run.player.mods.lockB);
    }

    const gameInput = {
      move: input.getMove(),
      aim: aimVector(),
      fire: input.fire && run.player.alive && !run.over,
      dashEdge: input.consumePress('Space'),
      slotEdge: input.consumePress('KeyQ'),
      useEdge: input.consumePress('KeyE'),
    };

    acc += dt;
    steps = 0;
    while (acc >= STEP && steps < 4) {
      stepRun(run, gameInput, data);
      acc -= STEP;
      steps++;
    }
    if (steps === 4) acc = 0;
    input.endFrame();
    consumeEvents();
    stepFading(dt);

    const alpha = acc / STEP;
    const p = run.player;

    // 玩家
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
    hud.game(p.hp, p.maxHp, p.pp, p.dashCharges, data.balance.player.dashCharges, roomLabel, p.money);
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
