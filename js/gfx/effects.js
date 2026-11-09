// 战斗特效 M8：属性化弹体 + 尾迹 + 命中特效。全部对象池，无运行时分配。
//   弹体：按样式（属性默认 / 特型招式覆盖）换材质——专属像素贴图 + 自旋/脉动/抖动
//   尾迹：弹体飞行沿途按属性撒粒子（火星/水滴/电火花/幽火……）
//   命中：hitFx 按属性组合粒子组 + 电弧 + 地面冲击环 + 专属点光
import { TRAILS, HIT_FX, TYPE_COLORS, styleOf, styleDef } from './vfxdefs.js?v=m8';
import { makeProjTex } from './projtex.js?v=m8';

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

  function update(dt) {
    clock += dt;
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
    for (const f of flashLights) {
      if (f.t <= 0) continue;
      f.t -= dt;
      const k = Math.max(f.t / f.max, 0);
      f.light.intensity = f.peak * k * k;
      if (f.t <= 0) f.light.visible = false;
    }
  }

  return { syncProjectiles, burst, bolt, muzzle, hitFx, zmoveFx, update };
}
