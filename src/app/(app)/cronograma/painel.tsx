"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Progress } from "@/components/ui/basicos";
import { Checkbox } from "@/components/ui/formulario";
import { Aviso } from "@/components/ui/layout";
import { EditorDisponibilidade, janelasSobrepostas, type Janela } from "@/components/estudo/editor-disponibilidade";
import { horasSemanaisNecessarias, type Projecao } from "@/lib/estudo/projecao";
import { NOMES_DIAS } from "@/lib/estudo/tempo";
import { formatarData, formatarDataHora } from "@/lib/utils";
import { adicionarBloqueio, removerBloqueio, resolverReplanejamento, salvarDisponibilidade } from "./acoes";

interface Proposta { id: string; motivo: string; inicio: string; fim: string; titulo: string; original: string }

const SITUACAO: Record<Projecao["situacao"], { rotulo: string; variante: "success" | "warning" | "destructive" | "outline" }> = {
  folgado: { rotulo: "Tempo suficiente", variante: "success" },
  no_limite: { rotulo: "No limite", variante: "warning" },
  insuficiente: { rotulo: "Tempo insuficiente", variante: "destructive" },
  sem_data: { rotulo: "Sem data de prova", variante: "outline" },
  prova_passou: { rotulo: "Data da prova já passou", variante: "outline" },
};

