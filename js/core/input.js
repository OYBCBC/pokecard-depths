// 输入层 M2→M9：键盘移动 + 鼠标瞄准/射击 + 冲刺 + 触屏虚拟双摇杆 + 手柄（标准映射）。
// M6 触屏：开机识别触屏设备直接进触屏 UI（不必等第一下触摸）；外接键盘按游戏键回键鼠 UI。
// M9 固定双摇杆：移动/攻击两根摇杆底座位置固定（布局由 HUD 量出后 setStickLayout 注入，玩家可在
// 暂停菜单「操作布局」里调）；按下点落在某根空闲摇杆 1.8R 内才接管它，离两根都远的触摸忽略。
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Tab',
]);

const STICK_R = 52;          // 摇杆半径兜底（px）：HUD 未量到布局时用
const STICK_DEAD = 0.14;     // 死区
const GRAB_K = 1.8;          // 接管半径 = 1.8R（指尖略偏出底座也算按到）
// 这些元素上的触摸走默认行为（合成 click），不进摇杆；浮层容器统一挂 .ui-touch
const UI_SEL = 'button, input, a, label, .ui-touch';

// 手柄标准映射（Gamepad API "standard" 布局）：
// 左摇杆=移动，右摇杆=瞄准+射击，RT=射击，A=冲刺，B=图鉴，X=消耗品，Y=切槽，LB=换替补，RB=Z 招式，Start=面板
const PAD_BTN = { 0: 'Space', 1: 'KeyB', 2: 'KeyE', 3: 'KeyQ', 4: 'KeyF', 5: 'KeyR', 9: 'Tab' };
const PAD_AXIS_DEAD = 0.18;

function urlFlag(name) {
  try { return new URLSearchParams(location.search).get(name) === '1'; } catch (e) { return false; }
}

// 触屏为主的设备（手机/平板）识别，三重兜底（M7.1：部分手机浏览器媒体查询会撒谎）：
//   ① 经典媒体查询（无悬停+粗指针）；② 触屏硬件+无精细指针（matchMedia 缺失/桌面模式壳浏览器）；
//   ③ UA 特征（安卓/iOS 壳浏览器最后防线）。?touch=1 强制（布局调试/桌面验收用）。
export function touchPreferred() {
  if (urlFlag('touch')) return true;
  try {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true;
    if ((navigator.maxTouchPoints || 0) > 0 && window.matchMedia && !window.matchMedia('(pointer: fine)').matches) return true;
    if (/Android|iPhone|iPad|iPod|IEMobile|Mobile/i.test(navigator.userAgent || '')) return true;
  } catch (e) { /* ignore */ }
  return false;
}

