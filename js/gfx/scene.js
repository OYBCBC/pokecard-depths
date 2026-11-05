// 场景装配：按房间配置搭建立体盒（《03》§6）。每进一房重建（dispose 旧组）。
// cfg = { type, w, h, doors: { '0,-1': 'normal'|'secret'|'revealed' } }
const SIDE_N = [0, -1], SIDE_S = [0, 1], SIDE_W = [-1, 0], SIDE_E = [1, 0];

export function buildRoom(THREE, scene, tex, lights, tier, cfg) {
  const { w: W, h: H, type } = cfg;
  const cx = W / 2, cz = H / 2;
  const group = new THREE.Group();
  scene.add(group);
  const isBoss = type === 'boss';

  // ---- 地板 ----
  const floorTex = isBoss ? tex.floorBoss : tex.floor;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.96 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.02, cz);
  floor.receiveShadow = true;
  group.add(floor);

  // 墙外黑暗裙边
  const skirt = new THREE.Mesh(new THREE.PlaneGeometry(W + 60, H + 60), new THREE.MeshBasicMaterial({ color: 0x0b0e18 }));
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.set(cx, 0, cz);
  group.add(skirt);

  // ---- 墙体（带门洞的侧留 2.4 缺口）----
  const T = 0.7, HGT = isBoss ? 1.05 : 0.9, GAP = 2.4;
  const wallTex = tex.wall, topTex = tex.wallTop;
  function wall(x, z, w, d, h) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      const [su, sv] = spans[f];
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
      }
    }
    uv.needsUpdate = true;
    const m = new THREE.Mesh(geo, [
      0, 1, 2, 3, 4, 5,
    ].map((k) => (k === 2 || k === 3
      ? new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.95 })
      : new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 }))));
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  }
  const doorSides = Object.keys(cfg.doors || {});
  const hasDoor = (side) => doorSides.includes(side[0] + ',' + side[1]);
  function sideWalls(side, mainAxis) {
    // side: [dx,dy]；mainAxis='x' 北南墙（沿 x），'z' 东西墙（沿 z）
    const gapC = mainAxis === 'x' ? [cx, side[1] < 0 ? -T / 2 : H + T / 2] : [side[0] < 0 ? -T / 2 : W + T / 2, cz];
    if (hasDoor(side)) {
      const len = (mainAxis === 'x' ? W : H) + T * 2 - GAP;
      const seg = len / 2 + T;
      if (mainAxis === 'x') {
        wall(gapC[0] - (GAP / 2 + seg - T / 2), gapC[1], seg, T, HGT);
        wall(gapC[0] + (GAP / 2 + seg - T / 2), gapC[1], seg, T, HGT);
      } else {
        wall(gapC[0], gapC[1] - (GAP / 2 + seg - T / 2), T, seg, HGT);
        wall(gapC[0], gapC[1] + (GAP / 2 + seg - T / 2), T, seg, HGT);
      }
    } else {
      if (mainAxis === 'x') wall(cx, gapC[1], W + T * 2, T, HGT);
      else wall(gapC[0], cz, T, H + T * 2, HGT);
    }
  }
  sideWalls(SIDE_N, 'x');
  sideWalls(SIDE_S, 'x');
  sideWalls(SIDE_W, 'z');
  sideWalls(SIDE_E, 'z');

  // ---- 门：闸板（战斗时关）+ 发光门洞 ----
  const gates = [], doorGlows = [], cracks = [];
  const mkGate = (side, secret) => {
    const gx = side[1] === 0 ? (side[0] < 0 ? -T / 2 : W + T / 2) : cx;
    const gz = side[1] === 0 ? cz : (side[1] < 0 ? -T / 2 : H + T / 2);
    if (secret) {
      // 隐藏门：裂缝贴片（揭示后移除）
      const crack = new THREE.Mesh(
        new THREE.PlaneGeometry(GAP * 0.9, GAP * 1.1),
        new THREE.MeshBasicMaterial({ map: tex.crack, transparent: true, depthWrite: false })
      );
      crack.position.set(gx, 0.55, gz);
      if (side[1] === 0) crack.rotation.y = Math.PI / 2;
      group.add(crack);
      cracks.push(crack);
      return;
    }
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(GAP * 0.95, GAP * 1.4),
      new THREE.MeshBasicMaterial({ map: tex.door, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    );
    glow.position.set(gx, GAP * 0.68, gz);
    if (side[1] === 0) glow.rotation.y = Math.PI / 2;
    group.add(glow);
    doorGlows.push(glow);
    const gate = new THREE.Mesh(
      new THREE.BoxGeometry(side[1] === 0 ? GAP : GAP * 0.9, HGT, side[1] === 0 ? GAP * 0.9 : GAP),
      [0, 1, 2, 3, 4, 5].map(() => new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 }))
    );
    gate.position.set(gx, HGT / 2, gz);
    gate.castShadow = gate.receiveShadow = true;
    group.add(gate);
    gates.push({ side, gate });
  };
  for (const dkey of doorSides) {
    const [dx, dy] = dkey.split(',').map(Number);
    mkGate([dx, dy], cfg.doors[dkey] !== 'normal' && cfg.doors[dkey] !== 'revealed');
  }

  // ---- 火把 ×2（北墙两侧）----
  const torches = [];
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.9 });
  // 黑市=暗红氛围 / 祭坛=暖金氛围（水晶簇颜色同步替换）
  const isBm = type === 'blackmarket', isAltar = type === 'altar';
  const torchColor = isBm ? 0xff5a5a : isAltar ? 0xffe9a0 : 0xffb36b;
  const crystalColor = isBm ? 0xff3860 : isAltar ? 0xffd570 : 0x4fc3ff;
  [W * 0.22, W * 0.78].forEach((x) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.6, 6), poleMat);
    pole.position.set(x, 0.3, 0.42);
    pole.castShadow = true;
    group.add(pole);
    const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.75),
      new THREE.MeshBasicMaterial({ map: tex.flame, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: torchColor }));
    flame.position.set(x, 0.78, 0.42);
    group.add(flame);
    const light = lights.acquire(torchColor, 80, x, 1.0, 0.9);
    torches.push({ flame, light, phase: Math.random() * 10, base: 80 });
  });

  // ---- 水晶簇（Boss 房四周 4 簇，普通房 3 簇；黑市暗红 / 祭坛暖金）----
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x9fdcff, emissive: crystalColor, emissiveIntensity: 1.8, roughness: 0.25,
  });
  const spots = isBoss
    ? [[2.2, 2.2], [W - 2.2, 2.2], [2.2, H - 2.2], [W - 2.2, H - 2.2]]
    : [[2.6, 2.2], [W - 2.6, 2.0], [W - 2.2, H - 2.0]];
  spots.forEach(([x, z], ci) => {
    const g = new THREE.Group();
    for (let i = 0; i < 2 + (ci % 2); i++) {
      const hgt = 0.8 + ((ci * 7 + i * 13) % 5) * 0.16;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16 + i * 0.07, hgt, 5), crystalMat);
      cone.position.set((i - 1) * 0.22, hgt / 2, (i % 2) * 0.18 - 0.09);
      cone.rotation.z = ((i % 2) ? 1 : -1) * 0.12;
      cone.castShadow = true;
      g.add(cone);
    }
    g.position.set(x, 0, z);
    group.add(g);
    lights.acquire(crystalColor, 60, x, 1.1, z);
  });

  // ---- 浮尘 ----
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
    color: 0xbfd8ff, size: 0.055, sizeAttenuation: true, transparent: true, opacity: 0.6, depthWrite: false,
  }));
  group.add(dust);

  let openState = false;
  return {
    group,
    update(dt, t) {
      torches.forEach(({ flame, light, phase, base }) => {
        const frame = Math.floor((t * 8 + phase) % 4);
        tex.flame.offset.x = frame / 4;
        light.intensity = base + Math.sin(t * 9 + phase) * 14 + Math.sin(t * 23 + phase * 2) * 7;
      });
      const p = dustGeo.attributes.position;
      for (let i = 0; i < N; i++) {
        p.setXYZ(i,
          ((p.getX(i) + vel[i][0] * dt) % W + W) % W,
          ((p.getY(i) + vel[i][1] * dt - 0.25) % 2 + 2) % 2 + 0.25,
          ((p.getZ(i) + vel[i][2] * dt) % H + H) % H);
      }
      p.needsUpdate = true;
    },
    setDoorOpen(open) {
      if (openState === open) return;
      openState = open;
      for (const { gate } of gates) gate.visible = !open;
      for (const g of doorGlows) g.material.opacity = open ? 1 : 0.25;
    },
    revealSecret() {
      for (const c of cracks) c.visible = false;
    },
    dispose() {
      group.traverse((o) => {
        if (o.isMesh || o.isPoints) {
          if (o.geometry) o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m && m.dispose && m.dispose());
        }
      });
      scene.remove(group);
    },
  };
}

