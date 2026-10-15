"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/formulario";
import { ROTULO_CAUSA } from "./rotulos";
import { proporRevisoesDosErros } from "./acoes";

export function FiltroCaderno({ status, causa, disciplina, disciplinas }: { status: string; causa: string; disciplina: string; disciplinas: { id: string; nome: string }[] }) {
  const router = useRouter();
  const caminho = usePathname();
  const ir = (m: Record<string, string>) => {
    const p = new URLSearchParams({ status, causa, disciplina, ...m });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    router.push(`${caminho}?${p}`);
  };
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-3">
      <Select aria-label="Situação" valor={status} aoMudar={(v) => ir({ status: v })} opcoes={[{ valor: "ativo", rotulo: "Ativos" }, { valor: "superado", rotulo: "Superados" }, { valor: "arquivado", rotulo: "Arquivados" }]} />
      <Select aria-label="Causa" valor={causa} aoMudar={(v) => ir({ causa: v })} opcoes={[{ valor: "", rotulo: "Todas as causas" }, ...Object.entries(ROTULO_CAUSA).map(([v, r]) => ({ valor: v, rotulo: r }))]} />
      <Select aria-label="Disciplina" valor={disciplina} aoMudar={(v) => ir({ disciplina: v })} opcoes={[{ valor: "", rotulo: "Todas as disciplinas" }, ...disciplinas.map((d) => ({ valor: d.id, rotulo: d.nome }))]} />
    </div>
  );
}

export function BotaoRevisoes() {
  const [pendente, iniciar] = useTransition();
  return (
    <Button variant="outline" carregando={pendente} onClick={() => iniciar(async () => {
      const r = await proporRevisoesDosErros();
      if (r.ok) toast.success(`Revisões agendadas para ${r.dados.assuntos} assunto(s), a partir de amanhã.`); else toast.error(r.erro);
    })}><RotateCcw /> Agendar revisões</Button>
  );
}
