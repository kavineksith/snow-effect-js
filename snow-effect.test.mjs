import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import SnowEffect from './snow-effect.mjs';

const W = 800;
const H = 600;

function makeCtx() {
  const noop = () => {};
  return new Proxy({}, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true) });
}

function setupDom() {
  const body = {
    style: {},
    appendChild(c) { c.parentNode = body; },
    removeChild(c) { c.parentNode = null; }
  };
  globalThis.document = {
    body,
    documentElement: { clientWidth: W, clientHeight: H },
    createElement: () => ({
      style: {}, width: 0, height: 0, parentNode: null,
      getContext: () => makeCtx(),
      setAttribute() {}
    })
  };
  globalThis.window = globalThis;
  globalThis.innerWidth = W;
  globalThis.innerHeight = H;
  globalThis.devicePixelRatio = 1;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  let id = 0;
  globalThis.requestAnimationFrame = () => ++id;
  globalThis.cancelAnimationFrame = () => {};
  return body;
}

function make(options = {}) {
  setupDom();
  return new SnowEffect({ enableSnow: true, particleCount: 20, ...options }).init();
}

function place(snow, x = 400, y = 300) {
  snow._x.fill(x);
  snow._y.fill(y);
}

test('does nothing when disabled', () => {
  setupDom();
  const snow = new SnowEffect({ enableSnow: false }).init();
  assert.equal(snow.canvas, null);
  assert.equal(snow.isRunning, false);
});

test('init creates a canvas and destroy removes it', () => {
  const snow = make({ particleCount: 50 });
  assert.ok(snow.canvas);
  assert.equal(snow.canvas.parentNode, document.body);
  assert.equal(snow.count, 50);
  assert.equal(snow.isRunning, true);
  snow.destroy();
  assert.equal(snow.canvas, null);
  assert.equal(snow.isRunning, false);
});

test('classic flow moves flakes downward', () => {
  const snow = make();
  place(snow);
  snow._step(1);
  for (let i = 0; i < snow.count; i++) {
    assert.ok(snow._y[i] > 300, 'y should increase');
    assert.ok(Math.abs(snow._x[i] - 400) < 0.1, 'x drift should be tiny');
  }
});

const directions = [
  ['down', 0, 1],
  ['top-to-bottom', 0, 1],
  ['up', 0, -1],
  ['bottom-to-top', 0, -1],
  ['left', -1, 0],
  ['right', 1, 0],
  ['down-left', -1, 1],
  ['down-right', 1, 1],
  ['up-left', -1, -1],
  ['up-right', 1, -1],
  [45, 1, 1]
];

for (const [dir, sx, sy] of directions) {
  test(`direction "${dir}" moves the right way`, () => {
    const snow = make({ direction: dir });
    place(snow);
    snow._step(1);
    for (let i = 0; i < snow.count; i++) {
      const dx = snow._x[i] - 400;
      const dy = snow._y[i] - 300;
      if (sx === 0) assert.ok(Math.abs(dx) < 0.1, `dx ${dx}`);
      else assert.ok(Math.sign(dx) === sx, `dx ${dx}`);
      if (sy === 0) assert.ok(Math.abs(dy) < 0.1, `dy ${dy}`);
      else assert.ok(Math.sign(dy) === sy, `dy ${dy}`);
    }
  });
}

test('flakes re-enter from the trailing edge', () => {
  const snow = make({ direction: 'up' });
  const m = snow._cfg.margin;
  place(snow, 400, -100);
  snow._step(1);
  for (let i = 0; i < snow.count; i++) assert.equal(snow._y[i], H + m);

  const right = make({ direction: 'right' });
  place(right, W + 100, 300);
  right._step(1);
  for (let i = 0; i < right.count; i++) assert.equal(right._x[i], -right._cfg.margin);
});

test('flakes stay inside the bounds over a long run', () => {
  for (const direction of ['classic', 'down', 'left', 'up-right']) {
    const snow = make({ direction, particleCount: 200 });
    const m = snow._cfg.margin;
    for (let f = 0; f < 600; f++) snow._step(1);
    for (let i = 0; i < snow.count; i++) {
      assert.ok(snow._x[i] >= -m - 5 && snow._x[i] <= W + m + 5, `${direction} x ${snow._x[i]}`);
      assert.ok(snow._y[i] >= -m - 5 && snow._y[i] <= H + m + 5, `${direction} y ${snow._y[i]}`);
    }
  }
});

test('symbols / emoji build one sprite per symbol and size step', () => {
  const snow = make({ symbols: ['❄', '🎄', '🎁'], size: [10, 20], sizeSteps: 4 });
  assert.equal(snow._sprites.length, 3 * 4);
  for (const s of snow._sprites) assert.ok(s.w >= 10 && s.w <= 20 + 1);
});

test('default particles are small circles; art defaults to larger sizes', () => {
  const dots = make();
  assert.deepEqual([dots._cfg.min, dots._cfg.max], [2, 8]);
  const art = make({ symbols: ['❄'] });
  assert.deepEqual([art._cfg.min, art._cfg.max], [12, 24]);
});

test('maxFps caps the update rate', () => {
  const snow = make({ maxFps: 30 });
  const calls = [];
  snow._step = (k) => calls.push(k);
  snow._last = 1000;
  snow._loop(1010); // 10ms  -> skipped
  assert.equal(calls.length, 0);
  snow._loop(1034); // 34ms  -> runs
  assert.equal(calls.length, 1);
  assert.ok(Math.abs(calls[0] - 34 / (1000 / 60)) < 1e-9);
});

test('long gaps are clamped so flakes never teleport', () => {
  const snow = make({ maxFps: 0 });
  const calls = [];
  snow._step = (k) => calls.push(k);
  snow._last = 0;
  snow._loop(60000);
  assert.ok(calls[0] <= 50 / (1000 / 60) + 1e-9);
});

test('setOptions updates particle count, direction and theme', () => {
  const snow = make({ particleCount: 20 });
  snow.setOptions({ particleCount: 10 });
  assert.equal(snow.count, 10);
  snow.setDirection('left');
  assert.equal(snow._cfg.ux, -1);
  snow.setTheme(false);
  assert.equal(snow._items[0].color, 'rgb(148, 163, 184)');
});

test('rotation allocates rotation state only when enabled', () => {
  assert.equal(make()._rot, null);
  const spin = make({ rotation: true });
  assert.ok(spin._rot instanceof Float32Array);
  assert.doesNotThrow(() => spin._render());
});

test('UMD build exposes the same class (CJS + global)', () => {
  const require = createRequire(import.meta.url);
  const Umd = require('./snow-effect.js');
  assert.equal(typeof Umd, 'function');
  assert.equal(Umd.default, Umd);
  setupDom();
  const snow = new Umd({ enableSnow: true }).init();
  assert.ok(snow.canvas);
  assert.equal(globalThis.SnowEffect, Umd);
  snow.destroy();
});