// ---- 台座与拾取物（独立小工厂，挂在场景上，随房间 dispose）----
export function createProps(THREE, scene, tex) {
  const props = new THREE.Group();
  scene.add(props);
  const pedestalViews = new Map();   // id -> {group, icon}
  const pickupViews = new Map();     // id -> {mesh}

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a5570, roughness: 0.9 });

  function addPedestal(id, x, z, iconTex) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.5), stoneMat);
    base.position.y = 0.28;
    base.castShadow = true;
    g.add(base);
    if (iconTex) {
      const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55),
        new THREE.MeshBasicMaterial({ map: iconTex, transparent: true, depthWrite: false }));
      icon.position.y = 0.85;
      g.add(icon);
      g.userData.icon = icon;
    }
    g.position.set(x, 0, z);
    props.add(g);
    pedestalViews.set(id, g);
    return g;
  }
  function removePedestal(id) {
    const g = pedestalViews.get(id);
    if (!g) return;
    props.remove(g);
    pedestalViews.delete(id);
  }
  function addPickup(id, kind, x, z) {
    let mesh;
    if (kind === 'stairs') {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.5),
        new THREE.MeshBasicMaterial({ map: tex.door, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0xffd24a }));
      mesh.position.set(x, 0.8, z);
      props.add(mesh);
      pickupViews.set(id, mesh);
      return;
    }
    if (kind === 'heart') {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.3),
        new THREE.MeshBasicMaterial({ map: tex.heart, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      mesh.position.set(x, 0.35, z);
    } else {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28),
        new THREE.MeshBasicMaterial({ map: tex.coin, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      mesh.position.set(x, 0.35, z);
    }
    props.add(mesh);
    pickupViews.set(id, mesh);
  }
  function removePickup(id) {
    const m = pickupViews.get(id);
    if (!m) return;
    props.remove(m);
    pickupViews.delete(id);
  }
  function syncPickups(pickups) {
    const live = new Set(pickups.map((k) => k.id));
    for (const [id] of pickupViews) if (!live.has(id)) removePickup(id);
    for (const k of pickups) if (!pickupViews.has(k.id)) addPickup(k.id, k.kind, k.x, k.y);
  }
  function update(t) {
    for (const [, g] of pedestalViews) {
      if (g.userData.icon) g.userData.icon.position.y = 0.85 + Math.sin(t * 2.5) * 0.06;
    }
    for (const [, m] of pickupViews) {
      m.rotation.y = t * 2;
      m.position.y = 0.35 + Math.sin(t * 3 + m.id) * 0.04;
    }
  }
  function dispose() {
    props.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose && o.material.dispose(); }
    });
    scene.remove(props);
    pedestalViews.clear();
    pickupViews.clear();
  }
  return { addPedestal, removePedestal, addPickup, removePickup, syncPickups, update, dispose,
    get pedestalCount() { return pedestalViews.size; } };
}

// ---- 预警圈渲染 ----
export function createTelegraphFx(THREE, scene, ringTex) {
  const POOL = 24;
  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, opacity: 0.85 }));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    m.position.y = 0.05;
    scene.add(m);
    pool.push(m);
  }
  function sync(telegraphs) {
    for (let i = 0; i < POOL; i++) {
      const m = pool[i], t = telegraphs[i];
      if (!t) { m.visible = false; continue; }
      m.visible = true;
      m.position.x = t.x; m.position.z = t.y;
      const k = 1 + Math.max(0, t.t) * 0.4;      // 越接近爆点越收紧
      m.scale.set(t.r * 2 * k, t.r * 2 * k, 1);
      m.material.opacity = t.kind === 'charge-line' ? 0.35 : 0.85;
    }
  }
  return { sync };
}
