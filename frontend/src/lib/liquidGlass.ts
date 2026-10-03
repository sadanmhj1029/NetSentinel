/**
 * Bridge between React and Liquid Glass JS (public/vendor/liquid-glass, unmodified).
 *
 * The library on its own: takes ONE html2canvas snapshot of the page the first
 * time any glass is created and refracts that image forever; re-renders only
 * on window scroll; has no way to change settings live or to tear an instance
 * down. This module adds exactly those pieces around it, without editing it:
 *
 *   refreshSnapshot()      re-capture the page and re-upload it to every glass
 *   applyGlassSettings()   change blur & friends live on every instance
 *   destroyGlass()         free the WebGL context when a component unmounts
 *   solveScrim()           measure contrast of text over the actual glass pixels
 *                          and find the lightest cream scrim that keeps it readable
 */

export interface GlassSettings {
  blurRadius: number; // 1-15, background blur
  edgeIntensity: number; // 0-0.1, refraction at the edges
  rimIntensity: number; // 0-0.2, rim lighting
  baseIntensity: number; // 0-0.05, centre distortion (only with warp)
  edgeDistance: number;
  rimDistance: number;
  baseDistance: number;
  cornerBoost: number;
  rippleEffect: number; // 0-0.5, surface texture
}

interface GlRefs {
  gl?: WebGLRenderingContext;
  texture?: WebGLTexture;
  textureSizeLoc?: WebGLUniformLocation;
  blurRadiusLoc?: WebGLUniformLocation;
  edgeIntensityLoc?: WebGLUniformLocation;
  rimIntensityLoc?: WebGLUniformLocation;
  baseIntensityLoc?: WebGLUniformLocation;
  edgeDistanceLoc?: WebGLUniformLocation;
  rimDistanceLoc?: WebGLUniformLocation;
  baseDistanceLoc?: WebGLUniformLocation;
  cornerBoostLoc?: WebGLUniformLocation;
  rippleEffectLoc?: WebGLUniformLocation;
  tintOpacityLoc?: WebGLUniformLocation;
}

export interface GlassInstance {
  element: HTMLDivElement;
  canvas: HTMLCanvasElement;
  gl_refs: GlRefs;
  tintOpacity: number;
  webglInitialized: boolean;
  render?: () => void;
  updateSizeFromDOM: () => void;
}

interface ContainerClass {
  new (opts: { type?: "rounded" | "pill" | "circle"; borderRadius?: number; tintOpacity?: number }): GlassInstance;
  instances: GlassInstance[];
  pageSnapshot: HTMLCanvasElement | null;
  isCapturing: boolean;
}

