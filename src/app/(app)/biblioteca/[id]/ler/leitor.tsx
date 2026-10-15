"use client";

import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import {
  ArrowLeft, Bookmark, BookmarkCheck, Bot, ChevronLeft, ChevronRight, Highlighter, Layers, ListTree, Maximize2, MessageSquarePlus,
  Minus, Plus, Search, Star, StickyNote, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Input, Skeleton, Textarea } from "@/components/ui/basicos";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/sobreposicoes";
import { Campo } from "@/components/ui/formulario";
import { cn } from "@/lib/utils";
import { ROTULO_TIPO_PONTO, itemFazParteDeTrecho, normalizarTrecho, type TipoPonto } from "@/lib/materiais/pontos-chave";
import { ChatEstudo } from "./chat-estudo";
import { buscarNoMaterial, excluirAnotacao, registrarLeitura, registrarSessaoLeitura, salvarAnotacao } from "./acoes";
import { criarFlashcard } from "../../../flashcards/acoes";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface Anotacao {
  id: string;
  pagina: number;
  tipo: string;
  texto: string | null;
  trecho: string | null;
  cor: string | null;
  created_at: string;
}

interface Props {
  material: { id: string; titulo: string; totalPaginas: number; disciplinaId: string | null; disciplina: string | null };
  url: string;
  paginaInicial: number;
  destaque?: string;
  secoes: { id: string; titulo: string; pagina_inicio: number; pagina_fim: number; tipo: string; assunto_id: string | null }[];
  anotacoesIniciais: Anotacao[];
  paginasLidas: number[];
  pontos: { id: string; pagina: number; tipo: TipoPonto; importancia: number; titulo: string; explicacao: string; trecho: string | null }[];
  abrirPontos?: boolean;
}

type Painel = "chat" | "pontos" | "secoes" | "notas" | "busca" | null;

const ROTULO_PAINEL: Record<Exclude<Painel, null>, string> = {
  chat: "Estudar com a IA", pontos: "Pontos importantes", secoes: "Seções", notas: "Anotações", busca: "Pesquisar no material",
};

/** Segundos de permanência que contam a página como lida. */
const TEMPO_LEITURA_PAGINA = 8;

