import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Same helper motion-primitives uses: merge conditional classes, let later Tailwind classes win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
