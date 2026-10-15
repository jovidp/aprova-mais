"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/basicos";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/sobreposicoes";
import { Switch } from "@/components/ui/formulario";

interface Parte { secaoId: string; materialId: string; material: string; secao: string; inicio: number; fim: number }
interface Plano { partes: Parte[]; paginas: number; custoEstimadoUsd: number | null; jaGeradas: number }

async function chamar<T>(corpo: unknown): Promise<T> {
  const r = await fetch("/api/pontos-chave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({ erro: "Falha de comunicação." }));
  if (!r.ok) throw Object.assign(new Error(j.erro ?? "Falha."), { status: r.status });
  return j as T;
}

/**
 * Gera os pontos mais importantes de um material ou de uma disciplina inteira,
 * uma faixa de páginas por vez (permite acompanhar, parar e retomar).
 */
export function GeradorPontos({ escopo, rotulo = "Gerar pontos importantes", variante = "default" }: {
  escopo: { materialId: string } | { disciplinaId: string; nome: string };
  rotulo?: string;
  variante?: "default" | "outline";
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [plano, setPlano] = useState<Plano | null>(null);
  const [refazer, setRefazer] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [progresso, setProgresso] = useState<{ feitas: number; pontos: number; custo: number; atual: string } | null>(null);
  const parar = useRef(false);

  const planejar = async (r: boolean) => {
    setCarregando(true);
    try {
      setPlano(await chamar<Plano>({ acao: "planejar", ...("materialId" in escopo ? { materialId: escopo.materialId } : { disciplinaId: escopo.disciplinaId }), refazer: r }));
    } catch (e) { toast.error((e as Error).message); setAberto(false); }
    finally { setCarregando(false); }
  };

  const executar = async () => {
    if (!plano) return;
    parar.current = false;
    const estado = { feitas: 0, pontos: 0, custo: 0, atual: "" };
    setProgresso({ ...estado });
    for (const p of plano.partes) {
      if (parar.current) break;
      estado.atual = `${p.material} · ${p.secao} (p. ${p.inicio}–${p.fim})`;
      setProgresso({ ...estado });
      try {
        const r = await chamar<{ criados: number; custoUsd: number }>({ acao: "gerar", secaoId: p.secaoId, inicio: p.inicio, fim: p.fim });
        estado.pontos += r.criados;
        estado.custo += r.custoUsd;
      } catch (e) {
        const status = (e as { status?: number }).status;
        toast.error((e as Error).message);
        if (status === 402 || status === 401 || status === 503) break; // orçamento, sessão ou IA indisponível
      }
      estado.feitas++;
      setProgresso({ ...estado });
    }
    toast.success(`${estado.pontos} ponto(s) importante(s) gerado(s).`);
    router.refresh();
    setProgresso(null);
    setPlano(null);
    setAberto(false);
  };

  const total = plano?.partes.length ?? 0;
  return (
    <>
      <Button variant={variante} onClick={() => { setAberto(true); setRefazer(false); void planejar(false); }}><Sparkles /> {rotulo}</Button>
      <Dialog open={aberto} onOpenChange={(v) => { if (!progresso) setAberto(v); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pontos mais importantes{"nome" in escopo ? ` · ${escopo.nome}` : ""}</DialogTitle>
            <DialogDescription>A IA lê as seções de teoria e resumo e marca o que mais cai em prova, com a página de origem. Os trechos aparecem destacados no leitor.</DialogDescription>
          </DialogHeader>
          {carregando && <p className="text-sm text-muted-foreground">Calculando…</p>}
          {plano && !progresso && (
            <div className="grid gap-3 text-sm">
              {total === 0 ? (
                <p>Todas as seções já têm pontos gerados{plano.jaGeradas ? "" : " (ou não há seções de teoria com texto)"}.</p>
              ) : (
                <p>
                  {plano.paginas} página(s) em {total} parte(s){plano.jaGeradas ? ` · ${plano.jaGeradas} parte(s) já feitas serão mantidas` : ""}.
                  {plano.custoEstimadoUsd !== null && <> Custo estimado: <strong>até US$ {plano.custoEstimadoUsd.toFixed(2)}</strong>.</>}
                </p>
              )}
              <label className="flex items-center gap-2"><Switch checked={refazer} onCheckedChange={(v) => { setRefazer(v); void planejar(v); }} /> Refazer também as partes já geradas</label>
              <p className="text-xs text-muted-foreground">A geração para sozinha se o orçamento mensal de IA acabar. Você pode interromper e continuar depois de onde parou.</p>
            </div>
          )}
          {progresso && (
            <div className="grid gap-2 text-sm" aria-live="polite">
              <Progress value={total ? (progresso.feitas / total) * 100 : 0} />
              <p className="tabular-nums">{progresso.feitas}/{total} parte(s) · {progresso.pontos} ponto(s) · US$ {progresso.custo.toFixed(3)}</p>
              <p className="truncate text-xs text-muted-foreground">{progresso.atual}</p>
              <p className="text-xs text-muted-foreground">Mantenha esta página aberta até terminar.</p>
            </div>
          )}
          <DialogFooter>
            {progresso
              ? <Button variant="outline" onClick={() => { parar.current = true; }}><Square /> Parar</Button>
              : <>
                <Button variant="outline" onClick={() => setAberto(false)}>Cancelar</Button>
                <Button disabled={!plano || total === 0 || carregando} onClick={() => void executar()}><Sparkles /> Gerar</Button>
              </>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
