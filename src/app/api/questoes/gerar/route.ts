import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { obterUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { gerarQuestoes } from "@/lib/questoes/gerador";
import { ErroIA } from "@/lib/ia";
import { mensagemDeErro } from "@/lib/erros";
import { registrarErro } from "@/lib/servidor/logs";

export const maxDuration = 300;

const esquema = z.object({
  disciplinaId: z.string().uuid().nullable().optional(),
  assuntoId: z.string().uuid().nullable().optional(),
  materialId: z.string().uuid().nullable().optional(),
  secaoId: z.string().uuid().nullable().optional(),
  quantidade: z.number().int().min(1).max(6),
  tipos: z.array(z.enum(["multipla_escolha", "certo_errado"])).min(1),
  dificuldades: z.array(z.enum(["facil", "medio", "dificil"])).min(1),
  estilos: z.array(z.enum(["conceitual", "interpretacao", "aplicacao", "situacao_hipotetica", "analise_juridica"])).min(1),
  bancaEstiloId: z.string().uuid().nullable().optional(),
  verificarComIA: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const usuario = await obterUsuario();
  if (!usuario) return NextResponse.json({ erro: "Sessão expirada. Entre novamente." }, { status: 401 });

  const corpo = esquema.safeParse(await request.json().catch(() => null));
  if (!corpo.success) return NextResponse.json({ erro: "Parâmetros inválidos." }, { status: 400 });
  if (!corpo.data.disciplinaId && !corpo.data.assuntoId && !corpo.data.materialId && !corpo.data.secaoId) {
    return NextResponse.json({ erro: "Escolha uma disciplina, assunto ou material." }, { status: 400 });
  }

  try {
    const supabase = await clienteServidor();
    const resultado = await gerarQuestoes(supabase, usuario.id, corpo.data);
    return NextResponse.json(resultado);
  } catch (erro) {
    if (erro instanceof ErroIA) {
      const status = erro.codigo === "orcamento" || erro.codigo === "indisponivel" ? 403 : erro.codigo === "limite" ? 429 : 502;
      return NextResponse.json({ erro: erro.message, codigo: erro.codigo }, { status });
    }
    const mensagem = mensagemDeErro(erro);
    if (mensagem.startsWith("Ocorreu um erro inesperado")) await registrarErro("api.questoes.gerar", erro, usuario.id);
    return NextResponse.json({ erro: mensagem }, { status: 400 });
  }
}
