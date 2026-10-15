"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, RotateCcw, Save, Settings2, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui/basicos";
import { Select, Switch } from "@/components/ui/formulario";
import { cn, formatarCronometro } from "@/lib/utils";
import { registrarPomodoro, registrarSessaoManual, salvarPreferenciasPomodoro } from "./acoes";

type Fase = "foco" | "pausa" | "pausa_longa";

export function Pomodoro({ disciplinas, preferencias }: { disciplinas: { id: string; nome: string }[]; preferencias: { foco: number; pausa: number; pausaLonga: number; gamificacao: boolean } }) {
  const router = useRouter();
  const [cfg, setCfg] = useState(preferencias);
  const [config, setConfig] = useState(false);
  const [fase, setFase] = useState<Fase>("foco");
  const [restante, setRestante] = useState(preferencias.foco * 60);
  const [rodando, setRodando] = useState(false);
  const [ciclos, setCiclos] = useState(0);
  const [disciplina, setDisciplina] = useState("");
  const [manual, setManual] = useState({ data: "", minutos: "60", tipo: "leitura" });
  const [pendente, iniciar] = useTransition();
  const inicioSessao = useRef<Date | null>(null);
  const focoAcumulado = useRef(0);
  const fimPrevisto = useRef(0);

  const duracao = (f: Fase) => (f === "foco" ? cfg.foco : f === "pausa" ? cfg.pausa : cfg.pausaLonga) * 60;

  useEffect(() => {
    if (!rodando) return;
    fimPrevisto.current = Date.now() + restante * 1000;
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((fimPrevisto.current - Date.now()) / 1000));
      setRestante(s);
      if (s === 0) {
        clearInterval(t);
        concluirFase();
      }
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rodando, fase]);

  useEffect(() => {
    document.title = rodando ? `${formatarCronometro(restante)} · ${fase === "foco" ? "Foco" : "Pausa"}` : "Metas · Aprova+";
  }, [restante, rodando, fase]);

  const concluirFase = () => {
    try {
      // Bipe curto ao fim de cada fase.
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.frequency.value = 880;
      ganho.gain.setValueAtTime(0.2, ctx.currentTime);
      ganho.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.connect(ganho).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } catch {
      // Navegador sem áudio: segue só com o aviso visual.
    }
    if (fase === "foco") {
      focoAcumulado.current += duracao("foco");
      const n = ciclos + 1;
      setCiclos(n);
      const proxima: Fase = n % 4 === 0 ? "pausa_longa" : "pausa";
      setFase(proxima);
      setRestante(duracao(proxima));
      toast.success(`Pomodoro ${n} concluído. Hora da pausa.`);
    } else {
      setFase("foco");
      setRestante(duracao("foco"));
    }
    setRodando(false);
  };

  const alternar = () => {
    if (!rodando && !inicioSessao.current) inicioSessao.current = new Date();
    setRodando(!rodando);
  };

  const salvarSessao = () => iniciar(async () => {
    if (!inicioSessao.current) return;
    const r = await registrarPomodoro({ inicio: inicioSessao.current.toISOString(), fim: new Date().toISOString(), pomodoros: ciclos, disciplinaId: disciplina || null });
    if (r.ok) {
      toast.success("Sessão registrada");
      inicioSessao.current = null;
      focoAcumulado.current = 0;
      setCiclos(0);
      setRodando(false);
      setFase("foco");
      setRestante(duracao("foco"));
      router.refresh();
    } else toast.error(r.erro);
  });

  const total = duracao(fase);
  const pct = total ? ((total - restante) / total) * 100 : 0;

  return (
    <div className="grid content-start gap-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Pomodoro</CardTitle>
          <Button variant="ghost" size="icon-sm" aria-label="Configurar" onClick={() => setConfig(!config)}><Settings2 /></Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          {config && (
            <div className="grid gap-2 rounded-lg border p-3 text-sm">
              <div className="grid grid-cols-3 gap-2">
                {(["foco", "pausa", "pausaLonga"] as const).map((k) => (
                  <label key={k} className="grid gap-1 text-xs">{k === "foco" ? "Foco" : k === "pausa" ? "Pausa" : "Pausa longa"} (min)
                    <Input type="number" min={1} max={120} value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: Number(e.target.value) })} />
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2"><Switch checked={cfg.gamificacao} onCheckedChange={(v) => setCfg({ ...cfg, gamificacao: v })} /> Mostrar sequência de dias</label>
              <Button size="sm" disabled={pendente} onClick={() => iniciar(async () => {
                const r = await salvarPreferenciasPomodoro(cfg);
                if (r.ok) { setConfig(false); if (!rodando) setRestante(duracao(fase)); router.refresh(); } else toast.error(r.erro);
              })}>Salvar</Button>
            </div>
          )}
          <div className="text-center">
            <p className={cn("text-sm font-medium", fase === "foco" ? "text-primary" : "text-success")}>{fase === "foco" ? "Foco" : fase === "pausa" ? "Pausa curta" : "Pausa longa"} · ciclo {ciclos + (fase === "foco" ? 1 : 0)}</p>
            <p className="my-2 font-mono text-5xl font-semibold tabular-nums" role="timer" aria-live="off">{formatarCronometro(restante)}</p>
            <div className="mx-auto h-1.5 max-w-xs overflow-hidden rounded-full bg-muted"><div className={cn("h-full transition-all", fase === "foco" ? "bg-primary" : "bg-success")} style={{ width: `${pct}%` }} /></div>
          </div>
          <Select aria-label="Disciplina" valor={disciplina} aoMudar={setDisciplina} opcoes={[{ valor: "", rotulo: "Disciplina (opcional)" }, ...disciplinas.map((d) => ({ valor: d.id, rotulo: d.nome }))]} />
          <div className="flex justify-center gap-2">
            <Button onClick={alternar}>{rodando ? <Pause /> : <Play />} {rodando ? "Pausar" : "Iniciar"}</Button>
            <Button variant="outline" size="icon" aria-label="Pular fase" onClick={concluirFase}><SkipForward /></Button>
            <Button variant="outline" size="icon" aria-label="Reiniciar fase" onClick={() => { setRodando(false); setRestante(duracao(fase)); }}><RotateCcw /></Button>
          </div>
          <Button variant="secondary" disabled={!inicioSessao.current || pendente} onClick={salvarSessao}><Save /> Encerrar e registrar sessão</Button>
          <p className="text-center text-xs text-muted-foreground">O tempo registrado entra nas horas estudadas e nas metas.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Registrar estudo manualmente</CardTitle></CardHeader>
        <CardContent className="grid gap-2">
          <Input type="datetime-local" aria-label="Início" value={manual.data} onChange={(e) => setManual({ ...manual, data: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input aria-label="Minutos" inputMode="numeric" value={manual.minutos} onChange={(e) => setManual({ ...manual, minutos: e.target.value.replace(/\D/g, "") })} />
            <Select aria-label="Tipo" valor={manual.tipo} aoMudar={(v) => setManual({ ...manual, tipo: v })}
              opcoes={[["leitura", "Leitura"], ["questoes", "Questões"], ["revisao", "Revisão"], ["flashcards", "Flashcards"], ["simulado", "Simulado"], ["outro", "Outro (videoaula etc.)"]].map(([v, r]) => ({ valor: v, rotulo: r }))} />
          </div>
          <Button variant="outline" disabled={!manual.data || pendente} onClick={() => iniciar(async () => {
            const r = await registrarSessaoManual({ data: new Date(manual.data).toISOString(), minutos: Number(manual.minutos), tipo: manual.tipo, disciplinaId: disciplina || null });
            if (r.ok) { toast.success("Sessão registrada"); setManual({ ...manual, data: "" }); router.refresh(); } else toast.error(r.erro);
          })}>Registrar</Button>
        </CardContent>
      </Card>
    </div>
  );
}
