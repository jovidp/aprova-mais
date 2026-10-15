"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/basicos";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/sobreposicoes";

export function FiltroPeriodo({ dias, inicio, fim }: { dias: number | null; inicio: string; fim: string }) {
  const router = useRouter();
  const caminho = usePathname();
  const [de, setDe] = useState(inicio);
  const [ate, setAte] = useState(fim);
  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Período">
      {[7, 30, 90].map((d) => (
        <button key={d} aria-pressed={dias === d} onClick={() => router.push(`${caminho}?periodo=${d}`)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${dias === d ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {d} dias
        </button>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <button aria-pressed={dias === null} className={`rounded-md px-2.5 py-1 text-xs font-medium ${dias === null ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            Personalizado
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="grid gap-2">
          <label className="grid gap-1 text-xs">De<Input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label className="grid gap-1 text-xs">Até<Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
          <Button size="sm" disabled={!de || !ate || de > ate} onClick={() => router.push(`${caminho}?inicio=${de}&fim=${ate}`)}>Aplicar</Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
