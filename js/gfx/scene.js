// 场景装配（《03》§6）：洞窟房 17×11 —— 地板/墙体/水晶/火把/浮尘
import { ROOM_W, ROOM_H } from '../sim/engine.js?v=m1l';

export function buildRoom(THREE, scene, tex, lights, tier) {
  const W = ROOM_W, H = ROOM_H;
  const cx = W / 2, cz = H / 2;

  // ---- 地板：整房一张烘焙纹理（17×11 格已含石板变化与贴墙暗角）----
  const floorMat = new THREE.MeshStandardMaterial({ map: tex.floor, roughness: 0.96, metalness: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.02, cz);
  floor.receiveShadow = true;
  scene.add(floor);

  // 墙外的黑暗裙边（相机斜视时会看到墙外）
  const skirt = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshBasicMaterial({ color: 0x0b0e18 })
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.set(cx, 0, cz);
  scene.add(skirt);

  // ---- 墙体：实心 3D 体块。北/东/西全高 0.9，南墙低 0.4（不挡玩家视线）----
  const T = 0.7;                                  // 墙厚
  function wall(x, z, w, d, h) {
    // 六面材质：±x, +y(顶), -y, ±z；顶用 wall-top；uv 按面世界跨度缩放（下面统一处理）
    const sideMat = () => new THREE.MeshStandardMaterial({ map: tex.wall, roughness: 0.9 });
    const topMat = new THREE.MeshStandardMaterial({ map: tex.wallTop, roughness: 0.95 });
    const mats = [sideMat(), sideMat(), topMat, topMat, sideMat(), sideMat()];
    // 按 uv 世界尺寸设置各面 repeat：近似以面片跨度为准
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    // BoxGeometry 面顺序 +x,-x,+y,-y,+z,-z，每面 4 顶点；按面跨度缩放 uv
    const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      const [su, sv] = spans[f];
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
      }
    }
    uv.needsUpdate = true;
    const m = new THREE.Mesh(geo, mats);
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  // 北墙留 2.4 宽的门洞（清空后开）：两段墙 + 封门闸板 + 发光门洞
  const GAP = 2.4;
  const segW = (W - GAP) / 2 + T;
  wall(cx - (GAP / 2 + segW / 2 - T / 2), -T / 2, segW, T, 0.9);
  wall(cx + (GAP / 2 + segW / 2 - T / 2), -T / 2, segW, T, 0.9);
  wall(cx, H + T / 2, W + T * 2, T, 0.9);          // 南（低）
  // 发光门洞（贴图自带拱形）
  const doorGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(GAP * 0.95, GAP * 1.4),
    new THREE.MeshBasicMaterial({ map: tex.door, transparent: true, depthWrite: false, side: THREE.DoubleSide })
  );
  doorGlow.position.set(cx, GAP * 0.68, -T / 2 - 0.02);
  scene.add(doorGlow);
  // 封门闸板（清空后落下消失）
  const gate = new THREE.Mesh(
    new THREE.BoxGeometry(GAP, 0.9, T * 0.8),
    [0, 1, 2, 3, 4, 5].map(() => new THREE.MeshStandardMaterial({ map: tex.wall, roughness: 0.9 }))
  );
  gate.position.set(cx, 0.45, -T / 2);
  gate.castShadow = gate.receiveShadow = true;
  scene.add(gate);
  wall(-T / 2, cz, T, H + T * 2, 0.9);             // 西
  wall(W + T / 2, cz, T, H + T * 2, 0.9);          // 东

  // ---- 水晶簇 ×3（emissive 喂 Bloom + 点光）----
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x9fdcff, emissive: 0x4fc3ff, emissiveIntensity: 1.8, roughness: 0.25, metalness: 0.1,
  });
  const crystalSpots = [[2.6, 2.2], [W - 2.6, 2.0], [W - 2.2, H - 2.0]];
  crystalSpots.forEach(([x, z], ci) => {
    const g = new THREE.Group();
    const shards = 2 + (ci % 2);
    for (let i = 0; i < shards; i++) {
      const hgt = 0.8 + ((ci * 7 + i * 13) % 5) * 0.16;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16 + i * 0.07, hgt, 5), crystalMat);
      cone.position.set((i - shards / 2) * 0.22, hgt / 2, (i % 2) * 0.18 - 0.09);
      cone.rotation.z = ((i % 2) ? 1 : -1) * 0.12;
      cone.castShadow = true;
      g.add(cone);
    }
    g.position.set(x, 0, z);
    scene.add(g);
    lights.acquire(0x4fc3ff, 60, x, 1.1, z);
  });

  // ---- 火把 ×2（北墙）----
  const torches = [];
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.9 });
  const torchX = [W * 0.28, W * 0.72];
  torchX.forEach((x) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.6, 6), poleMat);
    pole.position.set(x, 0.3, 0.42);
    pole.castShadow = true;
    scene.add(pole);
    // 火焰：面片 4 帧动画（MeshBasicMaterial 不受光、色彩直接喂 Bloom）
    const flameMat = new THREE.MeshBasicMaterial({
      map: tex.flame, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.75), flameMat);
    flame.position.set(x, 0.78, 0.42);
    scene.add(flame);
    const light = lights.acquire(0xffb36b, 80, x, 1.0, 0.9);
    torches.push({ flame, light, phase: Math.random() * 10, base: 80 });
  });

  // ---- 浮尘粒子（《03》§8：40 粒慢速漂浮）----
  const N = 40;
  const dustGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const vel = [];
  for (let i = 0; i < N; i++) {
    pos[i * 3] = Math.random() * W;
    pos[i * 3 + 1] = 0.25 + Math.random() * 2;
    pos[i * 3 + 2] = Math.random() * H;
    vel.push([(Math.random() - 0.5) * 0.08, 0.02 + Math.random() * 0.04, (Math.random() - 0.5) * 0.08]);
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xbfd8ff, size: 0.055, sizeAttenuation: true,
    transparent: true, opacity: 0.6, depthWrite: false,
  }));
  scene.add(dust);

  return {
    setDoorOpen(open) {
      gate.visible = !open;
      doorGlow.material.opacity = open ? 1 : 0.25;
    },
    update(dt, t) {
      // 火焰帧动画（8fps 闪烁）+ 点光呼吸
      torches.forEach(({ flame, light, phase, base }) => {
        const frame = Math.floor((t * 8 + phase) % 4);
        tex.flame.offset.x = frame / 4;
        light.intensity = base + Math.sin(t * 9 + phase) * 14 + Math.sin(t * 23 + phase * 2) * 7;
      });
      // 浮尘漂移 + 包裹回卷
      const p = dustGeo.attributes.position;
      for (let i = 0; i < N; i++) {
        p.setXYZ(i,
          ((p.getX(i) + vel[i][0] * dt) % W + W) % W,
          ((p.getY(i) + vel[i][1] * dt - 0.25) % 2 + 2) % 2 + 0.25,
          ((p.getZ(i) + vel[i][2] * dt) % H + H) % H);
      }
      p.needsUpdate = true;
    },
  };
}
