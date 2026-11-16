// 触屏输入回归（M6→M9 固定双摇杆）：node --test tools/test-input.mjs
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

const { createInput, touchPreferred } = await import('../js/core/input.js?v=m9');

// M9 固定双摇杆：测试统一注入布局（左=移动 (100,300)，右=攻击 (600,250)，半径 52）
const LAYOUT = { l: { x: 100, y: 300, r: 52 }, r: { x: 600, y: 250, r: 52 } };
function mk(win) {
  const inp = createInput(win);
  inp.setStickLayout(LAYOUT);
  return inp;
}

test('移动摇杆：方向/幅度正确，超半径归一化', () => {
  const { win } = setup();
  const inp = mk(win);
  win.emit('touchstart', tev(canvasEl, [[1, 100, 300]]));
  win.emit('touchmove', tev(canvasEl, [[1, 126, 300]]));   // 右 26px = 半径一半
  let m = inp.getMove();
  assert.ok(near(m.x, 0.5) && near(m.y, 0), `半推应为 0.5，得 ${JSON.stringify(m)}`);
  win.emit('touchmove', tev(canvasEl, [[1, 100, 200]]));   // 上 100px（超半径）
  m = inp.getMove();
  assert.ok(near(m.x, 0) && near(m.y, -1), `超半径应归一化为 (0,-1)，得 ${JSON.stringify(m)}`);
});

test('底座固定：拖出半径再回拉，方向始终以固定圆心为准（不跟手）', () => {
  const { win } = setup();
  const inp = mk(win);
  win.emit('touchstart', tev(canvasEl, [[1, 100, 300]]));
  win.emit('touchmove', tev(canvasEl, [[1, 300, 300]]));   // 向右拖 200px（浮动版底座会跟到 248）
  win.emit('touchmove', tev(canvasEl, [[1, 190, 300]]));   // 回拉到圆心右侧 90px：固定底座下仍是"向右推满"
  const m = inp.getMove();
  assert.ok(near(m.x, 1) && near(m.y, 0), `应仍向右推满，得 ${JSON.stringify(m)}`);
  const s = inp.sticks();
  assert.ok(near(s.l.kx, 1), `摇杆头贴边，得 ${JSON.stringify(s.l)}`);
  assert.equal(s.l.ox, undefined, 'sticks() 不再回传底座坐标（底座由 HUD 布局决定）');
});

test('死区：轻微抖动不算移动', () => {
  const { win } = setup();
  const inp = mk(win);
  win.emit('touchstart', tev(canvasEl, [[1, 100, 300]]));
  win.emit('touchmove', tev(canvasEl, [[1, 104, 302]]));   // 约 0.086 < 0.14
  const m = inp.getMove();
  assert.equal(m.x, 0); assert.equal(m.y, 0);
});

test('攻击摇杆：推过死区=瞄准射击；按住未推=touchHeld；松手停火', () => {
  const { win } = setup();
  const inp = mk(win);
  assert.equal(inp.touchAim(), null);
  win.emit('touchstart', tev(canvasEl, [[2, 600, 250]]));
  assert.equal(inp.touchAim(), null, '刚按下（未推过死区）没有方向');
  assert.equal(inp.touchHeld('r'), true, '但算按住（main 据此自动瞄准开火）');
  assert.equal(inp.touchHeld('l'), false);
  win.emit('touchmove', tev(canvasEl, [[2, 600, 300]]));   // 向下（南）
  const a = inp.touchAim();
  assert.ok(a && near(a.y, 50 / 52) && near(a.x, 0), `应朝南，得 ${JSON.stringify(a)}`);
  win.emit('touchend', tev(canvasEl, [[2, 600, 300]]));
  assert.equal(inp.touchAim(), null);
  assert.equal(inp.touchHeld('r'), false);
});

test('双摇杆同时：两指各管一根', () => {
  const { win } = setup();
  const inp = mk(win);
  win.emit('touchstart', tev(canvasEl, [[1, 100, 300], [2, 600, 250]]));
  win.emit('touchmove', tev(canvasEl, [[1, 100, 352], [2, 652, 250]]));
  const m = inp.getMove(), a = inp.touchAim();
  assert.ok(near(m.y, 1) && near(a.x, 1), `移动朝南+瞄准朝东，得 ${JSON.stringify({ m, a })}`);
  const s = inp.sticks();
  assert.ok(s.l && s.r, 'sticks() 两侧都有');
});

test('接管范围：1.8R 内接管（按偏也算），远处触摸忽略，已占用的摇杆不被第二指抢', () => {
  const { win } = setup();
  const inp = mk(win);
  win.emit('touchstart', tev(canvasEl, [[1, 100 + 52 * 1.7, 300]]));   // 底座外但在 1.8R 内
  assert.equal(inp.touchHeld('l'), true, '1.7R 处按下应接管移动摇杆');
  assert.ok(near(inp.getMove().x, 1), '按在右侧边外=向右推满');
  win.emit('touchstart', tev(canvasEl, [[2, 350, 100]]));               // 离两根都远
  assert.equal(inp.touchHeld('r'), false, '远处触摸不接管攻击摇杆');
  win.emit('touchstart', tev(canvasEl, [[3, 110, 300]]));               // 落在已占用的移动摇杆上
  assert.equal(inp.touchHeld('r'), false, '第二指不跨区抢攻击摇杆');
  win.emit('touchend', tev(canvasEl, [[1, 0, 0]]));
  assert.equal(inp.touchHeld('l'), false, '第三指没登记：首指抬起后移动摇杆空闲');
  win.emit('touchstart', tev(canvasEl, [[4, 100 + 52 * 1.9, 300]]));   // 1.9R：超出接管半径
  assert.equal(inp.touchHeld('l'), false, '1.9R 外不接管');
});

test('未注入布局时按窗口尺寸兜底（靶场页/HUD 未量到时仍可用）', () => {
  const { win } = setup({ W: 800, H: 400 });
  const inp = createInput(win);
  const L = inp.stickLayout;
  assert.equal(L.l.x, 118); assert.equal(L.l.y, 292);
  win.emit('touchstart', tev(canvasEl, [[1, 118, 292]]));
  win.emit('touchmove', tev(canvasEl, [[1, 144, 292]]));
  assert.ok(near(inp.getMove().x, 0.5));
  inp.setStickLayout(LAYOUT);
  assert.equal(inp.stickLayout.l.x, 100, '注入后以注入布局为准');
});

test('按钮/浮层上的触摸不进摇杆、不拦默认行为（合成 click 可用）', () => {
  const { win } = setup();
  const inp = mk(win);
  const ev = tev(buttonEl, [[5, 600, 250]]);             // 即便按钮压在攻击摇杆圆心上
  win.emit('touchstart', ev);
  assert.equal(ev.prevented, false, '按钮触摸不能 preventDefault（否则 click 不触发）');
  win.emit('touchmove', tev(buttonEl, [[5, 640, 250]]));
  assert.equal(inp.touchAim(), null);
  assert.equal(inp.sticks().r, null);
  const ev2 = tev(canvasEl, [[6, 700, 350]]);
  win.emit('touchstart', ev2);
  assert.equal(ev2.prevented, true, '画布触摸必须 preventDefault（防滚动/缩放/合成鼠标），没接管摇杆也一样');
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
  const inp = mk(win);
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
