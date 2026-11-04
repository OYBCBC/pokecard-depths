// 精灵面片系统（《03》§5 工艺五件套）：
//   1) Plane 面片（THREE.Sprite 不进阴影 pass，禁用）
//   2) alphaTest=0.5 + DoubleSide（不透明管线，写深度）
//   3) castShadow + customDepthMaterial / customDistanceMaterial（人形投影）
//   4) 法线朝天倾斜 60°（被环境光打亮）
//   5) 脚下椭圆假阴影 + 真实投影并存
// M2 增补：受击闪白（emissive 脉冲）、出生缩放、单例 dispose。
import { DIRS } from '../sim/engine.js?v=m4c';

const TEXEL = 16;                     // 16 texel = 1 世界单位
const NORMAL_TILT = 0.866;            // 法线 y 分量（60° 朝天倾斜）

export function createBillboard(THREE, atlasTex, atlasData, shadowTex, opts = {}) {
  const anims = atlasData.anims;
  const [atlasW, atlasH] = atlasData.atlas;

  const geometry = new THREE.PlaneGeometry(1, 1);
  {
    const n = geometry.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, NORMAL_TILT, Math.sqrt(1 - NORMAL_TILT * NORMAL_TILT));
    n.needsUpdate = true;
  }

  const material = new THREE.MeshStandardMaterial({
    map: atlasTex,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0,
    emissive: 0xffffff,
    emissiveIntensity: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = opts.castShadow !== false;

  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: atlasTex,
    alphaTest: 0.5,
  });
  mesh.customDistanceMaterial = new THREE.MeshDistanceMaterial({
    map: atlasTex,
    alphaTest: 0.5,
  });

  // 假阴影（贴地读位用）
  const shadowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.85, depthWrite: false })
  );
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = 0.06;          // 抬离地板（y=0.02）避免 z-fighting
  const shadowScale = [0.7, 1.0, 1.35][atlasData.shadowSize] ?? 1;
  shadowMesh.scale.set(shadowScale, shadowScale * 0.55, 1);

  const group = new THREE.Group();
  group.add(mesh);
  group.add(shadowMesh);

  const state = { anim: 'Idle', dir: 0, frame: 0, ticks: 0, flash: 0, spawnK: 1 };
  const uv = geometry.attributes.uv;

  function applyFrame() {
    const a = anims[state.anim] || anims.Idle;
    const row = a.rows === 8 ? state.dir : 0;
    const f = a.frames[row][state.frame];
    const u0 = f.x / atlasW, u1 = (f.x + a.frameW) / atlasW;
    const v0 = 1 - (f.y + a.frameH) / atlasH, v1 = 1 - f.y / atlasH;
    uv.setXY(0, u0, v1); uv.setXY(1, u1, v1);
    uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
    uv.needsUpdate = true;

    const k = state.spawnK;
    const w = a.frameW / TEXEL * k, h = a.frameH / TEXEL * k;
    mesh.scale.set(w, h, 1);
    shadowMesh.scale.set(shadowScale * k, shadowScale * 0.55 * k, 1);
    // 贴地：grounded 动作按每帧脚底像素行 gy 落地；腾空动作（Hurt 等）沿用锚点公式
    const cy = (a.grounded && f.gy != null)
      ? (f.gy - a.frameH / 2) / TEXEL * k
      : (a.frameH / 2 + f.oy) / TEXEL * k;
    mesh.position.set(-f.ox / TEXEL * k, cy, 0);
  }

  applyFrame();

  return {
    group, mesh, shadow: shadowMesh, material,
    get state() { return { ...state }; },
    setPose(anim, dir) {
      const animChanged = state.anim !== anim;
      const dirChanged = state.dir !== dir;
      if (!animChanged && !dirChanged) return;
      const a = anims[anim];
      if (!a) return;
      const keepFrame = !animChanged && a.rows === 8;
      state.anim = anim;
      state.dir = dir;
      if (!keepFrame) { state.frame = 0; state.ticks = 0; }
      applyFrame();
    },
    update(dt) {
      const a = anims[state.anim] || anims.Idle;
      const row = a.rows === 8 ? state.dir : 0;
      state.ticks += dt * 60;
      const f = a.frames[row];
      let guard = 0;
      while (state.ticks >= f[state.frame].dur && guard++ < 32) {
        state.ticks -= f[state.frame].dur;
        state.frame = (state.frame + 1) % f.length;
      }
      if (state.flash > 0) state.flash = Math.max(0, state.flash - dt);
      material.emissiveIntensity = (state.flash / 0.12) * 1.6;
      applyFrame();
    },
    flash(t = 0.12) { state.flash = Math.max(state.flash, t); },
    setSpawnK(k) { state.spawnK = k; applyFrame(); },
    place(x, z) { group.position.set(x, 0, z); },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.customDepthMaterial.dispose();
      mesh.customDistanceMaterial.dispose();
      shadowMesh.geometry.dispose();
      shadowMesh.material.dispose();
    },
  };
}

export { DIRS };
