"use client";

import Link from "next/link";
import { useState } from "react";
import { BarChart3, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/basicos";
import { Checkbox } from "@/components/ui/formulario";
import { Tabela } from "@/components/ui/layout";
import { ROTULO_STATUS_SIMULADO, type StatusSimulado } from "@/lib/simulados/status";
import { TIPOS_SIMULADO, type TipoSimulado } from "@/lib/simulados/config";
import { formatarData, formatarDuracao, formatarPercentual } from "@/lib/utils";

export interface LinhaSimulado {
  id: string;
  nome: string;
  tipo: string;
  totalQuestoes: number;
  tempoLimiteSeg: number | null;
  criadoEm: string;
  concurso: string | null;
  status: StatusSimulado;
  tentativas: number;
  tentativaAtivaId: string | null;
  ultimo: { tentativaId: string; nota: number; notaMaxima: number; percentual: number; tempoSeg: number; data: string } | null;
}

export function ListaSimulados({ linhas }: { linhas: LinhaSimulado[] }) {
  const [comparar, setComparar] = useState<string[]>([]);
  return (
    <div className="grid gap-3">
      {comparar.length >= 2 && (
        <div className="flex items-center justify-between rounded-lg border bg-card p-3 text-sm">
          <span>{comparar.length} simulados selecionados</span>
          <Button size="sm" asChild><Link href={`/simulados/comparar?t=${comparar.join(",")}`}><BarChart3 /> Comparar</Link></Button>
        </div>
      )}
      <Tabela>
        <thead>
          <tr><th className="w-8"><span className="sr-only">Comparar</span></th><th>Simulado</th><th>Data</th><th>Questões</th><th>Status</th><th className="text-right">Nota</th><th className="text-right">Acerto</th><th className="text-right">Tempo</th><th /></tr>
        </thead>
        <tbody>
          {linhas.map((s) => {
            const st = ROTULO_STATUS_SIMULADO[s.status];
            return (
              <tr key={s.id}>
                <td>
                  {s.ultimo && <Checkbox aria-label={`Comparar ${s.nome}`} checked={comparar.includes(s.ultimo.tentativaId)}
                    onCheckedChange={(v) => setComparar((l) => (v ? [...l, s.ultimo!.tentativaId] : l.filter((x) => x !== s.ultimo!.tentativaId)))} />}
                </td>
                <td>
                  <Link href={`/simulados/${s.id}`} className="font-medium hover:text-primary">{s.nome}</Link>
                  <div className="text-xs text-muted-foreground">{TIPOS_SIMULADO[s.tipo as TipoSimulado]?.rotulo ?? s.tipo}{s.concurso ? ` · ${s.concurso}` : ""}{s.tentativas > 1 ? ` · ${s.tentativas} tentativas` : ""}</div>
                </td>
                <td>{formatarData(s.ultimo?.data ?? s.criadoEm)}</td>
                <td className="tabular-nums">{s.totalQuestoes}{s.tempoLimiteSeg ? <span className="text-xs text-muted-foreground"> · {Math.round(s.tempoLimiteSeg / 60)} min</span> : null}</td>
                <td><Badge variant={st.variante}>{st.rotulo}</Badge></td>
                <td className="text-right tabular-nums">{s.ultimo ? `${s.ultimo.nota.toLocaleString("pt-BR")}/${s.ultimo.notaMaxima.toLocaleString("pt-BR")}` : "—"}</td>
                <td className="text-right tabular-nums">{s.ultimo ? formatarPercentual(s.ultimo.percentual) : "—"}</td>
                <td className="text-right tabular-nums">{s.ultimo ? formatarDuracao(s.ultimo.tempoSeg) : "—"}</td>
                <td className="text-right">
                  {s.tentativaAtivaId ? <Button size="sm" asChild><Link href={`/simulados/prova/${s.tentativaAtivaId}`}><Play /> Continuar</Link></Button>
                    : s.ultimo ? <Button size="sm" variant="outline" asChild><Link href={`/simulados/resultado/${s.ultimo.tentativaId}`}>Resultado</Link></Button>
                    : <Button size="sm" asChild><Link href={`/simulados/${s.id}`}><Play /> Iniciar</Link></Button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Tabela>
    </div>
  );
}
