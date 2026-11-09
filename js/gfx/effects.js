// 战斗特效池：弹体面片 + 命中碎屑 + 出生烟尘。全部对象池，无运行时分配。
export function createEffects(THREE, scene, orbTex) {
  // ---- 弹体池：按招式分材质（配色 tint）——玩家全部招式都要有，缺了弹体直接隐形 ----
  const POOL = 48;
  const TINTS = {
    'thunder-shock': 0xffffff, 'water-gun': 0x7fd4ff, 'fire-spin': 0xffa04a,
    'grass-knot': 0x9fe070, 'swift': 0xffe24a, 'bone-club': 0xe8e0cc,
    'bubble': 0xa8e8ff, 'tri-attack': 0xfff0b0, 'aerial-ace': 0xdff6ff,
    'hyper-beam': 0xffb0c8, 'fire-punch': 0xff8844, 'acid': null,
    // 伙伴专属默认招式（配色对应 moves.json 的 tint）
    'quick-attack': 0xf5e9c8, 'string-shot': 0xd8e8a0, 'acid-spray': 0xa868d8,
    'sonic-boom': 0xc8d8e8, 'sludge': 0xb06ad0, 'mud-shot': 0xb09868,
    'zap-cannon': 0xffe08a, 'bite': 0xe8c8a0, 'confusion': 0xff9fe0,
    'lick': 0xc0a8e8, 'sand-tomb': 0xe0c888, 'karate-chop': 0xe8a080,
    'horn-attack': 0xd8c8a8, 'feint-attack': 0x9098a8, 'fury-swipes': 0xe8d8a8,
    'shadow-ball': 0xa08fd0, 'moonblast': 0xffb8e8, 'pound': 0xf0c8d8,
    'rollout': 0xc8b090, 'psybeam': 0xff8fd8, 'egg-bomb': 0xf8ecd8,
    'fury-cutter': 0xb8e878, 'splash': 0x9fd8ff, 'twister': 0xa8d0f0,
    'mirror-shot': 0xffb8c8, 'body-slam': 0xe8e0c8, 'dragon-claw': 0xf0a858,
  };
  const mats = { acid: new THREE.MeshBasicMaterial({ map: orbTex.acid, transparent: true, depthWrite: false, side: THREE.DoubleSide }) };
  for (const [mv, tint] of Object.entries(TINTS)) {
    if (tint == null) continue;
    mats[mv] = new THREE.MeshBasicMaterial({ map: orbTex.bolt, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: tint });
  }
  const projGeo = new THREE.PlaneGeometry(0.3, 0.3);
  const projPool = [];
  for (let i = 0; i < POOL; i++) {
    const slot = {};
    for (const k of Object.keys(mats)) {
      const m = new THREE.Mesh(projGeo, mats[k]);
      m.visible = false;
      m.position.y = 0.55;
      scene.add(m);
      slot[k] = m;
    }
    projPool.push(slot);
  }

  function syncProjectiles(projectiles, alpha) {
    let used = 0;
    for (const b of projectiles) {
      if (used >= POOL) break;
      const slot = projPool[used++];
      let key = b.owner === 'player' ? (b.moveId || 'thunder-shock') : 'acid';
      if (!slot[key]) key = 'thunder-shock';               // 兜底：新招式漏配 tint 也不隐形
      for (const k of Object.keys(slot)) slot[k].visible = k === key;
      const m = slot[key];
      if (m) {
        m.position.x = b.px + (b.x - b.px) * alpha;
        m.position.z = b.py + (b.y - b.py) * alpha;
        m.scale.setScalar(Math.max(0.5, (b.radius * 2) / 0.3));
      }
    }
    for (let i = used; i < POOL; i++) for (const k of Object.keys(projPool[i])) projPool[i][k].visible = false;
  }

  // ---- 命中碎屑池：8 片小面片爆开 ----
  const CHIP_N = 96;
  const chipGeo = new THREE.PlaneGeometry(0.09, 0.09);
  const chipMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const chips = [];
  for (let i = 0; i < CHIP_N; i++) {
    const m = new THREE.Mesh(chipGeo, chipMat.clone());
    m.visible = false;
    scene.add(m);
    chips.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0 });
  }
  let chipCursor = 0;

  function burst(x, z, n = 8, color = 0xffe9a0) {
    for (let k = 0; k < n; k++) {
      const c = chips[chipCursor];
      chipCursor = (chipCursor + 1) % CHIP_N;
      c.mesh.visible = true;
      c.mesh.material.color.set(color);
      c.mesh.material.opacity = 1;
      c.mesh.position.set(x, 0.6, z);
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 3;
      c.vx = Math.cos(a) * s; c.vz = Math.sin(a) * s;
      c.vy = 1.5 + Math.random() * 2.5;
      c.life = 0.35 + Math.random() * 0.15;
    }
  }

  function update(dt) {
    for (const c of chips) {
      if (c.life <= 0) { c.mesh.visible = false; continue; }
      c.life -= dt;
      c.vy -= 9 * dt;
      c.mesh.position.x += c.vx * dt;
      c.mesh.position.y = Math.max(0.08, c.mesh.position.y + c.vy * dt);
      c.mesh.position.z += c.vz * dt;
      c.mesh.material.opacity = Math.max(0, c.life / 0.45);
    }
    for (const b of bolts) {
      if (b.life <= 0) { b.mesh.visible = false; continue; }
      b.life -= dt;
      b.mesh.material.opacity = Math.max(0, b.life / 0.18);
    }
  }

  // ---- 连锁闪电：两点间水平细条（0.18s 淡出）----
  const bolts = [];
  const boltGeo = new THREE.PlaneGeometry(1, 0.07);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({
      color: 0xbfe4ff, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.visible = false;
    scene.add(m);
    bolts.push({ mesh: m, life: 0 });
  }
  let boltCursor = 0;
  function bolt(x0, z0, x1, z1) {
    const b = bolts[boltCursor];
    boltCursor = (boltCursor + 1) % bolts.length;
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    b.mesh.visible = true;
    b.mesh.scale.set(len, 1, 1);
    b.mesh.position.set((x0 + x1) / 2, 0.55, (z0 + z1) / 2);
    b.mesh.rotation.set(-Math.PI / 2, 0, -Math.atan2(dz, dx));
    b.mesh.material.opacity = 1;
    b.life = 0.18;
  }

  return { syncProjectiles, burst, bolt, update };
}
