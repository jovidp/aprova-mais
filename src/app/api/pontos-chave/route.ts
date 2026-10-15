import { type NextRequest } from "next/server";
import { z } from "zod";
import { obterUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { ErroApp, mensagemDeErro } from "@/lib/erros";
import { ErroIA } from "@/lib/ia";
import { registrarErro } from "@/lib/servidor/logs";
import { gerarPontosParte, planejarPontos } from "@/lib/servidor/pontos-chave";

export const maxDuration = 300;

const esquema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("planejar"), materialId: z.string().uuid().optional(), disciplinaId: z.string().uuid().optional(), refazer: z.boolean().default(false) }),
  z.object({ acao: z.literal("gerar"), secaoId: z.string().uuid(), inicio: z.number().int().min(1), fim: z.number().int().min(1) }),
]);

export async function POST(request: NextRequest) {
  const usuario = await obterUsuario();
  if (!usuario) return Response.json({ erro: "Sessão expirada. Entre novamente." }, { status: 401 });
  const parsed = esquema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ erro: "Pedido inválido." }, { status: 400 });
  const supabase = await clienteServidor();
  try {
    if (parsed.data.acao === "planejar") {
      return Response.json(await planejarPontos(supabase, usuario.id, parsed.data, parsed.data.refazer));
    }
    const d = parsed.data;
    return Response.json(await gerarPontosParte(supabase, usuario.id, d.secaoId, d.inicio, d.fim));
  } catch (erro) {
    if (erro instanceof ErroIA) return Response.json({ erro: erro.message, codigo: erro.codigo }, { status: erro.codigo === "orcamento" ? 402 : 503 });
    if (!(erro instanceof ErroApp)) await registrarErro("pontos_chave", erro, usuario.id);
    return Response.json({ erro: mensagemDeErro(erro) }, { status: erro instanceof ErroApp ? 400 : 500 });
  }
}
