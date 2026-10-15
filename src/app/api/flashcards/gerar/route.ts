import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { obterUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { gerarFlashcards } from "@/lib/flashcards/gerador";
import { ErroIA } from "@/lib/ia";
import { mensagemDeErro } from "@/lib/erros";

export const maxDuration = 120;

const esquema = z.object({
  disciplinaId: z.string().uuid().nullable().optional(),
  assuntoId: z.string().uuid().nullable().optional(),
  materialId: z.string().uuid().nullable().optional(),
  quantidade: z.number().int().min(1).max(20),
});

export async function POST(request: NextRequest) {
  const usuario = await obterUsuario();
  if (!usuario) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const d = esquema.safeParse(await request.json().catch(() => null));
  if (!d.success || (!d.data.disciplinaId && !d.data.assuntoId && !d.data.materialId)) return NextResponse.json({ erro: "Escolha disciplina, assunto ou material." }, { status: 400 });
  try {
    const supabase = await clienteServidor();
    return NextResponse.json(await gerarFlashcards(supabase, usuario.id, d.data, d.data.quantidade));
  } catch (erro) {
    if (erro instanceof ErroIA) return NextResponse.json({ erro: erro.message }, { status: erro.codigo === "orcamento" || erro.codigo === "indisponivel" ? 403 : 502 });
    return NextResponse.json({ erro: mensagemDeErro(erro) }, { status: 400 });
  }
}
