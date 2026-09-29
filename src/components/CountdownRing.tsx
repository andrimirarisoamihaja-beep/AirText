"use client";

import type { ReactNode } from "react";

export function CountdownRing({
  fraction,
  size = 44,
  stroke = 3.5,
  color = "var(--color-mint)",
  track = "rgba(148,163,196,0.16)",
  children,
}: {
  fraction: number; // 0..1 (part restante)
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          style={{ transition: "stroke-dashoffset 1s linear, stroke 0.4s" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">{children}</span>
    </span>
  );
}
