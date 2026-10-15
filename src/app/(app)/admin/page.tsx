import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exigirAdmin } from "@/lib/auth";
import { adminDisponivel, clienteAdmin } from "@/lib/supabase/servidor";
import { estadoIA } from "@/lib/ia";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/basicos";
import { Aviso, CabecalhoPagina, Indicador, Tabela } from "@/components/ui/layout";
import { formatarDataHora } from "@/lib/utils";

export const metadata: Metadata = { title: "Administração" };

export default async function PaginaAdmin() {
  const usuario = await exigirAdmin();
  if (!adminDisponivel()) return <Aviso tipo="erro">SUPABASE_SECRET_KEY não configurada no servidor.</Aviso>;
  const admin = clienteAdmin();
  const contar = async (tabela: string, filtro?: [string, string]) => {
    let q = admin.from(tabela).select("*", { count: "exact", head: true });
    if (filtro) q = q.eq(filtro[0], filtro[1]);
    return (await q).count ?? 0;
  };
  const [usuarios, materiais, materiaisErro, questoes, pendentes, simulados, ia, { data: processamentos }, { data: logs }, { data: importacoes }] = await Promise.all([
    contar("profiles"), contar("materiais"), contar("materiais", ["status", "erro"]), contar("questoes"), contar("questoes", ["status", "pendente_revisao"]), contar("simulados"),
    estadoIA(usuario.id),
    admin.from("processamentos_ia").select("tipo, status, modelo, custo_estimado_usd, erro, created_at").order("created_at", { ascending: false }).limit(20),
    admin.from("logs_erros").select("origem, mensagem, created_at").order("created_at", { ascending: false }).limit(30),
    admin.from("importacoes").select("nome_arquivo, status, total_arquivos, arquivos_processados, iniciada_em").order("iniciada_em", { ascending: false }).limit(10),
  ]);

  return (
    <>
      <CabecalhoPagina titulo="Administração" descricao="Visão geral da plataforma."
        acoes={<Button asChild><Link href="/admin/usuarios"><Users /> Usuários, banimentos e IPs</Link></Button>} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Indicador rotulo="Usuários" valor={usuarios} />
        <Indicador rotulo="Materiais" valor={materiais} detalhe={materiaisErro ? `${materiaisErro} com erro` : undefined} />
        <Indicador rotulo="Questões" valor={questoes} detalhe={pendentes ? `${pendentes} pendente(s) de revisão` : undefined} />
        <Indicador rotulo="Simulados" valor={simulados} />
        <Indicador rotulo="IA no mês" valor={`US$ ${ia.gastoMesUsd.toFixed(2)}`} detalhe={`de US$ ${ia.orcamentoMensalUsd.toFixed(2)}`} />
        <Indicador rotulo="Provedor IA" valor={ia.configurada ? (ia.modelo ?? "—") : "desligado"} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Processamentos de IA</CardTitle></CardHeader>
          <CardContent>
            <Tabela>
              <thead><tr><th>Quando</th><th>Tipo</th><th>Status</th><th className="text-right">Custo</th></tr></thead>
              <tbody>{(processamentos ?? []).map((p, i) => <tr key={i} title={p.erro ?? undefined}><td>{formatarDataHora(p.created_at)}</td><td>{p.tipo}</td><td>{p.status}</td><td className="text-right tabular-nums">{Number(p.custo_estimado_usd).toFixed(4)}</td></tr>)}</tbody>
            </Tabela>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Erros do servidor</CardTitle></CardHeader>
          <CardContent>
            {!logs?.length ? <p className="text-sm text-muted-foreground">Nenhum erro registrado.</p> : (
              <ul className="grid gap-2 text-sm">{logs.map((l, i) => <li key={i}><span className="text-xs text-muted-foreground">{formatarDataHora(l.created_at)} · {l.origem}</span><p className="break-words">{l.mensagem}</p></li>)}</ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Importações recentes</CardTitle></CardHeader>
          <CardContent>
            <Tabela>
              <tbody>{(importacoes ?? []).map((x, i) => <tr key={i}><td>{x.nome_arquivo}</td><td>{x.status}</td><td className="text-right tabular-nums">{x.arquivos_processados}/{x.total_arquivos}</td><td>{formatarDataHora(x.iniciada_em)}</td></tr>)}</tbody>
            </Tabela>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
