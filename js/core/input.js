// 输入层 M2→M6：键盘移动 + 鼠标瞄准/射击 + 冲刺 + 触屏虚拟双摇杆 + 手柄（标准映射）。
// M6 触屏：开机识别触屏设备直接进触屏 UI（不必等第一下触摸）；摇杆浮动且跟手（拖出半径时底座跟随，
// 反向不用回拉）；第二根手指落在已占用的半屏时自动接管空闲摇杆；外接键盘按游戏键回键鼠 UI。
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Tab',
]);

const STICK_R = 52;          // 虚拟摇杆半径（px）
const STICK_DEAD = 0.14;     // 死区
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
  const touches = new Map();                        // touchId -> { side:'l'|'r', ox, oy, x, y }
  const forcedTouch = urlFlag('touch');
  const modeFns = [];
  let touchMode = false;

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

  // ---- 触屏：左半屏=移动摇杆，右半屏=瞄准+射击摇杆（浮动：按下处即摇杆中心） ----
  function stickVec(o) {
    let dx = (o.x - o.ox) / STICK_R, dy = (o.y - o.oy) / STICK_R;
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
  function touchstart(e) {
    setTouchMode(true);                              // 真触摸（含按钮上的）即切触屏 UI：开机检测失败也能秒纠正
    if (onUI(e)) return;                             // UI 元素走默认行为（合成 click），不进摇杆
    e.preventDefault();
    if (down.size === 0 && touches.size === 0) fireFirst();   // 在登记触点前判空
    const W = window.innerWidth || 1;
    for (const t of e.changedTouches) {
      let side = t.clientX < W / 2 ? 'l' : 'r';
      const other = side === 'l' ? 'r' : 'l';
      if (sideBusy(side) && !sideBusy(other)) side = other;   // 两指落同侧：后到的接管空闲摇杆
      touches.set(t.identifier, { side, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY });
    }
  }
  function touchmove(e) {
    if (onUI(e)) return;                             // 浮层内滑动=滚动，不拦
    e.preventDefault();
    for (const t of e.changedTouches) {
      const o = touches.get(t.identifier);
      if (!o) continue;
      o.x = t.clientX; o.y = t.clientY;
      const dx = o.x - o.ox, dy = o.y - o.oy, l = Math.hypot(dx, dy);
      if (l > STICK_R) { o.ox = o.x - dx / l * STICK_R; o.oy = o.y - dy / l * STICK_R; }   // 底座跟手
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
    padAim() { pollPad(); return padAimV; },        // 手柄右摇杆：朝推动方向射击
    padFire() { pollPad(); return padFire; },       // RT 射击
    sticks() {
      const out = { l: null, r: null };
      for (const o of touches.values()) {
        const v = stickVec(o);
        out[o.side] = { ox: o.ox, oy: o.oy, kx: Math.max(-1, Math.min(1, v.x)), ky: Math.max(-1, Math.min(1, v.y)) };
      }
      return out;
    },
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
