import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, ListChecks, Sparkles } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/basicos";
import { Aviso, CabecalhoPagina } from "@/components/ui/layout";
import { formatarBytes, formatarData, formatarDataHora } from "@/lib/utils";
import { EditorMaterial } from "./editor-material";
import { TabelaSecoes, type SecaoEditavel } from "./tabela-secoes";
import { GeradorPontos } from "@/components/materiais/gerador-pontos";
import { ListaPontos, type PontoExibicao } from "@/components/materiais/lista-pontos";

export const metadata: Metadata = { title: "Material" };

export default async function PaginaMaterial({ params }: PageProps<"/biblioteca/[id]">) {
  const { id } = await params;
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const { data: material } = await supabase
    .from("materiais")
    .select("*, disciplinas(id, nome)")
    .eq("id", id)
    .eq("user_id", usuario.id)
    .maybeSingle();
  if (!material) notFound();

  const [{ data: secoes }, { data: assuntos }, { data: progresso }, { count: questoes }, { data: pontos }] = await Promise.all([
    supabase.from("material_secoes").select("id, ordem, titulo, pagina_inicio, pagina_fim, tipo, banca, confianca, classificacao_origem, revisado_manualmente, assuntos(nome), subassuntos(nome)")
      .eq("material_id", id).order("ordem"),
    material.disciplina_id
      ? supabase.from("assuntos").select("nome").eq("disciplina_id", material.disciplina_id).order("nome")
      : Promise.resolve({ data: [] as { nome: string }[] }),
    supabase.from("progresso_leitura").select("ultima_pagina, paginas_lidas, tempo_leitura_seg").eq("material_id", id).maybeSingle(),
    supabase.from("questao_fontes").select("questao_id", { count: "exact", head: true }).eq("material_id", id),
    supabase.from("material_pontos_chave").select("id, secao_id, pagina, tipo, importancia, titulo, explicacao, trecho").eq("material_id", id).order("pagina").order("ordem"),
  ]);
  const essenciais = ((pontos ?? []) as PontoExibicao[]).filter((p) => p.importancia === 3);

  const avisos: string[] = (material.metadados?.avisos as string[] | undefined) ?? [];
  const lidas = (progresso?.paginas_lidas as number[] | undefined)?.length ?? 0;
  const linhas: SecaoEditavel[] = ((secoes ?? []) as unknown as (Omit<SecaoEditavel, "assunto" | "subassunto"> & { assuntos: { nome: string } | null; subassuntos: { nome: string } | null })[])
    .map((s) => ({ ...s, assunto: s.assuntos?.nome ?? "", subassunto: s.subassuntos?.nome ?? "" }));

  return (
    <>
      <CabecalhoPagina
        titulo={material.titulo}
        descricao={[material.disciplinas?.nome, material.concurso_detectado, material.autor].filter(Boolean).join(" · ")}
        acoes={
          <>
            <Button variant="outline" asChild><Link href="/biblioteca"><ArrowLeft /> Biblioteca</Link></Button>
            <Button variant="outline" asChild><Link href={`/questoes/gerar?material=${id}`}><Sparkles /> Gerar questões</Link></Button>
            <Button asChild><Link href={`/biblioteca/${id}/ler${progresso ? `?pagina=${progresso.ultima_pagina}` : ""}`}><BookOpen /> {progresso ? "Continuar leitura" : "Estudar"}</Link></Button>
          </>
        }
      />

      {material.status === "requer_ocr" && (
        <Aviso tipo="alerta" titulo="PDF digitalizado" className="mb-4">
          Este arquivo não tem texto extraível. Ele pode ser lido normalmente, mas busca, Tutor e geração de questões
          dependem do texto. Use uma ferramenta de OCR (ex.: OCRmyPDF) e importe o PDF resultante.
        </Aviso>
      )}
      {material.status === "erro" && <Aviso tipo="erro" className="mb-4">{material.erro ?? "Processamento incompleto."} Importe o arquivo novamente para completar.</Aviso>}
      {material.possivelmente_desatualizado && (
        <Aviso tipo="alerta" titulo="Conteúdo possivelmente desatualizado" className="mb-4">
          {material.observacao_atualizacao ?? "Verifique se houve alteração legislativa ou jurisprudencial desde a data do material."}
        </Aviso>
      )}

      <Card className="mb-6">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Pontos mais importantes</CardTitle>
            <CardDescription>
              {pontos?.length
                ? `${pontos.length} ponto(s), ${essenciais.length} essencial(is). Os trechos ficam destacados em verde no leitor.`
                : "A IA marca o que mais cai em prova em cada capítulo de teoria, com a página de origem."}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {!!pontos?.length && <Button variant="outline" asChild><Link href={`/biblioteca/${id}/pontos`}><ListChecks /> Ver todos / imprimir</Link></Button>}
            <GeradorPontos escopo={{ materialId: id }} rotulo={pontos?.length ? "Gerar o que falta" : "Gerar pontos importantes"} variante={pontos?.length ? "outline" : "default"} />
          </div>
        </CardHeader>
        {essenciais.length > 0 && (
          <CardContent>
            <ListaPontos materialId={id} pontos={essenciais.slice(0, 12)} secoes={secoes ?? []} mostrarTrecho={false} />
            {essenciais.length > 12 && <p className="mt-3 text-sm text-muted-foreground"><Link className="underline" href={`/biblioteca/${id}/pontos?minimo=3`}>Ver os {essenciais.length} pontos essenciais</Link></p>}
          </CardContent>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Seções e classificação</CardTitle>
            <CardDescription>
              Identificadas automaticamente pelo índice do PDF. Corrija assunto, subassunto, tipo ou páginas quando necessário;
              seções de questões comentadas são usadas só como referência e nunca copiadas para o banco.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TabelaSecoes materialId={id} secoes={linhas} assuntos={(assuntos ?? []).map((a) => a.nome)} totalPaginas={material.total_paginas} />
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Informações</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                {[
                  ["Arquivo", material.nome_arquivo],
                  ["Caminho no ZIP", material.caminho_original ?? "—"],
                  ["Páginas", `${material.total_paginas} (${material.paginas_processadas} com texto salvo)`],
                  ["Tamanho", formatarBytes(material.tamanho_bytes)],
                  ["Data do material", formatarData(material.data_material)],
                  ["Importado em", formatarDataHora(material.created_at)],
                  ["Leitura", `${lidas} de ${material.total_paginas} páginas`],
                  ["Questões vinculadas", String(questoes ?? 0)],
                  ["Identificador", material.id],
                ].map(([rotulo, valor]) => (
                  <div key={rotulo} className="grid grid-cols-[120px_1fr] gap-2">
                    <dt className="text-muted-foreground">{rotulo}</dt>
                    <dd className="break-all">{valor}</dd>
                  </div>
                ))}
              </dl>
              {avisos.length > 0 && (
                <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
                  {avisos.map((a) => <li key={a}>• {a}</li>)}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-1">
                <Badge variant="outline">SHA-256 {material.sha256.slice(0, 12)}…</Badge>
                <Badge variant="outline">{material.origem === "importacao_zip" ? "Importado de ZIP" : "Envio avulso"}</Badge>
              </div>
            </CardContent>
          </Card>
          <EditorMaterial
            id={id}
            inicial={{
              titulo: material.titulo,
              disciplina: material.disciplinas?.nome ?? "",
              aulaNumero: material.aula_numero,
              possivelmenteDesatualizado: material.possivelmente_desatualizado,
              observacao: material.observacao_atualizacao ?? "",
            }}
          />
        </div>
      </div>
    </>
  );
}
