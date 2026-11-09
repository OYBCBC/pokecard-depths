// 触屏输入回归（M6）：node --test tools/test-input.mjs
// 无 DOM：桩 window/document/location，直接喂 TouchEvent 形状的对象给 createInput。
import { test } from 'node:test';
import assert from 'node:assert/strict';

function classList() {
  const s = new Set();
  return {
    add: (c) => s.add(c), remove: (c) => s.delete(c),
    toggle: (c, on) => { if (on === undefined) on = !s.has(c); if (on) s.add(c); else s.delete(c); return on; },
    contains: (c) => s.has(c),
  };
}
function makeTarget() {
  const fns = {};
  return {
    addEventListener(type, fn) { (fns[type] = fns[type] || []).push(fn); },
    emit(type, ev) { (fns[type] || []).forEach((fn) => fn(ev)); },
  };
}
// 每个用例一套干净的全局桩（search 控制 ?touch=1，coarse 控制 matchMedia 结果）
function setup({ search = '', coarse = false, W = 800, H = 400 } = {}) {
  const win = makeTarget();
  win.innerWidth = W; win.innerHeight = H;
  win.matchMedia = () => ({ matches: coarse });
  const doc = makeTarget();
  doc.body = { classList: classList() };
  doc.hidden = false;
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.location = { search };
  // node 22 自带只读 navigator 全局：用 defineProperty 覆盖
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true, writable: true });
  return { win, doc };
}
const canvasEl = { closest: () => null };                // 画布：不是 UI
const buttonEl = { closest: (sel) => (sel.includes('button') ? buttonEl : null) };
function tev(target, touches) {
  let prevented = false;
  return {
    target, changedTouches: touches.map(([id, x, y]) => ({ identifier: id, clientX: x, clientY: y })),
    preventDefault() { prevented = true; }, get prevented() { return prevented; },
  };
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const { createInput, touchPreferred } = await import('../js/core/input.js?v=m7b');

test('左半屏拖动=移动：方向/幅度正确，超半径归一化', () => {
  const { win } = setup();
  const inp = createInput(win);
  win.emit('touchstart', tev(canvasEl, [[1, 100, 300]]));
  win.emit('touchmove', tev(canvasEl, [[1, 126, 300]]));   // 右 26px = 半径一半
  let m = inp.getMove();
  assert.ok(near(m.x, 0.5) && near(m.y, 0), `半推应为 0.5，得 ${JSON.stringify(m)}`);
  win.emit('touchmove', tev(canvasEl, [[1, 100, 200]]));   // 上 100px（超半径）
  m = inp.getMove();
  assert.ok(near(m.x, 0) && near(m.y, -1), `超半径应归一化为 (0,-1)，得 ${JSON.stringify(m)}`);
});

test('底座跟手：拖出半径后反向立即生效（不用拉回原点）', () => {
  const { win } = setup();
  const inp = createInput(win);
  win.emit('touchstart', tev(canvasEl, [[1, 100, 300]]));
  win.emit('touchmove', tev(canvasEl, [[1, 300, 300]]));   // 向右拖 200px，底座跟到 248
  win.emit('touchmove', tev(canvasEl, [[1, 190, 300]]));   // 回拉 110px（仍在原点右侧 90px：无跟手时这里还是"向右"）
  const m = inp.getMove();
  assert.ok(m.x < -0.9, `回拉应立刻变向左，得 ${JSON.stringify(m)}`);
});

test('死区：轻微抖动不算移动', () => {
  const { win } = setup();
  const inp = createInput(win);
  win.emit('touchstart', tev(canvasEl, [[1, 100, 300]]));
  win.emit('touchmove', tev(canvasEl, [[1, 104, 302]]));   // 约 0.086 < 0.14
  const m = inp.getMove();
  assert.equal(m.x, 0); assert.equal(m.y, 0);
});

test('右半屏拖动=瞄准射击；松手停火', () => {
  const { win } = setup();
  const inp = createInput(win);
  assert.equal(inp.touchAim(), null);
  win.emit('touchstart', tev(canvasEl, [[2, 600, 250]]));
  assert.equal(inp.touchAim(), null, '刚按下（未推过死区）不射击');
  win.emit('touchmove', tev(canvasEl, [[2, 600, 300]]));   // 向下（南）
  const a = inp.touchAim();
  assert.ok(a && near(a.y, 50 / 52) && near(a.x, 0), `应朝南，得 ${JSON.stringify(a)}`);
  win.emit('touchend', tev(canvasEl, [[2, 600, 300]]));
  assert.equal(inp.touchAim(), null);
});

test('双摇杆同时：两指各管一侧', () => {
  const { win } = setup();
  const inp = createInput(win);
  win.emit('touchstart', tev(canvasEl, [[1, 100, 300], [2, 600, 250]]));
  win.emit('touchmove', tev(canvasEl, [[1, 100, 352], [2, 652, 250]]));
  const m = inp.getMove(), a = inp.touchAim();
  assert.ok(near(m.y, 1) && near(a.x, 1), `移动朝南+瞄准朝东，得 ${JSON.stringify({ m, a })}`);
  const s = inp.sticks();
  assert.ok(s.l && s.r, 'sticks() 两侧都有');
});

test('两指落同侧：后到的接管空闲摇杆', () => {
  const { win } = setup();
  const inp = createInput(win);
  win.emit('touchstart', tev(canvasEl, [[1, 100, 300]]));
  win.emit('touchstart', tev(canvasEl, [[2, 380, 200]]));   // 也在左半屏（W/2=400），但右摇杆空闲
  win.emit('touchmove', tev(canvasEl, [[2, 380, 150]]));
  const a = inp.touchAim();
  assert.ok(a && a.y < -0.9, `第二指应成为瞄准摇杆，得 ${JSON.stringify(a)}`);
});

test('按钮/浮层上的触摸不进摇杆、不拦默认行为（合成 click 可用）', () => {
  const { win } = setup();
  const inp = createInput(win);
  const ev = tev(buttonEl, [[5, 700, 350]]);
  win.emit('touchstart', ev);
  assert.equal(ev.prevented, false, '按钮触摸不能 preventDefault（否则 click 不触发）');
  win.emit('touchmove', tev(buttonEl, [[5, 760, 350]]));
  assert.equal(inp.touchAim(), null);
  assert.equal(inp.sticks().r, null);
  const ev2 = tev(canvasEl, [[6, 700, 350]]);
  win.emit('touchstart', ev2);
  assert.equal(ev2.prevented, true, '画布触摸必须 preventDefault（防滚动/缩放/合成鼠标）');
});

test('触屏模式：触摸进入、外接键盘游戏键退出；?touch=1 强制不退出', () => {
  let s = setup();
  let modes = [];
  let inp = createInput(s.win);
  inp.onModeChange((on) => modes.push(on));
  assert.equal(inp.touchMode, false);
  s.win.emit('touchstart', tev(canvasEl, [[1, 100, 300]]));
  assert.equal(inp.touchMode, true);
  assert.ok(s.doc.body.classList.contains('touchmode'));
  s.win.emit('keydown', { code: 'KeyW', preventDefault() {} });
  assert.equal(inp.touchMode, false, '游戏键回键鼠 UI');
  assert.ok(!s.doc.body.classList.contains('touchmode'));
  assert.deepEqual(modes, [true, false]);
  s.win.emit('keydown', { code: 'KeyM', preventDefault() {} });   // 非游戏键不影响（已是键鼠）

  s = setup({ search: '?touch=1' });
  inp = createInput(s.win);
  assert.equal(inp.touchMode, true, '?touch=1 开机即触屏');
  s.win.emit('keydown', { code: 'KeyW', preventDefault() {} });
  assert.equal(inp.touchMode, true, '强制触屏不被键盘退出');
});

test('M7.1 检测兜底：媒体查询缺失/撒谎时，触屏硬件+UA 兜底', () => {
  // ① matchMedia 完全不支持（老内核），但 maxTouchPoints>0 且 UA 是安卓 → 触屏
  let s1 = setup({ coarse: false });
  s1.win.matchMedia = undefined;                       // 模拟不支持
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => [], maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-G991B)' },
    configurable: true, writable: true,
  });
  assert.equal(touchPreferred(), true, '安卓 UA 兜底');
  // ② iPhone 桌面模式：matchMedia 报 fine（撒谎），maxTouchPoints=5 → 硬件兜底
  let s2 = setup({ coarse: false });
  s2.win.matchMedia = (q) => ({ matches: q.includes('fine') });   // pointer:fine 撒谎为真
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => [], maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' },
    configurable: true, writable: true,
  });
  assert.equal(touchPreferred(), true, '触屏硬件+无精细指针兜底');
  // ③ 桌面 Chrome（无触屏）：全部不命中 → 键鼠
  let s3 = setup({ coarse: false });
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => [], maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0' },
    configurable: true, writable: true,
  });
  assert.equal(touchPreferred(), false, '桌面不误判');
  // ④ 触屏笔记本（maxTouchPoints>0 但有鼠标）：硬件兜底不命中（pointer:fine 为真），UA 不命中 → 键鼠
  let s4 = setup({ coarse: false });
  s4.win.matchMedia = (q) => ({ matches: q.includes('fine') });
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => [], maxTouchPoints: 10, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0' },
    configurable: true, writable: true,
  });
  assert.equal(touchPreferred(), false, '触屏笔记本不误判');
});

