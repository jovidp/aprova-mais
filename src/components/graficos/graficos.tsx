"use client";

import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps,
} from "recharts";
import { Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type Formato = "numero" | "percentual" | "minutos" | "nota";

export interface Ponto {
  rotulo: string;
  valor: number | null;
  /** Texto extra no tooltip (ex.: "12 de 20 questões"). */
  detalhe?: string;
}

function formatar(v: number | null | undefined, f: Formato) {
  if (v === null || v === undefined) return "—";
  if (f === "percentual") return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (f === "minutos") return v >= 60 ? `${Math.floor(v / 60)}h${String(Math.round(v % 60)).padStart(2, "0")}` : `${Math.round(v)} min`;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

const EIXO = { stroke: "var(--chart-eixo)", fontSize: 11, tickLine: false, axisLine: false } as const;

function Dica({ active, payload, formato, nomeSerie }: TooltipContentProps<number, string> & { formato: Formato; nomeSerie: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Ponto;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium text-foreground">{p.rotulo}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
        <span className="size-2 rounded-full" style={{ background: "var(--chart-1)" }} aria-hidden />
        {nomeSerie}: <span className="font-medium text-foreground tabular-nums">{formatar(p.valor, formato)}</span>
      </div>
      {p.detalhe && <div className="mt-0.5 text-muted-foreground">{p.detalhe}</div>}
    </div>
  );
}

/** Tabela equivalente ao gráfico (acessibilidade e leitura exata). */
function TabelaDados({ dados, formato, nomeSerie }: { dados: Ponto[]; formato: Formato; nomeSerie: string }) {
  return (
    <div className="max-h-56 overflow-y-auto rounded-md border text-xs">
      <table className="w-full">
        <thead className="sticky top-0 bg-muted"><tr><th className="px-2 py-1 text-left font-medium">Item</th><th className="px-2 py-1 text-right font-medium">{nomeSerie}</th></tr></thead>
        <tbody>
          {dados.map((d) => (
            <tr key={d.rotulo} className="border-t"><td className="px-2 py-1">{d.rotulo}</td><td className="px-2 py-1 text-right tabular-nums">{formatar(d.valor, formato)}{d.detalhe ? ` (${d.detalhe})` : ""}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PropsGrafico {
  titulo: string;
  descricao?: string;
  dados: Ponto[];
  formato?: Formato;
  nomeSerie: string;
  altura?: number;
  vazio?: string;
  dominio?: [number, number];
  className?: string;
}

function Moldura({ titulo, descricao, dados, formato = "numero", nomeSerie, vazio, className, children }: PropsGrafico & { children: React.ReactNode }) {
  const [tabela, setTabela] = useState(false);
  const temDados = dados.some((d) => d.valor !== null && d.valor !== 0);
  return (
    <figure className={cn("rounded-xl border bg-card p-4 shadow-sm", className)}>
      <figcaption className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{titulo}</div>
          {descricao && <div className="text-xs text-muted-foreground">{descricao}</div>}
        </div>
        {temDados && (
          <button onClick={() => setTabela(!tabela)} aria-pressed={tabela} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label={tabela ? "Ver gráfico" : "Ver tabela"}>
            <Table2 className="size-4" />
          </button>
        )}
      </figcaption>
      {!temDados ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed px-4 text-center text-xs text-muted-foreground">
          {vazio ?? "Sem registros no período."}
        </div>
      ) : tabela ? (
        <TabelaDados dados={dados} formato={formato} nomeSerie={nomeSerie} />
      ) : (
        children
      )}
    </figure>
  );
}

export function GraficoLinha(props: PropsGrafico) {
  const { dados, formato = "numero", nomeSerie, altura = 220, dominio } = props;
  return (
    <Moldura {...props}>
      <ResponsiveContainer width="100%" height={altura}>
        <LineChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grade)" />
          <XAxis dataKey="rotulo" {...EIXO} minTickGap={16} />
          <YAxis {...EIXO} domain={dominio ?? ["auto", "auto"]} tickFormatter={(v) => formatar(v, formato)} width={52} />
          <Tooltip content={(p) => <Dica {...(p as TooltipContentProps<number, string>)} formato={formato} nomeSerie={nomeSerie} />} cursor={{ stroke: "var(--chart-eixo)", strokeDasharray: "3 3" }} />
          <Line type="monotone" dataKey="valor" stroke="var(--chart-1)" strokeWidth={2} connectNulls={false}
            dot={{ r: 4, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }} activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Moldura>
  );
}

export function GraficoBarras(props: PropsGrafico & { horizontal?: boolean; cor?: string }) {
  const { dados, formato = "numero", nomeSerie, altura = 220, horizontal, cor = "var(--chart-1)", dominio } = props;
  const alturaReal = horizontal ? Math.max(altura, dados.length * 30 + 20) : altura;
  return (
    <Moldura {...props}>
      <ResponsiveContainer width="100%" height={alturaReal}>
        <BarChart data={dados} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, bottom: 0, left: horizontal ? 0 : -12 }} barCategoryGap={horizontal ? 6 : "20%"}>
          <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--chart-grade)" />
          {horizontal ? (
            <>
              <XAxis type="number" {...EIXO} domain={dominio ?? [0, "auto"]} tickFormatter={(v) => formatar(v, formato)} />
              <YAxis type="category" dataKey="rotulo" {...EIXO} width={140} tick={{ fontSize: 11, fill: "var(--chart-eixo)" }} />
            </>
          ) : (
            <>
              <XAxis dataKey="rotulo" {...EIXO} minTickGap={8} />
              <YAxis {...EIXO} domain={dominio ?? [0, "auto"]} tickFormatter={(v) => formatar(v, formato)} width={52} />
            </>
          )}
          <Tooltip content={(p) => <Dica {...(p as TooltipContentProps<number, string>)} formato={formato} nomeSerie={nomeSerie} />} cursor={{ fill: "var(--muted)", opacity: 0.6 }} />
          <Bar dataKey="valor" fill={cor} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={horizontal ? 18 : 28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Moldura>
  );
}

/** Mapa de calor de estudo (estilo calendário): uma coluna por semana. */
export function MapaCalor({ titulo, descricao, dias }: { titulo: string; descricao?: string; dias: { data: string; minutos: number }[] }) {
  const max = Math.max(0, ...dias.map((d) => d.minutos));
  const nivel = (m: number) => (m <= 0 || max === 0 ? 0 : Math.min(5, Math.ceil((m / max) * 5)));
  const primeiro = dias[0] ? new Date(`${dias[0].data}T12:00:00`).getDay() : 0;
  const celulas: ({ data: string; minutos: number } | null)[] = [...Array(primeiro).fill(null), ...dias];
  const semanas: (typeof celulas)[] = [];
  for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7));
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

  return (
    <figure className="rounded-xl border bg-card p-4 shadow-sm">
      <figcaption className="mb-3">
        <div className="text-sm font-medium">{titulo}</div>
        {descricao && <div className="text-xs text-muted-foreground">{descricao}</div>}
      </figcaption>
      {max === 0 ? (
        <div className="flex h-28 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">Nenhuma sessão de estudo registrada no período.</div>
      ) : (
        <>
          <div className="flex gap-[3px] overflow-x-auto pb-1" role="img" aria-label={`${titulo}: máximo de ${formatar(max, "minutos")} em um dia`}>
            {semanas.map((s, i) => (
              <div key={i} className="grid grid-rows-7 gap-[3px]">
                {s.map((c, j) => c ? (
                  <div key={c.data} title={`${fmt(c.data)}: ${formatar(c.minutos, "minutos")}`}
                    className="size-3 rounded-[3px] ring-offset-card hover:ring-2 hover:ring-ring"
                    style={{ background: `var(--seq-${nivel(c.minutos)})` }} />
                ) : <div key={`v${j}`} className="size-3" />)}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
            menos {[0, 1, 2, 3, 4, 5].map((n) => <span key={n} className="size-2.5 rounded-[2px]" style={{ background: `var(--seq-${n})` }} />)} mais
          </div>
        </>
      )}
    </figure>
  );
}
