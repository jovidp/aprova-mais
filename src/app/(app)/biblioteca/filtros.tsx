"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/basicos";
import { Select } from "@/components/ui/formulario";

const VISOES = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "favoritos", rotulo: "Favoritos" },
  { valor: "recentes", rotulo: "Recentes" },
  { valor: "nao_estudadas", rotulo: "Aulas não estudadas" },
];

export function FiltrosBiblioteca({ disciplinas, atual }: {
  disciplinas: { id: string; nome: string }[];
  atual: { disciplina: string; busca: string; visao: string };
}) {
  const router = useRouter();
  const caminho = usePathname();
  const [busca, setBusca] = useState(atual.busca);

  const aplicar = (mudancas: Partial<typeof atual>) => {
    const p = new URLSearchParams();
    const novo = { ...atual, busca, ...mudancas };
    if (novo.disciplina) p.set("disciplina", novo.disciplina);
    if (novo.busca) p.set("busca", novo.busca);
    if (novo.visao && novo.visao !== "todos") p.set("visao", novo.visao);
    router.push(`${caminho}${p.size ? `?${p}` : ""}`);
  };

  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <form className="relative flex-1" onSubmit={(e) => { e.preventDefault(); aplicar({ busca }); }}>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Pesquisar por título ou assunto" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Pesquisar materiais" />
      </form>
      <Select className="sm:w-56" aria-label="Disciplina" valor={atual.disciplina} aoMudar={(v) => aplicar({ disciplina: v })}
        opcoes={[{ valor: "", rotulo: "Todas as disciplinas" }, ...disciplinas.map((d) => ({ valor: d.id, rotulo: d.nome }))]} />
      <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Visão">
        {VISOES.map((v) => (
          <button key={v.valor} role="tab" aria-selected={atual.visao === v.valor} onClick={() => aplicar({ visao: v.valor })}
            className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap ${atual.visao === v.valor ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {v.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
