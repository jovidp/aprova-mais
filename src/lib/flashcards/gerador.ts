import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { executarComIA } from "@/lib/ia";
import { selecionarContexto, type FiltroContexto } from "@/lib/questoes/gerador";
import { blocoMaterial } from "@/lib/questoes/prompts";
import { detectarCopia } from "@/lib/questoes/validacao";

const SISTEMA = `Você cria flashcards de estudo para concursos públicos a partir de um material fornecido.
Regras:
1. Use somente informações do material entre <material> e </material>; nunca acrescente artigos, números ou jurisprudência ausentes.
2. Frente: uma pergunta objetiva e específica. Verso: resposta curta (até 3 frases), precisa e autossuficiente.
3. Um conceito por cartão. Prefira conceitos cobrados em prova: definições, exceções, requisitos, prazos e competências presentes no texto.
4. Reescreva com suas palavras; não copie trechos longos.
5. Informe "pagina" com o número da página que sustenta a resposta.
6. Português do Brasil formal.`;

const esquema = z.object({
  cartoes: z.array(z.object({ frente: z.string(), verso: z.string(), pagina: z.number() })),
});

export async function gerarFlashcards(supabase: SupabaseClient, userId: string, filtro: FiltroContexto, quantidade: number) {
  const ctx = await selecionarContexto(supabase, userId, filtro);
  const { resultado, custoUsd } = await executarComIA(userId, "gerar_flashcards", { quantidade, material_id: ctx.material.id, paginas: ctx.paginas.map((p) => p.numero) },
    async (provedor, registrarUso) => {
      const r = await provedor.gerarEstruturado({
        sistema: SISTEMA, nomeEsquema: "flashcards", esquema, esforco: "low", maxTokens: 8000,
        mensagens: [{ papel: "user", conteudo: `Crie ${quantidade} flashcards.\n\n${blocoMaterial({ tituloMaterial: ctx.material.titulo, disciplina: ctx.disciplinaNome, assunto: ctx.assunto?.nome ?? null, dataMaterial: ctx.material.dataMaterial, paginas: ctx.paginas })}` }],
      });
      registrarUso(r.uso, r.modelo);
      return r.dados.cartoes;
    });

  const paginasValidas = new Set(ctx.paginas.map((p) => p.numero));
  const textos = ctx.paginas.map((p) => p.texto);
  const validos = resultado
    .filter((c) => c.frente.trim().length >= 8 && c.verso.trim().length >= 2 && c.frente.length <= 2000 && c.verso.length <= 4000)
    .filter((c) => detectarCopia({ enunciado: c.frente, texto_apoio: c.verso, alternativas: [] } as never, textos).length === 0)
    .slice(0, quantidade);
  if (validos.length) {
    const { error } = await supabase.from("flashcards").insert(validos.map((c) => ({
      user_id: userId, frente: c.frente.trim(), verso: c.verso.trim(), disciplina_id: ctx.material.disciplinaId, assunto_id: ctx.assunto?.id ?? null,
      material_id: ctx.material.id, pagina: paginasValidas.has(c.pagina) ? c.pagina : ctx.paginas[0].numero, origem: "ia",
    })));
    if (error) throw error;
  }
  return { criados: validos.length, descartados: resultado.length - validos.length, custoUsd, fonte: { titulo: ctx.material.titulo, paginas: ctx.paginas.map((p) => p.numero) } };
}
