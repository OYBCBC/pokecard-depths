// 启动入口：素材装载 → 场景装配 → 固定步长主循环（模拟 60Hz + 渲染插值 + hit-stop）
import * as THREE from 'three';
import { detectTier, createRenderer, resize, viewportSize, TIERS } from './gfx/renderer.js?v=m2d';
import { createLights } from './gfx/lights.js?v=m2d';
import { createCamera } from './gfx/camera.js?v=m2d';
import { buildRoom } from './gfx/scene.js?v=m2d';
import { createBillboard } from './gfx/sprites.js?v=m2d';
import { createEffects } from './gfx/effects.js?v=m2d';
import { createPostfx } from './gfx/postfx.js?v=m2d';
import { createHud } from './ui/hud.js?v=m2d';
import { createCries } from './audio/cries.js?v=m2d';
import { createInput } from './core/input.js?v=m2d';
import { createRun, stepRun, STEP, ROOM_W, ROOM_H } from './sim/engine.js?v=m2d';

const hud = createHud();
const tier = detectTier();
const debugOn = new URLSearchParams(location.search).has('debug');

// 注：不走 TextureLoader 的 <img> 直传路径——个别 WebKit（内嵌 webview）对较大的
// img 纹理上传会静默采样为全黑；统一经 canvas 中转，所有浏览器行为一致。
function loadTexture(url, { srgb = true, pixel = false, mip = false } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
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

async function loadJson(url) { return (await fetch(url)).json(); }

// 光照自检：极少数嵌入式 webview 的 WebGL 光照管线会整体失效。
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
  rt.dispose();
  box.geometry.dispose();
  box.material.dispose();
  let red = 0;
  for (let i = 0; i < buf.length; i += 4) if (buf[i] > 100 && buf[i + 1] < 60) red++;
  return red > 100;
}

// composer 输出探测：个别 webview 能直渲染但 postprocessing 链输出全黑 → 回退直渲染
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

