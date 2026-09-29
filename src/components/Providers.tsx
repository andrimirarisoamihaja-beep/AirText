"use client";

import { useEffect } from "react";
import { useApp } from "@/lib/store";

// Hydrate le store depuis IndexedDB, fait battre l'horloge globale (timers),
// et enregistre le service worker PWA.
export function Providers() {
  const hydrate = useApp((s) => s.hydrate);
  const tick = useApp((s) => s.tick);

  useEffect(() => {
    void hydrate();
    const t = setInterval(() => tick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hydrate, tick]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
