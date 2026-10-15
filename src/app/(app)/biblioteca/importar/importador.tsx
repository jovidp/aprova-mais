"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleSlash, Copy, FileArchive, FileText, Loader2, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, Progress } from "@/components/ui/basicos";
import { Aviso } from "@/components/ui/layout";
import { clienteNavegador } from "@/lib/supabase/navegador";
import { listarEntradas, planejarExtracao, extrairEntrada, type EntradaZip } from "@/lib/materiais/leitor-zip";
import { LIMITES_ZIP, MIME_POR_TIPO, avaliarEntrada, conteudoCompativel, type TipoArquivo } from "@/lib/materiais/zip-seguranca";
import { analisarArquivo } from "@/lib/materiais/processar-arquivo-cliente";
import { sha256Hex } from "@/lib/materiais/pdfjs-cliente";
import { formatarBytes } from "@/lib/utils";
import {
  concluirImportacao, criarImportacao, criarMaterial, finalizarMaterial, marcarFalhaArquivo, registrarArquivo, salvarPaginas,
} from "../acoes-importacao";

type Estado = "aguardando" | "lendo" | "enviando" | "analisando" | "salvando" | "concluido" | "duplicado" | "erro";

interface Item {
  caminho: string;
  tipo: TipoArquivo;
  tamanho: number;
  estado: Estado;
  detalhe?: string;
  progresso?: number;
  materialId?: string;
  aviso?: string;
  /** Origem dos bytes: entrada do ZIP ou arquivo solto. */
  entrada?: EntradaZip;
  arquivo?: File;
}

const ROTULO_ESTADO: Record<Estado, string> = {
  aguardando: "Aguardando", lendo: "Extraindo", enviando: "Enviando", analisando: "Lendo páginas",
  salvando: "Salvando", concluido: "Concluído", duplicado: "Já existia", erro: "Erro",
};

/** Lotes de páginas abaixo do limite de corpo das Server Actions. */
function lotes<T extends { texto: string }>(paginas: T[], maxBytes = 900_000, maxItens = 60) {
  const saida: T[][] = [];
  let atual: T[] = [];
  let bytes = 0;
  for (const p of paginas) {
    const tamanho = p.texto.length * 2 + 64;
    if (atual.length && (bytes + tamanho > maxBytes || atual.length >= maxItens)) {
      saida.push(atual);
      atual = [];
      bytes = 0;
    }
    atual.push(p);
    bytes += tamanho;
  }
  if (atual.length) saida.push(atual);
  return saida;
}

function tipoDoNome(nome: string): TipoArquivo | null {
  const ext = nome.split(".").pop()?.toLowerCase();
  return ext === "pdf" || ext === "docx" || ext === "txt" || ext === "md" ? ext : null;
}

