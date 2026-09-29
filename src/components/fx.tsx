"use client";

import { memo, useEffect, useRef } from "react";

// Pluie de glyphes hexadécimaux — discrète, en arrière-plan. Zéro réseau.
const GLYPHS = "01ABCDEF39$#%&*+=:;·/\\<>".split("");

function BackgroundFXComponent() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let cols: { x: number; y: number; speed: number; alpha: number }[] = [];
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = "12px var(--font-jetbrains), monospace";
      const count = Math.floor(w / 20);
      cols = Array.from({ length: count }, (_, i) => ({
        x: i * 20 + 10,
        y: Math.random() * h,
        speed: 0.35 + Math.random() * 0.9,
        alpha: 0.04 + Math.random() * 0.08,
      }));
    };

    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 66) return; // ~15 fps suffit
      last = t;
      ctx.clearRect(0, 0, w, h);
      for (const c of cols) {
        const g = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        ctx.fillStyle = `rgba(108, 255, 184, ${c.alpha})`;
        ctx.fillText(g, c.x, c.y);
        // traînée violette occasionnelle
        if (Math.random() < 0.004) {
          ctx.fillStyle = "rgba(139, 124, 255, 0.12)";
          ctx.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)], c.x, c.y - 14);
        }
        c.y += c.speed * 6;
        if (c.y > h + 20) {
          c.y = -20 - Math.random() * h * 0.4;
          c.speed = 0.35 + Math.random() * 0.9;
        }
      }
    };

    resize();
    window.addEventListener("resize", resize);
    if (!reduced) raf = requestAnimationFrame(draw);
    else {
      // rendu statique unique
      ctx.clearRect(0, 0, w, h);
      for (const c of cols) {
        ctx.fillStyle = `rgba(108, 255, 184, ${c.alpha})`;
        ctx.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)], c.x, c.y);
      }
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <>
      <canvas ref={ref} className="pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(60% 42% at 18% -6%, rgba(108,255,184,0.075), transparent 62%)," +
            "radial-gradient(52% 40% at 88% 110%, rgba(139,124,255,0.09), transparent 60%)",
        }}
      />
      <div className="vignette z-0" aria-hidden />
    </>
  );
}

export const BackgroundFX = memo(BackgroundFXComponent);
