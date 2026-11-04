// 输入层 M2：键盘移动 + 鼠标瞄准/射击 + 冲刺。M4 扩展手柄/触屏，接口不变。
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Tab',
]);

export function createInput(target = window) {
  const down = new Set();
  const pressedOnce = new Set();
  const onFirstKey = [];
  const mouse = { x: 0.5, y: 0.5, down: false };   // NDC (-1..1)；down=左键

  function keydown(e) {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!down.has(e.code)) {
      pressedOnce.add(e.code);
      if (down.size === 0) { onFirstKey.forEach((fn) => fn()); onFirstKey.length = 0; }
    }
    down.add(e.code);
  }
  function keyup(e) { down.delete(e.code); }
  function blur() { down.clear(); mouse.down = false; }
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

  target.addEventListener('keydown', keydown);
  target.addEventListener('keyup', keyup);
  target.addEventListener('blur', blur);
  window.addEventListener('mousemove', mousemove);
  window.addEventListener('mousedown', mousedown);
  window.addEventListener('mouseup', mouseup);
  window.addEventListener('contextmenu', contextmenu);

  return {
    getMove() {
      let x = 0, y = 0;
      if (down.has('KeyA') || down.has('ArrowLeft')) x -= 1;
      if (down.has('KeyD') || down.has('ArrowRight')) x += 1;
      if (down.has('KeyW') || down.has('ArrowUp')) y -= 1;
      if (down.has('KeyS') || down.has('ArrowDown')) y += 1;
      return { x, y };
    },
    mouse,
    get fire() { return mouse.down; },
    consumePress(code) {
      if (pressedOnce.has(code)) { pressedOnce.delete(code); return true; }
      return false;
    },
    held(code) { return down.has(code); },
    endFrame() { pressedOnce.clear(); },
    onFirstInteraction(fn) { onFirstKey.push(fn); },
  };
}
