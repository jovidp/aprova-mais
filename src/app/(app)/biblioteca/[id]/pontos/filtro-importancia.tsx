"use client";

import { usePathname, useRouter } from "next/navigation";
import { Select } from "@/components/ui/formulario";

export function FiltroImportancia({ valor }: { valor: string }) {
  const router = useRouter();
  const caminho = usePathname();
  return (
    <Select aria-label="Importância mínima" className="w-48" valor={valor} aoMudar={(v) => router.push(v === "1" ? caminho : `${caminho}?minimo=${v}`)}
      opcoes={[{ valor: "1", rotulo: "Todos os pontos" }, { valor: "2", rotulo: "Importantes e essenciais" }, { valor: "3", rotulo: "Só os essenciais" }]} />
  );
}
