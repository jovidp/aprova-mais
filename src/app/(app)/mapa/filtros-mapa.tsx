"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/formulario";

export function FiltrosMapa({ disciplinas, disciplina, nivel, niveis }: {
  disciplinas: { id: string; nome: string }[];
  disciplina: string;
  nivel: string;
  niveis: { valor: string; rotulo: string }[];
}) {
  const router = useRouter();
  const ir = (d: string, n: string) => {
    const p = new URLSearchParams();
    if (d) p.set("disciplina", d);
    if (n) p.set("nivel", n);
    router.push(`/mapa${p.size ? `?${p}` : ""}`);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Select aria-label="Disciplina" className="w-52" valor={disciplina} aoMudar={(v) => ir(v, nivel)} opcoes={[{ valor: "", rotulo: "Todas as disciplinas" }, ...disciplinas.map((d) => ({ valor: d.id, rotulo: d.nome }))]} />
      <Select aria-label="Nível" className="w-48" valor={nivel} aoMudar={(v) => ir(disciplina, v)} opcoes={[{ valor: "", rotulo: "Todos os níveis" }, ...niveis]} />
    </div>
  );
}
