"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Plus, Send, Square, StickyNote, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/basicos";
import { TextoRico } from "@/components/ui/texto-rico";
import { cn } from "@/lib/utils";

interface Mensagem { id: string; papel: "user" | "assistant"; conteudo: string; fontes: { indice: number; pagina: number; titulo: string }[] }

// Tipos mínimos da Web Speech API (não fazem parte do lib.dom em todos os navegadores).
interface ResultadoFala { isFinal: boolean; 0: { transcript: string } }
interface Reconhecimento {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ResultadoFala> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void;
}
type ConstrutorReconhecimento = new () => Reconhecimento;

const ATALHOS = [
  "Explique esta página de forma simples",
  "Me faça uma pergunta sobre esta página",
  "Resuma esta página em 3 pontos",
  "Dê um exemplo prático",
];

/** Texto falável: sem marcação, citações e símbolos. */
function paraFala(texto: string) {
  return texto.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, "").replace(/[*_`#>]/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/⚠/g, "Atenção:").trim();
}

export function ChatEstudo({ materialId, titulo, pagina, assuntoId, aoSalvarNota }: {
  materialId: string; titulo: string; pagina: number; assuntoId: string | null; aoSalvarNota: (texto: string) => void;
}) {
  const chave = `estudo-conversa:${materialId}`;
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [ouvindo, setOuvindo] = useState(false);
  const [falar, setFalar] = useState(false);
  const [maosLivres, setMaosLivres] = useState(false);
  const conversaId = useRef<string | null>(null);
  const abortar = useRef<AbortController | null>(null);
  const reconhecimento = useRef<Reconhecimento | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  const paginaAtual = useRef(pagina);
  paginaAtual.current = pagina;
  const suportaVoz = typeof window !== "undefined" && Boolean((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
  const suportaFala = typeof window !== "undefined" && "speechSynthesis" in window;

  // Retoma a conversa deste material (o histórico fica salvo no servidor).
  useEffect(() => {
    let id: string | null = null;
    try { id = localStorage.getItem(chave); } catch { /* armazenamento indisponível */ }
    if (!id) return;
    conversaId.current = id;
    void fetch(`/api/tutor?conversa=${id}`).then(async (r) => {
      if (!r.ok) { conversaId.current = null; return; }
      const j = (await r.json()) as { mensagens: Mensagem[] };
      setMensagens(j.mensagens);
    }).catch(() => undefined);
  }, [chave]);

  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [mensagens]);
  useEffect(() => () => { abortar.current?.abort(); reconhecimento.current?.stop(); if (suportaFala) speechSynthesis.cancel(); }, [suportaFala]);

  const ouvir = useCallback(() => {
    const W = window as unknown as { SpeechRecognition?: ConstrutorReconhecimento; webkitSpeechRecognition?: ConstrutorReconhecimento };
    const Construtor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Construtor) { toast.error("Seu navegador não reconhece voz. Use o Chrome ou o Edge."); return; }
    if (suportaFala) speechSynthesis.cancel();
    const r = new Construtor();
    r.lang = "pt-BR";
    r.interimResults = true;
    r.continuous = false;
    let final = "";
    r.onresult = (e) => {
      let parcial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else parcial += e.results[i][0].transcript;
      }
      setTexto((final + parcial).trim());
    };
    r.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") toast.error("Não consegui ouvir. Verifique a permissão do microfone."); };
    r.onend = () => {
      setOuvindo(false);
      reconhecimento.current = null;
      if (final.trim()) void enviarRef.current(final.trim());
    };
    reconhecimento.current = r;
    setOuvindo(true);
    r.start();
  }, [suportaFala]);

  const lerEmVozAlta = useCallback((conteudo: string, depois?: () => void) => {
    if (!suportaFala) { depois?.(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(paraFala(conteudo));
    u.lang = "pt-BR";
    const voz = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("pt-br")) ?? speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("pt"));
    if (voz) u.voice = voz;
    u.rate = 1.05;
    u.onend = () => depois?.();
    speechSynthesis.speak(u);
  }, [suportaFala]);

  const enviar = async (fala: string) => {
    const msg = fala.trim();
    if (!msg || enviando) return;
    setTexto("");
    setEnviando(true);
    const idResposta = crypto.randomUUID();
    setMensagens((m) => [...m, { id: crypto.randomUUID(), papel: "user", conteudo: msg, fontes: [] }, { id: idResposta, papel: "assistant", conteudo: "", fontes: [] }]);
    const atualizar = (f: (m: Mensagem) => Mensagem) => setMensagens((l) => l.map((m) => (m.id === idResposta ? f(m) : m)));
    const controle = new AbortController();
    abortar.current = controle;
    let resposta = "";
    try {
      const r = await fetch("/api/tutor", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controle.signal,
        body: JSON.stringify({ conversaId: conversaId.current, mensagem: msg, modo: "estudo", materialId, pagina: paginaAtual.current, assuntoId }),
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({ erro: "Falha na comunicação." }));
        if (r.status === 404) { conversaId.current = null; try { localStorage.removeItem(chave); } catch { /* ignora */ } }
        atualizar((m) => ({ ...m, conteudo: `⚠ ${j.erro ?? "Falha na comunicação."}` }));
        return;
      }
      const leitor = r.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      let meta = false;
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        if (!meta) {
          const q = buffer.indexOf("\n");
          if (q < 0) continue;
          const m = JSON.parse(buffer.slice(0, q)) as { conversaId: string; fontes: Mensagem["fontes"] };
          conversaId.current = m.conversaId;
          try { localStorage.setItem(chave, m.conversaId); } catch { /* ignora */ }
          buffer = buffer.slice(q + 1);
          meta = true;
          atualizar((x) => ({ ...x, fontes: m.fontes }));
        }
        resposta = buffer;
        atualizar((x) => ({ ...x, conteudo: resposta }));
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") atualizar((m) => ({ ...m, conteudo: `${m.conteudo}\n\n⚠ A conexão foi interrompida.` }));
    } finally {
      setEnviando(false);
      abortar.current = null;
    }
    // No modo conversa por voz, lê a resposta e volta a ouvir sozinho.
    if (resposta && (falar || maosLivres)) lerEmVozAlta(resposta, maosLivres ? () => ouvir() : undefined);
  };
  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;

  const novaConversa = () => {
    abortar.current?.abort();
    conversaId.current = null;
    try { localStorage.removeItem(chave); } catch { /* ignora */ }
    setMensagens([]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="flex-1 truncate">Página {pagina} · {titulo}</span>
        {suportaFala && (
          <Button variant={falar ? "secondary" : "ghost"} size="icon-sm" aria-pressed={falar} title={falar ? "Não ler respostas" : "Ler respostas em voz alta"}
            aria-label="Ler respostas em voz alta" onClick={() => { if (falar) speechSynthesis.cancel(); setFalar(!falar); }}>
            {falar ? <Volume2 /> : <VolumeX />}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" title="Nova conversa" aria-label="Nova conversa" onClick={novaConversa}><Plus /></Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
        {mensagens.length === 0 && (
          <div className="grid gap-2 text-sm">
            <p className="text-muted-foreground">Converse comigo enquanto estuda: pergunte, peça exemplos ou peça para eu te testar. Eu sigo a página em que você está.</p>
            {ATALHOS.map((a) => <Button key={a} variant="outline" size="sm" className="h-auto justify-start whitespace-normal py-1.5 text-left" onClick={() => void enviar(a)}>{a}</Button>)}
          </div>
        )}
        {mensagens.map((m) => (
          <div key={m.id} className={cn("rounded-xl px-3 py-2 text-sm", m.papel === "user" ? "ml-6 bg-primary/10" : "mr-2 border bg-background")}>
            {m.papel === "assistant" && !m.conteudo
              ? <span className="text-muted-foreground">Pensando…</span>
              : m.papel === "assistant"
                ? <TextoRico texto={m.conteudo} citacao={(n) => {
                  const f = m.fontes.find((x) => x.indice === n);
                  return <span className="mx-0.5 rounded bg-primary/10 px-1 text-[11px] text-primary" title={f ? `${f.titulo}, p. ${f.pagina}` : undefined}>{f ? `p. ${f.pagina}` : `[${n}]`}</span>;
                }} />
                : <p className="whitespace-pre-wrap">{m.conteudo}</p>}
            {m.papel === "assistant" && m.conteudo && !enviando && (
              <div className="mt-1 flex gap-1">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { aoSalvarNota(m.conteudo.slice(0, 4000)); }}><StickyNote /> Salvar como anotação</Button>
                {suportaFala && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => lerEmVozAlta(m.conteudo)}><Volume2 /> Ouvir</Button>}
              </div>
            )}
          </div>
        ))}
        <div ref={fim} />
      </div>

      <form className="grid gap-2 border-t p-2" onSubmit={(e) => { e.preventDefault(); void enviar(texto); }}>
        <Textarea rows={2} aria-label="Fale ou digite" value={texto} placeholder={ouvindo ? "Ouvindo…" : "Digite ou toque no microfone…"}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(texto); } }} />
        <div className="flex items-center gap-2">
          {suportaVoz && (
            <Button type="button" variant={ouvindo ? "destructive" : "outline"} size="icon" aria-label={ouvindo ? "Parar de ouvir" : "Falar"}
              onClick={() => (ouvindo ? reconhecimento.current?.stop() : ouvir())}>
              {ouvindo ? <MicOff /> : <Mic />}
            </Button>
          )}
          {suportaVoz && suportaFala && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Responde em voz alta e volta a ouvir sozinho">
              <input type="checkbox" checked={maosLivres} onChange={(e) => { setMaosLivres(e.target.checked); if (e.target.checked && !ouvindo && !enviando) ouvir(); }} />
              Conversa por voz
            </label>
          )}
          <span className="flex-1" />
          {enviando
            ? <Button type="button" variant="outline" size="sm" onClick={() => abortar.current?.abort()}><Square /> Parar</Button>
            : <Button type="submit" size="sm" disabled={!texto.trim()}><Send /> Enviar</Button>}
        </div>
      </form>
    </div>
  );
}
