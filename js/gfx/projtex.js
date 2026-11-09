// M8 弹体像素纹理工厂：程序化生成 16×16 属性贴图（与游戏 16-texel 美术一致，NearestFilter 出像素感）。
// 纯 canvas 绘制，无 three 依赖——调用方（effects.js / lab.js）自行包 CanvasTexture。
// 命名与 vfxdefs 的 tex 字段一一对应；改图案只动本文件的 DRAW 表。

const S = 16;

function mk(draw) {
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  const px = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, 1, 1); };
  draw(ctx, px);
  return cv;
}

// 像素圆（半径按方形距离判定，出圆润像素轮廓）
function disc(ctx, cx, cy, r, c) {
  ctx.fillStyle = c;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    if (dx * dx + dy * dy <= r * r) ctx.fillRect(x, y, 1, 1);
  }
}

// 四芒星：纵横臂 + 对角短臂 + 核心圆
function star4(ctx, cx, cy, arm, halfW, diag, c) {
  ctx.fillStyle = c;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = Math.abs(x + 0.5 - cx), dy = Math.abs(y + 0.5 - cy);
    if ((Math.max(dx, dy) <= arm && Math.min(dx, dy) <= halfW) || (Math.abs(dx - dy) <= halfW && dx <= diag)) ctx.fillRect(x, y, 1, 1);
  }
}

// 菱形（叶片/光刃）：横向半径 rx、纵向半径 ry
function diamond(ctx, cx, cy, rx, ry, c) {
  ctx.fillStyle = c;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = Math.abs(x + 0.5 - cx) / rx, dy = Math.abs(y + 0.5 - cy) / ry;
    if (dx + dy <= 1) ctx.fillRect(x, y, 1, 1);
  }
}

// 竖向火焰滴（下宽上尖，顶部微摆）：ghost / ghostball / fire
function flame(ctx, baseC, coreC, sway = 1) {
  for (let y = 1; y <= 14; y++) {
    const t = (y - 1) / 13;                        // 0 顶 1 底
    const r = 1.4 + t * 4.2;
    const cx = 8 + Math.sin(t * 2.6) * sway;
    ctx.fillStyle = baseC;
    for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - cx;
      if (Math.abs(dx) <= r) ctx.fillRect(x, y, 1, 1);
    }
  }
  if (coreC) disc(ctx, 8, 10, 2.2, coreC);
}

