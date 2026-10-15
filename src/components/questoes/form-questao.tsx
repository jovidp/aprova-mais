"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Input, Textarea } from "@/components/ui/basicos";
import { Campo, Select } from "@/components/ui/formulario";
import { Aviso } from "@/components/ui/layout";
import { salvarQuestaoManual } from "@/app/(app)/questoes/acoes";
import type { OpcoesFiltro } from "@/lib/questoes/filtros";
import { QUESTAO_VAZIA, type DadosFormQuestao } from "@/lib/questoes/formulario";

const LETRAS = ["A", "B", "C", "D", "E"];

export function FormQuestao({ inicial, opcoes }: { inicial: DadosFormQuestao; opcoes: OpcoesFiltro }) {
  const [d, setD] = useState(inicial);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const assuntos = opcoes.assuntos.filter((a) => a.disciplina_id === d.disciplinaId);

  const mudarTipo = (tipo: DadosFormQuestao["tipo"]) => {
    setD({
      ...d, tipo,
      alternativas: tipo === "certo_errado"
        ? [{ letra: "C", texto: "Certo", correta: true, justificativa: "" }, { letra: "E", texto: "Errado", correta: false, justificativa: "" }]
        : QUESTAO_VAZIA.alternativas,
    });
  };
  const alt = (i: number, campo: "texto" | "justificativa", valor: string) =>
    setD({ ...d, alternativas: d.alternativas.map((a, k) => (k === i ? { ...a, [campo]: valor } : a)) });

  const salvar = (status: "rascunho" | "aprovada") =>
    iniciar(async () => {
      setErro(undefined);
      const r = await salvarQuestaoManual({
        id: d.id, tipo: d.tipo, estilo: d.estilo, enunciado: d.enunciado, textoApoio: d.textoApoio, dificuldade: d.dificuldade,
        disciplinaId: d.disciplinaId, assunto: d.assunto, subassunto: d.subassunto, bancaEstiloId: d.bancaEstiloId,
        alternativas: d.alternativas, explicacao: d.explicacao, materialId: d.materialId,
        pagina: d.pagina ? Number(d.pagina) : undefined, status,
      });
      if (r.ok) {
        toast.success(status === "aprovada" ? "Questão salva e disponível" : "Rascunho salvo");
        router.push(`/questoes/${r.dados.id}`);
      } else setErro(r.erro);
    });

  return (
    <Card>
      <CardContent className="grid gap-5 p-6">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Tipo" htmlFor="q-tipo">
            <Select id="q-tipo" valor={d.tipo} aoMudar={(v) => mudarTipo(v as DadosFormQuestao["tipo"])}
              opcoes={[{ valor: "multipla_escolha", rotulo: "Múltipla escolha" }, { valor: "certo_errado", rotulo: "Certo ou errado" }]} />
          </Campo>
          <Campo rotulo="Dificuldade" htmlFor="q-dif">
            <Select id="q-dif" valor={d.dificuldade} aoMudar={(v) => setD({ ...d, dificuldade: v as DadosFormQuestao["dificuldade"] })}
              opcoes={[{ valor: "facil", rotulo: "Fácil" }, { valor: "medio", rotulo: "Médio" }, { valor: "dificil", rotulo: "Difícil" }]} />
          </Campo>
          <Campo rotulo="Estilo" htmlFor="q-estilo">
            <Select id="q-estilo" valor={d.estilo} aoMudar={(v) => setD({ ...d, estilo: v as DadosFormQuestao["estilo"] })}
              opcoes={[{ valor: "conceitual", rotulo: "Conceitual" }, { valor: "interpretacao", rotulo: "Interpretação" }, { valor: "aplicacao", rotulo: "Aplicação" }, { valor: "situacao_hipotetica", rotulo: "Situação hipotética" }, { valor: "analise_juridica", rotulo: "Análise jurídica" }]} />
          </Campo>
          <Campo rotulo="Estilo de banca (opcional)" htmlFor="q-banca">
            <Select id="q-banca" valor={d.bancaEstiloId} aoMudar={(v) => setD({ ...d, bancaEstiloId: v })}
              opcoes={[{ valor: "", rotulo: "Nenhum" }, ...opcoes.bancas.map((b) => ({ valor: b.id, rotulo: b.sigla }))]} />
          </Campo>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Disciplina" htmlFor="q-disc">
            <Select id="q-disc" valor={d.disciplinaId} aoMudar={(v) => setD({ ...d, disciplinaId: v, assunto: "" })}
              opcoes={[{ valor: "", rotulo: "Selecione" }, ...opcoes.disciplinas.map((x) => ({ valor: x.id, rotulo: x.nome }))]} />
          </Campo>
          <Campo rotulo="Assunto" htmlFor="q-ass">
            <Input id="q-ass" list="q-assuntos" value={d.assunto} onChange={(e) => setD({ ...d, assunto: e.target.value })} />
            <datalist id="q-assuntos">{assuntos.map((a) => <option key={a.id} value={a.nome} />)}</datalist>
          </Campo>
          <Campo rotulo="Subassunto (opcional)" htmlFor="q-sub">
            <Input id="q-sub" value={d.subassunto} onChange={(e) => setD({ ...d, subassunto: e.target.value })} />
          </Campo>
        </div>
        <Campo rotulo="Texto de apoio (opcional)" htmlFor="q-apoio">
          <Textarea id="q-apoio" rows={3} value={d.textoApoio} onChange={(e) => setD({ ...d, textoApoio: e.target.value })} />
        </Campo>
        <Campo rotulo={d.tipo === "certo_errado" ? "Afirmação a ser julgada" : "Enunciado"} htmlFor="q-enun">
          <Textarea id="q-enun" rows={4} value={d.enunciado} onChange={(e) => setD({ ...d, enunciado: e.target.value })} />
        </Campo>

        <fieldset className="grid gap-3">
          <legend className="mb-2 text-sm font-medium">Alternativas (marque a correta)</legend>
          {d.alternativas.map((a, i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-start">
              <label className="flex items-center gap-2 pt-2 text-sm font-semibold">
                <input type="radio" name="correta" checked={a.correta} onChange={() => setD({ ...d, alternativas: d.alternativas.map((x, k) => ({ ...x, correta: k === i })) })} />
                {a.letra}
              </label>
              <Textarea aria-label={`Texto da alternativa ${a.letra}`} rows={2} value={a.texto} disabled={d.tipo === "certo_errado"} onChange={(e) => alt(i, "texto", e.target.value)} />
              <Textarea aria-label={`Justificativa da alternativa ${a.letra}`} rows={2} placeholder="Por que está certa/errada" value={a.justificativa} onChange={(e) => alt(i, "justificativa", e.target.value)} />
              {d.tipo === "multipla_escolha" && d.alternativas.length > 2 && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover alternativa ${a.letra}`}
                  onClick={() => {
                    const restantes = d.alternativas.filter((_, k) => k !== i).map((x, k) => ({ ...x, letra: LETRAS[k] }));
                    if (!restantes.some((x) => x.correta)) restantes[0].correta = true;
                    setD({ ...d, alternativas: restantes });
                  }}><Trash2 /></Button>
              )}
            </div>
          ))}
          {d.tipo === "multipla_escolha" && d.alternativas.length < 5 && (
            <Button type="button" variant="outline" size="sm" className="justify-self-start"
              onClick={() => setD({ ...d, alternativas: [...d.alternativas, { letra: LETRAS[d.alternativas.length], texto: "", correta: false, justificativa: "" }] })}>
              <Plus /> Alternativa
            </Button>
          )}
        </fieldset>

        <Campo rotulo="Explicação da resposta" htmlFor="q-exp">
          <Textarea id="q-exp" rows={4} value={d.explicacao} onChange={(e) => setD({ ...d, explicacao: e.target.value })} />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <Campo rotulo="Material de referência (opcional)" htmlFor="q-mat">
            <Select id="q-mat" valor={d.materialId} aoMudar={(v) => setD({ ...d, materialId: v })}
              opcoes={[{ valor: "", rotulo: "Nenhum" }, ...opcoes.materiais.filter((m) => !d.disciplinaId || m.disciplina_id === d.disciplinaId).map((m) => ({ valor: m.id, rotulo: m.titulo }))]} />
          </Campo>
          <Campo rotulo="Página" htmlFor="q-pag">
            <Input id="q-pag" inputMode="numeric" value={d.pagina} onChange={(e) => setD({ ...d, pagina: e.target.value.replace(/\D/g, "") })} />
          </Campo>
        </div>
        <div className="flex flex-wrap gap-2 border-t pt-5">
          <Button onClick={() => salvar("aprovada")} carregando={pendente}>Salvar e disponibilizar</Button>
          <Button variant="outline" onClick={() => salvar("rascunho")} disabled={pendente}>Salvar rascunho</Button>
        </div>
      </CardContent>
    </Card>
  );
}
