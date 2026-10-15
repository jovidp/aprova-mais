import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { Shell } from "@/components/app/shell";

export default async function LayoutApp({ children }: LayoutProps<"/">) {
  const usuario = await exigirUsuario();
  // O onboarding (/onboarding) fica fora deste grupo de rotas.
  if (!usuario.onboardingConcluido) redirect("/onboarding");

  const supabase = await clienteServidor();
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
