/**
 * New-incident alerts outside the dashboard: a desktop notification and/or a
 * short chime, both opt-in from Settings. The tab title also shows how many
 * incidents arrived while you were looking at another tab.
 */

const KEY = "netsentinel:alerts";

export interface AlertPrefs {
  desktop: boolean;
  sound: boolean;
}

export function getAlertPrefs(): AlertPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { desktop: false, sound: false, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { desktop: false, sound: false };
}

export function setAlertPrefs(p: AlertPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function desktopSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function desktopPermission(): NotificationPermission | "unsupported" {
  return desktopSupported() ? Notification.permission : "unsupported";
}

export async function requestDesktopPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!desktopSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

let audioCtx: AudioContext | null = null;

/** Two soft tones; louder/higher for critical. No audio file needed. */
export function playChime(critical = false) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx ?? new Ctx();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const notes = critical ? [880, 1175, 880] : [660, 880];
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(critical ? 0.22 : 0.14, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  } catch {
    /* audio blocked; ignore */
  }
}

export interface NewIncident {
  incident_id: string;
  title?: string;
  severity?: string;
  root_cause?: string | null;
}

export function alertNewIncidents(incidents: NewIncident[], onOpen?: (id: string) => void) {
  if (!incidents.length) return;
  const prefs = getAlertPrefs();
  const critical = incidents.some((i) => i.severity === "critical");
  if (prefs.sound) playChime(critical);
  if (prefs.desktop && desktopPermission() === "granted") {
    for (const inc of incidents.slice(0, 3)) {
      try {
        const n = new Notification(`${inc.severity === "critical" ? "Critical incident" : "New incident"}: ${inc.incident_id}`, {
          body: [inc.title, inc.root_cause ? `Likely cause: ${inc.root_cause}` : null].filter(Boolean).join("\n"),
          tag: inc.incident_id,
          requireInteraction: inc.severity === "critical",
        });
        n.onclick = () => {
          window.focus();
          onOpen?.(inc.incident_id);
          n.close();
        };
      } catch {
        /* some browsers only allow notifications from a service worker */
      }
    }
  }
}

/** "(3) NetSentinel" while incidents arrived in a background tab. */
const BASE_TITLE = typeof document !== "undefined" ? document.title : "NetSentinel";
let hiddenCount = 0;
export function bumpTitle(n: number) {
  if (typeof document === "undefined" || !document.hidden || n <= 0) return;
  hiddenCount += n;
  document.title = `(${hiddenCount}) ${BASE_TITLE}`;
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      hiddenCount = 0;
      document.title = BASE_TITLE;
    }
  });
}