export function Importador() {
  const [fonte, setFonte] = useState<{ nome: string; tamanho: number; zip?: File } | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [ignorados, setIgnorados] = useState<{ caminho: string; motivo: string }[]>([]);
  const [erro, setErro] = useState<string>();
  const [fase, setFase] = useState<"selecao" | "plano" | "processando" | "fim">("selecao");
  const [importacaoId, setImportacaoId] = useState<string>();
  const cancelar = useRef(false);
  const [arrastando, setArrastando] = useState(false);

  // Avisa antes de fechar a aba durante o processamento.
  useEffect(() => {
    if (fase !== "processando") return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [fase]);

  const atualizar = useCallback((indice: number, parcial: Partial<Item>) => {
    setItens((lista) => lista.map((it, i) => (i === indice ? { ...it, ...parcial } : it)));
  }, []);

  const preparar = async (arquivos: File[]) => {
    setErro(undefined);
    setItens([]);
    setIgnorados([]);
    try {
      const zips = arquivos.filter((f) => f.name.toLowerCase().endsWith(".zip"));
      if (zips.length > 1) throw new Error("Envie um ZIP por vez.");
      if (zips.length === 1) {
        const zip = zips[0];
        if (zip.size > LIMITES_ZIP.tamanhoZipMax) throw new Error(`O ZIP excede ${formatarBytes(LIMITES_ZIP.tamanhoZipMax)}.`);
        const plano = planejarExtracao(await listarEntradas(zip));
        if (plano.aceitas.length === 0) throw new Error("Nenhum PDF, DOCX, TXT ou MD encontrado no ZIP.");
        setFonte({ nome: zip.name, tamanho: zip.size, zip });
        setIgnorados(plano.ignoradas);
        setItens(plano.aceitas
          .sort((a, b) => a.caminho.localeCompare(b.caminho, "pt-BR", { numeric: true }))
          .map((e) => ({ caminho: e.caminho, tipo: e.tipo!, tamanho: e.tamanhoOriginal, estado: "aguardando", entrada: e })));
      } else {
        const aceitos: Item[] = [];
        const recusados: { caminho: string; motivo: string }[] = [];
        for (const f of arquivos) {
          const decisao = avaliarEntrada(f.name, f.size, f.size, true);
          if (decisao.aceita && tipoDoNome(f.name)) aceitos.push({ caminho: f.name, tipo: decisao.tipo!, tamanho: f.size, estado: "aguardando", arquivo: f });
          else recusados.push({ caminho: f.name, motivo: decisao.motivo ?? "Formato não suportado" });
        }
        if (aceitos.length === 0) throw new Error("Nenhum arquivo compatível selecionado.");
        setFonte({ nome: arquivos.length === 1 ? arquivos[0].name : `${arquivos.length} arquivos`, tamanho: arquivos.reduce((s, f) => s + f.size, 0) });
        setIgnorados(recusados);
        setItens(aceitos);
      }
      setFase("plano");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    }
  };

  const processar = async () => {
    if (!fonte) return;
    cancelar.current = false;
    setFase("processando");
    const criada = await criarImportacao({ nomeArquivo: fonte.nome, tamanhoBytes: fonte.tamanho, totalArquivos: itens.length, ignorados: ignorados.length });
    if (!criada.ok) {
      setErro(criada.erro);
      setFase("plano");
      return;
    }
    const { importacaoId: impId } = criada.dados;
    setImportacaoId(impId);
    const supabase = clienteNavegador();

    for (let i = 0; i < itens.length; i++) {
      if (cancelar.current) break;
      const item = itens[i];
      let arquivoId: string | null = null;
      try {
        atualizar(i, { estado: "lendo", detalhe: undefined });
        const dados = item.entrada ? await extrairEntrada(fonte.zip!, item.entrada) : new Uint8Array(await item.arquivo!.arrayBuffer());
        if (!conteudoCompativel(item.tipo, dados.subarray(0, 64 * 1024))) throw new Error("O conteúdo não corresponde à extensão do arquivo.");
        const sha = await sha256Hex(dados);

        const reg = await registrarArquivo({ importacaoId: impId, caminho: item.caminho, tipo: item.tipo, tamanhoBytes: dados.length, sha256: sha });
        if (!reg.ok) throw new Error(reg.erro);
        arquivoId = reg.dados.arquivoId;
        if (reg.dados.duplicado) {
          atualizar(i, { estado: "duplicado", materialId: reg.dados.materialId, detalhe: "Mesmo arquivo já está na biblioteca" });
          continue;
        }

        atualizar(i, { estado: "enviando" });
        const envio = await supabase.storage.from("materiais").upload(reg.dados.storagePath, new Blob([dados as BlobPart], { type: MIME_POR_TIPO[item.tipo] }), {
          contentType: MIME_POR_TIPO[item.tipo], upsert: false, cacheControl: "31536000",
        });
        if (envio.error && !/exists|duplicate/i.test(envio.error.message)) throw new Error(`Falha no envio: ${envio.error.message}`);

        atualizar(i, { estado: "analisando", progresso: 0 });
        const analise = await analisarArquivo(item.tipo, dados, item.caminho, (lidas, total) => {
          if (lidas % 10 === 0 || lidas === total) atualizar(i, { progresso: Math.round((lidas / total) * 100) });
        });

        atualizar(i, { estado: "salvando", progresso: 0 });
        const criado = await criarMaterial({
          arquivoId, importacaoId: impId, storagePath: reg.dados.storagePath, caminho: item.caminho, tipo: item.tipo,
          tamanhoBytes: dados.length, sha256: sha, totalPaginas: analise.totalPaginas, requerOcr: analise.requerOcr,
          avisos: analise.avisos, metadados: analise.metadados, secoes: analise.secoes,
        });
        if (!criado.ok) throw new Error(criado.erro);

        const grupos = lotes(analise.paginas);
        for (let g = 0; g < grupos.length; g++) {
          const r = await salvarPaginas({ materialId: criado.dados.materialId, paginas: grupos[g].map((p) => ({ numero: p.numero, texto: p.texto })) });
          if (!r.ok) throw new Error(r.erro);
          atualizar(i, { progresso: Math.round(((g + 1) / grupos.length) * 100) });
        }
        const fim = await finalizarMaterial({ materialId: criado.dados.materialId, arquivoId, importacaoId: impId });
        if (!fim.ok) throw new Error(fim.erro);

        const m = analise.metadados;
        atualizar(i, {
          estado: "concluido", materialId: criado.dados.materialId,
          detalhe: [m.disciplina, m.aulaNumero !== null ? `Aula ${m.aulaNumero}` : null, `${analise.totalPaginas} p.`, `${analise.secoes.length} seções`].filter(Boolean).join(" · "),
          aviso: analise.requerOcr ? analise.avisos[0] : undefined,
        });
      } catch (e) {
        const motivo = e instanceof Error ? e.message : "Erro inesperado";
        atualizar(i, { estado: "erro", detalhe: motivo });
        if (arquivoId) await marcarFalhaArquivo({ arquivoId, importacaoId: impId, motivo });
      }
    }
    await concluirImportacao({ importacaoId: impId, cancelada: cancelar.current });
    setFase("fim");
  };

  const contagem = (estados: Estado[]) => itens.filter((i) => estados.includes(i.estado)).length;
  const finalizados = contagem(["concluido", "duplicado", "erro"]);
  const percentual = itens.length ? Math.round((finalizados / itens.length) * 100) : 0;
  const porPasta = new Map<string, number>();
  for (const it of itens) {
    const pasta = it.caminho.includes("/") ? it.caminho.split("/")[0] : "(raiz)";
    porPasta.set(pasta, (porPasta.get(pasta) ?? 0) + 1);
  }

  return (
    <div className="grid gap-6">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {fase === "selecao" && (
        <label
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); void preparar([...e.dataTransfer.files]); }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors ${arrastando ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
        >
          <Upload className="size-10 text-muted-foreground" aria-hidden />
          <span className="mt-3 font-medium">Arraste um ZIP ou arquivos PDF/DOCX/TXT aqui</span>
          <span className="mt-1 text-sm text-muted-foreground">
            ou clique para escolher · ZIP até {formatarBytes(LIMITES_ZIP.tamanhoZipMax)} · até {formatarBytes(LIMITES_ZIP.arquivoMax)} por arquivo
          </span>
          <input type="file" className="sr-only" multiple accept=".zip,.pdf,.docx,.txt,.md,application/zip,application/pdf"
            onChange={(e) => e.target.files && void preparar([...e.target.files])} />
        </label>
      )}

      {fase !== "selecao" && fonte && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileArchive className="size-5 text-primary" /> {fonte.nome}</CardTitle>
            <CardDescription>
              {formatarBytes(fonte.tamanho)} · {itens.length} arquivo(s) para processar · {ignorados.length} ignorado(s)
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {fase === "plano" && (
              <>
                <div className="flex flex-wrap gap-2">
                  {[...porPasta].map(([pasta, n]) => <Badge key={pasta} variant="outline">{pasta}: {n}</Badge>)}
                </div>
                {ignorados.length > 0 && (
                  <details className="rounded-lg border p-3 text-sm">
                    <summary className="cursor-pointer font-medium">Arquivos que não serão importados ({ignorados.length})</summary>
                    <ul className="mt-2 max-h-48 overflow-y-auto text-muted-foreground">
                      {ignorados.map((i) => <li key={i.caminho}><code>{i.caminho}</code>: {i.motivo}</li>)}
                    </ul>
                  </details>
                )}
                <Aviso tipo="info">
                  Os arquivos são lidos no seu navegador e enviados um a um para o armazenamento privado da sua conta.
                  Arquivos idênticos aos já existentes na biblioteca são detectados e não são reenviados. Importações
                  anteriores não são apagadas. Mantenha esta aba aberta até o fim.
                </Aviso>
                <div className="flex gap-2">
                  <Button onClick={() => void processar()}><Upload /> Iniciar importação</Button>
                  <Button variant="outline" onClick={() => { setFase("selecao"); setFonte(null); setItens([]); }}>Trocar arquivo</Button>
                </div>
              </>
            )}

            {(fase === "processando" || fase === "fim") && (
              <>
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{fase === "fim" ? "Importação finalizada" : "Processando…"}</span>
                    <span className="tabular-nums">{finalizados}/{itens.length} ({percentual}%)</span>
                  </div>
                  <Progress value={percentual} />
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge variant="success"><CheckCircle2 /> {contagem(["concluido"])} concluídos</Badge>
                  <Badge variant="info"><Copy /> {contagem(["duplicado"])} já existiam</Badge>
                  <Badge variant="destructive"><XCircle /> {contagem(["erro"])} com erro</Badge>
                </div>
                {fase === "processando" && (
                  <div>
                    <Button variant="outline" size="sm" onClick={() => { cancelar.current = true; }}>
                      <CircleSlash /> Parar após o arquivo atual
                    </Button>
                  </div>
                )}
                {fase === "fim" && (
                  <div className="flex flex-wrap gap-2">
                    <Button asChild><Link href="/biblioteca">Ver biblioteca</Link></Button>
                    {importacaoId && <Button variant="outline" asChild><Link href={`/biblioteca/importacoes/${importacaoId}`}>Detalhes e classificação</Link></Button>}
                    {contagem(["erro"]) > 0 && (
                      <Button variant="outline" onClick={() => { setItens((l) => l.filter((i) => i.estado === "erro").map((i) => ({ ...i, estado: "aguardando", detalhe: undefined }))); setFase("plano"); }}>
                        Tentar novamente os que falharam
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {itens.length > 0 && fase !== "plano" && (
        <ul className="grid gap-1.5" aria-live="polite">
          {itens.map((it) => (
            <li key={it.caminho} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
              {it.estado === "concluido" ? <CheckCircle2 className="size-4 shrink-0 text-success" />
                : it.estado === "erro" ? <XCircle className="size-4 shrink-0 text-destructive" />
                : it.estado === "duplicado" ? <Copy className="size-4 shrink-0 text-primary" />
                : it.estado === "aguardando" ? <FileText className="size-4 shrink-0 text-muted-foreground" />
                : <Loader2 className="size-4 shrink-0 animate-spin text-primary" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{it.caminho}</div>
                {it.detalhe && <div className={`truncate text-xs ${it.estado === "erro" ? "text-destructive" : "text-muted-foreground"}`}>{it.detalhe}</div>}
                {it.aviso && <div className="flex items-center gap-1 text-xs text-warning-foreground dark:text-warning"><AlertTriangle className="size-3" /> {it.aviso}</div>}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {ROTULO_ESTADO[it.estado]}{it.progresso !== undefined && ["analisando", "salvando"].includes(it.estado) ? ` ${it.progresso}%` : ""}
              </span>
              {it.materialId && it.estado !== "erro" && (
                <Link href={`/biblioteca/${it.materialId}`} className="shrink-0 text-xs text-primary hover:underline">abrir</Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