export function createInput(target = window) {
  const down = new Set();
  const pressedOnce = new Set();
  const onFirstKey = [];
  const mouse = { x: 0.5, y: 0.5, down: false };   // NDC (-1..1)；down=左键
  const touches = new Map();                        // touchId -> { side:'l'|'r', x, y }
  const forcedTouch = urlFlag('touch');
  const modeFns = [];
  let touchMode = false;
  let layout = null;                                // { l:{x,y,r}, r:{x,y,r} }（视口 px）

  function setTouchMode(on) {
    on = !!on;
    if (on === touchMode) return;
    touchMode = on;
    if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('touchmode', on);
    modeFns.forEach((fn) => fn(on));
  }
  if (touchPreferred()) setTouchMode(true);

  function fireFirst() {
    if (!onFirstKey.length) return;
    onFirstKey.forEach((fn) => fn());
    onFirstKey.length = 0;
  }
  function keydown(e) {
    if (GAME_KEYS.has(e.code)) {
      e.preventDefault();
      if (touchMode && !forcedTouch) setTouchMode(false);    // 外接键盘玩家：切回键鼠 UI
    }
    if (!down.has(e.code)) {
      pressedOnce.add(e.code);
      if (down.size === 0) fireFirst();
    }
    down.add(e.code);
  }
  function keyup(e) { down.delete(e.code); }
  function blur() { down.clear(); mouse.down = false; touches.clear(); }
  function mousemove(e) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }
  function mousedown(e) {
    if (e.button === 0) {
      mouse.down = true;
      if (down.size === 0) fireFirst();
    }
  }
  function mouseup(e) { if (e.button === 0) mouse.down = false; }
  function contextmenu(e) { e.preventDefault(); }

  // ---- 触屏：固定双摇杆（l=移动，r=瞄准+射击；底座不动，向量=触点相对固定圆心） ----
  // 布局未注入（靶场页/测试/HUD 还没量到）时按默认位置兜底：左下 / 右下偏中，与 css 默认同量级
  function stickLayout() {
    if (layout) return layout;
    const W = window.innerWidth || 800, H = window.innerHeight || 400;
    return {
      l: { x: 118, y: H - 108, r: STICK_R },
      r: { x: Math.max(W / 2 + 80, W - 300), y: H - 112, r: STICK_R },
    };
  }
  function stickVec(o) {
    const s = stickLayout()[o.side];
    let dx = (o.x - s.x) / s.r, dy = (o.y - s.y) / s.r;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    return { x: dx, y: dy, l };
  }
  function onUI(e) {
    const t = e.target;
    return !!(t && t.closest && t.closest(UI_SEL));
  }
  function sideBusy(side) {
    for (const o of touches.values()) if (o.side === side) return true;
    return false;
  }
  // 按下点 → 接管哪根摇杆：空闲且在 1.8R 内的最近者；都不满足返回 null（触摸忽略）
  function pickStick(x, y) {
    const L = stickLayout();
    let best = null, bd = Infinity;
    for (const side of ['l', 'r']) {
      if (sideBusy(side)) continue;
      const s = L[side];
      const d = Math.hypot(x - s.x, y - s.y);
      if (d <= s.r * GRAB_K && d < bd) { bd = d; best = side; }
    }
    return best;
  }
  function touchstart(e) {
    setTouchMode(true);                              // 真触摸（含按钮上的）即切触屏 UI：开机检测失败也能秒纠正
    if (onUI(e)) return;                             // UI 元素走默认行为（合成 click），不进摇杆
    e.preventDefault();
    if (down.size === 0 && touches.size === 0) fireFirst();   // 在登记触点前判空
    for (const t of e.changedTouches) {
      const side = pickStick(t.clientX, t.clientY);
      if (side) touches.set(t.identifier, { side, x: t.clientX, y: t.clientY });
    }
  }
  function touchmove(e) {
    if (onUI(e)) return;                             // 浮层内滑动=滚动，不拦
    e.preventDefault();
    for (const t of e.changedTouches) {
      const o = touches.get(t.identifier);
      if (!o) continue;
      o.x = t.clientX; o.y = t.clientY;              // 底座固定：只更新触点
    }
  }
  function touchend(e) {
    for (const t of e.changedTouches) touches.delete(t.identifier);
  }
  function visibility() { if (typeof document !== 'undefined' && document.hidden) blur(); }   // 切后台可能收不到 touchend

  target.addEventListener('keydown', keydown);
  target.addEventListener('keyup', keyup);
  target.addEventListener('blur', blur);
  window.addEventListener('mousemove', mousemove);
  window.addEventListener('mousedown', mousedown);
  window.addEventListener('mouseup', mouseup);
  window.addEventListener('contextmenu', contextmenu);
  target.addEventListener('touchstart', touchstart, { passive: false });
  target.addEventListener('touchmove', touchmove, { passive: false });
  target.addEventListener('touchend', touchend, { passive: false });
  target.addEventListener('touchcancel', touchend, { passive: false });
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', visibility);

  function keyboardMove() {
    let x = 0, y = 0;
    if (down.has('KeyA') || down.has('ArrowLeft')) x -= 1;
    if (down.has('KeyD') || down.has('ArrowRight')) x += 1;
    if (down.has('KeyW') || down.has('ArrowUp')) y -= 1;
    if (down.has('KeyS') || down.has('ArrowDown')) y += 1;
    return { x, y };
  }
  function touchStick(side) {
    for (const o of touches.values()) {
      if (o.side !== side) continue;
      const v = stickVec(o);
      if (v.l > STICK_DEAD) return v;
    }
    return null;
  }

  // ---- 手柄：帧内幂等轮询（padPrev 保证边沿只触发一次） ----
  let padPrev = [];
  let padMove = null, padAimV = null, padFire = false;
  function pollPad() {
    padMove = null; padAimV = null; padFire = false;
    const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) { padPrev = []; return; }
    const dz = (v) => (Math.abs(v) < PAD_AXIS_DEAD ? 0 : v);
    const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0);
    const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
    if (lx || ly) padMove = { x: lx, y: ly };
    if (rx || ry) padAimV = { x: rx, y: ry };
    gp.buttons.forEach((b, i) => {
      const code = PAD_BTN[i];
      if (!code) return;
      if (b.pressed && !padPrev[i]) {
        pressedOnce.add(code);
        if (down.size === 0) fireFirst();
      }
      if (b.pressed) down.add(code);
      else down.delete(code);
    });
    const rt = gp.buttons[7];
    padFire = !!(rt && (rt.pressed || rt.value > 0.35));
    padPrev = gp.buttons.map((b) => b.pressed);
  }

  return {
    poll() { pollPad(); },                          // main 每帧开头调用一次；幂等
    getMove() {
      pollPad();
      const kb = keyboardMove();
      let x = kb.x, y = kb.y;
      if (padMove) { x += padMove.x; y += padMove.y; }
      const tm = touchStick('l');
      if (tm) { x += tm.x; y += tm.y; }
      return { x, y };                              // 多源叠加（引擎会归一化）
    },
    touchAim() { return touchStick('r'); },        // 右摇杆推过死区 = 朝该方向射击
    touchHeld(side) { return sideBusy(side); },     // 该摇杆有手指按着（含死区内：攻击摇杆按住不拖=自动瞄准）
    padAim() { pollPad(); return padAimV; },        // 手柄右摇杆：朝推动方向射击
    padFire() { pollPad(); return padFire; },       // RT 射击
    // 摇杆头偏移（渲染用）：未按的一侧为 null；底座位置由 HUD 自己的布局决定
    sticks() {
      const out = { l: null, r: null };
      for (const o of touches.values()) {
        const v = stickVec(o);
        out[o.side] = { kx: v.x, ky: v.y };
      }
      return out;
    },
    // 注入固定摇杆布局（HUD 按 DOM 实测：圆心视口坐标 + 半径 px）；传 null 回到默认兜底
    setStickLayout(L) { layout = L; },
    get stickLayout() { return stickLayout(); },
    pressButton(code) { pressedOnce.add(code); },  // 触屏按钮 → 模拟按键边沿（冲刺/切招/道具/换队/Z）
    held(code) { return down.has(code); },
    mouse,
    get fire() { return mouse.down; },
    get padConnected() {
      const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected) return true;
      return false;
    },
    get touchMode() { return touchMode; },
    setTouchMode,
    onModeChange(fn) { modeFns.push(fn); },
    consumePress(code) {
      if (pressedOnce.has(code)) { pressedOnce.delete(code); return true; }
      return false;
    },
    endFrame() { pressedOnce.clear(); },
    onFirstInteraction(fn) { onFirstKey.push(fn); },
    onPadConnect(fn) { window.addEventListener('gamepadconnected', (e) => fn(e.gamepad && e.gamepad.id)); },
  };
}
