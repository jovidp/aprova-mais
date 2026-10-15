import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { ipDoCliente } from "@/lib/rede/ip";
import { Shell } from "@/components/app/shell";

export default async function LayoutApp({ children }: LayoutProps<"/">) {
  const usuario = await exigirUsuario();
  // O onboarding (/onboarding) fica fora deste grupo de rotas.
  if (!usuario.onboardingConcluido) redirect("/onboarding");

  const supabase = await clienteServidor();

  // Registra o IP de acesso depois de enviar a página (usado na moderação).
  const cabecalhos = await headers();
  const ip = ipDoCliente(cabecalhos);
  if (ip) {
    const agente = cabecalhos.get("user-agent")?.slice(0, 500) ?? null;
    after(async () => {
      await supabase.rpc("registrar_acesso", { p_ip: ip, p_user_agent: agente });
    });
  }

  const { count } = await supabase
    .from("notificacoes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", usuario.id)
    .eq("lida", false);

  return (
    <Shell
      usuario={{ nome: usuario.nome, email: usuario.email, admin: usuario.papel === "admin" }}
      notificacoesNaoLidas={count ?? 0}
    >
      {children}
    </Shell>
  );
}
