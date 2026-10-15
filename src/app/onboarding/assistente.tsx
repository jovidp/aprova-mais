"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, GraduationCap, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, Input, Progress } from "@/components/ui/basicos";
import { Campo, Checkbox, Select } from "@/components/ui/formulario";
import { Aviso } from "@/components/ui/layout";
import { EditorDisponibilidade, janelasSobrepostas, totalMinutosSemana, type Janela } from "@/components/estudo/editor-disponibilidade";
import { NOMES_DIAS } from "@/lib/estudo/tempo";
import { formatarDuracao } from "@/lib/utils";
import { concluirOnboarding, type DadosOnboarding } from "./acoes";

const SUGESTOES = [
  "Direito Constitucional", "Direito Administrativo", "Português", "Raciocínio Lógico-Matemático", "Informática",
  "Ética e Conduta Pública", "Arquivologia", "Noções de Administração", "Legislação Relativa à PRF",
];

const PREFERENCIAS: { valor: DadosOnboarding["preferencias"][number]; rotulo: string }[] = [
  { valor: "pdf", rotulo: "Leitura de PDF" },
  { valor: "questoes", rotulo: "Resolução de questões" },
  { valor: "videoaula", rotulo: "Videoaulas" },
  { valor: "flashcards", rotulo: "Flashcards" },
  { valor: "resumos", rotulo: "Resumos" },
];

const ETAPAS = ["Concurso", "Disciplinas", "Disponibilidade", "Metas e preferências", "Revisão"];

type DisciplinaEscolhida = DadosOnboarding["disciplinas"][number];

