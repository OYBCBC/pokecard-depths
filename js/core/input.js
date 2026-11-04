// 输入层 M2→M4：键盘移动 + 鼠标瞄准/射击 + 冲刺 + 触屏虚拟双摇杆。
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Tab',
]);

const STICK_R = 52;          // 虚拟摇杆半径（px）
const STICK_DEAD = 0.14;     // 死区

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

  return {
    getMove() {
      const kb = keyboardMove();
      const tm = touchStick('l');
      if (!tm) return kb;
      if (!kb.x && !kb.y) return { x: tm.x, y: tm.y };
      return { x: kb.x + tm.x, y: kb.y + tm.y };   // 键盘+摇杆叠加（引擎会归一化）
    },
    touchAim() { return touchStick('r'); },        // 右摇杆推过死区 = 朝该方向射击
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
    consumePress(code) {
      if (pressedOnce.has(code)) { pressedOnce.delete(code); return true; }
      return false;
    },
    endFrame() { pressedOnce.clear(); },
    onFirstInteraction(fn) { onFirstKey.push(fn); },
  };
}
