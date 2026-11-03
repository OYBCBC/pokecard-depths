// 战斗特效池：弹体面片 + 命中碎屑 + 出生烟尘。全部对象池，无运行时分配。
export function createEffects(THREE, scene, orbTex) {
  // ---- 弹体池（bolt/acid 共用几何，材质两种）----
  const POOL = 48;
  const boltMat = new THREE.MeshBasicMaterial({ map: orbTex.bolt, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const acidMat = new THREE.MeshBasicMaterial({ map: orbTex.acid, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const projGeo = new THREE.PlaneGeometry(0.3, 0.3);
  const projPool = [];
  for (let i = 0; i < POOL; i++) {
    const m1 = new THREE.Mesh(projGeo, boltMat);
    const m2 = new THREE.Mesh(projGeo, acidMat);
    m1.visible = m2.visible = false;
    m1.position.y = m2.position.y = 0.55;
    scene.add(m1); scene.add(m2);
    projPool.push({ bolt: m1, acid: m2 });
  }

  function syncProjectiles(projectiles, alpha) {
    let used = 0;
    for (const b of projectiles) {
      if (used >= POOL) break;
      const slot = projPool[used++];
      const x = b.px + (b.x - b.px) * alpha;
      const y = b.py + (b.y - b.py) * alpha;
      const isBolt = b.owner === 'player';
      slot.bolt.visible = isBolt;
      slot.acid.visible = !isBolt;
      const m = isBolt ? slot.bolt : slot.acid;
      m.position.x = x; m.position.z = y;
    }
    for (let i = used; i < POOL; i++) { projPool[i].bolt.visible = false; projPool[i].acid.visible = false; }
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
  }

  return { syncProjectiles, burst, update };
}
