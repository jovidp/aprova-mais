"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/basicos";

/** O PDF.js depende do navegador (canvas, workers): carregado só no cliente. */
export const LeitorCarregavel = dynamic(() => import("./leitor").then((m) => m.Leitor), {
  ssr: false,
  loading: () => (
    <div className="grid gap-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="mx-auto h-[70vh] w-full max-w-3xl" />
    </div>
  ),
});