test('M7.1 首次触摸按钮也切触屏 UI（开机检测失败也能秒纠正）', () => {
  const { win, doc } = setup({ coarse: false });      // 检测失败的场景
  const inp = createInput(win);
  assert.equal(inp.touchMode, false);
  win.emit('touchstart', tev(buttonEl, [[1, 700, 350]]));   // 摸的是按钮（onUI 分支）
  assert.equal(inp.touchMode, true, '按钮上的触摸也要进触屏模式');
  assert.ok(doc.body.classList.contains('touchmode'));
});

test('开机识别：粗指针无悬停设备直接进触屏 UI', () => {
  setup({ coarse: true });
  assert.equal(touchPreferred(), true);
  const s = setup({ coarse: true });
  const inp = createInput(s.win);
  assert.equal(inp.touchMode, true);
  assert.ok(s.doc.body.classList.contains('touchmode'));
  setup({ coarse: false });
  assert.equal(touchPreferred(), false);
});

test('pressButton 边沿：consumePress 只生效一次；endFrame 清空', () => {
  const { win } = setup();
  const inp = createInput(win);
  inp.pressButton('Space');
  assert.equal(inp.consumePress('Space'), true);
  assert.equal(inp.consumePress('Space'), false);
  inp.pressButton('KeyQ');
  inp.endFrame();
  assert.equal(inp.consumePress('KeyQ'), false);
});

test('切后台（visibilitychange hidden）清空触点，防"幽灵摇杆"', () => {
  const { win, doc } = setup();
  const inp = createInput(win);
  win.emit('touchstart', tev(canvasEl, [[1, 100, 300]]));
  win.emit('touchmove', tev(canvasEl, [[1, 100, 352]]));
  assert.ok(inp.getMove().y > 0.9);
  doc.hidden = true;
  doc.emit('visibilitychange', {});
  const m = inp.getMove();
  assert.equal(m.y, 0, '后台回来不应继续走');
});

test('首次交互回调：触摸画布触发一次（音频解锁链路）', () => {
  const { win } = setup();
  const inp = createInput(win);
  let n = 0;
  inp.onFirstInteraction(() => n++);
  win.emit('touchstart', tev(canvasEl, [[1, 100, 300]]));
  win.emit('touchend', tev(canvasEl, [[1, 100, 300]]));
  win.emit('touchstart', tev(canvasEl, [[2, 100, 300]]));
  assert.equal(n, 1);
});