declare global {
  interface Window {
    LiquidGlass?: { Container: ContainerClass };
    glassControls?: Partial<GlassSettings>;
    html2canvas?: (el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLCanvasElement>;
    netsentinelGlass?: Record<string, unknown>;
  }
}

/** Tuned by hand in the glass tuner: blur 6, stronger edge bend and ripple, soft rim. */
export const DEFAULT_GLASS: GlassSettings = {
  blurRadius: 6,
  edgeIntensity: 0.026,
  rimIntensity: 0.025,
  baseIntensity: 0.01,
  edgeDistance: 0.15,
  rimDistance: 0.8,
  baseDistance: 0.1,
  cornerBoost: 0.02,
  rippleEffect: 0.16,
};

const UNIFORMS: [keyof GlassSettings, keyof GlRefs][] = [
  ["blurRadius", "blurRadiusLoc"],
  ["edgeIntensity", "edgeIntensityLoc"],
  ["rimIntensity", "rimIntensityLoc"],
  ["baseIntensity", "baseIntensityLoc"],
  ["edgeDistance", "edgeDistanceLoc"],
  ["rimDistance", "rimDistanceLoc"],
  ["baseDistance", "baseDistanceLoc"],
  ["cornerBoost", "cornerBoostLoc"],
  ["rippleEffect", "rippleEffectLoc"],
];

const IGNORE = (el: Element) =>
  el.classList.contains("glass-container") ||
  el.classList.contains("glass-button") ||
  el.classList.contains("glass-button-text");

function Container(): ContainerClass | null {
  return window.LiquidGlass?.Container ?? null;
}

let webglOk: boolean | null = null;
export function glassAvailable(): boolean {
  if (!Container() || typeof window.html2canvas !== "function") return false;
  if (webglOk === null) {
    try {
      webglOk = !!document.createElement("canvas").getContext("webgl");
    } catch {
      webglOk = false;
    }
  }
  return webglOk;
}

export function createGlass(opts: { type: "rounded" | "pill" | "circle"; borderRadius: number; tintOpacity: number }) {
  const C = Container();
  return C ? new C(opts) : null;
}

/** The library has no teardown: drop it from the registry and free its WebGL context. */
export function destroyGlass(inst: GlassInstance) {
  const C = Container();
  if (C) {
    const i = C.instances.indexOf(inst);
    if (i >= 0) C.instances.splice(i, 1);
  }
  inst.gl_refs.gl?.getExtension("WEBGL_lose_context")?.loseContext();
  inst.gl_refs = {}; // makes the library's leftover scroll listener a no-op
  inst.element.remove();
}

export function renderAll() {
  for (const inst of Container()?.instances ?? []) inst.render?.();
}

/** Push settings into every live instance (and into window.glassControls for new ones). */
export function applyGlassSettings(patch: Partial<GlassSettings>) {
  window.glassControls = { ...DEFAULT_GLASS, ...window.glassControls, ...patch };
  const s = window.glassControls as GlassSettings;
  for (const inst of Container()?.instances ?? []) {
    const r = inst.gl_refs;
    if (!r.gl) continue;
    for (const [key, loc] of UNIFORMS) {
      const l = r[loc] as WebGLUniformLocation | undefined;
      if (l) r.gl.uniform1f(l, s[key]);
    }
    if (r.tintOpacityLoc) r.gl.uniform1f(r.tintOpacityLoc, inst.tintOpacity);
    inst.render?.();
  }
  window.dispatchEvent(new Event("glass:rendered"));
}

// --------------------------------------------------------------------------- //
// Startup gate + user preference
// --------------------------------------------------------------------------- //
// The library snapshots the page the moment the first glass is created. Doing
// that during startup froze the app for seconds before data appeared, so glass
// surfaces render as CSS frosted cream until the app has painted real data and
// the browser is idle; then they upgrade to WebGL.
const PREF_KEY = "netsentinel:liquidGlass";
let appReady = false;
let gateOpen = false;
const gateListeners = new Set<() => void>();

export function glassEnabledPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "0";
  } catch {
    return true;
  }
}
export function setGlassEnabledPref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  gateListeners.forEach((fn) => fn());
}

export function isGlassGateOpen() {
  return gateOpen;
}
export function onGlassGate(fn: () => void) {
  gateListeners.add(fn);
  return () => gateListeners.delete(fn);
}

/** Call once real data is on screen. Opens the gate after the browser goes idle. */
export function markAppReady() {
  if (appReady) return;
  appReady = true;
  const open = () => {
    gateOpen = true;
    gateListeners.forEach((fn) => fn());
  };
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  setTimeout(() => (ric ? ric(open, { timeout: 3000 }) : open()), 1200);
}

// Don't freeze the page while someone is in the middle of using it.
let lastInput = 0;
if (typeof window !== "undefined") {
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(ev, () => (lastInput = performance.now()), { passive: true, capture: true });
  }
}

// --------------------------------------------------------------------------- //
// Snapshot refresh
// --------------------------------------------------------------------------- //
const MIN_GAP_MS = 15_000; // at most one capture per 15s unless forced (e.g. page change)
const QUIET_MS = 1500; // wait until the user has been idle this long
let capturing = false;
let pending = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastCaptureAt = 0;
export let lastCaptureMs = 0;

/** Re-capture the page (~1s of main-thread work on the full dashboard) and re-upload it everywhere. */
export async function refreshSnapshot(): Promise<void> {
  const C = Container();
  if (!C || !window.html2canvas || !C.instances.length) return;
  if (capturing || C.isCapturing) {
    pending = true;
    return;
  }
  capturing = true;
  const t0 = performance.now();
  try {
    const snap = await window.html2canvas(document.body, {
      scale: 1,
      useCORS: true,
      allowTaint: false,
      backgroundColor: null,
      logging: false,
      ignoreElements: IGNORE,
    });
    lastCaptureMs = Math.round(performance.now() - t0);
    lastCaptureAt = performance.now();
    C.pageSnapshot = snap;
    for (const inst of C.instances) {
      const r = inst.gl_refs;
      if (!r.gl || !r.texture) continue;
      r.gl.bindTexture(r.gl.TEXTURE_2D, r.texture);
      r.gl.texImage2D(r.gl.TEXTURE_2D, 0, r.gl.RGBA, r.gl.RGBA, r.gl.UNSIGNED_BYTE, snap);
      if (r.textureSizeLoc) r.gl.uniform2f(r.textureSizeLoc, snap.width, snap.height);
      inst.render?.();
    }
    window.dispatchEvent(new Event("glass:rendered"));
  } catch (err) {
    console.warn("[glass] snapshot refresh failed", err);
  } finally {
    capturing = false;
    if (pending) {
      pending = false;
      scheduleSnapshotRefresh(1500, true);
    }
  }
}

