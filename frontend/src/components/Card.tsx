import type { ReactNode } from "react";

export type CardTone = "light" | "beige" | "dark";

const CARD_TONES: Record<CardTone, string> = {
  light: "bg-white text-stone-900",
  beige: "bg-beige text-stone-900",
  dark: "bg-ink text-white",
};

export function Card({
  children,
  className = "",
  title,
  subtitle,
  action,
  tone = "light",
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  tone?: CardTone;
}) {
  return (
    <div className={`rounded-[26px] p-6 shadow-card ${CARD_TONES[tone]} ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && (
              <h3 className={`text-[15px] font-semibold tracking-tight ${tone === "dark" ? "text-white" : "text-stone-900"}`}>
                {title}
              </h3>
            )}
            {subtitle && (
              <p className={`mt-0.5 text-xs ${tone === "dark" ? "text-stone-400" : "text-stone-500"}`}>{subtitle}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const toneClass = {
    default: "text-stone-900",
    good: "text-emerald-600",
    bad: "text-red-600",
    warn: "text-amber-700",
  }[tone];

  return (
    <div className="rounded-[22px] bg-white p-5 shadow-card">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2">
      {label && <span className="text-xs font-medium text-stone-500">{label}</span>}
      <span
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-brand-orange" : "bg-stone-300"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </span>
    </label>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "dark" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary: "bg-brand-orange text-white hover:bg-brand-orange-dark",
    dark: "bg-ink text-white hover:bg-ink-soft",
    secondary: "border border-stone-200 bg-white text-stone-700 hover:bg-stone-50",
    danger: "bg-red-600/90 text-white hover:bg-red-600",
    ghost: "text-stone-600 hover:bg-stone-100",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
