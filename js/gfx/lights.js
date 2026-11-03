// 灯光（《03》§4 配方）：半球底光 + 平行主光（房间级静态阴影盒）+ 点光池
export function createLights(THREE, scene, tier, roomW, roomH) {
  // 半球光：天光=洞窟主题蓝，地面暖反射（r187 物理光单位，实测 1.2 起步）
  const hemi = new THREE.HemisphereLight(0x3a5a8c, 0x3a3630, 4.5);
  scene.add(hemi);

  // 平行主光：相机侧上方（南偏高）打光——billboard 精灵的受光面朝向镜头（HD-2D 关键，
  // 实测从北侧打光会把精灵照成背光剪影）。阴影正交盒覆盖整个房间（静态，《02》§7.3）
  const dir = new THREE.DirectionalLight(0xffe9c4, 7.0);
  dir.position.set(roomW * 0.30, 16, roomH * 1.55);
  dir.target.position.set(roomW / 2, 0, roomH / 2);
  scene.add(dir.target);
  if (tier !== 'low') {
    dir.castShadow = true;
    const cam = dir.shadow.camera;
    const spanW = roomW / 2 + 2.5, spanH = roomH / 2 + 3.5;
    cam.left = -spanW; cam.right = spanW;
    cam.top = spanH; cam.bottom = -spanH;
    cam.near = 1; cam.far = 60;
    cam.updateProjectionMatrix();
    dir.shadow.mapSize.set(tier === 'high' ? 2048 : 1024, tier === 'high' ? 2048 : 1024);
    dir.shadow.bias = -0.0004;
    dir.shadow.normalBias = 0.02;
  }
  scene.add(dir);

  // 点光池：事件驱动分配（火把/水晶/大招）。M1 用 3 盏
  const pool = [];
  const POOL_SIZE = tier === 'low' ? 4 : 8;
  for (let i = 0; i < POOL_SIZE; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 7, 2);
    l.visible = false;
    scene.add(l);
    pool.push(l);
  }
  let next = 0;
  function acquire(color, intensity, x, y, z) {
    const l = pool[next];
    next = (next + 1) % pool.length;
    l.color.set(color);
    l.intensity = intensity;
    l.position.set(x, y, z);
    l.visible = true;
    return l;
  }

  return { hemi, dir, pool, acquire };
}
