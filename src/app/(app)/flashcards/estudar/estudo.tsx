"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { BookOpen, CheckCircle2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, Progress } from "@/components/ui/basicos";
import { EstadoVazio } from "@/components/ui/layout";
import { ROTULO_AVALIACAO, type Avaliacao } from "@/lib/estudo/srs";
import { avaliarFlashcard } from "../acoes";

interface Cartao { id: string; frente: string; verso: string; pagina: number | null; materialId: string | null; assunto: string | null }

const TECLAS: Record<string, Avaliacao> = { "1": "nao_lembrei", "2": "dificil", "3": "bom", "4": "facil" };

export function Estudo({ cartoes }: { cartoes: Cartao[] }) {
  const [indice, setIndice] = useState(0);
  const [virado, setVirado] = useState(false);
  const [contagem, setContagem] = useState<Record<Avaliacao, number>>({ nao_lembrei: 0, dificil: 0, bom: 0, facil: 0 });
  const [pendente, iniciar] = useTransition();
  const inicio = useRef(Date.now());
  const atual = cartoes[indice];

  const avaliar = (a: Avaliacao) => {
    if (!atual || !virado || pendente) return;
    const tempoMs = Date.now() - inicio.current;
    iniciar(async () => {
      const r = await avaliarFlashcard({ id: atual.id, avaliacao: a, tempoMs: Math.min(tempoMs, 3_600_000) });
      if (!r.ok) return void toast.error(r.erro);
      setContagem((c) => ({ ...c, [a]: c[a] + 1 }));
      setIndice((i) => i + 1);
      setVirado(false);
      inicio.current = Date.now();
    });
  };

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); setVirado(true); }
      else if (TECLAS[e.key]) avaliar(TECLAS[e.key]);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  });

  if (cartoes.length === 0) return <EstadoVazio icone={<CheckCircle2 />} titulo="Nenhum cartão para hoje" acao={<Button asChild><Link href="/flashcards">Voltar</Link></Button>} />;
  if (!atual) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="grid gap-4 p-6 text-center">
          <CheckCircle2 className="mx-auto size-12 text-success" />
          <p className="text-lg font-semibold">Sessão concluída: {cartoes.length} cartões</p>
          <div className="flex flex-wrap justify-center gap-2">
            {(Object.keys(contagem) as Avaliacao[]).map((a) => <Badge key={a} variant="outline">{ROTULO_AVALIACAO[a]}: {contagem[a]}</Badge>)}
          </div>
          <Button asChild><Link href="/flashcards">Voltar aos flashcards</Link></Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground"><Progress value={(indice / cartoes.length) * 100} /><span className="tabular-nums">{indice + 1}/{cartoes.length}</span></div>
      <button type="button" onClick={() => setVirado(true)} aria-label={virado ? "Resposta" : "Mostrar resposta"}
        className="min-h-72 rounded-2xl border bg-card p-8 text-left shadow-sm transition-colors hover:border-primary/50">
        {atual.assunto && <Badge variant="outline" className="mb-4">{atual.assunto}</Badge>}
        <p className="texto-estudo text-lg font-medium">{atual.frente}</p>
        {virado ? (
          <div className="mt-6 border-t pt-6">
            <p className="texto-estudo">{atual.verso}</p>
            {atual.materialId && atual.pagina && (
              <Link href={`/biblioteca/${atual.materialId}/ler?pagina=${atual.pagina}`} onClick={(e) => e.stopPropagation()} className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                <BookOpen className="size-4" /> Ver no material (p. {atual.pagina})
              </Link>
            )}
          </div>
        ) : <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground"><RotateCw className="size-4" /> Clique ou pressione espaço para ver a resposta</p>}
      </button>
      {virado && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["nao_lembrei", "dificil", "bom", "facil"] as Avaliacao[]).map((a, i) => (
            <Button key={a} variant={a === "nao_lembrei" ? "destructive" : a === "facil" ? "success" : "outline"} disabled={pendente} onClick={() => avaliar(a)}>
              {ROTULO_AVALIACAO[a]} <kbd className="ml-1 text-xs opacity-60">{i + 1}</kbd>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
