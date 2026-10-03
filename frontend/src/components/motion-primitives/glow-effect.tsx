// Adapted from motion-primitives (https://github.com/ibelick/motion-primitives, MIT).
// Trimmed to the two modes the topology view uses.
import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { cn } from "../../lib/utils";

export type GlowEffectProps = {
  className?: string;
  style?: CSSProperties;
  colors: string[];
  mode?: "pulse" | "breathe";
  duration?: number;
};

export function GlowEffect({ className, style, colors, mode = "pulse", duration = 3 }: GlowEffectProps) {
  const radial = colors.map((c) => `radial-gradient(circle at 50% 50%, ${c} 0%, transparent 100%)`);
  const animate =
    mode === "pulse"
      ? { background: radial, scale: [1, 1.1, 1], opacity: [0.5, 0.85, 0.5] }
      : { background: radial, scale: [1, 1.05, 1], opacity: [0.4, 0.6, 0.4] };

  return (
    <motion.div
      aria-hidden
      style={{ willChange: "transform", backfaceVisibility: "hidden", ...style }}
      animate={animate}
      transition={{ repeat: Infinity, repeatType: "mirror", duration, ease: "easeInOut" }}
      className={cn("pointer-events-none absolute inset-0 h-full w-full transform-gpu blur-lg", className)}
    />
  );
}
