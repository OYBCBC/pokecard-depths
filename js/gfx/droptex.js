// 掉落物像素纹理工厂（M9.1）：程序化生成 16×16 像素画（与 projtex.js 同工艺，NearestFilter 出像素感）。
// coin/coin2 是 8 帧旋转序列（FRAMES×16 宽 spritesheet，视图层改 uv 帧动画），heart/key 单帧；
// shadow/glow 是 32×32 径向渐变（黑影斑 / 白光斑，材质上色用）。纯 canvas，无 three 依赖。

const S = 16;
export const FRAMES = 8;

function mk(w = S, h = S) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return { cv, ctx: cv.getContext('2d') };
}

// 硬币单帧：横向半径按 w01 缩放（1=正对，≈0.12=侧棱），逐像素竖椭圆 + 描边/渐变/高光/币芯
function coinFrame(ctx, ox, w01, pal) {
  if (w01 <= 0.14) {                                     // 侧棱帧：一条窄亮竖棱
    for (let y = 2; y <= 13; y++) {
      const c = y <= 3 || y >= 12 ? pal.edge : (y <= 7 ? pal.hi : pal.lite);
      ctx.fillStyle = c; ctx.fillRect(ox + 7, y, 2, 1);
    }
    return;
  }
  const cx = ox + S / 2, rx = 6.3 * w01, ry = 6.3;
  const edgeBand = 1 - 2.1 / ry;                         // 外圈描边带（半径平方阈值）
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - 8) / ry;
    const d = dx * dx + dy * dy;
    if (d > 1) continue;
    let c;
    if (d > edgeBand * edgeBand) c = pal.edge;           // 描边
    else if (dy > 0.42) c = pal.dark;                    // 下缘暗带
    else if (dx < -0.35 && dy < -0.05 && dy > -0.72) c = pal.hi;   // 左上高光弧
    else c = dy < -0.25 ? pal.lite : pal.body;           // 上亮下主体的金属渐变
    if (pal.gem) {                                        // coin2 币芯菱形宝石
      const gx = Math.abs(dx) / 0.52 + Math.abs(dy) / 0.52;
      if (gx <= 0.85) c = gx > 0.62 ? pal.gemEdge : pal.gem;
    }
    ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1);
  }
}

// 心形（隐函数 (nx²+ny²-1)³ - nx²·ny³ ≤ 0）：描边 + 上瓣亮下尖深 + 左上高光点
function heartCv() {
  const { cv, ctx } = mk();
  const inside = (x, y, k) => {
    const nx = (x + 0.5 - 8) / 7.0 * k, ny = (11.5 - y) / 7.0 * k;
    return Math.pow(nx * nx + ny * ny - 1, 3) - nx * nx * Math.pow(ny, 3) <= 0;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!inside(x, y, 1)) continue;
    let c;
    if (!inside(x, y, 1.24)) c = '#6b0f2a';                          // 描边
    else {
      const ny = (11.5 - y) / 7.0;
      c = ny > 0.42 ? '#d4103f' : ny > -0.15 ? '#ff4f79' : '#ff8fa8'; // 下尖→上瓣渐亮
      if (x >= 4 && x <= 5 && y >= 4 && y <= 5) c = '#ffd6e0';       // 左上高光点
    }
    ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1);
  }
  return cv;
}

