"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { RegistroServiceWorker } from "@/components/pwa/registro-sw";

export function Provedores({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      <Toaster richColors closeButton position="top-right" />
      <RegistroServiceWorker />
    </ThemeProvider>
  );
}