export function Leitor({ material, url, paginaInicial, destaque, secoes, anotacoesIniciais, paginasLidas, pontos, abrirPontos }: Props) {
  const [totalPaginas, setTotalPaginas] = useState(material.totalPaginas || 0);
  const [pagina, setPagina] = useState(paginaInicial);
  const [entradaPagina, setEntradaPagina] = useState(String(paginaInicial));
  const [zoom, setZoom] = useState(1);
  const [largura, setLargura] = useState(800);
  const [painel, setPainel] = useState<Painel>(abrirPontos && pontos.length ? "pontos" : null);
  const [realcarPontos, setRealcarPontos] = useState(true);
  const [anotacoes, setAnotacoes] = useState(anotacoesIniciais);
  const [lidas, setLidas] = useState(() => new Set(paginasLidas));
  const [termo, setTermo] = useState(destaque ?? "");
  const [resultados, setResultados] = useState<{ pagina: number; trecho: string }[] | null>(null);
  const [selecao, setSelecao] = useState("");
  const [novaNota, setNovaNota] = useState("");
  const [dialogoFlashcard, setDialogoFlashcard] = useState(false);
  const [flashcard, setFlashcard] = useState({ frente: "", verso: "" });
  const [pendente, iniciar] = useTransition();
  const areaRef = useRef<HTMLDivElement>(null);
  const inicioSessao = useRef(new Date());
  const entradaNaPagina = useRef(Date.now());

  // Largura responsiva da página.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => setLargura(Math.min(1100, Math.max(280, e.contentRect.width - 32))));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Progresso: a página conta como lida após alguns segundos nela.
  useEffect(() => {
    entradaNaPagina.current = Date.now();
    setEntradaPagina(String(pagina));
    const temporizador = setTimeout(() => {
      void registrarLeitura(material.id, pagina, TEMPO_LEITURA_PAGINA).then((r) => {
        if (r.ok) setLidas((s) => new Set(s).add(pagina));
      });
    }, TEMPO_LEITURA_PAGINA * 1000);
    return () => clearTimeout(temporizador);
  }, [pagina, material.id]);

  // Sessão de estudo registrada ao sair da página ou ocultar a aba.
  useEffect(() => {
    const encerrar = () => {
      const inicio = inicioSessao.current;
      void registrarSessaoLeitura({ materialId: material.id, inicio: inicio.toISOString(), fim: new Date().toISOString() });
      inicioSessao.current = new Date();
    };
    const aoMudarVisibilidade = () => { if (document.visibilityState === "hidden") encerrar(); else inicioSessao.current = new Date(); };
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => { document.removeEventListener("visibilitychange", aoMudarVisibilidade); encerrar(); };
  }, [material.id]);

  const irPara = useCallback((n: number) => {
    const alvo = Math.min(Math.max(1, n), totalPaginas || n);
    setPagina(alvo);
    areaRef.current?.scrollTo({ top: 0 });
    const url = new URL(window.location.href);
    url.searchParams.set("pagina", String(alvo));
    window.history.replaceState(null, "", url);
  }, [totalPaginas]);

  // Atalhos: ← → páginas, + − zoom.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(alvo.tagName)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") irPara(pagina + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") irPara(pagina - 1);
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(3, z + 0.1));
      else if (e.key === "-") setZoom((z) => Math.max(0.5, z - 0.1));
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [pagina, irPara]);

  const pesquisar = useCallback((t: string) => {
    if (t.trim().length < 2) return;
    iniciar(async () => {
      const r = await buscarNoMaterial(material.id, t);
      if (r.ok) setResultados(r.dados);
      else toast.error(r.erro);
    });
  }, [material.id]);

  useEffect(() => {
    if (destaque) { setPainel("busca"); pesquisar(destaque); }
  }, [destaque, pesquisar]);

  const pontosDaPagina = useMemo(() => pontos.filter((p) => p.pagina === pagina), [pontos, pagina]);

  // Realce na camada de texto: termo pesquisado (amarelo) e trechos dos pontos
  // importantes da página (verde). O react-pdf insere o retorno como HTML, então
  // o texto do PDF é escapado antes (evita injeção via PDF).
  const renderizarTexto = useMemo(() => {
    const t = termo.trim();
    const trechos = realcarPontos ? pontosDaPagina.flatMap((p) => (p.trecho ? [normalizarTrecho(p.trecho)] : [])) : [];
    if (t.length < 2 && trechos.length === 0) return undefined;
    const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const re = new RegExp(`(${escapar(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return ({ str }: { str: string }) => {
      let html = escapar(str);
      if (t.length >= 2) html = html.replace(re, '<mark class="bg-warning/60 text-transparent rounded-sm">$1</mark>');
      if (trechos.length && itemFazParteDeTrecho(str, trechos)) html = `<mark class="bg-success/35 text-transparent rounded-sm">${html}</mark>`;
      return html;
    };
  }, [termo, realcarPontos, pontosDaPagina]);

  const secaoAtual = secoes.find((s) => pagina >= s.pagina_inicio && pagina <= s.pagina_fim);
  const marcador = anotacoes.find((a) => a.pagina === pagina && a.tipo === "marcador");
  const notasDaPagina = anotacoes.filter((a) => a.pagina === pagina && a.tipo !== "marcador");

  const capturarSelecao = () => {
    const texto = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
    setSelecao(texto.slice(0, 4000));
  };

  const adicionarAnotacao = (tipo: "nota" | "marcador" | "destaque", texto = "", trecho = "") =>
    iniciar(async () => {
      const r = await salvarAnotacao({ materialId: material.id, pagina, tipo, texto, trecho, cor: tipo === "destaque" ? "#facc15" : undefined });
      if (r.ok) {
        setAnotacoes((l) => [...l, r.dados as Anotacao]);
        toast.success(tipo === "marcador" ? "Página marcada" : tipo === "destaque" ? "Trecho destacado" : "Anotação salva");
      } else toast.error(r.erro);
    });

  const remover = (id: string) =>
    iniciar(async () => {
      const r = await excluirAnotacao(id);
      if (r.ok) setAnotacoes((l) => l.filter((a) => a.id !== id));
      else toast.error(r.erro);
    });

  const percentualLido = totalPaginas ? Math.round((lidas.size / totalPaginas) * 100) : 0;

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4rem)] flex-col sm:-mx-6 lg:-mx-8">
      {/* Barra de ferramentas */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <Button variant="ghost" size="icon-sm" asChild aria-label="Voltar ao material"><Link href={`/biblioteca/${material.id}`}><ArrowLeft /></Link></Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{material.titulo}</div>
          <div className="truncate text-xs text-muted-foreground">{secaoAtual?.titulo ?? material.disciplina ?? ""} · {percentualLido}% lido</div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => irPara(pagina - 1)} disabled={pagina <= 1} aria-label="Página anterior"><ChevronLeft /></Button>
          <form onSubmit={(e) => { e.preventDefault(); irPara(Number(entradaPagina)); }} className="flex items-center gap-1 text-sm">
            <Input aria-label="Ir para a página" className="h-8 w-14 text-center" value={entradaPagina} onChange={(e) => setEntradaPagina(e.target.value.replace(/\D/g, ""))} />
            <span className="text-muted-foreground">/ {totalPaginas || "…"}</span>
          </form>
          <Button variant="ghost" size="icon-sm" onClick={() => irPara(pagina + 1)} disabled={totalPaginas > 0 && pagina >= totalPaginas} aria-label="Próxima página"><ChevronRight /></Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))} aria-label="Diminuir zoom"><Minus /></Button>
          <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon-sm" onClick={() => setZoom((z) => Math.min(3, z + 0.1))} aria-label="Aumentar zoom"><Plus /></Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setZoom(1)} aria-label="Ajustar à largura"><Maximize2 /></Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant={marcador ? "secondary" : "ghost"} size="icon-sm" aria-label={marcador ? "Remover marcador" : "Marcar página"}
            onClick={() => (marcador ? remover(marcador.id) : adicionarAnotacao("marcador"))}>
            {marcador ? <BookmarkCheck className="text-primary" /> : <Bookmark />}
          </Button>
          {(["chat", "pontos", "secoes", "notas", "busca"] as const).map((p) => {
            const Icone = p === "chat" ? Bot : p === "pontos" ? Star : p === "secoes" ? ListTree : p === "notas" ? StickyNote : Search;
            const contagem = p === "pontos" ? pontosDaPagina.length : p === "notas" ? notasDaPagina.length : 0;
            return (
              <Button key={p} variant={painel === p ? "secondary" : "ghost"} size="icon-sm" aria-label={ROTULO_PAINEL[p]} title={ROTULO_PAINEL[p]} aria-pressed={painel === p}
                onClick={() => setPainel(painel === p ? null : p)} className="relative">
                <Icone />
                {contagem > 0 && (
                  <span className={cn("absolute -top-1 -right-1 grid size-4 place-items-center rounded-full text-[10px] font-semibold",
                    p === "pontos" ? "bg-success text-success-foreground" : "bg-primary text-primary-foreground")}>{contagem}</span>
                )}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Página */}
        <div ref={areaRef} className="min-w-0 flex-1 overflow-auto bg-muted/50 p-4" onMouseUp={capturarSelecao} onKeyUp={capturarSelecao}>
          {selecao && (
            <div className="sticky top-0 z-10 mx-auto mb-3 flex max-w-xl flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-md">
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">“{selecao}”</span>
              <Button size="sm" variant="outline" onClick={() => { adicionarAnotacao("destaque", "", selecao); setSelecao(""); }}><Highlighter /> Destacar</Button>
              <Button size="sm" variant="outline" onClick={() => { setFlashcard({ frente: "", verso: selecao }); setDialogoFlashcard(true); }}><Layers /> Flashcard</Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/tutor?pergunta=${encodeURIComponent(`Explique este trecho (${material.titulo}, p. ${pagina}): "${selecao.slice(0, 600)}"`)}`}>
                  <MessageSquarePlus /> Perguntar ao Tutor
                </Link>
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Fechar" onClick={() => setSelecao("")}><X /></Button>
            </div>
          )}
          <Document
            file={url}
            onLoadSuccess={(doc) => setTotalPaginas(doc.numPages)}
            onLoadError={() => toast.error("Não foi possível carregar o PDF. Recarregue a página.")}
            loading={<Skeleton className="mx-auto h-[80vh] max-w-3xl" />}
            className="flex justify-center"
          >
            <Page
              pageNumber={pagina}
              width={largura * zoom}
              renderAnnotationLayer
              renderTextLayer
              customTextRenderer={renderizarTexto}
              loading={<Skeleton className="h-[80vh] w-full" style={{ width: largura * zoom }} />}
              className="shadow-lg"
            />
          </Document>
          <div className="mx-auto mt-4 grid max-w-3xl gap-2">
            {notasDaPagina.filter((a) => a.texto).map((a) => (
              <div key={a.id} className="group flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-sm">
                <StickyNote className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <p className="flex-1 whitespace-pre-wrap">{a.texto}</p>
                <Button variant="ghost" size="icon-sm" aria-label="Excluir anotação" className="opacity-60 group-hover:opacity-100" onClick={() => remover(a.id)}><Trash2 /></Button>
              </div>
            ))}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (novaNota.trim()) { adicionarAnotacao("nota", novaNota); setNovaNota(""); } }}>
              <Textarea rows={1} className="min-h-9" aria-label={`Anotação na página ${pagina}`} placeholder={`Anotar na página ${pagina}…`} value={novaNota}
                onChange={(e) => setNovaNota(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (novaNota.trim()) { adicionarAnotacao("nota", novaNota); setNovaNota(""); } } }} />
              <Button type="submit" variant="outline" disabled={!novaNota.trim() || pendente}><StickyNote /> Anotar</Button>
            </form>
          </div>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" onClick={() => irPara(pagina - 1)} disabled={pagina <= 1}><ChevronLeft /> Anterior</Button>
            <Button variant="outline" onClick={() => irPara(pagina + 1)} disabled={totalPaginas > 0 && pagina >= totalPaginas}>Próxima <ChevronRight /></Button>
          </div>
        </div>

        {/* Painel lateral */}
        {painel && (
          <aside className={cn("flex shrink-0 flex-col border-l bg-card max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:h-[70dvh] max-md:w-full max-md:rounded-t-xl max-md:border-t max-md:shadow-2xl",
            painel === "chat" ? "md:w-[400px]" : "md:w-80")} aria-label="Painel do leitor">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="text-sm font-medium">{ROTULO_PAINEL[painel]}</span>
              <Button variant="ghost" size="icon-sm" aria-label="Fechar painel" onClick={() => setPainel(null)}><X /></Button>
            </div>
            <div className={cn("flex-1 overflow-y-auto p-3", painel === "chat" && "flex flex-col overflow-hidden p-0")}>
              {painel === "chat" && (
                <ChatEstudo materialId={material.id} titulo={material.titulo} pagina={pagina} assuntoId={secaoAtual?.assunto_id ?? null}
                  aoSalvarNota={(texto) => adicionarAnotacao("nota", texto)} />
              )}

              {painel === "pontos" && (
                <div className="grid gap-3">
                  {pontos.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum ponto gerado para este material. <Link className="underline" href={`/biblioteca/${material.id}`}>Gere na página do material</Link>.</p>
                  ) : (
                    <>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input type="checkbox" checked={realcarPontos} onChange={(e) => setRealcarPontos(e.target.checked)} /> Destacar os trechos no PDF (verde)
                      </label>
                      <Link className="text-xs text-primary hover:underline" href={`/biblioteca/${material.id}/pontos`}>Ver lista completa / imprimir</Link>
                      {pontosDaPagina.length > 0 && <p className="text-xs font-medium text-muted-foreground">Nesta página</p>}
                      {[...pontosDaPagina, ...pontos.filter((p) => p.pagina !== pagina)].map((p) => (
                        <button key={p.id} onClick={() => irPara(p.pagina)}
                          className={cn("grid gap-1 rounded-md border p-2 text-left text-sm hover:bg-accent", p.pagina === pagina && "border-success")}>
                          <span className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-primary">p. {p.pagina}</span>
                            <span className="text-warning" aria-label={`Importância ${p.importancia} de 3`}>{"★".repeat(p.importancia)}</span>
                          </span>
                          <span className="font-medium">{p.titulo}</span>
                          <span className="text-xs text-muted-foreground">{p.explicacao}</span>
                          <Badge variant="outline" className="w-fit text-[10px]">{ROTULO_TIPO_PONTO[p.tipo]}</Badge>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}

              {painel === "secoes" && (
                <ul className="grid gap-1">
                  {secoes.map((s) => (
                    <li key={s.id}>
                      <button onClick={() => irPara(s.pagina_inicio)}
                        className={cn("w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent", secaoAtual?.id === s.id && "bg-primary/10 text-primary")}>
                        <span className="block">{s.titulo}</span>
                        <span className="text-xs text-muted-foreground">p. {s.pagina_inicio}–{s.pagina_fim}{s.tipo !== "teoria" ? ` · ${s.tipo.replace("_", " ")}` : ""}</span>
                      </button>
                    </li>
                  ))}
                  {secoes.length === 0 && <li className="text-sm text-muted-foreground">Sem seções identificadas.</li>}
                </ul>
              )}

              {painel === "notas" && (
                <div className="grid gap-4">
                  <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (novaNota.trim()) { adicionarAnotacao("nota", novaNota); setNovaNota(""); } }}>
                    <Textarea aria-label={`Nova anotação na página ${pagina}`} placeholder={`Anotação na página ${pagina}`} value={novaNota} onChange={(e) => setNovaNota(e.target.value)} />
                    <Button size="sm" type="submit" disabled={!novaNota.trim() || pendente}>Salvar anotação</Button>
                  </form>
                  {notasDaPagina.length > 0 && <p className="text-xs font-medium text-muted-foreground">Nesta página</p>}
                  {[...notasDaPagina, ...anotacoes.filter((a) => a.pagina !== pagina)].map((a) => (
                    <div key={a.id} className="group rounded-md border p-2 text-sm">
                      <div className="mb-1 flex items-center justify-between">
                        <button className="text-xs text-primary hover:underline" onClick={() => irPara(a.pagina)}>p. {a.pagina}</button>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline">{a.tipo === "marcador" ? "Marcador" : a.tipo === "destaque" ? "Destaque" : "Nota"}</Badge>
                          <Button variant="ghost" size="icon-sm" aria-label="Excluir anotação" onClick={() => remover(a.id)}><Trash2 /></Button>
                        </div>
                      </div>
                      {a.trecho && <p className="border-l-2 border-warning pl-2 text-xs text-muted-foreground">{a.trecho}</p>}
                      {a.texto && <p className="whitespace-pre-wrap">{a.texto}</p>}
                    </div>
                  ))}
                  {anotacoes.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma anotação ainda. Selecione um trecho no PDF para destacar.</p>}
                </div>
              )}

              {painel === "busca" && (
                <div className="grid gap-3">
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); pesquisar(termo); }}>
                    <Input aria-label="Termo" value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Ex.: brasileiro nato" />
                    <Button type="submit" size="sm" carregando={pendente}>Buscar</Button>
                  </form>
                  {resultados && <p className="text-xs text-muted-foreground">{resultados.length} página(s) encontrada(s)</p>}
                  {resultados?.map((r) => (
                    <button key={r.pagina} onClick={() => irPara(r.pagina)} className={cn("rounded-md border p-2 text-left text-sm hover:bg-accent", r.pagina === pagina && "border-primary")}>
                      <span className="text-xs font-medium text-primary">Página {r.pagina}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{r.trecho}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      <Dialog open={dialogoFlashcard} onOpenChange={setDialogoFlashcard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo flashcard</DialogTitle>
            <DialogDescription>Do trecho selecionado na página {pagina}.</DialogDescription>
          </DialogHeader>
          <Campo rotulo="Frente (pergunta)" htmlFor="fc-frente">
            <Textarea id="fc-frente" value={flashcard.frente} onChange={(e) => setFlashcard({ ...flashcard, frente: e.target.value })} placeholder="Ex.: Quem são os brasileiros natos?" />
          </Campo>
          <Campo rotulo="Verso (resposta)" htmlFor="fc-verso">
            <Textarea id="fc-verso" rows={5} value={flashcard.verso} onChange={(e) => setFlashcard({ ...flashcard, verso: e.target.value })} />
          </Campo>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogoFlashcard(false)}>Cancelar</Button>
            <Button carregando={pendente} disabled={!flashcard.frente.trim() || !flashcard.verso.trim()}
              onClick={() => iniciar(async () => {
                const r = await criarFlashcard({ ...flashcard, materialId: material.id, pagina, disciplinaId: material.disciplinaId, assuntoId: secaoAtual?.assunto_id ?? null, origem: "trecho_pdf" });
                if (r.ok) { toast.success("Flashcard criado"); setDialogoFlashcard(false); setSelecao(""); } else toast.error(r.erro);
              })}>
              Criar flashcard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
