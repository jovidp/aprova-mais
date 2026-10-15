import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, History } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/basicos";
import { CabecalhoPagina, EstadoVazio, Tabela } from "@/components/ui/layout";
import { formatarBytes, formatarDataHora } from "@/lib/utils";
import { ROTULO_STATUS_IMPORTACAO } from "./rotulos";

export const metadata: Metadata = { title: "Importações" };

export default async function PaginaImportacoes() {
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const { data } = await supabase.from("importacoes").select("*").eq("user_id", usuario.id).order("created_at", { ascending: false }).limit(100);
  return (
    <>
      <CabecalhoPagina titulo="Importações" descricao="Histórico de envios de materiais e o resultado de cada arquivo."
        acoes={<Button variant="outline" asChild><Link href="/biblioteca"><ArrowLeft /> Biblioteca</Link></Button>} />
      {!data?.length ? (
        <EstadoVazio icone={<History />} titulo="Nenhuma importação ainda" acao={<Button asChild><Link href="/biblioteca/importar">Importar materiais</Link></Button>} />
      ) : (
        <Tabela>
          <thead><tr><th>Arquivo</th><th>Data</th><th>Status</th><th className="text-right">Processados</th><th className="text-right">Duplicados</th><th className="text-right">Erros</th></tr></thead>
          <tbody>
            {data.map((i) => {
              const s = ROTULO_STATUS_IMPORTACAO[i.status] ?? { rotulo: i.status, variante: "outline" as const };
              return (
                <tr key={i.id}>
                  <td><Link href={`/biblioteca/importacoes/${i.id}`} className="font-medium hover:text-primary">{i.nome_arquivo}</Link><div className="text-xs text-muted-foreground">{formatarBytes(i.tamanho_bytes)} · {i.total_arquivos} arquivos</div></td>
                  <td>{formatarDataHora(i.created_at)}</td>
                  <td><Badge variant={s.variante}>{s.rotulo}</Badge></td>
                  <td className="text-right tabular-nums">{i.arquivos_processados}</td>
                  <td className="text-right tabular-nums">{i.arquivos_duplicados}</td>
                  <td className="text-right tabular-nums">{i.arquivos_com_erro}</td>
                </tr>
              );
            })}
          </tbody>
        </Tabela>
      )}
    </>
  );
}