// 金钥匙：环头（挖空圆环）+ 竖杆 + 两齿，金色渐变 + 左缘高光
function keyCv() {
  const { cv, ctx } = mk();
  const G = '#ffdf7e', HI = '#fff3c4', MID = '#eaa92e', EDGE = '#7a4a08';
  for (let y = 0; y < 8; y++) for (let x = 3; x < 13; x++) {         // 环头
    const dx = x + 0.5 - 8, dy = y + 0.5 - 4.2, d = Math.hypot(dx, dy);
    if (d <= 3.4 && d >= 1.7) {
      const isEdge = d > 2.75 || d < 2.25;
      ctx.fillStyle = isEdge ? EDGE : dx < -0.6 ? HI : dy > 1.2 ? MID : G;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let y = 7; y <= 14; y++) {                                     // 竖杆
    ctx.fillStyle = y >= 14 ? EDGE : G; ctx.fillRect(7, y, 1, 1);
    ctx.fillStyle = y >= 14 ? EDGE : HI; ctx.fillRect(8, y, 1, 1);
  }
  for (const [yy, len] of [[10, 3], [12, 2]]) {                       // 两齿
    for (let i = 0; i < 2; i++) for (let x = 9; x < 9 + len; x++) {
      ctx.fillStyle = (i === 0 && x === 9) ? HI : (i === 1 || x === 9 + len - 1) ? EDGE : G;
      ctx.fillRect(x, yy + i, 1, 1);
    }
  }
  return cv;
}

// 木箱（M10 以撒木箱转译）：棕木板箱 + 盖体合缝 + 金属包角锁扣
function chestCv() {
  const { cv, ctx } = mk();
  const WOOD = '#a86a32', WOOD_L = '#c98f4e', WOOD_D = '#7c4a1e', EDGE = '#3e240c',
        BAND = '#e8c060', BAND_D = '#9a7020';
  for (let y = 3; y <= 13; y++) for (let x = 1; x <= 14; x++) {
    let c;
    if (y === 3 || y === 13 || x === 1 || x === 14) c = EDGE;          // 外描边
    else if (y === 4) c = WOOD_L;                                      // 盖沿高光
    else if (y === 7 || y === 8) c = WOOD_D;                           // 盖体合缝
    else if (y === 12) c = WOOD_D;                                     // 底板阴影
    else c = (x === 5 || x === 10) ? WOOD_D : WOOD;                    // 板条竖缝
    ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1);
  }
  for (const bx of [2, 12]) {                                          // 两侧金属包角竖带
    for (let y = 3; y <= 13; y++) {
      ctx.fillStyle = y === 3 || y === 13 ? EDGE : BAND; ctx.fillRect(bx, y, 1, 1);
      ctx.fillStyle = y === 3 || y === 13 ? EDGE : BAND_D; ctx.fillRect(bx + 1, y, 1, 1);
    }
  }
  ctx.fillStyle = BAND_D; ctx.fillRect(6, 6, 3, 3);                    // 中央锁扣
  ctx.fillStyle = BAND; ctx.fillRect(6, 6, 3, 1);
  ctx.fillStyle = EDGE; ctx.fillRect(7, 7, 1, 2);                      // 锁孔
  return cv;
}

// 梦之宝箱（M11-C 终焉宝箱）：紫晶木箱 + 梦色包角 + 中央羽毛纹锁扣——以撒式"主动开箱才结算"
function finalChestCv() {
  const { cv, ctx } = mk();
  const WOOD = '#6a58a8', WOOD_L = '#8a78c8', WOOD_D = '#463878', EDGE = '#1e1636',
        BAND = '#c0a8ff', BAND_D = '#7a62b8';
  for (let y = 3; y <= 13; y++) for (let x = 1; x <= 14; x++) {
    let c;
    if (y === 3 || y === 13 || x === 1 || x === 14) c = EDGE;
    else if (y === 4) c = WOOD_L;
    else if (y === 7 || y === 8) c = WOOD_D;
    else if (y === 12) c = WOOD_D;
    else c = (x === 5 || x === 10) ? WOOD_D : WOOD;
    ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1);
  }
  for (const bx of [2, 12]) {
    for (let y = 3; y <= 13; y++) {
      ctx.fillStyle = y === 3 || y === 13 ? EDGE : BAND; ctx.fillRect(bx, y, 1, 1);
      ctx.fillStyle = y === 3 || y === 13 ? EDGE : BAND_D; ctx.fillRect(bx + 1, y, 1, 1);
    }
  }
  ctx.fillStyle = BAND_D; ctx.fillRect(6, 6, 3, 3);
  ctx.fillStyle = BAND; ctx.fillRect(6, 6, 3, 1);
  ctx.fillStyle = EDGE; ctx.fillRect(7, 7, 1, 2);
  ctx.fillStyle = '#f0e8ff'; ctx.fillRect(7, 10, 1, 1);   // 星辉微光
  return cv;
}

