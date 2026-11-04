// 输入层 M2→M4：键盘移动 + 鼠标瞄准/射击 + 冲刺 + 触屏虚拟双摇杆 + 手柄（标准映射）。
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Tab',
]);

const STICK_R = 52;          // 虚拟摇杆半径（px）
const STICK_DEAD = 0.14;     // 死区

// 手柄标准映射（Gamepad API "standard" 布局）：
// 左摇杆=移动，右摇杆=瞄准+射击，RT=射击，A=冲刺，B=图鉴，X=消耗品，Y=切槽，LB=换替补，RB=Z 招式，Start=面板
const PAD_BTN = { 0: 'Space', 1: 'KeyB', 2: 'KeyE', 3: 'KeyQ', 4: 'KeyF', 5: 'KeyR', 9: 'Tab' };
const PAD_AXIS_DEAD = 0.18;

export function createInput(target = window) {
  const down = new Set();
  const pressedOnce = new Set();
  const onFirstKey = [];
  const mouse = { x: 0.5, y: 0.5, down: false };   // NDC (-1..1)；down=左键
  const touches = new Map();                        // touchId -> { side:'l'|'r', ox, oy, x, y }

  function keydown(e) {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!down.has(e.code)) {
      pressedOnce.add(e.code);
      if (down.size === 0) { onFirstKey.forEach((fn) => fn()); onFirstKey.length = 0; }
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
      if (down.size === 0) { onFirstKey.forEach((fn) => fn()); onFirstKey.length = 0; }
    }
  }
  function mouseup(e) { if (e.button === 0) mouse.down = false; }
  function contextmenu(e) { e.preventDefault(); }

  // ---- 触屏：左半屏=移动摇杆，右半屏=瞄准+射击摇杆 ----
  function stickVec(o) {
    let dx = (o.x - o.ox) / STICK_R, dy = (o.y - o.oy) / STICK_R;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    return { x: dx, y: dy, l };
  }
  function firstTouch() {
    if (down.size === 0 && touches.size === 0) { onFirstKey.forEach((fn) => fn()); onFirstKey.length = 0; }
  }
  function onButtons(e) {
    // 按钮与浮层上的触摸走默认行为（合成 click），不进摇杆
    const t = e.target;
    return !!(t.closest && t.closest('button, #start, #dex, .tbtn'));
  }
  function touchstart(e) {
    if (onButtons(e)) return;
    e.preventDefault();
    document.body.classList.add('touchmode');
    firstTouch();                                    // 在登记触点前判空
    for (const t of e.changedTouches) {
      const side = t.clientX < window.innerWidth / 2 ? 'l' : 'r';
      touches.set(t.identifier, { side, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY });
    }
  }
  function touchmove(e) {
    if (onButtons(e)) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const o = touches.get(t.identifier);
      if (o) { o.x = t.clientX; o.y = t.clientY; }
    }
  }
  function touchend(e) {
    for (const t of e.changedTouches) touches.delete(t.identifier);
  }

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
        if (down.size === 0) { onFirstKey.forEach((fn) => fn()); onFirstKey.length = 0; }
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
    pressButton(code) { pressedOnce.add(code); },  // 触屏按钮 → 模拟按键（冲刺/图鉴）
    held(code) { return down.has(code); },
    mouse,
    get fire() { return mouse.down; },
    get padConnected() {
      const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected) return true;
      return false;
    },
    consumePress(code) {
      if (pressedOnce.has(code)) { pressedOnce.delete(code); return true; }
      return false;
    },
    endFrame() { pressedOnce.clear(); },
    onFirstInteraction(fn) { onFirstKey.push(fn); },
    onPadConnect(fn) { window.addEventListener('gamepadconnected', (e) => fn(e.gamepad && e.gamepad.id)); },
  };
}
