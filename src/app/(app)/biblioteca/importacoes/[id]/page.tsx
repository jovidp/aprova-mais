import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { Badge, Progress } from "@/components/ui/basicos";
import { Aviso, CabecalhoPagina, Indicador, Tabela } from "@/components/ui/layout";
import { formatarBytes, formatarDataHora } from "@/lib/utils";
import { ROTULO_STATUS_ARQUIVO as ROTULO_ARQUIVO, ROTULO_STATUS_IMPORTACAO } from "../rotulos";

export const metadata: Metadata = { title: "Importação" };

export default async function PaginaImportacao({ params }: PageProps<"/biblioteca/importacoes/[id]">) {
  const { id } = await params;
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const { data: imp } = await supabase.from("importacoes").select("*").eq("id", id).eq("user_id", usuario.id).maybeSingle();
  if (!imp) notFound();
  const { data: arquivos } = await supabase
    .from("importacao_arquivos")
    .select("id, caminho_original, tipo, tamanho_bytes, status, motivo, material_id, materiais(titulo, total_paginas, status, disciplinas(nome))")
    .eq("importacao_id", id).order("caminho_original");
  const s = ROTULO_STATUS_IMPORTACAO[imp.status] ?? { rotulo: imp.status, variante: "outline" as const };
  const finalizados = imp.arquivos_processados + imp.arquivos_duplicados + imp.arquivos_com_erro;

  return (
    <>
      <CabecalhoPagina titulo={imp.nome_arquivo} descricao={`${formatarBytes(imp.tamanho_bytes)} · iniciada em ${formatarDataHora(imp.created_at)}`}
        acoes={<Button variant="outline" asChild><Link href="/biblioteca/importacoes"><ArrowLeft /> Importações</Link></Button>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Indicador rotulo="Status" valor={<Badge variant={s.variante}>{s.rotulo}</Badge>} />
        <Indicador rotulo="Arquivos" valor={imp.total_arquivos} />
        <Indicador rotulo="Processados" valor={imp.arquivos_processados} />
        <Indicador rotulo="Já existiam" valor={imp.arquivos_duplicados} />
        <Indicador rotulo="Ignorados / erros" valor={`${imp.arquivos_ignorados} / ${imp.arquivos_com_erro}`} />
      </div>
      <Progress value={imp.total_arquivos ? (100 * finalizados) / imp.total_arquivos : 0} className="mb-6" />
      {imp.status === "processando" && (
        <Aviso tipo="info" className="mb-6">
          Esta importação não foi concluída (a aba pode ter sido fechada). Envie o mesmo ZIP novamente: os arquivos já
          processados são reconhecidos e apenas os restantes são importados.
        </Aviso>
      )}
      <Tabela>
        <thead><tr><th>Arquivo</th><th>Disciplina</th><th>Status</th><th>Detalhe</th></tr></thead>
        <tbody>
          {(arquivos ?? []).map((a) => {
            const m = a.materiais as unknown as { titulo: string; total_paginas: number; disciplinas: { nome: string } | null } | null;
            const st = ROTULO_ARQUIVO[a.status] ?? { rotulo: a.status, variante: "outline" as const };
            return (
              <tr key={a.id}>
                <td>
                  {a.material_id ? <Link href={`/biblioteca/${a.material_id}`} className="font-medium hover:text-primary">{a.caminho_original}</Link> : <span className="font-medium">{a.caminho_original}</span>}
                  <div className="text-xs text-muted-foreground">{a.tipo.toUpperCase()} · {a.tamanho_bytes ? formatarBytes(a.tamanho_bytes) : "—"}{m ? ` · ${m.titulo}` : ""}</div>
                </td>
                <td>{m?.disciplinas?.nome ?? "—"}</td>
                <td><Badge variant={st.variante}>{st.rotulo}</Badge></td>
                <td className="text-xs text-muted-foreground">{a.motivo ?? (m ? `${m.total_paginas} páginas` : "")}</td>
              </tr>
            );
          })}
        </tbody>
      </Tabela>
    </>
  );
}