// 离开的洞口（M11-C 结局①）：上行梯口——石框 + 三级上行台阶 + 暖金光斑
function stairsLeaveCv() {
  const W = 24, H = 30;
  const { cv, ctx } = mk(W, H);
  const EDGE = '#1c1206', RIM = '#50402a', STEP = '#7c6a48', STEP_L = '#9c8a62',
        LIGHT = '#ffd88a', LIGHT_D = '#c89850';
  ctx.fillStyle = EDGE; ctx.fillRect(2, 2, W - 4, H - 4);
  ctx.fillStyle = RIM; ctx.fillRect(3, 3, W - 6, H - 6);
  for (let i = 0; i < 3; i++) {                          // 上行台阶（自下而上收窄）
    const w = 14 - i * 4;
    ctx.fillStyle = i % 2 ? STEP : STEP_L;
    ctx.fillRect(Math.round((W - w) / 2), 22 - i * 7, w, 6);
  }
  ctx.fillStyle = LIGHT; ctx.fillRect(9, 8, 6, 5);       // 顶部暖金光
  ctx.fillStyle = LIGHT_D; ctx.fillRect(9, 13, 6, 2);
  return cv;
}

// 兜底"包裹箱"（M10）：道具图标缺失时替代压扁金币帧——牛皮纸包裹 + 问号
function itemBoxCv() {
  const { cv, ctx } = mk();
  const PAPER = '#c8a468', PAPER_D = '#96703a', EDGE = '#5c3c14', MARK = '#5c3c14';
  for (let y = 3; y <= 13; y++) for (let x = 2; x <= 13; x++) {
    let c;
    if (y === 3 || y === 13 || x === 2 || x === 13) c = EDGE;
    else if (y === 8 || x === 7) c = PAPER_D;                          // 十字捆扎带
    else c = (x + y) % 7 ? PAPER : '#d8b87c';
    ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1);
  }
  ctx.fillStyle = MARK;                                                // 问号（3×5 手绘）
  for (const [x, y] of [[9, 5], [10, 6], [9, 7], [8, 7], [8, 8]]) ctx.fillRect(x, y, 1, 1);
  return cv;
}

// 下行楼梯陷阱门（M11）：贴地石框 + 四级下行台阶 + 青晶光斑——替换旧"门贴图染金"占位。
// 24×30（纵比 0.8）：视图层按 1.8×2.25 平放，俯视 55° 投影后视觉近似回正。
function stairsCv() {
  const W = 24, H = 30;
  const { cv, ctx } = mk(W, H);
  const EDGE = '#0a0f1c', RIM = '#2a3550', RIM_L = '#3d4c6e', RIM_HI = '#5a6e9a', RIM_D = '#1a2336';
  const STEP = ['#202c48', '#141c30', '#0b1120', '#05080f'];   // 近→远（越深越黑）
  const NOSE = ['#33436a', '#283456', '#1f2a44'];              // 台阶前缘受光
  const CYAN = '#4fc3ff', CYAN_L = '#9fdcff', SEEP = '#1c5a8c';
  // 圆角矩形逐像素判定：把点夹到内缩矩形上量距离
  const inRR = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return Math.hypot(x - cx, y - cy) <= r + 0.5;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inRR(x, y, 1, 1, 22, 28, 4.2)) continue;
    let c;
    if (!inRR(x, y, 2, 2, 21, 27, 3.6)) c = EDGE;              // 外描边 1px
    else if (inRR(x, y, 5, 5, 18, 24, 2.4)) {                  // 深坑：四级台阶（上=远=深）
      const band = y <= 9 ? 3 : y <= 14 ? 2 : y <= 19 ? 1 : 0;
      const bandStart = band === 3 ? 5 : band === 2 ? 10 : band === 1 ? 15 : 20;
      c = band > 0 && y === bandStart ? NOSE[band - 1] : STEP[band];
      if (y === 5 || x === 5 || x === 18 || y === 24) c = (x + y) % 2 ? EDGE : '#04070c';   // 坑口内缘
    } else {                                                   // 石框：左上受光 / 右下背光
      const lt = y <= 4 || x <= 4, dk = y >= 25 || x >= 19;
      c = lt && !dk ? RIM_L : dk && !lt ? RIM_D : RIM;
      if ((y === 4 || x === 4) && !dk) c = RIM_HI;             // 坑口石唇高光
    }
    ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1);
  }
  // 坑底微光（下方晶簇透上来的青光）+ 坑内星点
  ctx.fillStyle = SEEP; ctx.fillRect(6, 6, 12, 1);
  ctx.fillStyle = CYAN_L; ctx.fillRect(9, 6, 2, 1); ctx.fillRect(14, 7, 1, 1);
  ctx.fillStyle = CYAN_L; ctx.fillRect(8, 12, 1, 1); ctx.fillRect(15, 17, 1, 1); ctx.fillRect(11, 21, 1, 1);
  // 左右石框水晶嵌点（与房间水晶簇同色）
  for (const [gx, gy] of [[3, 13], [19, 13]]) {
    ctx.fillStyle = EDGE; ctx.fillRect(gx - 1, gy - 1, 4, 4);
    ctx.fillStyle = CYAN; ctx.fillRect(gx, gy, 2, 2);
    ctx.fillStyle = CYAN_L; ctx.fillRect(gx, gy, 1, 1);
  }
  return cv;
}