export function PainelCronograma({ janelas: iniciais, diasDescanso: descansoInicial, horasSemanais, bloqueios, propostas, projecao, dataProva }: {
  janelas: Janela[]; diasDescanso: number[]; horasSemanais: number; bloqueios: { id: string; inicio: string; fim: string; motivo: string | null }[];
  propostas: Proposta[]; projecao: Projecao; dataProva: string | null;
}) {
  const router = useRouter();
  const [janelas, setJanelas] = useState(iniciais);
  const [descanso, setDescanso] = useState(descansoInicial);
  const [editando, setEditando] = useState(false);
  const [bloqueio, setBloqueio] = useState({ inicio: "", fim: "", motivo: "" });
  const [modificando, setModificando] = useState<string | null>(null);
  const [novoHorario, setNovoHorario] = useState({ inicio: "", fim: "" });
  const [cenario, setCenario] = useState(Math.round(horasSemanais));
  const [pendente, iniciar] = useTransition();

  const p = projecao;
  const cenarioCalc = p.semanasRestantes ? { ...p, horasDisponiveis: cenario * p.semanasRestantes } : null;
  const necessarias = horasSemanaisNecessarias(p);

  return (
    <div className="grid content-start gap-4">
      {propostas.length > 0 && (
        <Card className="border-warning/60">
          <CardHeader><CardTitle>Replanejamento sugerido</CardTitle><CardDescription>Atividades não realizadas e um novo horário livre para cada uma.</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            {propostas.map((pr) => (
              <div key={pr.id} className="grid gap-2 rounded-lg border p-3 text-sm">
                <p className="font-medium">{pr.titulo}</p>
                <p className="text-xs text-muted-foreground">Era {formatarDataHora(pr.original)} → sugerido {formatarDataHora(pr.inicio)}</p>
                {modificando === pr.id ? (
                  <div className="grid gap-2">
                    <Input type="datetime-local" aria-label="Novo início" value={novoHorario.inicio} onChange={(e) => setNovoHorario({ ...novoHorario, inicio: e.target.value })} />
                    <Input type="datetime-local" aria-label="Novo fim" value={novoHorario.fim} onChange={(e) => setNovoHorario({ ...novoHorario, fim: e.target.value })} />
                    <Button size="sm" disabled={!novoHorario.inicio || !novoHorario.fim || pendente} onClick={() => iniciar(async () => {
                      const r = await resolverReplanejamento({ id: pr.id, decisao: "modificada", inicio: new Date(novoHorario.inicio).toISOString(), fim: new Date(novoHorario.fim).toISOString() });
                      if (r.ok) { setModificando(null); router.refresh(); } else toast.error(r.erro);
                    })}>Confirmar horário</Button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <Button size="sm" disabled={pendente} onClick={() => iniciar(async () => { const r = await resolverReplanejamento({ id: pr.id, decisao: "aceita" }); if (r.ok) router.refresh(); else toast.error(r.erro); })}><Check /> Aceitar</Button>
                    <Button size="sm" variant="outline" onClick={() => { setModificando(pr.id); setNovoHorario({ inicio: pr.inicio.slice(0, 16), fim: pr.fim.slice(0, 16) }); }}><Pencil /> Modificar</Button>
                    <Button size="sm" variant="ghost" disabled={pendente} onClick={() => iniciar(async () => { const r = await resolverReplanejamento({ id: pr.id, decisao: "rejeitada" }); if (r.ok) router.refresh(); else toast.error(r.erro); })}><X /> Rejeitar</Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Preparação até a prova</CardTitle><CardDescription>Estimativa a partir da teoria restante nos seus PDFs e da sua disponibilidade. Não é garantia de aprovação.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="flex items-center justify-between"><span>{dataProva ? `Prova em ${formatarData(dataProva)}` : "Data da prova não informada"}</span><Badge variant={SITUACAO[p.situacao].variante}>{SITUACAO[p.situacao].rotulo}</Badge></div>
          <div>
            <div className="mb-1 flex justify-between text-xs"><span>Teoria lida</span><span>{Math.round(p.progressoRealizado * 100)}%{p.progressoEsperado !== null ? ` · esperado ${Math.round(p.progressoEsperado * 100)}%` : ""}</span></div>
            <Progress value={p.progressoRealizado * 100} />
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <dt className="text-muted-foreground">Páginas restantes</dt><dd className="text-right tabular-nums">{p.paginasRestantes}</dd>
            <dt className="text-muted-foreground">Horas necessárias</dt><dd className="text-right tabular-nums">{Math.round(p.horasNecessarias)} h</dd>
            {p.horasDisponiveis !== null && <><dt className="text-muted-foreground">Horas disponíveis</dt><dd className="text-right tabular-nums">{Math.round(p.horasDisponiveis)} h</dd></>}
            {p.ritmoPaginasSemana !== null && <><dt className="text-muted-foreground">Ritmo necessário</dt><dd className="text-right tabular-nums">{Math.round(p.ritmoPaginasSemana)} páginas/semana</dd></>}
            {necessarias !== null && <><dt className="text-muted-foreground">Horas/semana necessárias</dt><dd className="text-right tabular-nums">{necessarias.toFixed(1)} h</dd></>}
          </dl>
          {p.semanasRestantes !== null && p.semanasRestantes > 0 && cenarioCalc && (
            <div className="rounded-md border p-2">
              <label className="text-xs" htmlFor="cenario">Cenário: {cenario} h por semana</label>
              <input id="cenario" type="range" min={1} max={60} value={cenario} onChange={(e) => setCenario(Number(e.target.value))} className="w-full accent-primary" />
              <p className="text-xs text-muted-foreground">
                {Math.round(cenarioCalc.horasDisponiveis)} h disponíveis até a prova:{" "}
                {cenarioCalc.horasDisponiveis >= p.horasNecessarias ? "cobre o necessário" : `faltariam ${Math.round(p.horasNecessarias - cenarioCalc.horasDisponiveis)} h`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div><CardTitle>Disponibilidade</CardTitle><CardDescription>{horasSemanais.toFixed(1)} h por semana</CardDescription></div>
          <Button size="sm" variant="outline" onClick={() => setEditando(!editando)}>{editando ? "Fechar" : "Editar"}</Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!editando ? (
            <ul className="grid gap-1 text-sm">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const doDia = iniciais.filter((j) => j.diaSemana === d);
                return (
                  <li key={d} className="flex justify-between">
                    <span className="text-muted-foreground">{NOMES_DIAS[d]}</span>
                    <span>{descansoInicial.includes(d) ? "descanso" : doDia.length ? doDia.map((j) => `${String(Math.floor(j.inicioMin / 60)).padStart(2, "0")}:${String(j.inicioMin % 60).padStart(2, "0")}–${String(Math.floor(j.fimMin / 60)).padStart(2, "0")}:${String(j.fimMin % 60).padStart(2, "0")}`).join(", ") : "—"}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <>
              <EditorDisponibilidade janelas={janelas} aoMudar={setJanelas} diasDescanso={descanso} />
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="w-full text-xs font-medium">Dias de descanso</span>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <label key={d} className="flex items-center gap-1.5"><Checkbox checked={descanso.includes(d)} onCheckedChange={(v) => setDescanso(v ? [...descanso, d] : descanso.filter((x) => x !== d))} />{NOMES_DIAS[d].slice(0, 3)}</label>
                ))}
              </div>
              {janelasSobrepostas(janelas) && <Aviso tipo="erro">Há horários sobrepostos no mesmo dia.</Aviso>}
              <Button disabled={janelasSobrepostas(janelas) || pendente} onClick={() => iniciar(async () => {
                const r = await salvarDisponibilidade({ janelas, diasDescanso: descanso });
                if (r.ok) { toast.success("Disponibilidade salva. Gere o cronograma para aplicar."); setEditando(false); router.refresh(); } else toast.error(r.erro);
              })}>Salvar disponibilidade</Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Indisponibilidades</CardTitle><CardDescription>Viagens, compromissos ou folgas extras. Atividades no período vão para replanejamento.</CardDescription></CardHeader>
        <CardContent className="grid gap-2">
          <div className="grid gap-2">
            <Input type="datetime-local" aria-label="Início" value={bloqueio.inicio} onChange={(e) => setBloqueio({ ...bloqueio, inicio: e.target.value })} />
            <Input type="datetime-local" aria-label="Fim" value={bloqueio.fim} onChange={(e) => setBloqueio({ ...bloqueio, fim: e.target.value })} />
            <Input aria-label="Motivo" placeholder="Motivo (opcional)" value={bloqueio.motivo} onChange={(e) => setBloqueio({ ...bloqueio, motivo: e.target.value })} />
            <Button size="sm" variant="outline" disabled={!bloqueio.inicio || !bloqueio.fim || pendente} onClick={() => iniciar(async () => {
              const r = await adicionarBloqueio({ inicio: new Date(bloqueio.inicio).toISOString(), fim: new Date(bloqueio.fim).toISOString(), motivo: bloqueio.motivo });
              if (r.ok) { setBloqueio({ inicio: "", fim: "", motivo: "" }); router.refresh(); } else toast.error(r.erro);
            })}>Adicionar indisponibilidade</Button>
          </div>
          {bloqueios.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs">
              <span>{formatarDataHora(b.inicio)} → {formatarDataHora(b.fim)}{b.motivo ? ` · ${b.motivo}` : ""}</span>
              <Button size="icon-sm" variant="ghost" aria-label="Remover" onClick={() => iniciar(async () => { const r = await removerBloqueio(b.id); if (r.ok) router.refresh(); else toast.error(r.erro); })}><Trash2 /></Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
