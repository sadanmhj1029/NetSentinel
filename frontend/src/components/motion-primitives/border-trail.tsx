// Adapted from motion-primitives (https://github.com/ibelick/motion-primitives, MIT).
import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { cn } from "../../lib/utils";

export type BorderTrailProps = {
  className?: string;
  size?: number;
  duration?: number;
  style?: CSSProperties;
};

/** A small bright segment that travels around the parent's border. Parent needs `relative` + a border radius. */
export function BorderTrail({ className, size = 40, duration = 4, style }: BorderTrailProps) {
  return (
    <div className="pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]">
      <motion.div
        className={cn("absolute aspect-square bg-stone-500", className)}
        style={{ width: size, offsetPath: `rect(0 auto auto 0 round ${size}px)`, ...style }}
        animate={{ offsetDistance: ["0%", "100%"] }}
        transition={{ repeat: Infinity, duration, ease: "linear" }}
      />
    </div>
  );
}
