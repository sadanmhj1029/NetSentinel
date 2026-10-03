import type { ReactNode } from "react";

/**
 * Full-width "canvas" banner for the top of the dashboard: a slow, soft
 * moving gradient in the brand colors (cream + warm orange) with a light
 * grain overlay so it reads as textured rather than flat.
 *
 * The animation speed lives in the `--hero-duration` CSS variable (see
 * `.hero-canvas` in index.css) -- one number to tune, rather than editing
 * keyframes. Lower it for a faster drift, raise it for slower.
 */
export function DashboardHero({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="hero-canvas rounded-2xl border border-black/5 px-6 py-8 shadow-sm sm:px-10 sm:py-10">
      <div className="hero-grain" />
      <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[#b45a3c]">NetSentinel</div>
          <h1 className="mt-1 text-2xl font-bold text-[#4a3326] sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-[#6b5847]">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
