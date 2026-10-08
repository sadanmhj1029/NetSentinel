import { Search } from "lucide-react";

/** Search box + optional status pills + "n of total" count, used above tables. */
export function FilterBar({
  query,
  onQuery,
  placeholder,
  options,
  value,
  onChange,
  count,
  total,
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  options?: string[];
  value?: string;
  onChange?: (v: string) => void;
  count: number;
  total: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <label className="relative min-w-[14rem] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full rounded-full border border-stone-200 bg-white py-2 pl-9 pr-3 text-sm text-stone-900 outline-none placeholder:text-stone-500 focus:border-brand-orange"
        />
      </label>
      {options && onChange && (
        <div className="flex flex-wrap gap-1 rounded-full bg-stone-100 p-1">
          {options.map((o) => (
            <button
              key={o}
              onClick={() => onChange(o)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                value === o ? "bg-brand-orange text-white" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      )}
      <span className="text-xs text-stone-500">
        {count === total ? `${total} total` : `${count} of ${total}`}
      </span>
    </div>
  );
}
