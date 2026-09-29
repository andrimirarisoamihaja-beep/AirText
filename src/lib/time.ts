// Formatage des durées restantes (timers de conversation, TTL d'attente).

export function formatRemaining(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600) % 24;
  const d = Math.floor(total / 86400);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}j ${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function formatShort(ms: number): string {
  if (ms <= 0) return "expiré";
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600) % 24;
  const d = Math.floor(total / 86400);
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")}`;
  if (m > 0) return `${m} min ${String(s).padStart(2, "0")}`;
  return `${s} s`;
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function durationLabel(ms: number): string {
  const h = ms / 3600000;
  if (h < 1) return `${Math.round(ms / 60000)} min`;
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} j`;
}
