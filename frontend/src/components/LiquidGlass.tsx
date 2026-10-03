import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  createGlass,
  destroyGlass,
  glassAvailable,
  glassEnabledPref,
  isGlassGateOpen,
  onGlassGate,
  scheduleSnapshotRefresh,
  solveScrim,
} from "../lib/liquidGlass";
import type { GlassInstance } from "../lib/liquidGlass";
import { cn } from "../lib/utils";

interface Props {
  children: ReactNode;
  type?: "rounded" | "pill" | "circle";
  radius?: number;
  /** The library's own white/grey tint over the glass (0-1). */
  tint?: number;
  /** Classes for the glass element itself (size, layout). */
  className?: string;
  style?: CSSProperties;
  /** The darkest text colour used on this glass; contrast is guaranteed for it. */
  textColor?: string;
  /** 4.5 for normal text (WCAG AA), 3 for large text / icons only. */
  minContrast?: number;
  /** Cream layer between glass and text; never goes below this. */
  minScrim?: number;
  scrimColor?: string;
  /** Change this when the content *behind* the glass changes, to re-capture it. */
  refreshKey?: unknown;
  /** Re-check contrast while scrolling (for glass that floats over moving content). */
  trackScroll?: boolean;
}

/**
 * React wrapper around a Liquid Glass `Container`. Children render on top of
 * the WebGL glass through a portal; a cream scrim between them is tuned from
 * measured pixels so text always meets `minContrast`.
 */
export function LiquidGlass({
  children,
  type = "rounded",
  radius = 24,
  tint = 0.1,
  className,
  style,
  textColor = "#1c1917",
  minContrast = 4.5,
  minScrim = 0.2,
  scrimColor = "#faf7f2",
  refreshKey,
  trackScroll = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<GlassInstance | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  // WebGL glass only once the app has painted data (see markAppReady) and if the
  // user hasn't switched it off in Settings; until then, CSS frosted cream.
  const [, rerender] = useState(0);
  useEffect(() => {
    const off = onGlassGate(() => rerender((n) => n + 1));
    return () => {
      off();
    };
  }, []);
  const supported = glassAvailable() && glassEnabledPref() && isGlassGateOpen();
  const [scrim, setScrim] = useState(Math.max(minScrim, 0.55)); // safe until first measurement
  const [measured, setMeasured] = useState<{ contrast: number; raw: number } | null>(null);

  // Create the glass, mount it, tear it down.
  useLayoutEffect(() => {
    if (!supported || !hostRef.current) return;
    const inst = createGlass({ type, borderRadius: radius, tintOpacity: tint });
    if (!inst) return;
    instRef.current = inst;
    // Layout is ours, not glass.css's (its flex/padding/gap defaults would fight Tailwind).
    Object.assign(inst.element.style, { display: "block", padding: "0", gap: "0", isolation: "isolate" });
    hostRef.current.appendChild(inst.element);
    setTarget(inst.element);
    return () => {
      destroyGlass(inst);
      instRef.current = null;
      setTarget(null);
    };
  }, [supported, type, radius, tint]);

  // Keep the canvas sized to the content and positioned after layout changes.
  useEffect(() => {
    const inst = instRef.current;
    if (!inst || !target) return;
    const ro = new ResizeObserver(() => {
      inst.updateSizeFromDOM();
      requestAnimationFrame(() => inst.render?.());
    });
    ro.observe(target);
    const onResize = () => scheduleSnapshotRefresh(600);
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [target]);

  // Content behind the glass changed: re-capture once things settle. Not on first
  // mount: the library takes its own snapshot when the glass is created.
  const seenKey = useRef<unknown>(undefined);
  const mountedKey = useRef(false);
  useEffect(() => {
    if (!target) return;
    if (!mountedKey.current) {
      mountedKey.current = true;
      seenKey.current = refreshKey;
      return;
    }
    if (seenKey.current !== refreshKey) {
      seenKey.current = refreshKey;
      scheduleSnapshotRefresh(900);
    }
  }, [refreshKey, target]);

  // Measure contrast whenever the glass re-renders (and on scroll if asked).
  useEffect(() => {
    const inst = instRef.current;
    if (!inst || !target) return;
    let raf = 0;
    let last = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!inst.webglInitialized) return;
        inst.render?.();
        const r = solveScrim(inst, textColor, scrimColor, minContrast, minScrim);
        if (!r) return;
        setScrim(r.alpha);
        setMeasured({ contrast: r.contrast, raw: r.rawContrast });
      });
    };
    // The library initialises WebGL asynchronously after its first snapshot.
    const poll = setInterval(() => {
      if (inst.webglInitialized) {
        clearInterval(poll);
        measure();
      }
    }, 150);
    const onScroll = () => {
      const now = performance.now();
      if (now - last > 200) {
        last = now;
        measure();
      }
    };
    window.addEventListener("glass:rendered", measure);
    if (trackScroll) window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearInterval(poll);
      cancelAnimationFrame(raf);
      window.removeEventListener("glass:rendered", measure);
      window.removeEventListener("scroll", onScroll);
    };
  }, [target, textColor, scrimColor, minContrast, minScrim, trackScroll]);

  // No WebGL (or library missing): same look with CSS frosted glass, already readable.
  if (!supported) {
    return (
      <div
        className={cn("relative backdrop-blur-xl", className)}
        style={{ borderRadius: type === "rounded" ? radius : 9999, background: `${scrimColor}d9`, ...style }}
      >
        {children}
      </div>
    );
  }

  return (
    <div ref={hostRef} className="contents">
      {target &&
        createPortal(
          <div
            className={cn("relative", className)}
            style={style}
            data-glass=""
            data-glass-scrim={scrim.toFixed(2)}
            data-glass-contrast={measured ? measured.contrast.toFixed(2) : ""}
            data-glass-raw-contrast={measured ? measured.raw.toFixed(2) : ""}
          >
            {/* cream scrim + soft rim highlight; strength is solved from measured pixels */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 transition-[opacity] duration-300"
              style={{
                background: scrimColor,
                opacity: scrim,
                borderRadius: type === "rounded" ? radius : 9999,
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                borderRadius: type === "rounded" ? radius : 9999,
                boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.75), inset 0 0 0 1px rgb(255 255 255 / 0.35)",
              }}
            />
            <div className="relative">{children}</div>
          </div>,
          target,
        )}
    </div>
  );
}
