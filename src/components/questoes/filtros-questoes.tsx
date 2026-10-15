"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/basicos";
import { Select } from "@/components/ui/formulario";
import { SITUACOES, type OpcoesFiltro, type ValoresFiltro } from "@/lib/questoes/filtros";

export function FiltrosQuestoes({ opcoes, valores, extras }: { opcoes: OpcoesFiltro; valores: ValoresFiltro; extras?: Record<string, string> }) {
  const router = useRouter();
  const caminho = usePathname();
  const [local, setLocal] = useState<ValoresFiltro>(valores);
  const [avancado, setAvancado] = useState(Boolean(valores.ano || valores.cargo || valores.material || valores.origem || valores.concurso));

  const aplicar = (novos: ValoresFiltro) => {
    const p = new URLSearchParams(extras);
    for (const [k, v] of Object.entries(novos)) if (v) p.set(k, v);
    router.push(`${caminho}?${p}`);
  };
  const mudar = (chave: keyof ValoresFiltro, valor: string) => {
    const novos = { ...local, [chave]: valor, ...(chave === "disciplina" ? { assunto: "", material: "" } : {}) };
    setLocal(novos);
    if (chave !== "busca" && chave !== "cargo" && chave !== "ano") aplicar(novos);
  };
  const assuntos = opcoes.assuntos.filter((a) => !local.disciplina || a.disciplina_id === local.disciplina);
  const materiais = opcoes.materiais.filter((m) => !local.disciplina || m.disciplina_id === local.disciplina);
  const ativos = Object.values(valores).filter(Boolean).length;

  return (
    <form className="mb-6 grid gap-3 rounded-xl border bg-card p-4" onSubmit={(e) => { e.preventDefault(); aplicar(local); }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select aria-label="Disciplina" valor={local.disciplina ?? ""} aoMudar={(v) => mudar("disciplina", v)}
          opcoes={[{ valor: "", rotulo: "Todas as disciplinas" }, ...opcoes.disciplinas.map((d) => ({ valor: d.id, rotulo: d.nome }))]} />
        <Select aria-label="Assunto" valor={local.assunto ?? ""} aoMudar={(v) => mudar("assunto", v)}
          opcoes={[{ valor: "", rotulo: "Todos os assuntos" }, ...assuntos.map((a) => ({ valor: a.id, rotulo: a.nome }))]} />
        <Select aria-label="Situação" valor={local.situacao ?? ""} aoMudar={(v) => mudar("situacao", v)} opcoes={SITUACOES} />
        <div className="grid grid-cols-2 gap-3">
          <Select aria-label="Dificuldade" valor={local.dificuldade ?? ""} aoMudar={(v) => mudar("dificuldade", v)}
            opcoes={[{ valor: "", rotulo: "Dificuldade" }, { valor: "facil", rotulo: "Fácil" }, { valor: "medio", rotulo: "Médio" }, { valor: "dificil", rotulo: "Difícil" }]} />
          <Select aria-label="Tipo" valor={local.tipo ?? ""} aoMudar={(v) => mudar("tipo", v)}
            opcoes={[{ valor: "", rotulo: "Tipo" }, { valor: "multipla_escolha", rotulo: "Múltipla escolha" }, { valor: "certo_errado", rotulo: "Certo/errado" }]} />
        </div>
      </div>
      {avancado && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select aria-label="Banca" valor={local.banca ?? ""} aoMudar={(v) => mudar("banca", v)}
            opcoes={[{ valor: "", rotulo: "Qualquer banca (estilo ou oficial)" }, ...opcoes.bancas.map((b) => ({ valor: b.id, rotulo: b.sigla }))]} />
          <Select aria-label="Origem" valor={local.origem ?? ""} aoMudar={(v) => mudar("origem", v)}
            opcoes={[{ valor: "", rotulo: "Qualquer origem" }, { valor: "ia", rotulo: "Autorais (IA)" }, { valor: "manual", rotulo: "Autorais (manuais)" }, { valor: "importada_licenciada", rotulo: "Base licenciada" }]} />
          <Select aria-label="Material de origem" valor={local.material ?? ""} aoMudar={(v) => mudar("material", v)}
            opcoes={[{ valor: "", rotulo: "Qualquer material" }, ...materiais.map((m) => ({ valor: m.id, rotulo: m.titulo }))]} />
          {opcoes.concursos && opcoes.concursos.length > 0 && (
            <Select aria-label="Concurso" valor={local.concurso ?? ""} aoMudar={(v) => mudar("concurso", v)}
              opcoes={[{ valor: "", rotulo: "Qualquer concurso" }, ...opcoes.concursos.map((c) => ({ valor: c.id, rotulo: c.nome }))]} />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input aria-label="Ano" placeholder="Ano" inputMode="numeric" value={local.ano ?? ""} onChange={(e) => setLocal({ ...local, ano: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
            <Input aria-label="Cargo" placeholder="Cargo" value={local.cargo ?? ""} onChange={(e) => setLocal({ ...local, cargo: e.target.value })} />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input className="min-w-56 flex-1" aria-label="Buscar no enunciado" placeholder="Buscar no enunciado" value={local.busca ?? ""} onChange={(e) => setLocal({ ...local, busca: e.target.value })} />
        <Button type="submit" variant="secondary">Buscar</Button>
        <Button type="button" variant="ghost" onClick={() => setAvancado(!avancado)}><Filter /> {avancado ? "Menos filtros" : "Mais filtros"}</Button>
        {ativos > 0 && (
          <Button type="button" variant="ghost" onClick={() => { setLocal({}); aplicar({}); }}><X /> Limpar ({ativos})</Button>
        )}
      </div>
    </form>
  );
}
