// 相机（《03》§3）：fov 40 竖直、俯角 -55°、偏航固定，跟随 + 移动方向前瞻
export function createCamera(THREE) {
  const w = window.innerWidth || 1280, h = window.innerHeight || 800;   // 防 0 除
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 120);
  const PITCH = 55 * Math.PI / 180;
  const DIST = 13.5;                     // 拉远到能框住北墙与火把（俯角 55° 时上缘达 z≈-1）
  // 相机在目标点的“南上方”：y+ 为高度，z+ 为南（朝北俯视）
  const OFFSET = new THREE.Vector3(0, Math.sin(PITCH) * DIST, Math.cos(PITCH) * DIST);
  const target = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const desired = new THREE.Vector3();
  let shakeT = 0, shakeAmp = 0;

  camera.position.set(0, 0, 0).add(OFFSET);

  return {
    camera,
    // x, z：玩家世界坐标；vx, vz：移动方向（前瞻用）
    update(dt, x, z, vx = 0, vz = 0) {
      desired.set(x + vx * 0.8, 0, z + vz * 0.8).add(OFFSET);
      // 帧率无关的指数平滑
      camera.position.lerp(desired, 1 - Math.pow(0.0015, dt));
      if (shakeT > 0) {
        shakeT -= dt;
        const k = Math.max(shakeT, 0) * shakeAmp;
        camera.position.x += (Math.random() - 0.5) * k;
        camera.position.y += (Math.random() - 0.5) * k;
      }
      lookAt.set(camera.position.x - OFFSET.x, 0, camera.position.z - OFFSET.z);
      camera.lookAt(lookAt);
    },
    shake(amp = 0.25, dur = 0.3) { shakeAmp = amp; shakeT = dur; },
    offset: OFFSET,
  };
}
