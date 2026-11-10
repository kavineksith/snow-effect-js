export type SnowDirection =
  | 'classic'
  | 'down' | 'up' | 'left' | 'right'
  | 'down-left' | 'down-right' | 'up-left' | 'up-right'
  | 'top-to-bottom' | 'bottom-to-top' | 'left-to-right' | 'right-to-left'
  | number; // degrees: 0 = right, 90 = down, 180 = left, 270 = up

export type SnowShape = 'circle' | 'square' | 'star' | 'diamond';

export type SnowImageSource = string | HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export interface SnowEffectOptions {
  /** true = white snow (dark backgrounds), false = slate snow. Default: true */
  isDark?: boolean;
  /** Number of flakes. Default: 100 */
  particleCount?: number;
  /** Default: true in December only */
  enableSnow?: boolean;
  /** Default: document.body (fullscreen). Any other element fills that element. */
  container?: HTMLElement;
  /** Default: 9999 */
  zIndex?: number;

  /** Default: 'classic' (original flow) */
  direction?: SnowDirection;
  /** Speed multiplier. Default: 1 */
  speed?: number;
  /** Sideways sway amplitude. Default: 0.5 */
  sway?: number;
  /** Particle diameter in px, or [min, max]. Default: [2, 8] (dots) / [12, 24] (symbols, images) */
  size?: number | [number, number];
  /** Built-in shape(s). Default: 'circle' */
  shape?: SnowShape | SnowShape[];
  /** Text / emoji particles, e.g. ['❄', '🎄'] */
  symbols?: string | string[];
  /** Image particles */
  images?: SnowImageSource | SnowImageSource[];
  /** CSS colour(s) for shapes and text glyphs */
  color?: string | string[];
  /** 0..1. Default: 0.8 for shapes, 1 for symbols/images */
  opacity?: number;
  /** true, or a speed multiplier. Default: false */
  rotation?: boolean | number;
  /** FPS cap, 0 = uncapped. Default: 60 */
  maxFps?: number;
  /** Canvas pixel ratio, or 'auto' (device ratio, max 2). Default: 1 */
  pixelRatio?: number | 'auto';
  /** Distinct pre-rendered sizes per symbol. Default: 6 */
  sizeSteps?: number;
  /** Font for `symbols` */
  fontFamily?: string;
  /** Draw a still frame instead of animating when the user prefers reduced motion. Default: true */
  respectReducedMotion?: boolean;
}

export class SnowEffect {
  constructor(options?: SnowEffectOptions);
  readonly options: SnowEffectOptions;
  readonly canvas: HTMLCanvasElement | null;
  isRunning: boolean;
  init(): this;
  start(): this;
  stop(): this;
  setTheme(isDark: boolean): this;
  setDirection(direction: SnowDirection): this;
  setOptions(options: Partial<Omit<SnowEffectOptions, 'container'>>): this;
  refresh(): this;
  destroy(): this;
}

export default SnowEffect;
