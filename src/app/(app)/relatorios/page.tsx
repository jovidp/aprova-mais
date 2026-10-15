import type { Metadata } from "next";
import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/basicos";
import { CabecalhoPagina, EstadoVazio, Tabela } from "@/components/ui/layout";
import type { DadosRelatorio } from "@/lib/relatorios/analise";
import { formatarData, formatarDuracao, formatarPercentual, percentual } from "@/lib/utils";
import { GeradorRelatorio } from "./gerador";

export const metadata: Metadata = { title: "Relatórios" };

const ROTULO_PERIODO = { semanal: "Semanal", mensal: "Mensal", personalizado: "Personalizado" } as const;

export default async function PaginaRelatorios() {
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const { data: relatorios } = await supabase.from("relatorios").select("id, periodo, inicio, fim, dados, analise_ia, created_at")
    .eq("user_id", usuario.id).order("created_at", { ascending: false }).limit(100);

  return (
    <>
      <CabecalhoPagina titulo="Relatórios" descricao="Relatórios de desempenho por período, calculados dos seus registros. Exporte em PDF pela opção de impressão." />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          {!relatorios?.length ? (
            <EstadoVazio icone={<FileBarChart />} titulo="Nenhum relatório gerado" descricao="Gere um relatório semanal, mensal ou de um período personalizado." />
          ) : (
            <Card>
              <CardContent className="pt-6">
                <Tabela>
                  <thead><tr><th>Período</th><th>Tipo</th><th className="text-right">Questões</th><th className="text-right">Acerto</th><th className="text-right">Estudo</th><th>Gerado em</th></tr></thead>
                  <tbody>
                    {relatorios.map((r) => {
                      const d = r.dados as DadosRelatorio;
                      return (
                        <tr key={r.id}>
                          <td><Link className="font-medium hover:underline" href={`/relatorios/${r.id}`}>{formatarData(r.inicio)} a {formatarData(r.fim)}</Link></td>
                          <td><Badge variant="outline">{ROTULO_PERIODO[r.periodo as keyof typeof ROTULO_PERIODO]}</Badge>{r.analise_ia && <Badge variant="secondary" className="ml-1">IA</Badge>}</td>
                          <td className="text-right tabular-nums">{d.totais.respondidas}</td>
                          <td className="text-right tabular-nums">{formatarPercentual(percentual(d.totais.acertos, d.totais.respondidas))}</td>
                          <td className="text-right tabular-nums">{d.totais.tempo_estudo_seg ? formatarDuracao(d.totais.tempo_estudo_seg) : "—"}</td>
                          <td className="text-muted-foreground">{formatarData(r.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Tabela>
              </CardContent>
            </Card>
          )}
        </div>
        <Card className="h-fit">
          <CardHeader><CardTitle>Gerar relatório</CardTitle></CardHeader>
          <CardContent><GeradorRelatorio /></CardContent>
        </Card>
      </div>
    </>
  );
}