function Escala({ valor, aoMudar, rotulo }: { valor: number; aoMudar: (v: number) => void; rotulo: string }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={rotulo}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n} type="button" role="radio" aria-checked={valor === n} aria-label={`${rotulo} ${n}`}
          onClick={() => aoMudar(n)}
          className={`size-7 rounded-md border text-xs font-medium ${valor === n ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

export function Assistente({ nome, bancas, disciplinasExistentes }: {
  nome: string;
  bancas: { id: string; sigla: string; nome: string }[];
  disciplinasExistentes: string[];
}) {
  const [etapa, setEtapa] = useState(0);
  const [concurso, setConcurso] = useState({ nome: "", orgao: "", cargo: "", bancaId: "", dataProva: "" });
  const [disciplinas, setDisciplinas] = useState<DisciplinaEscolhida[]>([]);
  const [novaDisciplina, setNovaDisciplina] = useState("");
  const [janelas, setJanelas] = useState<Janela[]>([]);
  const [diasDescanso, setDiasDescanso] = useState<number[]>([]);
  const [preferencias, setPreferencias] = useState<DadosOnboarding["preferencias"]>(["pdf", "questoes"]);
  const [metas, setMetas] = useState({ questoesDia: 30, horasSemana: 15, simuladosMes: 4 });
  const [erro, setErro] = useState<string>();
  const [resultado, setResultado] = useState<{ atividadesCriadas: number; semDisponibilidade: boolean }>();
  const [pendente, iniciar] = useTransition();

  const sugestoes = useMemo(
    () => [...new Set([...SUGESTOES, ...disciplinasExistentes])].filter((s) => !disciplinas.some((d) => d.nome === s)),
    [disciplinas, disciplinasExistentes],
  );
  const minutosSemana = totalMinutosSemana(janelas, diasDescanso);

  const adicionar = (nomeDisciplina: string) => {
    const limpo = nomeDisciplina.trim();
    if (!limpo || disciplinas.some((d) => d.nome.toLowerCase() === limpo.toLowerCase())) return;
    setDisciplinas([...disciplinas, { nome: limpo, dificuldade: 3, prioridade: 3, peso: 1 }]);
  };

  const validarEtapa = (): string | undefined => {
    if (etapa === 0 && concurso.nome.trim().length < 2) return "Informe o concurso (ex.: PRF — Agente Administrativo).";
    if (etapa === 1 && disciplinas.length === 0) return "Escolha ao menos uma disciplina.";
    if (etapa === 2 && janelasSobrepostas(janelas)) return "Há horários sobrepostos no mesmo dia.";
    if (etapa === 2 && janelas.some((j) => j.fimMin <= j.inicioMin)) return "O horário final deve ser depois do inicial.";
    if (etapa === 3 && preferencias.length === 0) return "Escolha ao menos uma forma de estudo.";
    return undefined;
  };

  const avancar = () => {
    const problema = validarEtapa();
    setErro(problema);
    if (!problema) setEtapa((e) => Math.min(ETAPAS.length - 1, e + 1));
  };

  const concluir = () =>
    iniciar(async () => {
      setErro(undefined);
      const r = await concluirOnboarding({ concurso, disciplinas, janelas, diasDescanso, preferencias, metas });
      if (r.ok) setResultado(r.dados);
      else setErro(r.erro);
    });

  if (resultado) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6 text-center">
        <CheckCircle2 className="mx-auto size-14 text-success" aria-hidden />
        <h1 className="text-2xl font-semibold">Tudo pronto!</h1>
        <p className="text-muted-foreground">
          {resultado.semDisponibilidade
            ? "Você ainda não informou horários de estudo, então o cronograma ficou vazio. Ajuste em Meu Cronograma quando quiser."
            : `Criamos ${resultado.atividadesCriadas} atividades para as próximas duas semanas. Depois de importar seus materiais, o cronograma passa a indicar as páginas de cada aula.`}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild><Link href="/biblioteca/importar">Importar meus materiais</Link></Button>
          <Button variant="outline" asChild><Link href="/dashboard">Ir para o dashboard</Link></Button>
        </div>
        <p className="text-xs text-muted-foreground">
          O simulado diagnóstico fica disponível em Gerar Simulados assim que houver questões no banco.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <div className="mb-8 flex items-center gap-2 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCap className="size-5" aria-hidden />
        </span>
        Aprova+
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{nome ? `Olá, ${nome.split(" ")[0]}!` : "Bem-vindo!"} Vamos configurar seus estudos.</h1>
      <p className="mt-1 text-sm text-muted-foreground">Tudo pode ser alterado depois em Configurações e Meu Cronograma.</p>

      <div className="mt-6">
        <div className="mb-2 flex justify-between text-xs text-muted-foreground">
          <span>Etapa {etapa + 1} de {ETAPAS.length}: <strong className="text-foreground">{ETAPAS[etapa]}</strong></span>
          <span>{Math.round(((etapa + 1) / ETAPAS.length) * 100)}%</span>
        </div>
        <Progress value={((etapa + 1) / ETAPAS.length) * 100} />
      </div>

      <Card className="mt-6">
        <CardContent className="grid gap-5 p-6">
          {erro && <Aviso tipo="erro">{erro}</Aviso>}

          {etapa === 0 && (
            <>
              <Campo rotulo="Concurso" htmlFor="c-nome" ajuda="Ex.: PRF — Agente Administrativo">
                <Input id="c-nome" value={concurso.nome} onChange={(e) => setConcurso({ ...concurso, nome: e.target.value })} />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Órgão (opcional)" htmlFor="c-orgao">
                  <Input id="c-orgao" value={concurso.orgao} onChange={(e) => setConcurso({ ...concurso, orgao: e.target.value })} />
                </Campo>
                <Campo rotulo="Cargo (opcional)" htmlFor="c-cargo">
                  <Input id="c-cargo" value={concurso.cargo} onChange={(e) => setConcurso({ ...concurso, cargo: e.target.value })} />
                </Campo>
                <Campo rotulo="Banca (opcional)" htmlFor="c-banca">
                  <Select id="c-banca" valor={concurso.bancaId} aoMudar={(v) => setConcurso({ ...concurso, bancaId: v })}
                    opcoes={[{ valor: "", rotulo: "Ainda não definida" }, ...bancas.map((b) => ({ valor: b.id, rotulo: b.sigla }))]} />
                </Campo>
                <Campo rotulo="Data da prova (se conhecida)" htmlFor="c-data">
                  <Input id="c-data" type="date" value={concurso.dataProva} onChange={(e) => setConcurso({ ...concurso, dataProva: e.target.value })} />
                </Campo>
              </div>
            </>
          )}

          {etapa === 1 && (
            <>
              <div>
                <p className="mb-2 text-sm font-medium">Sugestões</p>
                <div className="flex flex-wrap gap-2">
                  {sugestoes.map((s) => (
                    <button key={s} type="button" onClick={() => adicionar(s)} className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm hover:bg-accent">
                      <Plus className="size-3.5" /> {s}
                    </button>
                  ))}
                </div>
              </div>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); adicionar(novaDisciplina); setNovaDisciplina(""); }}>
                <Input placeholder="Outra disciplina" value={novaDisciplina} onChange={(e) => setNovaDisciplina(e.target.value)} aria-label="Nova disciplina" />
                <Button type="submit" variant="outline">Adicionar</Button>
              </form>
              {disciplinas.length > 0 && (
                <div className="grid gap-2">
                  <div className="hidden grid-cols-[1fr_auto_auto_auto] gap-4 px-3 text-xs text-muted-foreground sm:grid">
                    <span>Disciplina</span><span>Dificuldade</span><span>Prioridade</span><span />
                  </div>
                  {disciplinas.map((d, i) => (
                    <div key={d.nome} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:gap-4">
                      <span className="font-medium">{d.nome}</span>
                      <Escala rotulo="Dificuldade" valor={d.dificuldade} aoMudar={(v) => setDisciplinas(disciplinas.map((x, k) => (k === i ? { ...x, dificuldade: v } : x)))} />
                      <Escala rotulo="Prioridade" valor={d.prioridade} aoMudar={(v) => setDisciplinas(disciplinas.map((x, k) => (k === i ? { ...x, prioridade: v } : x)))} />
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover ${d.nome}`} onClick={() => setDisciplinas(disciplinas.filter((_, k) => k !== i))}><X /></Button>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">1 = baixa, 5 = alta. Disciplinas mais difíceis e prioritárias recebem mais tempo no cronograma.</p>
                </div>
              )}
            </>
          )}

          {etapa === 2 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">Informe quando você realmente pode estudar.</p>
                <Badge variant="info">Total semanal: {formatarDuracao(minutosSemana * 60)}</Badge>
              </div>
              <EditorDisponibilidade janelas={janelas} aoMudar={setJanelas} diasDescanso={diasDescanso} />
            </>
          )}

          {etapa === 3 && (
            <>
              <div>
                <p className="mb-2 text-sm font-medium">Dias de descanso</p>
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <label key={d} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                      <Checkbox checked={diasDescanso.includes(d)} onCheckedChange={(v) => setDiasDescanso(v ? [...diasDescanso, d] : diasDescanso.filter((x) => x !== d))} />
                      {NOMES_DIAS[d]}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Como prefere estudar?</p>
                <div className="flex flex-wrap gap-2">
                  {PREFERENCIAS.map((p) => (
                    <label key={p.valor} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                      <Checkbox checked={preferencias.includes(p.valor)} onCheckedChange={(v) => setPreferencias(v ? [...preferencias, p.valor] : preferencias.filter((x) => x !== p.valor))} />
                      {p.rotulo}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Campo rotulo="Questões por dia" htmlFor="m-q">
                  <Input id="m-q" type="number" min={0} max={1000} value={metas.questoesDia} onChange={(e) => setMetas({ ...metas, questoesDia: Number(e.target.value) })} />
                </Campo>
                <Campo rotulo="Horas por semana" htmlFor="m-h">
                  <Input id="m-h" type="number" min={0} max={100} step={0.5} value={metas.horasSemana} onChange={(e) => setMetas({ ...metas, horasSemana: Number(e.target.value) })} />
                </Campo>
                <Campo rotulo="Simulados por mês" htmlFor="m-s">
                  <Input id="m-s" type="number" min={0} max={60} value={metas.simuladosMes} onChange={(e) => setMetas({ ...metas, simuladosMes: Number(e.target.value) })} />
                </Campo>
              </div>
              {minutosSemana > 0 && metas.horasSemana * 60 > minutosSemana && (
                <Aviso tipo="alerta">A meta semanal ({metas.horasSemana} h) é maior que a disponibilidade informada ({formatarDuracao(minutosSemana * 60)}).</Aviso>
              )}
            </>
          )}

          {etapa === 4 && (
            <dl className="grid gap-3 text-sm">
              <div><dt className="text-muted-foreground">Concurso</dt><dd className="font-medium">{concurso.nome}{concurso.cargo && ` — ${concurso.cargo}`}{concurso.dataProva && ` · prova em ${new Date(`${concurso.dataProva}T12:00`).toLocaleDateString("pt-BR")}`}</dd></div>
              <div><dt className="text-muted-foreground">Disciplinas</dt><dd className="flex flex-wrap gap-1">{disciplinas.map((d) => <Badge key={d.nome}>{d.nome}</Badge>)}</dd></div>
              <div><dt className="text-muted-foreground">Disponibilidade</dt><dd className="font-medium">{janelas.length ? `${formatarDuracao(minutosSemana * 60)} por semana` : "Não informada"}</dd></div>
              <div><dt className="text-muted-foreground">Metas</dt><dd className="font-medium">{metas.questoesDia} questões/dia · {metas.horasSemana} h/semana · {metas.simuladosMes} simulados/mês</dd></div>
            </dl>
          )}

          <div className="flex justify-between gap-2 border-t pt-5">
            <Button type="button" variant="ghost" onClick={() => { setErro(undefined); setEtapa((e) => Math.max(0, e - 1)); }} disabled={etapa === 0 || pendente}>
              <ArrowLeft /> Voltar
            </Button>
            {etapa < ETAPAS.length - 1 ? (
              <Button type="button" onClick={avancar}>Continuar <ArrowRight /></Button>
            ) : (
              <Button type="button" onClick={concluir} carregando={pendente}><Check /> Concluir e gerar cronograma</Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
