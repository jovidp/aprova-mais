import "server-only";
import { adminDisponivel, clienteAdmin } from "@/lib/supabase/servidor";

/** Registra o erro no console e, se houver chave secreta, na tabela logs_erros. */
export async function registrarErro(origem: string, erro: unknown, userId?: string | null, extra?: Record<string, unknown>) {
  const mensagem = erro instanceof Error ? erro.message : typeof erro === "object" && erro && "message" in erro ? String((erro as { message: unknown }).message) : String(erro);
  console.error(`[${origem}]`, mensagem, erro);
  if (!adminDisponivel()) return;
  try {
    await clienteAdmin()
      .from("logs_erros")
      .insert({
        user_id: userId ?? null,
        origem,
        mensagem: mensagem.slice(0, 2000),
        detalhes: {
          ...(extra ?? {}),
          codigo: typeof erro === "object" && erro && "code" in erro ? (erro as { code: unknown }).code : undefined,
          stack: erro instanceof Error ? erro.stack?.slice(0, 4000) : undefined,
        },
      });
  } catch (falha) {
    console.error("[logs] falha ao registrar erro", falha);
  }
}
