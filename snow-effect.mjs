/**
 * SnowEffect - A lightweight, low-resource canvas particle library
 * @version 2.0.0
 * @license MIT
 *
 * Design goals: tiny CPU / RAM / GPU footprint.
 *  - particles live in typed arrays (zero per-frame allocation, no GC churn)
 *  - every flake is a pre-rendered sprite blitted with drawImage (no per-frame
 *    path building or fillText)
 *  - time-based motion with an optional FPS cap
 *  - no work at all while stopped / destroyed
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const FRAME_MS = 1000 / 60;
const MAX_DT_MS = 50; // clamp long gaps (tab restore, debugger pause)

const SNOW_ON_DARK = '#ffffff';
const SNOW_ON_LIGHT = 'rgb(148, 163, 184)';
const DEFAULT_FONT =
  'system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

// Angles are in screen space: 0 = right, 90 = down, 180 = left, 270 = up.
const DIRECTIONS = {
  right: 0,
  'down-right': 45,
  down: 90,
  'down-left': 135,
  left: 180,
  'up-left': 225,
  up: 270,
  'up-right': 315,
  'left-to-right': 0,
  'top-to-bottom': 90,
  'right-to-left': 180,
  'bottom-to-top': 270
};

const hasDOM = () => typeof window !== 'undefined' && typeof document !== 'undefined';
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const asList = (v) => (v == null ? [] : [].concat(v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function resolveDirection(input) {
  const classic = { classic: true, ux: 0, uy: 1 };
  if (input == null) return classic;

  let deg;
  if (typeof input === 'number' && isFinite(input)) {
    deg = input;
  } else if (typeof input === 'string') {
    const key = input.trim().toLowerCase();
    if (key === 'classic') return classic;
    if (Object.prototype.hasOwnProperty.call(DIRECTIONS, key)) deg = DIRECTIONS[key];
  }

  if (deg === undefined) {
    console.warn('[SnowEffect] Unknown direction "' + input + '", using "classic".');
    return classic;
  }

  const clean = (v) => (Math.abs(v) < 1e-9 ? 0 : v);
  return { classic: false, ux: clean(Math.cos(deg * DEG)), uy: clean(Math.sin(deg * DEG)) };
}

function toRange(size, fallback) {
  if (typeof size === 'number' && isFinite(size) && size > 0) return [size, size];
  if (Array.isArray(size) && size.length >= 2) {
    const a = num(size[0], NaN);
    const b = num(size[1], NaN);
    if (a > 0 && b > 0) return a <= b ? [a, b] : [b, a];
  }
  return fallback;
}

class SnowEffect {
  /**
   * @param {object} [options]
   * Original options (unchanged behaviour):
   * @param {boolean} [options.isDark=true]        white snow (true) or slate snow (false)
   * @param {number}  [options.particleCount=100]
   * @param {boolean} [options.enableSnow]         default: December only
   * @param {HTMLElement} [options.container]      default: document.body
   * @param {number}  [options.zIndex=9999]
   *
   * Opt-in customisation (all optional):
   * @param {string|number} [options.direction='classic']
   * @param {number} [options.speed=1]
   * @param {number} [options.sway=0.5]
   * @param {number|number[]} [options.size]       diameter in px, or [min, max]
   * @param {string|string[]} [options.shape='circle']
   * @param {string|string[]} [options.symbols]    text / emoji particles
   * @param {Array} [options.images]               image URLs / elements / canvases
   * @param {string|string[]} [options.color]
   * @param {number} [options.opacity]
   * @param {boolean|number} [options.rotation=false]
   * @param {number} [options.maxFps=60]           0 = uncapped
   * @param {number|'auto'} [options.pixelRatio=1]
   * @param {number} [options.sizeSteps=6]
   * @param {string} [options.fontFamily]
   * @param {boolean} [options.respectReducedMotion=true]
   */
  constructor(options = {}) {
    const o = options || {};

    this.options = {
      // --- original options -------------------------------------------------
      isDark: o.isDark !== undefined ? o.isDark : true,
      particleCount: o.particleCount || 100,
      enableSnow: o.enableSnow !== undefined ? o.enableSnow : new Date().getMonth() === 11,
      container: o.container || (hasDOM() ? document.body : null),
      zIndex: o.zIndex || 9999,
      // --- opt-in customisation --------------------------------------------
      direction: o.direction !== undefined ? o.direction : 'classic',
      speed: o.speed !== undefined ? o.speed : 1,
      sway: o.sway !== undefined ? o.sway : 0.5,
      size: o.size,
      shape: o.shape || 'circle',
      symbols: o.symbols,
      images: o.images,
      color: o.color,
      opacity: o.opacity,
      rotation: o.rotation || false,
      maxFps: o.maxFps !== undefined ? o.maxFps : 60,
      pixelRatio: o.pixelRatio !== undefined ? o.pixelRatio : 1,
      sizeSteps: o.sizeSteps !== undefined ? o.sizeSteps : 6,
      fontFamily: o.fontFamily || DEFAULT_FONT,
      respectReducedMotion: o.respectReducedMotion !== undefined ? o.respectReducedMotion : true
    };

    this.canvas = null;
    this.ctx = null;
    this.animationFrameId = null;
    this.angle = 0;
    this.width = 0;
    this.height = 0;
    this.isRunning = false;
    this.count = 0;

    this._cfg = null;
    this._items = [];
    this._sprites = [];
    this._imgs = {};
    this._dpr = 0;
    this._last = 0;
    this._full = true;
    this._resizeRaf = 0;
    this._ro = null;
    this._restorePosition = false;
    this._x = this._y = this._v = this._d = this._sp = this._rot = this._vr = null;

    this._configure();

    this._loop = (now) => {
      if (!this.isRunning) return;
      this.animationFrameId = requestAnimationFrame(this._loop);

      let dt = now - this._last;
      if (dt <= 0 || dt < this._cfg.minFrame - 1) return; // FPS cap
      this._last = now;
      if (dt > MAX_DT_MS) dt = MAX_DT_MS;

      this._step(dt / FRAME_MS);
      this._render();
    };

    this._onResize = () => {
      if (this._resizeRaf) return;
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = 0;
        this._resize();
      });
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Initialize and start the snow effect
   */
  init() {
    if (!hasDOM() || this.canvas || !this.options.enableSnow) return this;

    const container = this.options.container || document.body;
    if (!container) {
      console.error('[SnowEffect] No container available (is document.body ready?)');
      return this;
    }
    this.options.container = container;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Failed to get canvas context');
      return this;
    }

    this._full = container === document.body || container === document.documentElement;

    const s = canvas.style;
    s.position = this._full ? 'fixed' : 'absolute';
    s.top = '0';
    s.left = '0';
    s.width = '100%';
    s.height = '100%';
    s.pointerEvents = 'none';
    s.zIndex = this.options.zIndex;
    canvas.setAttribute('aria-hidden', 'true');

    if (!this._full && typeof getComputedStyle === 'function' &&
        getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
      this._restorePosition = true;
    }

    this.canvas = canvas;
    this.ctx = ctx;
    container.appendChild(canvas);

    this._dpr = 0;
    this._resize(true);
    this._initParticles();

    window.addEventListener('resize', this._onResize);
    if (!this._full && typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(container);
    }

    const reduce =
      this.options.respectReducedMotion &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      this._render(); // still frame, no animation
    } else {
      this.start();
    }
    return this;
  }

  /**
   * Start the animation
   */
  start() {
    if (this.isRunning || !this.canvas) return this;
    this.isRunning = true;
    this._last = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.animationFrameId = requestAnimationFrame(this._loop);
    return this;
  }

  /**
   * Stop the animation (the canvas keeps the last frame)
   */
  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    return this;
  }

  /**
   * Update theme (dark/light mode)
   */
  setTheme(isDark) {
    this.options.isDark = isDark;
    if (this.canvas) {
      this._buildSprites();
      if (!this.isRunning) this._render();
    }
    return this;
  }

  /**
   * Change the direction at runtime (see `direction` option)
   */
  setDirection(direction) {
    return this.setOptions({ direction });
  }

  /**
   * Change options at runtime. `container` cannot be changed (destroy + recreate).
   */
  setOptions(partial = {}) {
    for (const k in partial) {
      if (partial[k] !== undefined && k !== 'container') this.options[k] = partial[k];
    }

    if ('enableSnow' in partial) {
      if (this.options.enableSnow && !this.canvas) return this.init();
      if (!this.options.enableSnow && this.canvas) {
        this.destroy();
        return this;
      }
    }
    if (!this.canvas) {
      this._configure();
      return this;
    }

    this._configure();
    this.canvas.style.zIndex = this.options.zIndex;

    const has = (...keys) => keys.some((k) => k in partial);
    const dprChanged = has('pixelRatio') && this._resolveDpr() !== this._dpr;

    if (dprChanged) this._resize(true); // rebuilds sprites
    else if (has('isDark', 'color', 'shape', 'symbols', 'images', 'size', 'sizeSteps', 'fontFamily')) {
      this._buildSprites();
    }
    if (has('particleCount', 'symbols', 'images', 'shape', 'color', 'size', 'sizeSteps', 'rotation')) {
      this._initParticles();
    }
    if (!this.isRunning) this._render();
    return this;
  }

  /**
   * Rebuild sprites, e.g. after a custom web font has finished loading
   */
  refresh() {
    if (this.canvas) {
      this._buildSprites();
      if (!this.isRunning) this._render();
    }
    return this;
  }

  /**
   * Clean up and remove the effect
   */
  destroy() {
    this.stop();

    if (typeof window !== 'undefined') window.removeEventListener('resize', this._onResize);
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    if (this._resizeRaf && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._resizeRaf);
      this._resizeRaf = 0;
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    if (this._restorePosition && this.options.container) {
      this.options.container.style.position = '';
      this._restorePosition = false;
    }

    this.canvas = null;
    this.ctx = null;
    this._sprites = [];
    this._items = [];
    this._imgs = {};
    this._x = this._y = this._v = this._d = this._sp = this._rot = this._vr = null;
    this.count = 0;
    this.width = this.height = 0;
    this._dpr = 0;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  _configure() {
    const o = this.options;
    const dir = resolveDirection(o.direction);
    const hasArt = asList(o.symbols).length > 0 || asList(o.images).length > 0;
    const range = toRange(o.size, hasArt ? [12, 24] : [2, 8]);
    const steps = range[0] === range[1] ? 1 : clamp(Math.floor(num(o.sizeSteps, 6)), 1, 12);
    const maxFps = num(o.maxFps, 60);

    this._cfg = {
      classic: dir.classic,
      ux: dir.ux,
      uy: dir.uy,
      min: range[0],
      max: range[1],
      steps,
      margin: Math.max(10, Math.ceil(range[1] / 2) + 2),
      minFrame: maxFps > 0 ? 1000 / maxFps : 0,
      alpha: clamp(num(o.opacity, hasArt ? 1 : 0.8), 0, 1),
      speed: Math.max(0, num(o.speed, 1)),
      sway: num(o.sway, 0.5),
      rotate: !!o.rotation,
      spin: typeof o.rotation === 'number' ? o.rotation : 1
    };
  }

  _resolveDpr() {
    const pr = this.options.pixelRatio;
    const raw = pr === 'auto' ? Math.min(window.devicePixelRatio || 1, 2) : num(pr, 1);
    return clamp(raw, 0.25, 4);
  }

  _resize(force) {
    if (!this.canvas) return;
    const container = this.options.container;
    const w = this._full
      ? document.documentElement.clientWidth || window.innerWidth
      : container.clientWidth;
    const h = this._full ? window.innerHeight : container.clientHeight;
    const dpr = this._resolveDpr();

    if (!force && w === this.width && h === this.height && dpr === this._dpr) return;

    const ow = this.width;
    const oh = this.height;
    const dprChanged = dpr !== this._dpr;

    this.width = w;
    this.height = h;
    this._dpr = dpr;

    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (ow && oh && this._x) {
      const fx = w / ow;
      const fy = h / oh;
      for (let i = 0; i < this.count; i++) {
        this._x[i] *= fx;
        this._y[i] *= fy;
      }
    }

    if (dprChanged || !this._sprites.length) this._buildSprites();
    if (!this.isRunning) this._render();
  }

  _makeItems() {
    const o = this.options;
    const colors = o.color ? asList(o.color) : [o.isDark ? SNOW_ON_DARK : SNOW_ON_LIGHT];
    const items = [];

    asList(o.images).forEach((src) => items.push({ type: 'image', src }));
    asList(o.symbols).forEach((text) => items.push({ type: 'text', text: String(text) }));

    if (!items.length) {
      let shapes = asList(o.shape || 'circle');
      if (shapes.length === 1 && colors.length > 1) shapes = colors.map(() => shapes[0]);
      shapes.forEach((shape) => items.push({ type: 'shape', shape }));
    }
    items.forEach((it, i) => {
      it.color = colors[i % colors.length];
    });
    return items;
  }

  _buildSprites() {
    const { min, max, steps } = this._cfg;
    this._items = this._makeItems();

    const sprites = [];
    for (let i = 0; i < this._items.length; i++) {
      for (let b = 0; b < steps; b++) {
        const size = min + ((b + 0.5) / steps) * (max - min);
        sprites.push(this._makeSprite(this._items[i], size));
      }
    }
    this._sprites = sprites;
  }

  _getImage(src) {
    let img = src;
    if (typeof src === 'string') {
      img = this._imgs[src];
      if (!img) {
        img = new Image();
        img.onerror = () => console.warn('[SnowEffect] Could not load image: ' + src);
        img.src = src;
        this._imgs[src] = img;
      }
    }
    if (!img) return null;
    if (img.complete === false || img.naturalWidth === 0) {
      if (img.addEventListener && !img._snowWatch) {
        img._snowWatch = true;
        img.addEventListener('load', () => this.refresh(), { once: true });
      }
      return null;
    }
    return img;
  }

  _makeSprite(item, sizeCss) {
    const dpr = this._dpr || 1;
    const px = Math.max(1, Math.ceil(sizeCss * dpr));
    const half = px / 2;
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    g.fillStyle = item.color;

    if (item.type === 'shape') {
      g.beginPath();
      if (item.shape === 'square') {
        g.rect(0, 0, px, px);
      } else if (item.shape === 'diamond') {
        g.moveTo(half, 0);
        g.lineTo(px, half);
        g.lineTo(half, px);
        g.lineTo(0, half);
        g.closePath();
      } else if (item.shape === 'star') {
        for (let k = 0; k < 10; k++) {
          const rad = k % 2 === 0 ? half : half * 0.45;
          const a = -Math.PI / 2 + (k * Math.PI) / 5;
          const x = half + Math.cos(a) * rad;
          const y = half + Math.sin(a) * rad;
          if (k) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.closePath();
      } else {
        g.arc(half, half, half, 0, TAU);
      }
      g.fill();
    } else if (item.type === 'text') {
      g.font = Math.max(1, Math.round(px * 0.8)) + 'px ' + this.options.fontFamily;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(item.text, half, half + px * 0.04);
    } else {
      const img = this._getImage(item.src);
      if (!img) return null;
      const iw = img.naturalWidth || img.videoWidth || img.width;
      const ih = img.naturalHeight || img.videoHeight || img.height;
      if (!iw || !ih) return null;
      const scale = Math.min(px / iw, px / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      g.drawImage(img, (px - dw) / 2, (px - dh) / 2, dw, dh);
    }

    const w = px / dpr;
    return { c, w, h: w / 2 };
  }

  _initParticles() {
    const n = this.options.particleCount | 0;
    const { steps, rotate, spin } = this._cfg;
    const items = Math.max(1, this._items.length);

    this.count = n;
    this._x = new Float32Array(n);
    this._y = new Float32Array(n);
    this._v = new Float32Array(n); // speed class 1..4 (bigger = faster, like the original radius)
    this._d = new Float32Array(n); // phase
    this._sp = new Uint16Array(n); // sprite index
    this._rot = rotate ? new Float32Array(n) : null;
    this._vr = rotate ? new Float32Array(n) : null;

    for (let i = 0; i < n; i++) {
      const t = Math.random();
      this._x[i] = Math.random() * this.width;
      this._y[i] = Math.random() * this.height;
      this._v[i] = 1 + 3 * t;
      this._d[i] = Math.random() * TAU;
      this._sp[i] = ((Math.random() * items) | 0) * steps + Math.min(steps - 1, (t * steps) | 0);
      if (rotate) {
        this._rot[i] = Math.random() * TAU;
        this._vr[i] = (Math.random() - 0.5) * 0.08 * spin;
      }
    }
  }

  /**
   * Advance the simulation. `k` = elapsed time in 60fps-frame units.
   */
  _step(k) {
    const n = this.count;
    if (!n || !this._x) return;

    const cfg = this._cfg;
    const w = this.width;
    const h = this.height;
    const m = cfg.margin;
    const x = this._x;
    const y = this._y;
    const v = this._v;
    const d = this._d;

    this.angle += 0.01 * k;
    const a = this.angle;
    const sinA = Math.sin(a);
    const sp = cfg.speed * k;
    const across = sinA * cfg.sway * sp;

    if (cfg.classic) {
      // Original flow: fall straight down, sway sideways, 2/3 respawn on top, 1/3 from the sides.
      for (let i = 0; i < n; i++) {
        y[i] += (Math.cos(a + d[i]) + 1 + v[i] * 0.5) * sp;
        x[i] += across;

        if (x[i] > w + m || x[i] < -m || y[i] > h) {
          if (i % 3 > 0) {
            x[i] = Math.random() * w;
            y[i] = -m;
          } else {
            y[i] = Math.random() * h;
            x[i] = sinA > 0 ? -m : w + m;
          }
        }
      }
    } else {
      const ux = cfg.ux;
      const uy = cfg.uy;
      const px = -uy; // perpendicular (sway axis)
      const py = ux;
      const ax = Math.abs(ux);
      const ay = Math.abs(uy);
      const pHorizontalEdge = (ay * w) / (ay * w + ax * h); // chance to re-enter via top/bottom edge

      for (let i = 0; i < n; i++) {
        const along = (Math.cos(a + d[i]) + 1 + v[i] * 0.5) * sp;
        x[i] += ux * along + px * across;
        y[i] += uy * along + py * across;

        if (x[i] > w + m || x[i] < -m || y[i] > h + m || y[i] < -m) {
          if (Math.random() < pHorizontalEdge) {
            x[i] = Math.random() * w;
            y[i] = uy > 0 ? -m : h + m;
          } else {
            y[i] = Math.random() * h;
            x[i] = ux > 0 ? -m : w + m;
          }
        }
      }
    }

    if (cfg.rotate) {
      const rot = this._rot;
      const vr = this._vr;
      for (let i = 0; i < n; i++) rot[i] += vr[i] * k;
    }
  }

  _render() {
    const ctx = this.ctx;
    if (!ctx || !this._x) return;

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.globalAlpha = this._cfg.alpha;

    const n = this.count;
    const x = this._x;
    const y = this._y;
    const spr = this._sp;
    const sprites = this._sprites;

    if (!this._cfg.rotate) {
      for (let i = 0; i < n; i++) {
        const s = sprites[spr[i]];
        if (s) ctx.drawImage(s.c, x[i] - s.h, y[i] - s.h, s.w, s.w);
      }
    } else {
      const dpr = this._dpr;
      const rot = this._rot;
      for (let i = 0; i < n; i++) {
        const s = sprites[spr[i]];
        if (!s) continue;
        const cos = Math.cos(rot[i]) * dpr;
        const sin = Math.sin(rot[i]) * dpr;
        ctx.setTransform(cos, sin, -sin, cos, x[i] * dpr, y[i] * dpr);
        ctx.drawImage(s.c, -s.h, -s.h, s.w, s.w);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }
}

export { SnowEffect as default, SnowEffect };