async function boot() {
  hud.progress(0.05, '读取数据…');
  const [typechartDoc, enemiesDoc, movesDoc, balance] = await Promise.all([
    loadJson('js/data/typechart.json'),
    loadJson('js/data/enemies.json'),
    loadJson('js/data/moves.json'),
    loadJson('js/data/balance.json'),
  ]);
  const data = {
    typechart: typechartDoc.chart,
    enemies: enemiesDoc.enemies,
    moves: movesDoc.moves,
    balance,
    waves: enemiesDoc.waves,
    species: { player: { types: ['electric'] } },
  };

  hud.progress(0.15, '读取图集…');
  const slugs = ['pikachu', 'rattata', 'caterpie', 'oddish'];
  const atlases = {};
  await Promise.all(slugs.map(async (slug) => {
    atlases[slug] = await loadJson(`assets/atlas/${slug}.json`);
  }));

  hud.progress(0.3, '加载纹理…');
  const [atlasTexes, floorTex, wallTex, wallTopTex, flameTex, shadowTex, orbBolt, orbAcid, doorTex] = await Promise.all([
    Promise.all(slugs.map((s) => loadTexture(`assets/atlas/${s}.png`, { pixel: true }))),
    loadTexture('assets/tiles/cave-floor.png', { pixel: true, mip: true }),
    loadTexture('assets/tiles/cave-wall.png', { pixel: true, mip: true }),
    loadTexture('assets/tiles/cave-wall-top.png', { pixel: true, mip: true }),
    loadTexture('assets/tiles/flame.png', { pixel: true }),
    loadTexture('assets/tiles/shadow.png', { pixel: true }),
    loadTexture('assets/tiles/orb-bolt.png', { pixel: true }),
    loadTexture('assets/tiles/orb-acid.png', { pixel: true }),
    loadTexture('assets/tiles/door.png', { pixel: true }),
  ]);
  const texBySlug = {};
  slugs.forEach((s, i) => { texBySlug[s] = atlasTexes[i]; });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTopTex.wrapS = wallTopTex.wrapT = THREE.RepeatWrapping;
  flameTex.wrapS = THREE.RepeatWrapping;
  flameTex.repeat.set(1 / 4, 1);

  hud.progress(0.5, '装配场景…');
  const canvas = document.getElementById('game');
  const renderer = createRenderer(THREE, canvas, tier);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e18);
  scene.fog = new THREE.Fog(0x0b0e18, 26, 60);
  const lights = createLights(THREE, scene, tier, ROOM_W, ROOM_H);
  const camCtl = createCamera(THREE);
  resize(THREE, renderer, camCtl.camera);
  const room = buildRoom(THREE, scene, {
    floor: floorTex, wall: wallTex, wallTop: wallTopTex, flame: flameTex, door: doorTex,
  }, lights, tier);

  const player = createBillboard(THREE, texBySlug.pikachu, atlases.pikachu, shadowTex);
  scene.add(player.group);

  const fx = createEffects(THREE, scene, { bolt: orbBolt, acid: orbAcid });

  hud.progress(0.65, '后处理链…');
  let postfx = await createPostfx(THREE, renderer, scene, camCtl.camera, tier);
  let postfxFallback = false;
  if (postfx) {
    postfx.setFocusTarget(player.mesh);
    postfx.setSize(window.innerWidth, window.innerHeight);
    camCtl.update(0.5, ROOM_W / 2, ROOM_H / 2, 0, 0);
    if (!composerWorks(renderer, postfx.composer, canvas)) {
      postfx = null;
      postfxFallback = true;
      renderer.setRenderTarget(null);
    }
  }

  hud.progress(0.8, '光照自检…');
  const lightOk = await lightingSelfTest(THREE, renderer);

  hud.progress(0.9, '叫声（可降级）…');
  const cries = createCries();
  cries.load(25, 'assets/cries/25.ogg');
  const input = createInput();
  input.onFirstInteraction(() => cries.ensureCtx());

  // ---- 局与实体池 ----
  let run = createRun(data);
  const enemyViews = new Map();          // sim id -> billboard
  let hitStopT = 0;
  const feel = balance.feel;

  window.__depths = { run, player, renderer, scene, camera: camCtl.camera, cries, tier, postfx, input, lightOk,
    restart: () => { run = createRun(data); }, pump: null };

  hud.progress(1, '出发！');
  hud.ready();

  // 鼠标瞄准：NDC 射线交 y=0 地面
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  const v3 = new THREE.Vector3();

  function aimVector() {
    raycaster.setFromCamera(input.mouse, camCtl.camera);
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
      const dx = hitPoint.x - run.player.x;
      const dz = hitPoint.z - run.player.y;
      if (Math.hypot(dx, dz) > 0.05) return { x: dx, y: dz };
    }
    return { x: run.player.lastDir.x, y: run.player.lastDir.y };
  }

  // 事件 → 表现（音效/粒子/震屏/飘字/闪白）
  function consumeEvents() {
    for (const ev of run.events) {
      switch (ev.t) {
        case 'spawn': {
          const spec = data.enemies[ev.eid];
          const bb = createBillboard(THREE, texBySlug[spec.anim], atlases[spec.anim], shadowTex);
          bb.place(ev.x, ev.y);
          bb.setSpawnK(0.2);
          scene.add(bb.group);
          enemyViews.set(ev.id, bb);
          fx.burst(ev.x, ev.y, 6, 0x9fb8d8);
          break;
        }
        case 'enemy-hurt':
        case 'enemy-die': {
          const bb = enemyViews.get(ev.id);
          if (bb) bb.flash(0.12);
          const color = ev.kind === 'super' ? 0xffd24a : ev.kind === 'weak' ? 0x9aa7bd : 0xffe9a0;
          fx.burst(ev.x, ev.y, ev.t === 'enemy-die' ? 14 : 6, color);
          if (ev.t === 'enemy-die') {
            hitStopT = Math.max(hitStopT, feel.hitStopKill);
            camCtl.shake(feel.shakeKill, 0.18);
            damageNum(ev.x, ev.y, ev.kind === 'super' ? '克制!' : '', 'super');
            bb && fadeOut(bb);
          } else {
            damageNum(ev.x, ev.y, ev.dmg >= 10 ? Math.round(ev.dmg) : ev.dmg.toFixed(1), ev.kind);
          }
          break;
        }
        case 'enemy-shoot': fx.burst(ev.x, ev.y, 3, 0xa0e070); break;
        case 'player-hurt':
          hitStopT = Math.max(hitStopT, feel.hitStopHurt);
          camCtl.shake(feel.shakeHurt, 0.3);
          player.flash(0.1);
          break;
        case 'player-die':
          camCtl.shake(0.5, 0.5);
          cries.play(25, { volume: 0.7, rateJitter: false });
          hud.showDeath(run.stats, run.seed);
          break;
        case 'clear':
          room.setDoorOpen(true);
          break;
        case 'room-next':
          room.setDoorOpen(false);
          break;
        default: break;
      }
    }
  }

  // 死亡淡出（简化：缩小+移除）
  const fading = [];
  function fadeOut(bb) {
    fading.push({ bb, t: 0.22 });
  }
  function stepFading(dt) {
    for (let i = fading.length - 1; i >= 0; i--) {
      const f = fading[i];
      f.t -= dt;
      f.bb.setSpawnK(Math.max(f.t / 0.22, 0.05));
      if (f.t <= 0) {
        scene.remove(f.bb.group);
        f.bb.dispose();
        fading.splice(i, 1);
      }
    }
  }

  function damageNum(worldX, worldY, txt, kind) {
    if (!txt && txt !== 0) return;
    v3.set(worldX, 1.2, worldY).project(camCtl.camera);
    const sx = (v3.x + 1) / 2 * window.innerWidth;
    const sy = (1 - (v3.y + 1) / 2) * window.innerHeight;
    hud.damageNum(sx, sy, txt, kind);
  }

  // ---- 主循环 ----
  let last = performance.now(), acc = 0, steps = 0;
  const clock = { t: 0 };
  let roomOpen = false;

  function frame(now, forcedDt) {
    requestAnimationFrame(frame);
    if (!Number.isFinite(camCtl.camera.aspect)) resize(THREE, renderer, camCtl.camera);
    let dt = forcedDt ?? (now - last) / 1000;
    if (dt < 0) dt = 0;
    if (dt > 0.25) dt = 0.25;
    last = now;

    // hit-stop：命中停顿（时间缩放）
    if (hitStopT > 0) { hitStopT -= dt; dt *= 0.08; }

    // 调试键
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
      if (input.consumePress('KeyN')) run.room.waveIdx = data.waves.length;  // 直接开下一波
    }
    if (input.consumePress('KeyR') && !run.player.alive) {
      run = createRun(data);
      window.__depths.run = run;
      hud.hideDeath();
    }

    // 输入包
    const gameInput = {
      move: input.getMove(),
      aim: aimVector(),
      fire: input.fire && run.player.alive,
      dashEdge: input.consumePress('Space'),
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

    // 玩家渲染（插值 + 无敌帧闪烁）
    const rx = p.px + (p.x - p.px) * alpha;
    const ry = p.py + (p.y - p.py) * alpha;
    player.setPose(p.anim, p.dir);
    player.update(dt);
    player.place(rx, ry);
    player.mesh.visible = p.alive && (p.iframes <= 0 || Math.floor(run.t * 18) % 2 === 0);
    player.shadow.visible = p.alive;

    // 敌人渲染
    for (const e of run.enemies) {
      const bb = enemyViews.get(e.id);
      if (!bb) continue;
      if (e.state === 'spawning') bb.setSpawnK(Math.max(0.2, 1 - e.spawnT / 0.55 * 0.8));
      else bb.setSpawnK(1);
      bb.setPose(e.flash > 0 ? 'Hurt' : e.anim, e.dir);
      bb.update(dt);
      bb.place(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha);
      bb.mesh.visible = true;
    }
    // 清掉已不在 sim 里的视图（保险）
    const live = new Set(run.enemies.map((e) => e.id));
    for (const [id, bb] of enemyViews) {
      if (!live.has(id)) { scene.remove(bb.group); bb.dispose(); enemyViews.delete(id); }
    }

    fx.syncProjectiles(run.projectiles, alpha);
    fx.update(dt);
    room.update(dt, clock.t);
    clock.t += dt;

    // 门状态
    const open = run.room.state === 'cleared';
    if (open !== roomOpen) { roomOpen = open; room.setDoorOpen(open); }

    const moving = p.moving ? 1 : 0;
    camCtl.update(dt, rx, ry, (p.x - p.px) / STEP * moving * 0.2, (p.y - p.py) / STEP * moving * 0.2);

    if (postfx) postfx.composer.render(dt);
    else renderer.render(scene, camCtl.camera);

    hud.game(p.hp, p.maxHp, p.pp, p.dashCharges, data.balance.player.dashCharges,
      run.room.n, run.room.waveIdx + 1, data.waves.length, run.room.state === 'cleared');
    const info = renderer.info.render;
    hud.frame(dt, {
      tier: `${TIERS[tier].label}(${tier})`,
      dpr: renderer.getPixelRatio().toFixed(2),
      calls: info.calls, tris: info.triangles,
      enemies: run.enemies.length, projs: run.projectiles.length, steps,
      x: p.x, y: p.y, hp: p.hp, pp: p.pp,
      cry: cries.statusOf(25),
      postfx: postfx ? '开' : (postfxFallback ? '关（composer黑图已回退直渲染）' : '关（低档）'),
      light: lightOk ? '正常' : '异常（该环境光照管线失效，请用 Chrome/Safari 打开）',
    });
  }
  requestAnimationFrame(frame);
  window.addEventListener('resize', () => {
    resize(THREE, renderer, camCtl.camera);
    if (postfx) postfx.setSize(...viewportSize());
  });
  window.__depths.pump = (n = 1, dtMs = 1000 / 60) => {
    let t = performance.now();
    for (let i = 0; i < n; i++) {
      t += dtMs;
      frame(t, dtMs / 1000);
      input.endFrame();
    }
  };
}

boot().catch((e) => {
  hud.progress(1, '启动失败');
  const errBox = document.getElementById('load-err');
  errBox.textContent = String(e && e.stack || e);
  errBox.style.display = 'block';
});