export const DRAW = {
  // ---- 属性默认 ----
  fire(ctx) {
    flame(ctx, '#e8431a', null, 0);               // 外焰（深橙红壳）
    disc(ctx, 8, 9.5, 4.2, '#ff9a3c');
    disc(ctx, 7.5, 9.5, 2.7, '#ffe66e');
    disc(ctx, 7.5, 10.5, 1.3, '#fff6d0');
    ctx.fillStyle = '#ffd23c';                     // 左缘亮边（受光感）
    ctx.fillRect(3, 9, 1, 1); ctx.fillRect(3, 10, 1, 1); ctx.fillRect(4, 8, 1, 1);
  },
  water(ctx) {
    disc(ctx, 8, 8, 5.6, '#2a6fd4');
    disc(ctx, 8, 8, 4.7, '#3fa9ff');
    disc(ctx, 6.4, 6.4, 1.8, '#cfeeff');
    ctx.fillStyle = '#7cc4ff'; ctx.fillRect(9, 9, 1, 1); ctx.fillRect(10, 10, 1, 1);
    ctx.fillStyle = '#3fa9ff'; ctx.fillRect(5, 14, 1, 1); ctx.fillRect(11, 14, 1, 1);   // 分离水滴
  },
  grass(ctx) {
    diamond(ctx, 8, 8, 3.4, 6.6, '#4f8f2e');
    diamond(ctx, 8, 8, 2.4, 5.6, '#7ec850');
    ctx.fillStyle = '#d8f0b0';
    for (let y = 3; y <= 12; y++) ctx.fillRect(8, y, 1, 1);                             // 中脉
  },
  electric(ctx) {
    star4(ctx, 8, 8, 6, 1.3, 3.2, '#ffd23c');
    disc(ctx, 8, 8, 2, '#fff8c8');
  },
  psychic(ctx) {
    ctx.fillStyle = '#d156a8';                                                          // 环绕珠
    for (const [x, y] of [[8, 1], [8, 15], [1, 8], [15, 8], [2, 2], [14, 14]]) ctx.fillRect(x, y, 1, 1);
    disc(ctx, 8, 8, 4.6, '#ff7fd0');
    disc(ctx, 8, 8, 2.6, '#ffb8ea');
    disc(ctx, 8, 8, 1.2, '#fff0f8');
  },
  ghost(ctx) { flame(ctx, '#8f7fd8', '#c9b8f2', 1); ctx.fillStyle = '#efe8ff'; ctx.fillRect(6, 7, 1, 1); ctx.fillRect(10, 6, 1, 1); },
  poison(ctx) {
    disc(ctx, 8, 8, 5.4, '#7a4ba8');
    disc(ctx, 8, 8, 4.4, '#a868d8');
    disc(ctx, 6.4, 6.4, 1.6, '#d9b8f0');
    ctx.fillStyle = '#d9b8f0'; ctx.fillRect(10, 10, 1, 1); ctx.fillRect(6, 10, 1, 1);
  },
  ground(ctx) {
    disc(ctx, 8, 8.5, 5.2, '#a08858');
    disc(ctx, 7, 8, 4, '#b09868');
    ctx.fillStyle = '#86663f';
    for (const [x, y] of [[7, 8], [10, 10], [6, 11], [3, 8], [13, 9], [9, 3]]) ctx.fillRect(x, y, 1, 1);
  },
  rock(ctx) {
    ctx.fillStyle = '#a8a29a';
    ctx.fillRect(4, 5, 8, 8);
    ctx.fillRect(5, 4, 6, 1); ctx.fillRect(5, 13, 6, 1); ctx.fillRect(3, 6, 1, 6); ctx.fillRect(12, 6, 1, 6);
    ctx.fillStyle = '#d0ccc4'; ctx.fillRect(5, 5, 2, 1); ctx.fillRect(5, 6, 1, 2);
    ctx.fillStyle = '#6f6a63'; ctx.fillRect(8, 6, 1, 1); ctx.fillRect(9, 7, 1, 2); ctx.fillRect(7, 9, 1, 1); ctx.fillRect(8, 10, 1, 2);
  },
  normal(ctx) {
    disc(ctx, 8, 8, 5, '#d9c9a0');
    disc(ctx, 8, 8, 3.4, '#f5e9c8');
    disc(ctx, 8, 8, 1.7, '#fffbe8');
  },
  fighting(ctx) {                                                                       // 气劲弧
    disc(ctx, 8, 8, 5.8, '#e8604a');
    ctx.globalCompositeOperation = 'destination-out';
    disc(ctx, 10, 6, 4.9, '#000');
    ctx.globalCompositeOperation = 'source-over';
    disc(ctx, 8, 9.5, 2.2, '#ffb08a');
  },
  flying(ctx) {                                                                         // 白月牙刃
    disc(ctx, 8, 8, 5.8, '#9fd8ff');
    ctx.globalCompositeOperation = 'destination-out';
    disc(ctx, 10.4, 6.2, 4.9, '#000');
    ctx.globalCompositeOperation = 'source-over';
    disc(ctx, 7.6, 9.8, 2, '#f0faff');
  },
  bug(ctx) {
    diamond(ctx, 8, 8, 2.2, 6.8, '#78a848');
    diamond(ctx, 8, 8, 1.3, 5.8, '#b8e878');
    ctx.fillStyle = '#eaffc8';
    for (let y = 3; y <= 12; y++) ctx.fillRect(8, y, 1, 1);
  },
  steel(ctx) {
    disc(ctx, 8, 8, 5.6, '#8a97a5');
    disc(ctx, 8, 8, 4.6, '#c8d4e0');
    disc(ctx, 6.4, 6.4, 1.9, '#f4f9fd');
    ctx.fillStyle = '#8a97a5'; ctx.fillRect(9, 9, 2, 1); ctx.fillRect(9, 10, 1, 1);
  },
  dragon(ctx) {
    disc(ctx, 8, 8, 5.2, '#c86a28');
    disc(ctx, 8, 8, 4.2, '#f0a858');
    disc(ctx, 8, 8, 2, '#ffe0a8');
    ctx.fillStyle = '#7a5af0';
    for (const [x, y] of [[3, 10], [4, 9], [4, 8], [12, 6], [11, 7], [12, 8]]) ctx.fillRect(x, y, 1, 1);
  },
  fairy(ctx) {
    star4(ctx, 8, 8, 6.5, 1.5, 3.6, '#ffb8e8');
    disc(ctx, 8, 8, 2.1, '#fff2fa');
  },
  ice(ctx) {
    ctx.fillStyle = '#a8e8f5';
    for (let i = 2; i <= 13; i++) { ctx.fillRect(8, i, 1, 1); ctx.fillRect(i, 8, 1, 1); }
    for (let i = 4; i <= 11; i++) { ctx.fillRect(i, i, 1, 1); ctx.fillRect(15 - i, i, 1, 1); }
    ctx.fillStyle = '#6fc8dd';
    ctx.fillRect(5, 3, 1, 1); ctx.fillRect(10, 3, 1, 1); ctx.fillRect(5, 12, 1, 1); ctx.fillRect(10, 12, 1, 1);
    disc(ctx, 8, 8, 1.7, '#e8fbff');
  },
  dark(ctx) {
    disc(ctx, 8, 8, 5.4, '#3a3050');
    disc(ctx, 8, 8, 4.3, '#5a4a72');
    disc(ctx, 6.8, 6.8, 1.6, '#8a7aa5');
  },
  // ---- 特型招式 ----
  swift(ctx) {
    star4(ctx, 8, 8, 7, 2, 4, '#ffd23c');
    star4(ctx, 8, 8, 4.5, 1.5, 2.5, '#fff8c8');
    disc(ctx, 8, 8, 1.4, '#fffdf0');
  },
  bone(ctx) {
    ctx.fillStyle = '#efe8d4'; ctx.fillRect(4, 7, 8, 2);                                // 骨杆
    disc(ctx, 3.5, 6.8, 2.2, '#efe8d4'); disc(ctx, 3.5, 9.2, 2.2, '#efe8d4');
    disc(ctx, 12.5, 6.8, 2.2, '#efe8d4'); disc(ctx, 12.5, 9.2, 2.2, '#efe8d4');
    ctx.fillStyle = '#c8bfa8';
    ctx.fillRect(3, 5, 1, 1); ctx.fillRect(13, 5, 1, 1); ctx.fillRect(3, 11, 1, 1); ctx.fillRect(13, 11, 1, 1);
  },
  egg(ctx) {
    disc(ctx, 8, 7, 3.6, '#d8c8a8'); disc(ctx, 8, 9.5, 4.3, '#d8c8a8');                 // 蛋形（上窄下宽）
    disc(ctx, 8, 7.2, 2.9, '#fdf6e8'); disc(ctx, 8, 9.3, 3.6, '#fdf6e8');
    ctx.fillStyle = '#e8b84a'; ctx.fillRect(6, 7, 2, 1); ctx.fillRect(10, 9, 1, 1); ctx.fillRect(7, 11, 1, 1);
  },
  tri(ctx) {                                                                            // 三重攻击：火/电/冰三瓣
    disc(ctx, 8, 8, 5.2, '#ff5a1f');
    ctx.save(); ctx.beginPath(); ctx.arc(8, 8, 5.4, Math.PI * 0.5, Math.PI * 1.5); ctx.closePath();
    ctx.clip(); disc(ctx, 8, 8, 5.4, '#ffd23c'); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.moveTo(3, 8); ctx.lineTo(13, 8); ctx.lineTo(8, 14); ctx.closePath();
    ctx.clip(); disc(ctx, 8, 9, 5.4, '#7fd4ff'); ctx.restore();
    disc(ctx, 8, 8, 1.8, '#fff8dc');
  },
  hyper(ctx) {
    disc(ctx, 8, 8, 5.6, '#ff3c30');
    disc(ctx, 8, 8, 4.4, '#ff8844');
    disc(ctx, 8, 8, 2.5, '#fff0c8');
  },
  ghostball(ctx) { flame(ctx, '#5a48a8', '#9a86e8', 1.5); disc(ctx, 8, 9, 1.4, '#e8e0ff'); },
  splash(ctx) {
    star4(ctx, 8, 8, 5, 1.2, 2.6, '#3fa9ff');
    disc(ctx, 8, 8, 1.6, '#cfeeff');
  },
  wisp(ctx) { flame(ctx, '#c0a8e8', '#efe8ff', 0.8); },
  silk(ctx) {                                                                           // 吐丝：丝团
    ctx.strokeStyle = '#d8e8a0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(8, 8, 4.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(8, 8, 2.5, 0.6, Math.PI * 1.6); ctx.stroke();
    ctx.fillStyle = '#eef8c0'; ctx.fillRect(8, 8, 1, 1);
  },
  note(ctx) {                                                                           // 摇篮曲：音符
    ctx.fillStyle = '#ffb0d8';
    disc(ctx, 5.5, 11, 2.4, '#ffb0d8');
    ctx.fillRect(7, 3, 2, 8);
    ctx.fillRect(9, 3, 4, 2);
    ctx.fillRect(9, 5, 2, 1);
  },
};

/** 生成全部弹体贴图 canvas。返回 { name: canvas }——异常名称直接缺省（normal 兜底）。 */
export function makeProjTex() {
  const out = {};
  for (const [name, draw] of Object.entries(DRAW)) out[name] = mk(draw);
  return out;
}
