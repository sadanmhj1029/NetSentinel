/** Tiny CSV export: turns rows into a CSV file and downloads it. Opens cleanly in Excel. */

type Cell = string | number | boolean | null | undefined;

function escape(value: Cell): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Guard against spreadsheet formula injection from text fields.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv<T>(rows: T[], columns: { header: string; value: (row: T) => Cell }[]): string {
  const lines = [columns.map((c) => escape(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => escape(c.value(row))).join(","));
  return lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  // BOM so Excel reads UTF-8 correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
