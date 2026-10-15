import { type NextRequest } from "next/server";
import { z } from "zod";
import { obterUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { estadoIA, executarComIA, ErroIA, type MensagemIA } from "@/lib/ia";
import { SISTEMA_ESTUDO, SISTEMA_TUTOR, blocoFontes, contextoQuestao, fontesDaAula, fontesDaPagina, recuperarFontes, type FonteTutor } from "@/lib/tutor/contexto";
import { registrarErro } from "@/lib/servidor/logs";

export const maxDuration = 120;

const esquema = z.object({
  conversaId: z.string().uuid().nullable().optional(),
  mensagem: z.string().trim().min(1).max(4000),
  questaoId: z.string().uuid().nullable().optional(),
  assuntoId: z.string().uuid().nullable().optional(),
  materialId: z.string().uuid().nullable().optional(),
  nivel: z.enum(["simples", "aprofundado"]).default("simples"),
  /** Modo "estudo": conversa curta ao lado do PDF, com a página atual como fonte principal. */
  modo: z.enum(["tutor", "estudo"]).default("tutor"),
  pagina: z.number().int().min(1).max(100000).optional(),
});

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

/** Últimas mensagens de uma conversa do usuário (retomar o estudo junto ao PDF). */
export async function GET(request: NextRequest) {
  const usuario = await obterUsuario();
  if (!usuario) return json({ erro: "Sessão expirada." }, 401);
  const id = request.nextUrl.searchParams.get("conversa") ?? "";
  if (!z.string().uuid().safeParse(id).success) return json({ erro: "Conversa inválida." }, 400);
  const supabase = await clienteServidor();
  const { data: conversa } = await supabase.from("tutor_conversas").select("id").eq("id", id).eq("user_id", usuario.id).maybeSingle();
  if (!conversa) return json({ erro: "Conversa não encontrada." }, 404);
  const { data } = await supabase.from("tutor_mensagens").select("id, papel, conteudo, fontes").eq("conversa_id", id).order("created_at", { ascending: false }).limit(30);
  return json({ mensagens: [...(data ?? [])].reverse() });
}

/**
 * Responde em streaming. A primeira linha da resposta traz os metadados
 * (conversa e fontes) em JSON; o restante é o texto da resposta.
 */
export async function POST(request: NextRequest) {
  const usuario = await obterUsuario();
  if (!usuario) return json({ erro: "Sessão expirada." }, 401);
  const parsed = esquema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ erro: "Mensagem inválida." }, 400);
  const d = parsed.data;
  const supabase = await clienteServidor();

  let conversaId = d.conversaId ?? null;
  if (conversaId) {
    const { data } = await supabase.from("tutor_conversas").select("id").eq("id", conversaId).eq("user_id", usuario.id).maybeSingle();
    if (!data) return json({ erro: "Conversa não encontrada." }, 404);
  } else {
    const { data: mat } = d.modo === "estudo" && d.materialId ? await supabase.from("materiais").select("titulo").eq("id", d.materialId).maybeSingle() : { data: null };
    const { data, error } = await supabase.from("tutor_conversas").insert({
      user_id: usuario.id, titulo: (mat ? `Estudo · ${mat.titulo}` : d.mensagem).slice(0, 80),
      contexto: { questao_id: d.questaoId ?? null, assunto_id: d.assuntoId ?? null, material_id: d.materialId ?? null, modo: d.modo },
    }).select("id").single();
    if (error) return json({ erro: "Não foi possível iniciar a conversa." }, 500);
    conversaId = data.id;
  }

  const { data: historico } = await supabase.from("tutor_mensagens").select("papel, conteudo").eq("conversa_id", conversaId).order("created_at", { ascending: false }).limit(10);
  await supabase.from("tutor_mensagens").insert({ conversa_id: conversaId, user_id: usuario.id, papel: "user", conteudo: d.mensagem });

  // Recuperação de contexto
  const aula = /\baula\s*0*(\d{1,3})\b/i.exec(d.mensagem);
  let fontes: FonteTutor[] = [];
  try {
    if (d.materialId && d.pagina) {
      // Estudo junto ao PDF: página atual e vizinhas, completadas pela busca nos materiais.
      fontes = await fontesDaPagina(supabase, d.materialId, d.pagina);
      const extras = await recuperarFontes(supabase, d.mensagem);
      for (const f of extras) {
        if (fontes.length >= 6) break;
        if (fontes.some((x) => x.materialId === f.materialId && x.pagina === f.pagina)) continue;
        fontes.push({ ...f, indice: fontes.length + 1 });
      }
    } else if (aula && /resum|explique a aula|principais pontos/i.test(d.mensagem)) {
      const { data: assunto } = d.assuntoId ? await supabase.from("assuntos").select("disciplina_id").eq("id", d.assuntoId).maybeSingle() : { data: null };
      fontes = await fontesDaAula(supabase, usuario.id, Number(aula[1]), assunto?.disciplina_id ?? null);
    }
    if (fontes.length === 0) {
      const consultaBusca = d.questaoId
        ? `${d.mensagem} ${(await supabase.from("questoes").select("enunciado").eq("id", d.questaoId).maybeSingle()).data?.enunciado ?? ""}`
        : d.mensagem;
      fontes = await recuperarFontes(supabase, consultaBusca, { materialIds: d.materialId ? [d.materialId] : undefined, assuntoIds: d.assuntoId ? [d.assuntoId] : undefined });
    }
  } catch (erro) {
    await registrarErro("tutor.busca", erro, usuario.id);
  }
  const questao = d.questaoId ? await contextoQuestao(supabase, usuario.id, d.questaoId) : null;
  const metadados = { conversaId, fontes: fontes.map(({ trecho, ...f }) => ({ ...f, trecho: trecho.slice(0, 280) })) };

  const ia = await estadoIA(usuario.id);
  const codificador = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const escritor = writable.getWriter();
  const escrever = (t: string) => escritor.write(codificador.encode(t));

  // Sem IA: entrega apenas os trechos mais relevantes (busca nos materiais).
  if (!ia.configurada || ia.bloqueadaPorOrcamento) {
    void (async () => {
      await escrever(`${JSON.stringify(metadados)}\n`);
      const texto = fontes.length
        ? `${ia.configurada ? "O orçamento de IA deste mês foi atingido" : "A IA não está configurada"}, então mostro os trechos dos seus materiais mais relevantes para a pergunta:\n\n${fontes.map((f) => `**[${f.indice}] ${f.titulo}, p. ${f.pagina}**\n${f.trecho.slice(0, 700)}…`).join("\n\n")}`
        : `${ia.configurada ? "O orçamento de IA deste mês foi atingido" : "A IA não está configurada"} e não encontrei trechos nos seus materiais sobre isso. Tente outras palavras-chave.`;
      await escrever(texto);
      await supabase.from("tutor_mensagens").insert({ conversa_id: conversaId, user_id: usuario.id, papel: "assistant", conteudo: texto, fontes: metadados.fontes });
      await escritor.close();
    })();
    return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const mensagens: MensagemIA[] = [
    ...[...(historico ?? [])].reverse().map((m) => ({ papel: m.papel as "user" | "assistant", conteudo: m.conteudo.slice(0, 6000) })),
    {
      papel: "user",
      conteudo: `${blocoFontes(fontes)}\n${questao ? `\n${questao}\n` : ""}${d.pagina ? `\nO aluno está na página ${d.pagina} do material.\n` : ""}\nNível de explicação: ${d.nivel === "simples" ? "simples e direto, para quem está começando" : "aprofundado, com nuances e exceções"}.\n\n${d.modo === "estudo" ? "Fala do aluno" : "Pergunta do aluno"}: ${d.mensagem}`,
    },
  ];

  void (async () => {
    await escrever(`${JSON.stringify(metadados)}\n`);
    let textoFinal = "";
    try {
      const { processamentoId } = await executarComIA(usuario.id, "tutor", { conversa_id: conversaId, fontes: fontes.length, nivel: d.nivel }, async (provedor, registrarUso) => {
        const fluxo = await provedor.conversar({
          sistema: d.modo === "estudo" ? SISTEMA_ESTUDO : SISTEMA_TUTOR, mensagens,
          esforco: d.nivel === "aprofundado" ? "medium" : "low", maxTokens: d.modo === "estudo" ? 3000 : 6000,
        });
        for await (const pedaco of fluxo.textos) {
          textoFinal += pedaco;
          await escrever(pedaco);
        }
        const fim = await fluxo.final();
        registrarUso(fim.uso, fim.modelo);
        return fim.texto || textoFinal;
      });
      await supabase.from("tutor_mensagens").insert({ conversa_id: conversaId, user_id: usuario.id, papel: "assistant", conteudo: textoFinal || "(sem resposta)", fontes: metadados.fontes, processamento_id: processamentoId });
      await supabase.from("tutor_conversas").update({ updated_at: new Date().toISOString() }).eq("id", conversaId);
    } catch (erro) {
      const msg = erro instanceof ErroIA ? erro.message : "Não foi possível concluir a resposta. Tente novamente.";
      if (!(erro instanceof ErroIA)) await registrarErro("tutor.resposta", erro, usuario.id);
      await escrever(`${textoFinal ? "\n\n" : ""}⚠ ${msg}`);
    } finally {
      await escritor.close();
    }
  })();

  return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