/**
 * Debounced, idle-time refresh. Skipped while the tab is hidden, postponed while
 * the user is actively scrolling/typing, and rate-limited unless `force`.
 */
export function scheduleSnapshotRefresh(delay = 800, force = false) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (document.hidden || !(Container()?.instances.length ?? 0)) return;
    const now = performance.now();
    if (now - lastInput < QUIET_MS) return scheduleSnapshotRefresh(QUIET_MS, force);
    if (!force && now - lastCaptureAt < MIN_GAP_MS) return scheduleSnapshotRefresh(MIN_GAP_MS - (now - lastCaptureAt), false);
    const run = () => void refreshSnapshot();
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback;
    if (ric) ric(run, { timeout: 2000 });
    else run();
  }, delay);
}

// --------------------------------------------------------------------------- //
// Readability: measure the real glass pixels, solve for the cream scrim
// --------------------------------------------------------------------------- //
type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const probe = typeof document !== "undefined" ? document.createElement("canvas") : null;

/** Downsampled RGB of the rendered glass (inside its shape mask only). */
function samplePixels(inst: GlassInstance): RGB[] {
  const c = inst.canvas;
  if (!probe || !c.width || !c.height) return [];
  const w = Math.max(8, Math.min(64, Math.round(c.width / 8)));
  const h = Math.max(4, Math.round((w * c.height) / c.width));
  probe.width = w;
  probe.height = h;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(c, 0, 0, w, h); // works because the library sets preserveDrawingBuffer: true
  const data = ctx.getImageData(0, 0, w, h).data;
  const out: RGB[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 200) out.push([data[i], data[i + 1], data[i + 2]]);
  }
  return out;
}

export interface ScrimResult {
  alpha: number; // scrim opacity to use
  contrast: number; // worst-case (5th percentile) contrast achieved
  rawContrast: number; // same, with no scrim at all
}

/**
 * Text sits on: glass pixels, then a cream scrim at opacity `alpha`. For each
 * candidate alpha, composite every sampled pixel and take the 5th-percentile
 * contrast against the text colour (so a few bright refraction speckles can't
 * fake a pass, but one stray pixel doesn't force an opaque panel). Return the
 * lightest scrim that meets the target.
 */
export function solveScrim(
  inst: GlassInstance,
  textHex: string,
  scrimHex: string,
  target: number,
  minAlpha: number,
): ScrimResult | null {
  const px = samplePixels(inst);
  if (px.length < 4) return null;
  const text = hexToRgb(textHex);
  const scrim = hexToRgb(scrimHex);
  const worst = (alpha: number) => {
    const ratios = px
      .map(
        (p) =>
          [0, 1, 2].map((k) => alpha * scrim[k] + (1 - alpha) * p[k]) as RGB,
      )
      .map((c) => contrastRatio(text, c))
      .sort((a, b) => a - b);
    return ratios[Math.floor(ratios.length * 0.05)];
  };
  const rawContrast = worst(0);
  for (let a = minAlpha; a <= 0.951; a += 0.05) {
    const c = worst(a);
    if (c >= target) return { alpha: Math.round(a * 100) / 100, contrast: c, rawContrast };
  }
  return { alpha: 0.95, contrast: worst(0.95), rawContrast };
}

// Handy for tuning from the browser console: netsentinelGlass.apply({ blurRadius: 9 })
if (typeof window !== "undefined") {
  window.netsentinelGlass = {
    apply: applyGlassSettings,
    refresh: refreshSnapshot,
    settings: () => ({ ...DEFAULT_GLASS, ...window.glassControls }),
    lastCaptureMs: () => lastCaptureMs,
  };
}
