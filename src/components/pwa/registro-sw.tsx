"use client";

import { useEffect } from "react";

/** Registra o service worker em produção (instalação como app e modo offline limitado). */
export function RegistroServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Sem service worker a plataforma continua funcionando normalmente.
    });
  }, []);
  return null;
}
