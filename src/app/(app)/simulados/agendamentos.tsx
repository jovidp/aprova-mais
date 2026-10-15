"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui/basicos";
import { Campo, Select, Switch } from "@/components/ui/formulario";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/sobreposicoes";
import { TIPOS_SIMULADO, type TipoSimulado } from "@/lib/simulados/config";
import { NOMES_DIAS } from "@/lib/estudo/tempo";
import { formatarDataHora } from "@/lib/utils";
import { alternarAgendamento, excluirAgendamento, salvarAgendamento } from "./acoes";

interface Agendamento {
  id: string; nome: string; frequencia: string; dia_semana: number | null; dia_mes: number | null; data_unica: string | null; hora: string;
  ativo: boolean; proxima_execucao_em: string | null; ultima_execucao_em: string | null; ultimo_simulado_id: string | null; ultimo_erro: string | null;
  config: { tipo: TipoSimulado; quantidade: number };
}

const DESCRICAO_FREQ: Record<string, string> = { semanal: "Toda semana", quinzenal: "A cada 15 dias", mensal: "Todo mês", data_unica: "Uma vez" };

export function Agendamentos({ agendamentos, disciplinas }: { agendamentos: Agendamento[]; disciplinas: { id: string; nome: string }[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  const [f, setF] = useState({
    nome: "Simulado semanal", frequencia: "semanal" as "semanal" | "quinzenal" | "mensal" | "data_unica", diaSemana: 0, diaMes: 1, dataUnica: "", hora: "08:00",
    tipo: "semanal" as TipoSimulado, quantidade: 40, tempo: 60, disciplina: "", permitirIA: false,
  });

  return (
    <Card className="mt-8">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Simulados agendados</CardTitle>
          <CardDescription>Ficam prontos na data programada (verificação diária). Geração com IA só se você permitir e houver orçamento.</CardDescription>
        </div>
        <Dialog open={aberto} onOpenChange={setAberto}>
          <DialogTrigger asChild><Button variant="outline" size="sm"><CalendarPlus /> Agendar</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Agendar simulado</DialogTitle><DialogDescription>Ex.: todo domingo, 40 questões dos assuntos estudados na semana.</DialogDescription></DialogHeader>
            <div className="grid gap-3">
              <Campo rotulo="Nome" htmlFor="ag-nome"><Input id="ag-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Frequência" htmlFor="ag-freq">
                  <Select id="ag-freq" valor={f.frequencia} aoMudar={(v) => setF({ ...f, frequencia: v as typeof f.frequencia })}
                    opcoes={[{ valor: "semanal", rotulo: "Semanal" }, { valor: "quinzenal", rotulo: "Quinzenal" }, { valor: "mensal", rotulo: "Mensal" }, { valor: "data_unica", rotulo: "Data específica" }]} />
                </Campo>
                {(f.frequencia === "semanal" || f.frequencia === "quinzenal") && (
                  <Campo rotulo="Dia da semana" htmlFor="ag-dia">
                    <Select id="ag-dia" valor={String(f.diaSemana)} aoMudar={(v) => setF({ ...f, diaSemana: Number(v) })} opcoes={NOMES_DIAS.map((n, i) => ({ valor: String(i), rotulo: n }))} />
                  </Campo>
                )}
                {f.frequencia === "mensal" && (
                  <Campo rotulo="Dia do mês" htmlFor="ag-mes"><Input id="ag-mes" type="number" min={1} max={28} value={f.diaMes} onChange={(e) => setF({ ...f, diaMes: Number(e.target.value) })} /></Campo>
                )}
                {f.frequencia === "data_unica" && (
                  <Campo rotulo="Data" htmlFor="ag-data"><Input id="ag-data" type="date" value={f.dataUnica} onChange={(e) => setF({ ...f, dataUnica: e.target.value })} /></Campo>
                )}
                <Campo rotulo="Hora" htmlFor="ag-hora"><Input id="ag-hora" type="time" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} /></Campo>
                <Campo rotulo="Tipo" htmlFor="ag-tipo">
                  <Select id="ag-tipo" valor={f.tipo} aoMudar={(v) => setF({ ...f, tipo: v as TipoSimulado })}
                    opcoes={(["semanal", "revisao_acumulada", "adaptativo", "geral", "disciplina", "erros", "diagnostico"] as TipoSimulado[]).map((t) => ({ valor: t, rotulo: TIPOS_SIMULADO[t].rotulo }))} />
                </Campo>
                {f.tipo === "disciplina" && (
                  <Campo rotulo="Disciplina" htmlFor="ag-disc">
                    <Select id="ag-disc" valor={f.disciplina} aoMudar={(v) => setF({ ...f, disciplina: v })} opcoes={disciplinas.map((d) => ({ valor: d.id, rotulo: d.nome }))} />
                  </Campo>
                )}
                <Campo rotulo="Questões" htmlFor="ag-q"><Input id="ag-q" type="number" min={5} max={300} value={f.quantidade} onChange={(e) => setF({ ...f, quantidade: Number(e.target.value) })} /></Campo>
                <Campo rotulo="Tempo (min)" htmlFor="ag-t"><Input id="ag-t" type="number" min={5} max={720} value={f.tempo} onChange={(e) => setF({ ...f, tempo: Number(e.target.value) })} /></Campo>
              </div>
              <label className="flex items-center gap-3 text-sm"><Switch checked={f.permitirIA} onCheckedChange={(v) => setF({ ...f, permitirIA: v })} /> Permitir gerar questões com IA se faltar conteúdo (consome orçamento)</label>
            </div>
            <DialogFooter>
              <Button carregando={pendente} onClick={() => iniciar(async () => {
                const r = await salvarAgendamento({
                  nome: f.nome, frequencia: f.frequencia,
                  diaSemana: f.frequencia === "semanal" || f.frequencia === "quinzenal" ? f.diaSemana : null,
                  diaMes: f.frequencia === "mensal" ? f.diaMes : null, dataUnica: f.frequencia === "data_unica" ? f.dataUnica : null, hora: f.hora,
                  config: { tipo: f.tipo, nome: f.nome, quantidade: f.quantidade, tempoLimiteMin: f.tempo, disciplinaIds: f.disciplina ? [f.disciplina] : [], gerarComIA: f.permitirIA, aceitarMenos: true },
                  permitirIA: f.permitirIA,
                });
                if (r.ok) { toast.success(`Agendado. Próximo: ${formatarDataHora(r.dados.proxima)}`); setAberto(false); router.refresh(); } else toast.error(r.erro);
              })}>Salvar agendamento</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="grid gap-2">
        {agendamentos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum agendamento.</p>}
        {agendamentos.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{a.nome} <Badge variant="outline">{TIPOS_SIMULADO[a.config.tipo]?.rotulo} · {a.config.quantidade} questões</Badge></p>
              <p className="text-xs text-muted-foreground">
                {DESCRICAO_FREQ[a.frequencia]}{a.dia_semana !== null ? ` · ${NOMES_DIAS[a.dia_semana]}` : ""}{a.dia_mes ? ` · dia ${a.dia_mes}` : ""} às {a.hora.slice(0, 5)}
                {a.ativo && a.proxima_execucao_em ? ` · próximo: ${formatarDataHora(a.proxima_execucao_em)}` : ""}
                {a.ultimo_erro ? ` · último erro: ${a.ultimo_erro}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {a.ultimo_simulado_id && <Button size="sm" variant="outline" asChild><a href={`/simulados/${a.ultimo_simulado_id}`}>Último</a></Button>}
              <Switch aria-label={a.ativo ? "Desativar" : "Ativar"} checked={a.ativo} onCheckedChange={async (v) => { const r = await alternarAgendamento(a.id, v); if (!r.ok) toast.error(r.erro); router.refresh(); }} />
              <Button size="icon-sm" variant="ghost" aria-label="Excluir agendamento" onClick={async () => { const r = await excluirAgendamento(a.id); if (r.ok) router.refresh(); else toast.error(r.erro); }}><Trash2 /></Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
