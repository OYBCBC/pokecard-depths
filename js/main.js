// 启动入口：素材装载 → 场景装配 → 固定步长主循环（模拟 60Hz + 渲染插值）
import * as THREE from 'three';
import { detectTier, createRenderer, resize, viewportSize, TIERS } from './gfx/renderer.js?v=m1j';
import { createLights } from './gfx/lights.js?v=m1j';
import { createCamera } from './gfx/camera.js?v=m1j';
import { buildRoom } from './gfx/scene.js?v=m1j';
import { createBillboard } from './gfx/sprites.js?v=m1j';
import { createPostfx } from './gfx/postfx.js?v=m1j';
import { createHud } from './ui/hud.js?v=m1j';
import { createCries } from './audio/cries.js?v=m1j';
import { createInput } from './core/input.js?v=m1j';
import { createRun, stepRun, STEP, DIRS, ROOM_W, ROOM_H } from './sim/engine.js?v=m1j';

const hud = createHud();
const tier = detectTier();

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

// 光照自检：极少数嵌入式 webview 的 WebGL 光照管线会整体失效（漫反射零输出、
// 纯自发光正常）。开机时渲染一个带环境光的红盒子到离屏目标，数红色像素。
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

// composer 输出探测：个别 webview 的 WebGL 能直渲染，但 postprocessing 链（半浮点
// 中间缓冲等）输出全黑。开机走一帧 composer 并用 2D canvas 采样画布，黑则回退直渲染。
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
  hud.progress(0.05, '读取图集索引…');
  const atlasData = await (await fetch('assets/atlas/pikachu.json')).json();

  hud.progress(0.2, '加载纹理…');
  const [atlasTex, floorTex, wallTex, wallTopTex, flameTex, shadowTex] = await Promise.all([
    loadTexture('assets/atlas/pikachu.png', { pixel: true }),
    loadTexture('assets/tiles/cave-floor.png', { pixel: true, mip: true }),
    loadTexture('assets/tiles/cave-wall.png', { pixel: true, mip: true }),
    loadTexture('assets/tiles/cave-wall-top.png', { pixel: true, mip: true }),
    loadTexture('assets/tiles/flame.png', { pixel: true }),
    loadTexture('assets/tiles/shadow.png', { pixel: true }),
  ]);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTopTex.wrapS = wallTopTex.wrapT = THREE.RepeatWrapping;
  flameTex.wrapS = THREE.RepeatWrapping;
  flameTex.repeat.set(1 / 4, 1);   // 火焰 4 帧横排

  hud.progress(0.45, '装配场景…');
  const canvas = document.getElementById('game');
  const renderer = createRenderer(THREE, canvas, tier);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e18);
  scene.fog = new THREE.Fog(0x0b0e18, 26, 60);   // 远端轻雾；near 必须大于相机到房内最远点（≈24），否则全场灰雾
  const lights = createLights(THREE, scene, tier, 17, 11);
  const camCtl = createCamera(THREE);
  resize(THREE, renderer, camCtl.camera);
  const room = buildRoom(THREE, scene, {
    floor: floorTex, wall: wallTex, wallTop: wallTopTex, flame: flameTex,
  }, lights, tier);

  const player = createBillboard(THREE, atlasTex, atlasData, shadowTex);
  scene.add(player.group);

  hud.progress(0.7, '后处理链…');
  let postfx = await createPostfx(THREE, renderer, scene, camCtl.camera, tier);
  let postfxFallback = false;
  if (postfx) {
    postfx.setFocusTarget(player.mesh);
    postfx.setSize(window.innerWidth, window.innerHeight);
    // 相机先收敛一拍再探测（首帧相机还在初始位）
    camCtl.update(0.5, ROOM_W / 2, ROOM_H / 2, 0, 0);
    if (!composerWorks(renderer, postfx.composer, canvas)) {
      postfx = null;               // 该环境 composer 输出黑 → 回退直渲染
      postfxFallback = true;
      renderer.setRenderTarget(null);
    }
  }

  hud.progress(0.85, '光照自检…');
  const lightOk = await lightingSelfTest(THREE, renderer);

  hud.progress(0.92, '叫声（可降级）…');
  const cries = createCries();
  cries.load(25, 'assets/cries/25.ogg');
  const input = createInput();
  input.onFirstInteraction(() => cries.ensureCtx());

  const run = createRun();
  // ?debug 控制台钩子；pump() 手动驱动 n 帧（内嵌 webview 可能不跑 rAF，自动化测试用）
  window.__depths = { run, player, renderer, scene, camera: camCtl.camera, cries, tier, postfx, input, lightOk, pump: null };

  hud.progress(1, '出发！');
  hud.ready();

  // ---- 主循环：累加器固定步长，最多补 4 步；渲染插值 α ----
  let last = performance.now(), acc = 0, steps = 0;
  const clock = { t: 0 };

  function frame(now, forcedDt) {
    requestAnimationFrame(frame);
    // 相机 aspect 兜底：若启动时视口尺寸异常（NaN），首帧修正
    if (!Number.isFinite(camCtl.camera.aspect)) resize(THREE, renderer, camCtl.camera);
    let dt = forcedDt ?? (now - last) / 1000;
    if (dt < 0) dt = 0;
    if (dt > 0.25) dt = 0.25;
    last = now;
    acc += dt;
    steps = 0;
    while (acc >= STEP && steps < 4) {
      stepRun(run, input.getMove());
      acc -= STEP;
      steps++;
    }
    if (steps === 4) acc = 0;
    input.endFrame();

    if (input.consumePress('KeyC')) cries.play(25);
    const digit = ['Digit1', 'Digit2', 'Digit3'].find(c => input.consumePress(c));
    if (digit) {
      const map = { Digit1: 'high', Digit2: 'med', Digit3: 'low' };
      const u = new URL(location.href);
      u.searchParams.set('q', map[digit]);
      location.replace(u);
    }

    const p = run.player;
    const alpha = acc / STEP;
    const rx = p.px + (p.x - p.px) * alpha;
    const ry = p.py + (p.y - p.py) * alpha;
    player.setPose(p.anim, p.dir);
    player.update(dt);
    player.place(rx, ry);

    room.update(dt, clock.t);
    clock.t += dt;
    const moving = p.moving ? 1 : 0;
    camCtl.update(dt, rx, ry, (p.x - p.px) / STEP * moving * 0.2, (p.y - p.py) / STEP * moving * 0.2);

    if (postfx) postfx.composer.render(dt);
    else renderer.render(scene, camCtl.camera);

    const info = renderer.info.render;
    hud.frame(dt, {
      tier: `${TIERS[tier].label}(${tier})`,
      dpr: renderer.getPixelRatio().toFixed(2),
      calls: info.calls, tris: info.triangles,
      entities: 1, steps,
      anim: p.anim, frame: player.state.frame, dirName: DIRS[p.dir],
      x: p.x, y: p.y,
      cry: cries.statusOf(25),
      postfx: postfx ? '开' : (postfxFallback ? '关（该环境输出黑，已回退直渲染）' : '关（低档）'),
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
    for (let i = 0; i < n; i++) { t += dtMs; frame(t, dtMs / 1000); }
  };
}

boot().catch((e) => {
  hud.progress(1, '启动失败');
  const errBox = document.getElementById('load-err');
  errBox.textContent = String(e && e.stack || e);
  errBox.style.display = 'block';
});
