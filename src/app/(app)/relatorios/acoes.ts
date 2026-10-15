"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { ErroApp } from "@/lib/erros";
import { executarComIA } from "@/lib/ia";
import { dataLocal, diferencaDias, somarDias } from "@/lib/estudo/tempo";
import { fusoDoUsuario, inicioDaSemana } from "@/lib/servidor/painel";
import { montarDadosRelatorio } from "@/lib/servidor/relatorios";
import { analisarRelatorio, type DadosRelatorio } from "@/lib/relatorios/analise";

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const esquemaGerar = z.discriminatedUnion("periodo", [
  z.object({ periodo: z.literal("semanal"), referencia: z.enum(["atual", "anterior"]) }),
  z.object({ periodo: z.literal("mensal"), referencia: z.enum(["atual", "anterior"]) }),
  z.object({ periodo: z.literal("personalizado"), inicio: data, fim: data }),
]);

export async function gerarRelatorio(entrada: z.input<typeof esquemaGerar>) {
  return executarAcao("relatorios.gerar", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const p = esquemaGerar.parse(entrada);
    const hoje = dataLocal(new Date(), await fusoDoUsuario(supabase, usuario.id));
    let inicio: string;
    let fim: string;
    if (p.periodo === "semanal") {
      inicio = somarDias(inicioDaSemana(hoje), p.referencia === "anterior" ? -7 : 0);
      fim = p.referencia === "anterior" ? somarDias(inicio, 6) : hoje;
    } else if (p.periodo === "mensal") {
      const [a, m] = hoje.split("-").map(Number);
      const ref = p.referencia === "anterior" ? new Date(Date.UTC(a, m - 2, 1)) : new Date(Date.UTC(a, m - 1, 1));
      inicio = ref.toISOString().slice(0, 10);
      fim = p.referencia === "anterior" ? new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0)).toISOString().slice(0, 10) : hoje;
    } else {
      inicio = p.inicio;
      fim = p.fim;
      if (fim < inicio) throw new ErroApp("A data final deve ser posterior à inicial.");
      if (diferencaDias(inicio, fim) > 366) throw new ErroApp("Escolha um período de até 1 ano.");
    }
    const dados = await montarDadosRelatorio(supabase, usuario.id, inicio, fim, p.periodo);
    const { data: criado, error } = await supabase.from("relatorios").insert({ user_id: usuario.id, periodo: p.periodo, inicio, fim, dados }).select("id").single();
    if (error) throw error;
    revalidatePath("/relatorios");
    return { id: criado.id as string };
  });
}

const esquemaAnalise = z.object({
  resumo: z.string(),
  pontos_fortes: z.array(z.string()),
  pontos_de_atencao: z.array(z.string()),
  recomendacoes: z.array(z.string()),
});

const SISTEMA_ANALISE = `Você analisa relatórios de estudo de um candidato a concurso público. Escreva em português do Brasil.
Regras:
- Use somente os números fornecidos. Não invente dados, médias de outros candidatos nem previsões de aprovação.
- Amostras com menos de 10 questões não permitem conclusões sobre domínio; diga isso quando relevante.
- Recomendações devem ser concretas e acionáveis (o que estudar, quantas questões, quando revisar), coerentes com os números.
- Seja breve: resumo com até 4 frases; no máximo 4 itens por lista.`;

export async function analisarRelatorioComIA(id: string) {
  return executarAcao("relatorios.ia", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const { data: rel } = await supabase.from("relatorios").select("id, dados").eq("id", z.string().uuid().parse(id)).eq("user_id", usuario.id).maybeSingle();
    if (!rel) throw new ErroApp("Relatório não encontrado.");
    const dados = rel.dados as DadosRelatorio;
    const compacto = {
      ...dados,
      por_dia: undefined,
      por_assunto: dados.por_assunto.filter((a) => a.respondidas >= 5).slice(0, 25),
      observacoes_calculadas: analisarRelatorio(dados).map((o) => o.texto),
    };
    const { resultado } = await executarComIA(usuario.id, "relatorio", { relatorio_id: rel.id }, async (provedor, registrarUso) => {
      const r = await provedor.gerarEstruturado({
        sistema: SISTEMA_ANALISE, nomeEsquema: "analise_relatorio", esquema: esquemaAnalise, esforco: "low", maxTokens: 3000,
        mensagens: [{ papel: "user", conteudo: `Dados do relatório (JSON):\n${JSON.stringify(compacto)}` }],
      });
      registrarUso(r.uso, r.modelo);
      return r.dados;
    });
    const lista = (titulo: string, itens: string[]) => (itens.length ? `\n\n**${titulo}**\n${itens.slice(0, 4).map((i) => `- ${i}`).join("\n")}` : "");
    const texto = `${resultado.resumo}${lista("Pontos fortes", resultado.pontos_fortes)}${lista("Pontos de atenção", resultado.pontos_de_atencao)}${lista("Recomendações", resultado.recomendacoes)}`;
    const { error } = await supabase.from("relatorios").update({ analise_ia: texto.slice(0, 8000) }).eq("id", rel.id);
    if (error) throw error;
    revalidatePath(`/relatorios/${rel.id}`);
  });
}

export async function excluirRelatorio(id: string) {
  return executarAcao("relatorios.excluir", async () => {
    const usuario = await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("relatorios").delete().eq("id", z.string().uuid().parse(id)).eq("user_id", usuario.id);
    if (error) throw error;
    revalidatePath("/relatorios");
  });
}
