"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BookOpen, Check, ChevronLeft, ChevronRight, ClipboardList, Layers, MoreHorizontal, NotebookPen, PenLine, Plus, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, Input } from "@/components/ui/basicos";
import { Campo, Select } from "@/components/ui/formulario";
import { Aviso } from "@/components/ui/layout";
import { Confirmar, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/sobreposicoes";
import { NOMES_DIAS_CURTOS, dataLocal, horaParaMinutos, instanteLocal, somarDias } from "@/lib/estudo/tempo";
import { cn } from "@/lib/utils";
import { atualizarAtividade, criarAtividade, excluirAtividade, regerar } from "./acoes";

export interface AtividadeAgenda {
  id: string; tipo: string; titulo: string; descricao: string | null; inicio: string; fim: string; status: string; prioridade: number; origem: string;
  material_id: string | null; pagina_inicio: number | null; pagina_fim: number | null; assunto_id: string | null; quantidade_questoes: number | null; disciplina: string | null;
}

const ICONE: Record<string, typeof BookOpen> = { leitura: BookOpen, questoes: PenLine, revisao: RotateCcw, flashcards: Layers, simulado: ClipboardList, correcao_erros: NotebookPen };
const COR: Record<string, string> = {
  leitura: "border-l-[var(--chart-1)]", questoes: "border-l-[var(--chart-3)]", revisao: "border-l-[var(--chart-4)]",
  flashcards: "border-l-[var(--chart-5)]", simulado: "border-l-[var(--chart-2)]", correcao_erros: "border-l-[var(--chart-2)]",
};
const ROTULO_STATUS: Record<string, string> = { planejada: "", em_andamento: "em andamento", concluida: "concluída", parcial: "parcial", nao_realizada: "não realizada", reagendada: "reagendada" };

function linkAtividade(a: AtividadeAgenda) {
  if (a.tipo === "leitura" && a.material_id) return `/biblioteca/${a.material_id}/ler${a.pagina_inicio ? `?pagina=${a.pagina_inicio}` : ""}`;
  if (a.tipo === "questoes") return `/resolver${a.assunto_id ? `?assunto=${a.assunto_id}` : ""}`;
  if (a.tipo === "revisao") return "/revisoes";
  if (a.tipo === "flashcards") return "/flashcards/estudar";
  if (a.tipo === "simulado") return "/simulados";
  if (a.tipo === "correcao_erros") return "/caderno-erros";
  return null;
}

export function Agenda({ semana, hoje, fuso, atividades, disciplinas, semDisponibilidade }: {
  semana: string; hoje: string; fuso: string; atividades: AtividadeAgenda[]; disciplinas: { id: string; nome: string }[]; semDisponibilidade: boolean;
}) {
  const router = useRouter();
  const caminho = usePathname();
  const [pendente, iniciar] = useTransition();
  const [nova, setNova] = useState({ titulo: "", tipo: "leitura", data: hoje, inicio: "19:00", fim: "20:00", disciplina: "" });
  const [aberto, setAberto] = useState(false);
  const dias = Array.from({ length: 7 }, (_, i) => somarDias(semana, i));
  const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: fuso });
  const planejadas = atividades.filter((a) => a.status !== "reagendada");
  const concluidas = planejadas.filter((a) => a.status === "concluida" || a.status === "parcial").length;

  const mudarStatus = (a: AtividadeAgenda, status: "concluida" | "parcial" | "nao_realizada" | "planejada") => iniciar(async () => {
    const r = await atualizarAtividade({ id: a.id, status });
    if (r.ok) router.refresh(); else toast.error(r.erro);
  });

  return (
    <Card>
      <CardContent className="grid gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon-sm" aria-label="Semana anterior" onClick={() => router.push(`${caminho}?semana=${somarDias(semana, -7)}`)}><ChevronLeft /></Button>
          <Button variant="outline" size="sm" onClick={() => router.push(caminho)}>Hoje</Button>
          <Button variant="outline" size="icon-sm" aria-label="Próxima semana" onClick={() => router.push(`${caminho}?semana=${somarDias(semana, 7)}`)}><ChevronRight /></Button>
          <span className="text-sm font-medium">
            {new Date(`${semana}T12:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – {new Date(`${somarDias(semana, 6)}T12:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
          {planejadas.length > 0 && <Badge variant="outline">{concluidas}/{planejadas.length} concluídas</Badge>}
          <div className="ml-auto flex gap-2">
            <Dialog open={aberto} onOpenChange={setAberto}>
              <DialogTrigger asChild><Button variant="outline" size="sm"><Plus /> Atividade</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Nova atividade</DialogTitle></DialogHeader>
                <div className="grid gap-3">
                  <Campo rotulo="Título" htmlFor="at-t"><Input id="at-t" value={nova.titulo} onChange={(e) => setNova({ ...nova, titulo: e.target.value })} /></Campo>
                  <div className="grid grid-cols-2 gap-3">
                    <Select aria-label="Tipo" valor={nova.tipo} aoMudar={(v) => setNova({ ...nova, tipo: v })}
                      opcoes={[["leitura", "Leitura"], ["questoes", "Questões"], ["revisao", "Revisão"], ["flashcards", "Flashcards"], ["simulado", "Simulado"], ["correcao_erros", "Correção de erros"], ["outro", "Outro"]].map(([v, r]) => ({ valor: v, rotulo: r }))} />
                    <Select aria-label="Disciplina" valor={nova.disciplina} aoMudar={(v) => setNova({ ...nova, disciplina: v })} opcoes={[{ valor: "", rotulo: "Disciplina (opcional)" }, ...disciplinas.map((d) => ({ valor: d.id, rotulo: d.nome }))]} />
                    <Input aria-label="Data" type="date" value={nova.data} onChange={(e) => setNova({ ...nova, data: e.target.value })} />
                    <div className="flex gap-2">
                      <Input aria-label="Início" type="time" value={nova.inicio} onChange={(e) => setNova({ ...nova, inicio: e.target.value })} />
                      <Input aria-label="Fim" type="time" value={nova.fim} onChange={(e) => setNova({ ...nova, fim: e.target.value })} />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button carregando={pendente} onClick={() => iniciar(async () => {
                    const r = await criarAtividade({
                      titulo: nova.titulo, tipo: nova.tipo, disciplinaId: nova.disciplina || null,
                      inicio: instanteLocal(nova.data, horaParaMinutos(nova.inicio), fuso).toISOString(), fim: instanteLocal(nova.data, horaParaMinutos(nova.fim), fuso).toISOString(),
                    });
                    if (r.ok) { setAberto(false); router.refresh(); } else toast.error(r.erro);
                  })}>Adicionar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Confirmar titulo="Gerar o cronograma novamente?" confirmar="Gerar"
              descricao="As atividades futuras criadas automaticamente são recalculadas com base na sua disponibilidade, nos pesos, no desempenho e nas revisões pendentes. Atividades concluídas e as que você criou manualmente são mantidas."
              aoConfirmar={async () => { const r = await regerar(); if (r.ok) { toast.success(`${r.dados.criadas} atividades planejadas para as próximas duas semanas.`); router.refresh(); } else toast.error(r.erro); }}>
              <Button size="sm"><RefreshCw /> Gerar cronograma</Button>
            </Confirmar>
          </div>
        </div>

        {semDisponibilidade && <Aviso tipo="alerta">Informe sua disponibilidade semanal ao lado para que o cronograma possa ser gerado.</Aviso>}

        <div className="grid gap-3 md:grid-cols-7">
          {dias.map((dia, i) => {
            const doDia = atividades.filter((a) => dataLocal(new Date(a.inicio), fuso) === dia);
            return (
              <div key={dia} className={cn("min-h-32 rounded-lg border p-2", dia === hoje && "border-primary bg-primary/5")}>
                <div className="mb-2 flex items-baseline justify-between text-xs">
                  <span className="font-semibold">{NOMES_DIAS_CURTOS[(i + 1) % 7]}</span>
                  <span className="text-muted-foreground">{dia.slice(8, 10)}/{dia.slice(5, 7)}</span>
                </div>
                <div className="grid gap-1.5">
                  {doDia.length === 0 && <p className="text-[11px] text-muted-foreground">—</p>}
                  {doDia.map((a) => {
                    const Icone = ICONE[a.tipo] ?? BookOpen;
                    const link = linkAtividade(a);
                    const feita = a.status === "concluida" || a.status === "parcial";
                    return (
                      <div key={a.id} className={cn("group rounded-md border border-l-4 bg-card p-1.5 text-[11px] leading-tight", COR[a.tipo], (feita || a.status === "reagendada") && "opacity-60", a.status === "nao_realizada" && "border-dashed")}>
                        <div className="flex items-start gap-1">
                          <Icone className="mt-0.5 size-3 shrink-0" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <div className="text-muted-foreground tabular-nums">{hora(a.inicio)}–{hora(a.fim)}</div>
                            {link ? <Link href={link} className={cn("font-medium hover:underline", feita && "line-through")}>{a.titulo}</Link> : <span className={cn("font-medium", feita && "line-through")}>{a.titulo}</span>}
                            {ROTULO_STATUS[a.status] && <div className="text-muted-foreground">{ROTULO_STATUS[a.status]}</div>}
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><button className="rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100" aria-label={`Ações de ${a.titulo}`}><MoreHorizontal className="size-3.5" /></button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {link && <DropdownMenuItem asChild><Link href={link}>Começar</Link></DropdownMenuItem>}
                              <DropdownMenuItem onSelect={() => mudarStatus(a, "concluida")}><Check /> Concluída</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => mudarStatus(a, "parcial")}>Parcialmente</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => mudarStatus(a, "nao_realizada")}><X /> Não realizada (replanejar)</DropdownMenuItem>
                              {feita && <DropdownMenuItem onSelect={() => mudarStatus(a, "planejada")}>Desfazer</DropdownMenuItem>}
                              {!feita && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-destructive" onSelect={() => iniciar(async () => { const r = await excluirAtividade(a.id); if (r.ok) router.refresh(); else toast.error(r.erro); })}><Trash2 /> Excluir</DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