// 径向渐变斑（影/光共用画法）：c0→透明的柔和圆斑
function blobCv(c0, c1) {
  const { cv, ctx } = mk(32, 32);
  const g = ctx.createRadialGradient(16, 16, 1.5, 16, 16, 15);
  g.addColorStop(0, c0); g.addColorStop(1, c1);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
  return cv;
}

// 蛛网（M12 障碍）：8 根辐条 + 两圈下垂弧线的半透明细网——线描画法（细线比逐像素更像丝）。
export function makeWebTex() {
  const N = 48;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d');
  const C = 24, SPOKES = 8;
  ctx.strokeStyle = 'rgba(214,224,244,0.85)';
  ctx.lineWidth = 1.1;
  // 辐条
  for (let i = 0; i < SPOKES; i++) {
    const a = (i / SPOKES) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(C, C);
    ctx.lineTo(C + Math.cos(a) * 23, C + Math.sin(a) * 23);
    ctx.stroke();
  }
  // 环线：相邻辐条间的下垂弧（二次曲线， sag 随半径增大）
  for (let ring = 1; ring <= 3; ring++) {
    const r = 6 + ring * 6;
    ctx.beginPath();
    for (let i = 0; i <= SPOKES; i++) {
      const a = (i / SPOKES) * Math.PI * 2 - Math.PI / 2;
      const px = C + Math.cos(a) * r, py = C + Math.sin(a) * r;
      if (i === 0) { ctx.moveTo(px, py); continue; }
      const am = a - Math.PI / SPOKES;
      const mid = r - 1.6 - ring * 0.4;                       // 向心下垂
      ctx.quadraticCurveTo(C + Math.cos(am) * mid, C + Math.sin(am) * mid, px, py);
    }
    ctx.stroke();
  }
  // 几粒"缠住的碎屑"（可读性：一眼看出是网不是装饰圈）
  ctx.fillStyle = 'rgba(230,238,252,0.9)';
  for (const [x, y] of [[24, 18], [30, 28], [17, 27], [27, 15]]) ctx.fillRect(x, y, 1.4, 1.4);
  return cv;
}

// 白色径向光斑（掉落物光斑 / 精英常驻光环共用）；独立导出，调用方自行包 CanvasTexture
export function makeGlowTex() {
  return blobCv('rgba(255,255,255,0.85)', 'rgba(255,255,255,0)');
}

const COIN_PAL = { edge: '#8a5410', dark: '#c07f16', body: '#f5b02a', lite: '#ffd75e', hi: '#fff3b0' };
const COIN2_PAL = { edge: '#7a2408', dark: '#c25210', body: '#f07f1e', lite: '#ffab47', hi: '#ffe0a8',
  gem: '#fff0f5', gemEdge: '#ffb3c8' };

export function makeDropTex() {
  const coin = mk(FRAMES * S, S), coin2 = mk(FRAMES * S, S);
  for (let f = 0; f < FRAMES; f++) {
    const w01 = Math.max(0.1, Math.abs(Math.cos(f / FRAMES * Math.PI * 2)));
    coinFrame(coin.ctx, f * S, w01, COIN_PAL);
    coinFrame(coin2.ctx, f * S, w01, COIN2_PAL);
  }
  return {
    coin: coin.cv, coin2: coin2.cv,
    heart: heartCv(), key: keyCv(),
    chest: chestCv(), itemBox: itemBoxCv(),
    'final-chest': finalChestCv(), 'stairs-leave': stairsLeaveCv(),
    stairs: stairsCv(),
    shadow: blobCv('rgba(0,0,0,0.5)', 'rgba(0,0,0,0)'),
    glow: makeGlowTex(),
  };
}
