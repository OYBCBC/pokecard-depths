// 相机（《03》§3）：fov 40 竖直、俯角 -55°、偏航固定，跟随 + 移动方向前瞻
const DEG = Math.PI / 180;
const BASE_FOV = 40;
const DESIGN_ASPECT = 16 / 9;            // 构图基准：16:9 时横向刚好框住 17 格宽的房间
const MAX_FOV = 62;                      // 窄屏放宽竖直 fov 的上限（再大透视畸变明显）
const MAX_DIST_MUL = 1.7;                // fov 到顶后相机最多拉远到 1.7 倍

export function createCamera(THREE) {
  const w = window.innerWidth || 1280, h = window.innerHeight || 800;   // 防 0 除
  const camera = new THREE.PerspectiveCamera(BASE_FOV, w / h, 0.1, 120);
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
    // 窄屏适配（M6）：平板 4:3 / 手机竖屏横向视野不足——先放宽竖直 fov（≤62°），还不够再拉远相机。
    // 返回比基准多拉远的距离：主循环据此补偿雾的 near/far（防远墙被雾吞，见 M1 踩坑⑦）。
    fit(aspect) {
      const a = Math.max(0.3, aspect || DESIGN_ASPECT);
      let fov = BASE_FOV, dist = DIST;
      if (a < DESIGN_ASPECT) {
        const need = Math.tan(BASE_FOV / 2 * DEG) * DESIGN_ASPECT / a;   // 保持横向视野需要的 tan(竖直半角)
        const maxT = Math.tan(MAX_FOV / 2 * DEG);
        fov = 2 * Math.atan(Math.min(need, maxT)) / DEG;
        if (need > maxT) dist = DIST * Math.min(need / maxT, MAX_DIST_MUL);
      }
      camera.fov = fov;
      camera.updateProjectionMatrix();
      OFFSET.set(0, Math.sin(PITCH) * dist, Math.cos(PITCH) * dist);
      return dist - DIST;
    },
    offset: OFFSET,
  };
}
