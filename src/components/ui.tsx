"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { fingerprintHues } from "@/lib/crypto";
import type { RoomStatus } from "@/lib/store";

// ---------------- Logo ----------------
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M16 2 28 8v8c0 7.18-4.84 12.06-12 14C8.84 28.06 4 23.18 4 16V8l12-6Z"
        stroke="var(--color-mint)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10.5 16.5h4l2-5 3.2 9 2.1-4h3.7" stroke="var(--color-iris)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="mono text-[13px] font-semibold uppercase tracking-[0.42em] text-ink">
      Koragna
    </span>
  );
}

// ---------------- Empreinte visuelle d'une salle ----------------
export function Fingerprint({ roomId, size = "md" }: { roomId: string; size?: "sm" | "md" }) {
  const hues = fingerprintHues(roomId);
  const h = size === "sm" ? "h-4" : "h-5";
  return (
    <span className={`flex ${h} items-stretch gap-[3px]`} aria-hidden>
      {hues.map((hue, i) => (
        <span
          key={i}
          className="w-[5px] rounded-full"
          style={{ background: `linear-gradient(180deg, hsl(${hue} 90% 72%), hsl(${(hue + 50) % 360} 85% 55%))` }}
        />
      ))}
    </span>
  );
}

// ---------------- Pastille de statut ----------------
const STATUS_COLOR: Record<RoomStatus, string> = {
  waiting: "var(--color-amber)",
  connecting: "var(--color-iris)",
  connected: "var(--color-mint)",
  disconnected: "var(--color-faint)",
  expired: "var(--color-danger)",
};

export const STATUS_LABEL: Record<RoomStatus, string> = {
  waiting: "en attente",
  connecting: "connexion",
  connected: "connecté",
  disconnected: "hors ligne",
  expired: "expiré",
};

export function StatusDot({ status, pulse = true }: { status: RoomStatus; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && (status === "connecting" || status === "waiting") && (
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50"
          style={{ background: STATUS_COLOR[status] }}
        />
      )}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
    </span>
  );
}

// ---------------- Bouton copier ----------------
export function CopyButton({ value, label = "Copier" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = value;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
      className="mono inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-muted transition-colors hover:border-mint/50 hover:text-mint"
    >
      {done ? <Check size={13} className="text-mint" /> : <Copy size={13} />}
      {done ? "Copié" : label}
    </button>
  );
}

// ---------------- Bouton à maintien (actions destructrices) ----------------
export function HoldButton({
  onConfirm,
  duration = 1400,
  children,
  className = "",
  armedClassName = "",
}: {
  onConfirm: () => void;
  duration?: number;
  children: ReactNode;
  className?: string;
  armedClassName?: string;
}) {
  const [progress, setProgress] = useState(0);
  const raf = useRef(0);
  const start = useRef(0);

  const tickHold = useCallback(
    (t: number) => {
      if (!start.current) start.current = t;
      const p = Math.min(1, (t - start.current) / duration);
      setProgress(p);
      if (p >= 1) {
        cancelAnimationFrame(raf.current);
        start.current = 0;
        setProgress(0);
        onConfirm();
        return;
      }
      raf.current = requestAnimationFrame(tickHold);
    },
    [duration, onConfirm]
  );

  const begin = () => {
    start.current = 0;
    raf.current = requestAnimationFrame(tickHold);
  };
  const cancel = () => {
    cancelAnimationFrame(raf.current);
    start.current = 0;
    setProgress(0);
  };

  return (
    <button
      type="button"
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative touch-none select-none overflow-hidden ${className} ${progress > 0 ? armedClassName : ""}`}
    >
      <span
        className="absolute inset-y-0 left-0 bg-danger/25 transition-[width] duration-75"
        style={{ width: `${progress * 100}%` }}
        aria-hidden
      />
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </button>
  );
}

// ---------------- Étiquette de section ----------------
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mono text-[10px] font-medium uppercase tracking-[0.34em] text-faint">{children}</p>
  );
}
