"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui/basicos";
import { Campo, Select } from "@/components/ui/formulario";
import { Aviso } from "@/components/ui/layout";
import { SITUACOES, filtrosParaConsulta, type OpcoesFiltro, type ValoresFiltro } from "@/lib/questoes/filtros";
import { criarSessaoQuestoes } from "../questoes/acoes";

const QUANTIDADES = [10, 20, 30, 50];

export function ConfigurarSessao({ opcoes, valores }: { opcoes: OpcoesFiltro; valores: ValoresFiltro }) {
  const [v, setV] = useState<ValoresFiltro>(valores);
  const [quantidade, setQuantidade] = useState(20);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const assuntos = opcoes.assuntos.filter((a) => !v.disciplina || a.disciplina_id === v.disciplina);

  return (
    <Card>
      <CardHeader><CardTitle>Nova sessão</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Disciplina" htmlFor="s-disc">
            <Select id="s-disc" valor={v.disciplina ?? ""} aoMudar={(x) => setV({ ...v, disciplina: x, assunto: "" })}
              opcoes={[{ valor: "", rotulo: "Todas" }, ...opcoes.disciplinas.map((d) => ({ valor: d.id, rotulo: d.nome }))]} />
          </Campo>
          <Campo rotulo="Assunto" htmlFor="s-ass">
            <Select id="s-ass" valor={v.assunto ?? ""} aoMudar={(x) => setV({ ...v, assunto: x })}
              opcoes={[{ valor: "", rotulo: "Todos" }, ...assuntos.map((a) => ({ valor: a.id, rotulo: a.nome }))]} />
          </Campo>
          <Campo rotulo="Quais questões" htmlFor="s-sit">
            <Select id="s-sit" valor={v.situacao ?? ""} aoMudar={(x) => setV({ ...v, situacao: x })} opcoes={SITUACOES} />
          </Campo>
          <Campo rotulo="Dificuldade" htmlFor="s-dif">
            <Select id="s-dif" valor={v.dificuldade ?? ""} aoMudar={(x) => setV({ ...v, dificuldade: x })}
              opcoes={[{ valor: "", rotulo: "Todas" }, { valor: "facil", rotulo: "Fácil" }, { valor: "medio", rotulo: "Médio" }, { valor: "dificil", rotulo: "Difícil" }]} />
          </Campo>
          <Campo rotulo="Tipo" htmlFor="s-tipo">
            <Select id="s-tipo" valor={v.tipo ?? ""} aoMudar={(x) => setV({ ...v, tipo: x })}
              opcoes={[{ valor: "", rotulo: "Todos" }, { valor: "multipla_escolha", rotulo: "Múltipla escolha" }, { valor: "certo_errado", rotulo: "Certo ou errado" }]} />
          </Campo>
          <Campo rotulo="Estilo de banca" htmlFor="s-banca">
            <Select id="s-banca" valor={v.banca ?? ""} aoMudar={(x) => setV({ ...v, banca: x })}
              opcoes={[{ valor: "", rotulo: "Qualquer" }, ...opcoes.bancas.map((b) => ({ valor: b.id, rotulo: b.sigla }))]} />
          </Campo>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Quantidade</p>
          <div className="flex flex-wrap gap-2">
            {QUANTIDADES.map((q) => (
              <button key={q} type="button" aria-pressed={quantidade === q} onClick={() => setQuantidade(q)}
                className={`rounded-md border px-3 py-1.5 text-sm ${quantidade === q ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{q}</button>
            ))}
            <Input aria-label="Quantidade personalizada" className="w-24" type="number" min={1} max={200} value={quantidade} onChange={(e) => setQuantidade(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
          </div>
        </div>
        <Campo rotulo="Nome da sessão (opcional)" htmlFor="s-nome">
          <Input id="s-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Revisão de nacionalidade" />
        </Campo>
        <Button className="justify-self-start" carregando={pendente}
          onClick={() => iniciar(async () => {
            setErro(undefined);
            const r = await criarSessaoQuestoes({ nome, quantidade, filtros: filtrosParaConsulta(v), modo: v.situacao === "erradas" || v.situacao === "caderno" ? "revisao_erros" : "pratica" });
            if (r.ok) router.push(`/resolver/${r.dados.sessaoId}`);
            else setErro(r.erro);
          })}>
          <PenLine /> Começar
        </Button>
      </CardContent>
    </Card>
  );
}
