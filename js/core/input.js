// 输入层 M1：键盘（WASD + 方向键）。M4 在此扩展手柄与触屏摇杆，接口不变。
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Tab',
]);

export function createInput(target = window) {
  const down = new Set();
  const pressedOnce = new Set();   // 本帧“按下沿”（调试键等一次性动作用）
  const onFirstKey = [];           // 首次交互回调（解锁 AudioContext 用）

  function keydown(e) {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!down.has(e.code)) {
      pressedOnce.add(e.code);
      if (down.size === 0) { onFirstKey.forEach(fn => fn()); onFirstKey.length = 0; }
    }
    down.add(e.code);
  }
  function keyup(e) { down.delete(e.code); }
  function blur() { down.clear(); }

  target.addEventListener('keydown', keydown);
  target.addEventListener('keyup', keyup);
  target.addEventListener('blur', blur);

  return {
    getMove() {
      let x = 0, y = 0;
      if (down.has('KeyA') || down.has('ArrowLeft')) x -= 1;
      if (down.has('KeyD') || down.has('ArrowRight')) x += 1;
      if (down.has('KeyW') || down.has('ArrowUp')) y -= 1;
      if (down.has('KeyS') || down.has('ArrowDown')) y += 1;
      return { x, y };
    },
    consumePress(code) {
      if (pressedOnce.has(code)) { pressedOnce.delete(code); return true; }
      return false;
    },
    endFrame() { pressedOnce.clear(); },
    onFirstInteraction(fn) { onFirstKey.push(fn); },
  };
}
