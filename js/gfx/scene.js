// 场景装配：按房间配置搭建立体盒（《03》§6）。每进一房重建（dispose 旧组）。
// cfg = { type, w, h, doors: { '0,-1': 'normal'|'secret'|'revealed'|'locked'|'boss' } }
import { makeDropTex, FRAMES } from './droptex.js?v=m9b';

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
  const mkGate = (side, secret, locked, boss) => {
    const gx = side[1] === 0 ? (side[0] < 0 ? -T / 2 : W + T / 2) : cx;
    const gz = side[1] === 0 ? cz : (side[1] < 0 ? -T / 2 : H + T / 2);
    if (secret) {
      // 隐藏门/裂缝门：裂缝贴片（揭示后移除）
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
    // Boss 门（M10）：骷髅门脸贴图，比普通门高半档——离远了也能一眼认出"这是 Boss 房"
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(boss ? GAP * 1.15 : GAP * 0.95, boss ? GAP * 1.75 : GAP * 1.4),
      new THREE.MeshBasicMaterial({
        map: boss ? tex.bossDoor : tex.door, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        color: locked ? 0xffd24a : 0xffffff,        // 锁门泛金光（钥匙经济的"这里能开"信号）
      })
    );
    glow.position.set(gx, boss ? GAP * 0.82 : GAP * 0.68, gz);
    if (side[1] === 0) glow.rotation.y = Math.PI / 2;
    group.add(glow);
    glow.userData.boss = !!boss;
    doorGlows.push(glow);
    const gate = new THREE.Mesh(
      new THREE.BoxGeometry(side[1] === 0 ? GAP : GAP * 0.9, HGT, side[1] === 0 ? GAP * 0.9 : GAP),
      [0, 1, 2, 3, 4, 5].map(() => new THREE.MeshStandardMaterial({
        map: wallTex, roughness: 0.9,
        color: locked ? 0xd8b24a : boss ? 0x9a5044 : 0xffffff,   // Boss 闸板暗红石
        emissive: locked ? 0x5a4210 : boss ? 0x2a0f0c : 0x000000,
      }))
    );
    gate.position.set(gx, HGT / 2, gz);
    gate.castShadow = gate.receiveShadow = true;
    group.add(gate);
    gates.push({ side, gate });
  };
  for (const dkey of doorSides) {
    const [dx, dy] = dkey.split(',').map(Number);
    const dt = cfg.doors[dkey];
    // secret/fissure 未揭示=裂缝；locked=金闸；boss=骷髅门；normal/revealed=普通门
    mkGate([dx, dy], dt !== 'normal' && dt !== 'revealed' && dt !== 'locked' && dt !== 'boss',
      dt === 'locked', dt === 'boss');
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
    update(dt, t, calm) {
      // calm=全屏 UI 浮层打开（开始界面/暂停/图鉴/胜负页）：火光定在基准亮度、火焰停帧。
      // 频闪的火把在游戏里是氛围，透过 80% 透明的浮层就是背景一明一暗晃眼（M6 用户反馈）。
      torches.forEach(({ flame, light, phase, base }) => {
        if (calm) { light.intensity = base; return; }
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
      // Boss 门关着时保持半亮（骷髅红眼隐约可见=压迫感）；普通门只漏 25% 光
      for (const g of doorGlows) g.material.opacity = open ? 1 : (g.userData.boss ? 0.55 : 0.25);
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
// 拾取物 M9.1 HD2D 化：billboard 主贴图（金币 8 帧旋转序列）+ 脚下软影 + 加色光斑（吃 bloom）
// + 出生衰减弹跳 + 磁吸增速反馈；heart 满血灰显；consumable/trinket 复用道具 icon 贴图。
// tex = { door, iconOf(itemId) -> texture|null }
export function createProps(THREE, scene, tex) {
  const props = new THREE.Group();
  scene.add(props);
  const pedestalViews = new Map();   // id -> {group, icon}
  const pickupViews = new Map();     // id -> view

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a5570, roughness: 0.9 });

  // ---- 拾取物共享资源 ----
  const dt = makeDropTex();
  const wrap = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  };
  const dropTex = { coin: wrap(dt.coin), coin2: wrap(dt.coin2), heart: wrap(dt.heart), key: wrap(dt.key), chest: wrap(dt.chest), itemBox: wrap(dt.itemBox), stairs: wrap(dt.stairs) };
  const shadowTex = wrap(dt.shadow);
  const glowTex = wrap(dt.glow);

  const TILT = -35 * Math.PI / 180;          // 与弹体同工艺：后仰 35° 正对俯视镜头
  const DROP_DEFS = {                        // 每类掉落物的贴图/尺寸/悬浮高/光斑
    coin:       { tex: dropTex.coin, size: 0.42, anim: 'spin', glow: 0xffc95e, glowS: 0.85 },
    coin2:      { tex: dropTex.coin2, size: 0.54, anim: 'spin', glow: 0xff9a4a, glowS: 1.05 },
    heart:      { tex: dropTex.heart, size: 0.46, anim: 'pulse', glow: 0xff7d9a, glowS: 0.9 },
    key:        { tex: dropTex.key, size: 0.48, anim: 'sway', glow: 0xbfe4ff, glowS: 0.9 },
    chest:      { tex: dropTex.chest, size: 0.52, anim: 'pulse', glow: 0xffc95e, glowS: 1.0 },
  };
  const baseMat = (t) => new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const dropMats = {};
  for (const [k, d] of Object.entries(DROP_DEFS)) dropMats[k] = baseMat(d.tex);
  const heartDimMat = baseMat(dropTex.heart);           // 满血灰显
  heartDimMat.color.set(0x8a8a8a); heartDimMat.opacity = 0.55;
  const glowMatOf = (c) => new THREE.MeshBasicMaterial({
    map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: c,
  });
  const shadowMatOf = () => new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.8 });
  const glowGeo = new THREE.PlaneGeometry(1, 1);
  const shGeo = new THREE.PlaneGeometry(1, 1);

  // 金币序列帧：改实例 geometry 的 uv（sprites.js applyFrame 同工艺，共享材质各自相位）。
  // 原始 0/1 uv 首次调用前缓存进 userData，之后每次从模板重写（uv 会被改成帧偏移，不能就地判定）
  function setSpinFrame(mesh, f) {
    const uv = mesh.geometry.attributes.uv;
    if (!mesh.userData.uvTpl) mesh.userData.uvTpl = Array.from(uv.array);
    const tpl = mesh.userData.uvTpl;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (f + tpl[i * 2]) / FRAMES);
    uv.needsUpdate = true;
  }

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

  function addPickup(id, kind, x, z, itemId) {
    if (kind === 'stairs') {                          // 下行楼梯陷阱门（M11）：贴地石框台阶 + 呼吸晶光圈
      const g = new THREE.Group();
      const glow = new THREE.Mesh(glowGeo, glowMatOf(0x35b6ff));   // 青晶光圈（与房间水晶簇同色系）
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.032;
      glow.scale.setScalar(2.6);
      g.add(glow);
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.25), baseMat(dropTex.stairs));
      pad.rotation.x = -Math.PI / 2;                  // 平贴地面（俯视 55° 投影后近似回正）
      pad.position.y = 0.05;
      g.add(pad);
      g.position.set(x, 0, z);
      props.add(g);
      pickupViews.set(id, { kind, group: g, icon: pad, glow, stair: true, seed: (id % 16) / 16 });
      return;
    }
    const def = DROP_DEFS[kind];
    // consumable/trinket → 道具 icon（M10：缺失图标兜底"包裹箱"，不再退化成压扁金币帧）
    const iconTex = def ? def.tex : ((tex.iconOf && tex.iconOf(itemId)) || dropTex.itemBox);
    const size = def ? def.size : 0.55;
    const g = new THREE.Group();
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
      baseMat(iconTex));
    icon.rotation.x = TILT;
    if (def && def.anim === 'spin') setSpinFrame(icon, 0);
    g.add(icon);
    const shadow = new THREE.Mesh(shGeo, shadowMatOf());   // 影随高度调 opacity → 材质按实例隔离
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.07;
    shadow.scale.setScalar(size * 1.15);
    g.add(shadow);
    // M10：icon 类掉落也有柔光光斑（和金币们一样"值得弯腰"的视觉语言）
    const glowColor = def ? def.glow : 0xfff2c8;
    const glowS = def ? def.glowS : 0.95;
    const glow = new THREE.Mesh(glowGeo, glowMatOf(glowColor));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.06;
    glow.scale.setScalar(glowS);
    g.add(glow);
    g.position.set(x, 0, z);
    props.add(g);
    pickupViews.set(id, { kind, group: g, icon, shadow, glow, def, seed: (id % 16) / 16,
      birth: null, px: x, pz: z, mag: 0, dimmed: false, frame: -1 });
  }
  function removePickup(id) {
    const v = pickupViews.get(id);
    if (!v) return;
    props.remove(v.group);
    if (v.icon && v.icon.geometry !== shGeo && v.icon.geometry !== glowGeo) v.icon.geometry.dispose();
    pickupViews.delete(id);
  }
  function syncPickups(pickups, t) {
    const live = new Set(pickups.map((k) => k.id));
    for (const [id] of pickupViews) if (!live.has(id)) removePickup(id);
    for (const k of pickups) {
      if (!pickupViews.has(k.id)) addPickup(k.id, k.kind, k.x, k.y, k.itemId);
      const v = pickupViews.get(k.id);
      if (!v || v.stair) continue;
      const spd = Math.hypot(k.x - v.px, k.y - v.pz);          // 磁吸：位置每帧同步 + 速度读数
      v.px = k.x; v.pz = k.y;
      v.group.position.set(k.x, 0, k.y);
      v.mag = Math.max(spd, v.mag * 0.86);                      // 平滑衰减的"流速"
      if (v.birth === null) v.birth = t;                        // 首帧见到才起表（弹跳动画起点）
    }
  }
  // M10：台座同步——以撒交换把旧件放回台座时 itemId 变了 → 重建该台座视图；taken 的移除
  function syncPedestals(pedestals, iconOf) {
    const live = new Set();
    for (const d of pedestals) {
      if (d.taken) continue;
      live.add(d.id);
      const g = pedestalViews.get(d.id);
      if (!g || g.userData.itemId !== d.itemId) {
        if (g) removePedestal(d.id);
        const ng = addPedestal(d.id, d.x, d.y, iconOf ? iconOf(d.itemId) : null);
        ng.userData.itemId = d.itemId;
      } else {
        g.position.set(d.x, 0, d.y);
      }
    }
    for (const id of [...pedestalViews.keys()]) if (!live.has(id)) removePedestal(id);
  }
  // 满血时 heart 灰显（提示吃不下；不拾就不吃，机制不变）
  function setFullHp(b) {
    for (const [, v] of pickupViews) {
      if (v.kind !== 'heart' || v.stair) continue;
      const want = !!b;
      if (v.dimmed !== want) {
        v.dimmed = want;
        v.icon.material = want ? heartDimMat : dropMats.heart;
      }
    }
  }
  function update(t) {
    for (const [, g] of pedestalViews) {
      if (g.userData.icon) g.userData.icon.position.y = 0.85 + Math.sin(t * 2.5) * 0.06;
    }
    for (const [, v] of pickupViews) {
      if (v.stair) {                                                    // 楼梯：晶光圈呼吸（贴地无浮动画）
        v.glow.material.opacity = 0.46 + Math.sin(t * 2.1 + v.seed * 6.28) * 0.18;
        v.glow.scale.setScalar(2.7 + Math.sin(t * 2.1 + v.seed * 6.28) * 0.14);
        continue;
      }
      const def = v.def;
      const seed = v.seed;
      const baseY = 0.38;
      // 出生衰减弹跳（落地蹦两下）→ 常态缓慢浮动
      const age = v.birth === null ? 9 : t - v.birth;
      const hop = age < 0.6 ? 0.24 * Math.abs(Math.sin(age * 8.5)) * Math.exp(-age * 4.0) : 0;
      const bob = Math.sin(t * 3 + seed * 6.28) * 0.045;
      const y = baseY + hop + bob;
      v.icon.position.y = y;
      // 影随高度：越高越小越淡（浮空读位）
      const h01 = Math.min(1, (y - baseY + 0.05) / 0.28);
      v.shadow.scale.setScalar((def ? def.size : 0.55) * 1.15 * (1 - 0.38 * h01));
      v.shadow.material.opacity = 0.8 * (1 - 0.5 * h01);
      if (def) {
        if (def.anim === 'spin') {
          const f = Math.floor((t * 9 + seed * FRAMES)) % FRAMES;
          if (f !== v.frame) { v.frame = f; setSpinFrame(v.icon, f); }   // 帧号变了才重写 uv
        }
        else if (def.anim === 'pulse') v.icon.scale.setScalar(1 + Math.sin(t * 2.6 + seed * 6.28) * 0.06);
        else if (def.anim === 'sway') v.icon.rotation.z = Math.sin(t * 2.0 + seed * 6.28) * 0.12;
        v.icon.rotation.x = TILT - Math.min(0.3, v.mag * 0.5);          // 磁吸时贴图向镜头倾
      }
      if (v.glow) {                                                     // M10：icon 类掉落同样呼吸光斑
        const breath = 0.62 + 0.2 * Math.sin(t * 2.4 + seed * 6.28);
        v.glow.material.opacity = breath * (1 + v.mag * 0.9);           // 磁吸时光斑炸亮
        v.glow.scale.setScalar((def ? def.glowS : 0.95) * (1 + 0.07 * Math.sin(t * 2.4 + seed * 6.28) + v.mag * 0.3));
      }
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
  return { addPedestal, removePedestal, addPickup, removePickup, syncPickups, syncPedestals, update, setFullHp, dispose,
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
