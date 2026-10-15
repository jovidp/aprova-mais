"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, FileText, Send, Square, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, Textarea } from "@/components/ui/basicos";
import { Dica } from "@/components/ui/sobreposicoes";
import { Select } from "@/components/ui/formulario";
import { TextoRico } from "@/components/ui/texto-rico";
import { cn } from "@/lib/utils";

export interface FonteChat { indice: number; materialId: string; titulo: string; pagina: number; secao: string | null; trecho: string }
export interface MensagemChat { id: string; papel: "user" | "assistant"; conteudo: string; fontes: FonteChat[] }

const SUGESTOES = [
  "Resuma a aula 01 de Direito Constitucional",
  "Qual a diferença entre direitos e garantias fundamentais?",
  "Explique o controle concentrado de constitucionalidade com exemplos",
  "Quais são os remédios constitucionais e quando cabe cada um?",
];

export function Chat({ conversaId: idInicial, iniciais, perguntaInicial, contexto }: {
  conversaId: string | null;
  iniciais: MensagemChat[];
  perguntaInicial: string;
  contexto: { questaoId: string | null; assuntoId: string | null; materialId: string | null };
}) {
  const router = useRouter();
  const [mensagens, setMensagens] = useState(iniciais);
  const [texto, setTexto] = useState("");
  const [nivel, setNivel] = useState<"simples" | "aprofundado">("simples");
  const [enviando, setEnviando] = useState(false);
  const conversaId = useRef(idInicial);
  const abortar = useRef<AbortController | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  const enviouInicial = useRef(false);

  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [mensagens]);

  const enviar = async (pergunta: string) => {
    const msg = pergunta.trim();
    if (!msg || enviando) return;
    setTexto("");
    setEnviando(true);
    const idResposta = crypto.randomUUID();
    setMensagens((m) => [...m, { id: crypto.randomUUID(), papel: "user", conteudo: msg, fontes: [] }, { id: idResposta, papel: "assistant", conteudo: "", fontes: [] }]);
    const atualizar = (f: (m: MensagemChat) => MensagemChat) => setMensagens((l) => l.map((m) => (m.id === idResposta ? f(m) : m)));
    const controle = new AbortController();
    abortar.current = controle;
    const novaConversa = !conversaId.current;
    try {
      const resp = await fetch("/api/tutor", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controle.signal,
        body: JSON.stringify({ conversaId: conversaId.current, mensagem: msg, nivel, ...(mensagens.length === 0 ? contexto : {}) }),
      });
      if (!resp.ok || !resp.body) {
        const erro = await resp.json().catch(() => ({ erro: "Falha na comunicação." }));
        atualizar((m) => ({ ...m, conteudo: `⚠ ${erro.erro ?? "Falha na comunicação."}` }));
        return;
      }
      const leitor = resp.body.getReader();
      const decodificador = new TextDecoder();
      let buffer = "";
      let metadadosLidos = false;
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        buffer += decodificador.decode(value, { stream: true });
        if (!metadadosLidos) {
          const quebra = buffer.indexOf("\n");
          if (quebra < 0) continue;
          const meta = JSON.parse(buffer.slice(0, quebra)) as { conversaId: string; fontes: FonteChat[] };
          conversaId.current = meta.conversaId;
          metadadosLidos = true;
          buffer = buffer.slice(quebra + 1);
          atualizar((m) => ({ ...m, fontes: meta.fontes }));
        }
        const parcial = buffer;
        atualizar((m) => ({ ...m, conteudo: parcial }));
      }
    } catch (erro) {
      if ((erro as Error).name !== "AbortError") atualizar((m) => ({ ...m, conteudo: `${m.conteudo}\n\n⚠ A conexão foi interrompida.` }));
    } finally {
      setEnviando(false);
      abortar.current = null;
      if (novaConversa && conversaId.current) router.replace(`/tutor?c=${conversaId.current}`, { scroll: false });
      else router.refresh();
    }
  };

  useEffect(() => {
    if (perguntaInicial && !enviouInicial.current) {
      enviouInicial.current = true;
      void enviar(perguntaInicial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="flex min-h-[60vh] flex-col gap-0 p-0">
      <div className="flex-1 space-y-5 overflow-y-auto p-4" aria-live="polite">
        {mensagens.length === 0 && (
          <div className="grid place-items-center gap-4 py-10 text-center">
            <Bot className="size-10 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">Pergunte sobre qualquer tema dos seus materiais. O tutor busca os trechos relevantes e indica de onde tirou cada informação.</p>
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {SUGESTOES.map((s) => <Button key={s} variant="outline" size="sm" className="h-auto whitespace-normal py-1.5 text-left" onClick={() => enviar(s)}>{s}</Button>)}
            </div>
          </div>
        )}
        {mensagens.map((m) => (
          <div key={m.id} className={cn("flex gap-3", m.papel === "user" && "flex-row-reverse")}>
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", m.papel === "user" ? "bg-primary text-primary-foreground" : "bg-muted")} aria-hidden>
              {m.papel === "user" ? <User className="size-4" /> : <Bot className="size-4" />}
            </span>
            <div className={cn("min-w-0 max-w-[85%] rounded-xl px-4 py-3 text-sm", m.papel === "user" ? "bg-primary/10" : "border bg-card")}>
              {m.papel === "assistant" && !m.conteudo ? (
                <span className="inline-flex gap-1 text-muted-foreground" aria-label="Escrevendo"><span className="animate-pulse">●</span><span className="animate-pulse [animation-delay:150ms]">●</span><span className="animate-pulse [animation-delay:300ms]">●</span></span>
              ) : m.papel === "assistant" ? (
                <TextoRico texto={m.conteudo} citacao={(n) => {
                  const f = m.fontes.find((x) => x.indice === n);
                  return f ? (
                    <Dica conteudo={`${f.titulo}, p. ${f.pagina}`}>
                      <Link href={`/biblioteca/${f.materialId}/ler?pagina=${f.pagina}`} className="mx-0.5 rounded bg-primary/10 px-1 text-xs font-medium text-primary hover:underline">[{n}]</Link>
                    </Dica>
                  ) : <span className="text-xs text-muted-foreground">[{n}]</span>;
                }} />
              ) : <p className="whitespace-pre-wrap">{m.conteudo}</p>}
              {m.fontes.length > 0 && (
                <details className="mt-3 border-t pt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Fontes consultadas ({m.fontes.length})</summary>
                  <ul className="mt-2 grid gap-2">
                    {m.fontes.map((f) => (
                      <li key={f.indice} className="text-xs">
                        <Link href={`/biblioteca/${f.materialId}/ler?pagina=${f.pagina}`} className="inline-flex items-center gap-1 font-medium hover:underline">
                          <FileText className="size-3" /> [{f.indice}] {f.titulo}, p. {f.pagina}
                        </Link>
                        {f.secao && <Badge variant="outline" className="ml-1 text-[10px]">{f.secao}</Badge>}
                        <p className="mt-0.5 line-clamp-2 text-muted-foreground">{f.trecho}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
        ))}
        <div ref={fim} />
      </div>
      <form className="grid gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); void enviar(texto); }}>
        {contexto.questaoId && mensagens.length === 0 && <p className="text-xs text-muted-foreground">A questão selecionada será enviada como contexto.</p>}
        <Textarea aria-label="Sua pergunta" rows={2} maxLength={4000} value={texto} placeholder="Digite sua dúvida… (Enter envia, Shift+Enter quebra linha)"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(texto); } }} />
        <div className="flex items-center justify-between gap-2">
          <Select aria-label="Nível de explicação" className="w-48" valor={nivel} aoMudar={(v) => setNivel(v as typeof nivel)}
            opcoes={[{ valor: "simples", rotulo: "Explicação simples" }, { valor: "aprofundado", rotulo: "Explicação aprofundada" }]} />
          <p className="hidden text-xs text-muted-foreground sm:block">Confira dispositivos legais em fonte oficial.</p>
          {enviando
            ? <Button type="button" variant="outline" onClick={() => abortar.current?.abort()}><Square /> Parar</Button>
            : <Button type="submit" disabled={!texto.trim()}><Send /> Enviar</Button>}
        </div>
      </form>
    </Card>
  );
}
