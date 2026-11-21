// 战斗特效 M8：属性化弹体 + 尾迹 + 命中特效。全部对象池，无运行时分配。
//   弹体：按样式（属性默认 / 特型招式覆盖）换材质——专属像素贴图 + 自旋/脉动/抖动
//   尾迹：弹体飞行沿途按属性撒粒子（火星/水滴/电火花/幽火……）
//   命中：hitFx 按属性组合粒子组 + 电弧 + 地面冲击环 + 专属点光
import { TRAILS, HIT_FX, TYPE_COLORS, styleOf, styleDef } from './vfxdefs.js?v=m12a';
import { makeProjTex } from './projtex.js?v=m12a';

export function createEffects(THREE, scene, ringTex, opts = {}) {
  let clock = 0;

  // ---- 弹体池：每 slot 一个 mesh，按样式换共享材质 ----
  const POOL = 48;
  const canvases = makeProjTex();
  const texOf = {};
  for (const [name, cv] of Object.entries(canvases)) {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    texOf[name] = t;
  }
  const matCache = {};
  function matFor(styleKey, moveType) {
    const def = styleDef(styleKey, moveType);
    const key = def.tex + (def.glow ? '+a' : '');
    if (!matCache[key]) {
      matCache[key] = new THREE.MeshBasicMaterial({
        map: texOf[def.tex] || texOf.normal, transparent: true, depthWrite: false,
        side: THREE.DoubleSide,
        blending: def.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
    }
    return matCache[key];
  }
  const projGeo = new THREE.PlaneGeometry(0.3, 0.3);
  // 弹体面片朝相机倾转（俯角 55°——与精灵 billboard 同工艺）：竖直平面在俯视下被压扁成"贴地贴纸"，
  // 绕 X 后仰 35° 让法线正对镜头，弹体才有立体浮空感。XYZ 欧拉序下 z 自旋仍在面内。
  const PROJ_TILT = -35 * Math.PI / 180;
  // 假阴影软斑（径向渐变 canvas）：脚下有影 → 弹体被读成"浮空"而不是贴地火堆
  const blobCv = document.createElement('canvas');
  blobCv.width = blobCv.height = 32;
  {
    const g = blobCv.getContext('2d').createRadialGradient(16, 16, 2, 16, 16, 15);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    const bc = blobCv.getContext('2d');
    bc.fillStyle = g;
    bc.fillRect(0, 0, 32, 32);
  }
  const blobTex = new THREE.CanvasTexture(blobCv);
  const shadowMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
  const projPool = [];
  for (let i = 0; i < POOL; i++) {
    const m = new THREE.Mesh(projGeo, matFor('normal', 'normal'));
    m.visible = false;
    m.position.y = 0.66;
    m.rotation.x = PROJ_TILT;
    scene.add(m);
    const sh = new THREE.Mesh(projGeo, shadowMat);
    sh.visible = false;
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.07;
    sh.scale.setScalar(0.55);
    scene.add(sh);
    projPool.push({ mesh: m, shadow: sh, mat: null, rot: 0, trailAcc: 0 });
  }

  function syncProjectiles(projectiles, alpha, dt, data) {
    const moves = data ? data.moves : null;
    let used = 0;
    for (const b of projectiles) {
      if (used >= POOL) break;
      const slot = projPool[used++];
      const mv = (moves && moves[b.moveId]) || null;
      const type = mv ? mv.type : 'normal';
      const styleKey = styleOf(b.moveId, type);
      const def = styleDef(styleKey, type);
      const mat = matFor(styleKey, type);
      if (slot.mat !== mat) { slot.mesh.material = mat; slot.mat = mat; }
      slot.mesh.visible = true;
      slot.shadow.visible = true;
      let x = b.px + (b.x - b.px) * alpha;
      let z = b.py + (b.y - b.py) * alpha;
      if (def.jitter) { x += (Math.random() - 0.5) * def.jitter * 2; z += (Math.random() - 0.5) * def.jitter * 2; }
      slot.mesh.position.x = x;
      slot.mesh.position.z = z;
      slot.shadow.position.x = x;
      slot.shadow.position.z = z;
      let s = Math.max(0.7, (b.radius * 2) / 0.3) * 1.9;     // 贴图含边距 → 放大补足视觉弹径
      if (def.pulse) s *= 1 + def.pulse[0] * Math.sin(clock * def.pulse[1] + used);
      slot.rot += (def.spin || 0) * (dt || 0);
      slot.mesh.rotation.set(PROJ_TILT, 0, slot.rot);
      slot.mesh.scale.setScalar(s);
      slot.shadow.scale.setScalar(Math.max(0.35, s * 0.3));
      // 尾迹：按属性行为撒粒子（弹多时降频护池）
      if (dt > 0 && def.trail && TRAILS[def.trail]) {
        const tr = TRAILS[def.trail];
        const k = projectiles.length > 14 ? 0.45 : 1;
        slot.trailAcc += tr.rate * dt * k;
        while (slot.trailAcc >= 1) {
          slot.trailAcc -= 1;
          spawnParticle(x + (Math.random() - 0.5) * 0.18, 0.66, z + (Math.random() - 0.5) * 0.18, {
            color: tr.colors[(Math.random() * tr.colors.length) | 0],
            vx: (Math.random() - 0.5) * tr.spd, vz: (Math.random() - 0.5) * tr.spd,
            vy: (tr.up || 0) + (Math.random() - 0.5) * 0.6,
            grav: tr.grav || 0, life: tr.life * (0.7 + Math.random() * 0.6),
            flicker: tr.flicker, shrink: tr.shrink, scale: 1.0 + Math.random() * 1.1,
          });
        }
      } else if (dt > 0) slot.trailAcc = 0;
    }
    for (let i = used; i < POOL; i++) { projPool[i].mesh.visible = false; projPool[i].shadow.visible = false; }
  }

  // ---- 粒子池（尾迹 + 命中碎屑通用）----
  const PN = 224;
  const pGeo = new THREE.PlaneGeometry(0.09, 0.09);
  const particles = [];
  for (let i = 0; i < PN; i++) {
    const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({
      color: 0xffe9a0, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.visible = false;
    scene.add(m);
    particles.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, grav: 6, flicker: false, shrink: false, scale: 1 });
  }
  let pCur = 0;
  function spawnParticle(x, y, z, o) {
    const p = particles[pCur];
    pCur = (pCur + 1) % PN;
    p.mesh.visible = true;
    p.mesh.position.set(x, y, z);
    p.mesh.material.color.set(o.color);
    p.mesh.material.opacity = 1;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.grav = o.grav != null ? o.grav : 6;
    p.life = p.maxLife = o.life || 0.4;
    p.flicker = !!o.flicker; p.shrink = !!o.shrink;
    p.scale = o.scale || 1;
    p.mesh.scale.setScalar(p.scale);
  }

  /** 兼容旧接口：径向爆一圈碎屑（颜色可传单色或忽略） */
  function burst(x, z, n = 8, color = 0xffe9a0, o = {}) {
    const c = typeof color === 'number' ? '#' + color.toString(16).padStart(6, '0') : color;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = (o.spd || 2.5) * (0.6 + Math.random() * 0.8);
      spawnParticle(x, o.y || 0.6, z, {
        color: c, vx: Math.cos(a) * s, vz: Math.sin(a) * s,
        vy: (o.up != null ? o.up : 2) + Math.random() * 1.5,
        grav: o.grav != null ? o.grav : 6, life: (o.life || 0.4) * (0.8 + Math.random() * 0.5),
        scale: 0.8 + Math.random() * 0.8, shrink: true,
      });
    }
  }

  // ---- 命中点光池（专用，不抢 scene 火把的灯）----
  const flashLights = [];
  if (opts.flashLights !== false) {
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 5, 2);
      l.visible = false;
      scene.add(l);
      flashLights.push({ light: l, t: 0, max: 1, peak: 0 });
    }
  }
  let flCur = 0;
  function flashLight(colorHex, intensity, x, z, dur = 0.22) {
    if (!flashLights.length) return;
    const f = flashLights[flCur];
    flCur = (flCur + 1) % flashLights.length;
    f.light.color.set(colorHex);
    f.light.position.set(x, 0.9, z);
    f.light.visible = true;
    f.t = f.max = dur; f.peak = intensity;
    f.light.intensity = intensity;
  }

  // ---- 地面冲击环（命中环 / Z 招式）----
  const rings = [];
  if (ringTex) {
    const rGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(rGeo, new THREE.MeshBasicMaterial({
        map: ringTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0xffffff,
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      rings.push({ mesh: m, t: 0, max: 1, maxR: 2 });
    }
  }
  let ringCur = 0;
  function ring(colorHex, maxR, dur, x, z) {
    if (!rings.length) return;
    const r = rings[ringCur];
    ringCur = (ringCur + 1) % rings.length;
    r.mesh.material.color.set(colorHex);
    r.mesh.position.set(x, 0.09, z);
    r.mesh.visible = true;
    r.t = 0; r.max = dur; r.maxR = maxR;
  }

  // ---- 连锁闪电（颜色可变）----
  const bolts = [];
  const boltGeo = new THREE.PlaneGeometry(1, 0.07);
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({
      color: 0xbfe4ff, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.visible = false;
    scene.add(m);
    bolts.push({ mesh: m, life: 0 });
  }
  let boltCur = 0;
  function bolt(x0, z0, x1, z1, colorHex = 0xbfe4ff, dur = 0.18) {
    const b = bolts[boltCur];
    boltCur = (boltCur + 1) % bolts.length;
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    b.mesh.visible = true;
    b.mesh.material.color.set(colorHex);
    b.mesh.scale.set(Math.max(len, 0.05), 1, 1);
    b.mesh.position.set((x0 + x1) / 2, 0.55, (z0 + z1) / 2);
    b.mesh.rotation.set(-Math.PI / 2, 0, -Math.atan2(dz, dx));
    b.mesh.material.opacity = 1;
    b.life = dur;
  }

  /** 枪口闪光：沿弹道小喷 + 强光属性点闪 */
  function muzzle(x, z, styleKey, moveType) {
    const def = styleDef(styleKey, moveType);
    const pal = TYPE_COLORS[moveType] || TYPE_COLORS.normal;
    const hx = pal[0];
    for (let k = 0; k < 4; k++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 1.5;
      spawnParticle(x + (Math.random() - 0.5) * 0.2, 0.55, z + (Math.random() - 0.5) * 0.2, {
        color: pal[(Math.random() * pal.length) | 0],
        vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 0.5,
        grav: 1, life: 0.18 + Math.random() * 0.1, scale: 0.5 + Math.random() * 0.5, shrink: true, flicker: def.glow,
      });
    }
    if (def.glow) flashLight(hx, 10, x, z, 0.12);
  }

  /** 命中特效：属性组合。kind: super/weak/immune/normal（克制微调粒子量与附加色）
   *  burst 兜底样式的粒子颜色按属性配色覆盖——每系命中都有属性识别度 */
  function hitFx(x, z, styleKey, moveType, kind = 'normal') {
    const def = styleDef(styleKey, moveType);
    const h = HIT_FX[def.hit] || HIT_FX.burst;
    const palOverride = (!HIT_FX[def.hit] || def.hit === 'burst') && TYPE_COLORS[moveType];
    const kN = kind === 'super' ? 1.4 : kind === 'weak' ? 0.6 : 1;
    for (const part of h.parts) {
      const colors = palOverride || part.colors || ['#ffe9a0', '#fff8dc'];   // 兜底：无属性信息时用暖白
      const n = Math.max(2, Math.round(part.n * kN));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = part.spd * (0.5 + Math.random() * 0.9);
        spawnParticle(x, 0.62, z, {
          color: colors[(Math.random() * colors.length) | 0],
          vx: Math.cos(a) * s, vz: Math.sin(a) * s,
          vy: part.up * (0.6 + Math.random() * 0.8),
          grav: part.grav, life: part.life * (0.75 + Math.random() * 0.5),
          scale: 0.8 + Math.random() * 0.9, flicker: part.flicker, shrink: true,
        });
      }
    }
    if (kind === 'super') burst(x, z, 5, '#ffd24a', { spd: 3.6, up: 3, grav: 4, life: 0.5 });
    if (kind === 'weak') burst(x, z, 3, '#9aa7bd', { spd: 2, up: 1.4, grav: 5, life: 0.35 });
    if (kind === 'immune') { ring(0x9aa7bd, 1.4, 0.35, x, z); return; }
    if (h.bolt) {
      for (let i = 0; i < h.bolt; i++) {
        const a = Math.random() * Math.PI * 2, d = 0.5 + Math.random() * 0.7;
        bolt(x, z, x + Math.cos(a) * d, z + Math.sin(a) * d, 0xfff36b, 0.14);
      }
    }
    if (h.ring) ring(h.ring[0], h.ring[1], h.ring[2], x, z);
    if (h.flash) flashLight(h.flash[0], h.flash[1], x, z, h.flash[2] ? 0.18 : 0.22);
  }

  /** Z 招式：属性色大爆发 + 大冲击环 + 强闪 */
  function zmoveFx(x, z, moveType, radius = 4) {
    const pal = TYPE_COLORS[moveType] || TYPE_COLORS.normal;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6;
      spawnParticle(x, 0.7, z, {
        color: pal[(Math.random() * pal.length) | 0],
        vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 1.5 + Math.random() * 4.5,
        grav: 5, life: 0.5 + Math.random() * 0.45, scale: 1 + Math.random() * 1.4, shrink: true, flicker: true,
      });
    }
    ring(pal[0], Math.max(radius * 0.9, 2.5), 0.5, x, z);
    flashLight(pal[0], 60, x, z, 0.35);
  }

  // ---- 近战横扫弧（M9 sweep）：月牙扇环面片（单位半径，按扇角缓存几何），池化 4 个 ----
  // 顶点色做软边：内缘与两端压黑（加色混合下黑=透明），外缘最亮——读起来像一道挥击残影
  const sweepGeos = new Map();
  function sweepGeo(arcDeg) {
    const k = Math.round(arcDeg);
    let g = sweepGeos.get(k);
    if (g) return g;
    const th = (k * Math.PI) / 180, R0 = 0.5;
    g = new THREE.RingGeometry(R0, 1, Math.max(8, Math.round(k / 5)), 2, -th / 2, th);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i);
      const radial = Math.pow((Math.hypot(px, py) - R0) / (1 - R0), 1.6);
      const ends = Math.min(1, (1 - Math.abs(Math.atan2(py, px)) / (th / 2)) * 3);
      const v = radial * ends;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    sweepGeos.set(k, g);
    return g;
  }
  const sweeps = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(sweepGeo(120), new THREE.MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
    m.visible = false;
    scene.add(m);
    sweeps.push({ mesh: m, t: 0, max: 1, r: 1 });
  }
  let sweepCur = 0;
  /** 近战横扫：以 (x,z) 为圆心、angle 方向（世界 xz 平面弧度）、arcDeg 扇角、r 半径的挥击弧 + 沿弧碎屑 */
  function sweepFx(x, z, angle, arcDeg, r, moveType, styleKey) {
    const def = styleDef(styleKey, moveType);
    const pal = TYPE_COLORS[moveType] || TYPE_COLORS.normal;
    const s = sweeps[sweepCur];
    sweepCur = (sweepCur + 1) % sweeps.length;
    s.mesh.geometry = sweepGeo(arcDeg);
    s.mesh.material.color.set(pal[0]);
    s.mesh.position.set(x, 0.42, z);
    s.mesh.rotation.set(-Math.PI / 2, 0, -angle);     // 与 bolt 同约定：局部 +X → 世界 angle 方向
    s.mesh.scale.setScalar(r * 0.8);
    s.mesh.material.opacity = 1;
    s.mesh.visible = true;
    s.t = 0; s.max = 0.2; s.r = r;
    const th = (arcDeg * Math.PI) / 180;
    const n = Math.max(6, Math.round(arcDeg / 12));
    for (let i = 0; i < n; i++) {
      const a = angle + (i / (n - 1) - 0.5) * th;
      const rr = r * (0.75 + Math.random() * 0.25), sp = 1.8 + Math.random() * 2.4;
      spawnParticle(x + Math.cos(a) * rr, 0.5, z + Math.sin(a) * rr, {
        color: pal[(Math.random() * pal.length) | 0],
        vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 0.8 + Math.random(),
        grav: 4, life: 0.22 + Math.random() * 0.12, scale: 0.6 + Math.random() * 0.6, shrink: true, flicker: def.glow,
      });
    }
    if (def.glow) flashLight(pal[0], 8, x + Math.cos(angle) * r * 0.6, z + Math.sin(angle) * r * 0.6, 0.14);
  }

  // ---- 玩家喷息光束（M9.2 硫磺火式）：激活期间常驻锥形光带（核心+柔光两层），
  //      每帧由 main 刷新位置/朝向；关闭后快速淡出。端点沿程撒属性色碎屑。 ----
  const beamGeo = new THREE.PlaneGeometry(1, 1);
  beamGeo.translate(0.5, 0, 0);                       // 原点移到光束起点（左端）
  const beamCoreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 });
  const beamSoftMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.3 });
  const beamGroup = new THREE.Group();
  const beamCore = new THREE.Mesh(beamGeo, beamCoreMat);
  const beamSoft = new THREE.Mesh(beamGeo, beamSoftMat);
  beamCore.rotation.x = beamSoft.rotation.x = -Math.PI / 2;   // 贴地放平（浮空 y 由 group 控制）
  beamGroup.add(beamCore, beamSoft);
  beamGroup.visible = false;
  scene.add(beamGroup);
  let beamFade = 0, beamAcc = 0;
  function beamSet(on, x, z, angle, len, halfDeg, color) {
    if (on) {
      beamFade = 1;                                    // 1=持续满亮；<1=淡出中
      beamGroup.visible = true;
      beamCoreMat.color.set(color); beamSoftMat.color.set(color);
      const w = 2 * Math.tan((halfDeg || 11) * Math.PI / 180) * len + 0.22;   // 端宽=锥宽+根宽
      beamCore.scale.set(len, w * 0.62, 1);
      beamSoft.scale.set(len * 1.03, w * 1.25, 1);
      beamGroup.position.set(x, 0.5, z);
      beamGroup.rotation.y = -angle;                  // 本地 +x 对准世界 (cos a, sin a)
      beamAcc += 1;                                    // 沿程碎屑（节流）
      if (beamAcc >= 4) {
        beamAcc = 0;
        burst(x + Math.cos(angle) * len * (0.3 + Math.random() * 0.6),
              z + Math.sin(angle) * len * (0.3 + Math.random() * 0.6),
              2, color, { spd: 1.1, up: 1.6, life: 0.3, y: 0.5 });
      }
    } else if (beamGroup.visible && beamFade >= 1) {
      beamFade = 0.999;                                // 松开：进入淡出
    }
  }

  // ---- 蓄力射线发射闪（破坏光线 M12.1）：光带全亮一帧后走 beamSet 淡出 + 沿线碎屑 + 端点闪光 ----
  function rayFlash(x, z, angle, len, width, color) {
    const halfDeg = Math.atan2(Math.max(0.1, (width || 1.1) / 2), Math.max(len, 0.1)) * 180 / Math.PI;
    beamSet(true, x, z, angle, len, halfDeg, color);
    for (let i = 1; i <= 4; i++) {
      const d = (i / 4) * len;
      burst(x + Math.cos(angle) * d, z + Math.sin(angle) * d, 4, color, { spd: 1.6, up: 1.2, life: 0.28, y: 0.5 });
    }
    flashLight(color, 14, x + Math.cos(angle) * len * 0.85, z + Math.sin(angle) * len * 0.85, 0.22);
  }

  function update(dt) {
    clock += dt;
    if (beamGroup.visible) {
      if (beamFade < 1) {
        beamFade -= dt * 9;
        if (beamFade <= 0) { beamFade = 0; beamGroup.visible = false; }
      }
      const flick = 0.9 + 0.1 * Math.sin(clock * 31);  // 满亮时轻微电流感颤动
      beamCoreMat.opacity = 0.85 * beamFade * flick;
      beamSoftMat.opacity = 0.3 * beamFade * flick;
    }
    for (const p of particles) {
      if (p.life <= 0) { if (p.mesh.visible) p.mesh.visible = false; continue; }
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vy -= p.grav * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y = Math.max(0.07, p.mesh.position.y + p.vy * dt);
      p.mesh.position.z += p.vz * dt;
      const k = p.life / p.maxLife;
      p.mesh.material.opacity = k * (p.flicker ? 0.4 + Math.random() * 0.6 : 1);
      if (p.shrink) p.mesh.scale.setScalar(p.scale * (0.3 + 0.7 * k));
    }
    for (const b of bolts) {
      if (b.life <= 0) { if (b.mesh.visible) b.mesh.visible = false; continue; }
      b.life -= dt;
      if (b.life <= 0) { b.mesh.visible = false; continue; }
      b.mesh.material.opacity = Math.max(0, b.life / 0.18);
    }
    for (const r of rings) {
      if (r.t >= r.max) { if (r.mesh.visible) r.mesh.visible = false; continue; }
      r.t += dt;
      const k = Math.min(r.t / r.max, 1);
      if (k >= 1) { r.mesh.visible = false; continue; }
      const rad = 0.3 + (r.maxR - 0.3) * Math.sqrt(k);
      r.mesh.scale.set(rad * 2, rad * 2, 1);
      r.mesh.material.opacity = (1 - k) * 0.85;
    }
    for (const s of sweeps) {                          // 横扫弧：0.2s 内略外扩并淡出
      if (s.t >= s.max) { if (s.mesh.visible) s.mesh.visible = false; continue; }
      s.t += dt;
      const k = Math.min(s.t / s.max, 1);
      if (k >= 1) { s.mesh.visible = false; continue; }
      s.mesh.scale.setScalar(s.r * (0.8 + 0.25 * Math.sqrt(k)));
      s.mesh.material.opacity = 1 - k * k;
    }
    for (const f of flashLights) {
      if (f.t <= 0) continue;
      f.t -= dt;
      const k = Math.max(f.t / f.max, 0);
      f.light.intensity = f.peak * k * k;
      if (f.t <= 0) f.light.visible = false;
    }
  }

  return { syncProjectiles, burst, bolt, muzzle, hitFx, zmoveFx, sweepFx, beamSet, rayFlash, update };
}
