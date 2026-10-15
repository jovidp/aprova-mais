import Link from "next/link";
import { BookOpen, ClipboardCheck, GraduationCap, LineChart, Sparkles, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";

const RECURSOS = [
  { icone: BookOpen, titulo: "Seus materiais organizados", texto: "Importe um ZIP de PDFs: aulas, assuntos e páginas são identificados automaticamente." },
  { icone: Sparkles, titulo: "Questões a partir dos PDFs", texto: "Questões autorais geradas e validadas com referência à página do material." },
  { icone: ClipboardCheck, titulo: "Simulados completos", texto: "Configure disciplina, assuntos, banca, quantidade e tempo. Correção comentada no fim." },
  { icone: LineChart, titulo: "Desempenho real", texto: "Dashboards calculados a partir das suas respostas, sem números fictícios." },
  { icone: CalendarClock, titulo: "Cronograma adaptativo", texto: "Planejamento que se ajusta aos seus resultados e à sua disponibilidade." },
];

export default function Inicio() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="size-5" aria-hidden />
          </span>
          Aprova+
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" asChild><Link href="/entrar">Entrar</Link></Button>
          <Button asChild><Link href="/cadastro">Criar conta</Link></Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 pt-12 pb-24">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Estude pelos seus materiais. Treine com questões e simulados. Saiba exatamente onde melhorar.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          Plataforma de preparação para concursos públicos que conecta PDFs, questões, simulados, revisões e cronograma
          em um só lugar.
        </p>
        <div className="mt-8 flex gap-3">
          <Button size="lg" asChild><Link href="/cadastro">Começar agora</Link></Button>
          <Button size="lg" variant="outline" asChild><Link href="/entrar">Já tenho conta</Link></Button>
        </div>
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RECURSOS.map(({ icone: Icone, titulo, texto }) => (
            <div key={titulo} className="rounded-xl border bg-card p-5">
              <Icone className="size-6 text-primary" aria-hidden />
              <p className="mt-3 font-medium">{titulo}</p>
              <p className="mt-1 text-sm text-muted-foreground">{texto}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
