import type { Metadata } from "next";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { estadoIA } from "@/lib/ia";
import { CabecalhoPagina } from "@/components/ui/layout";
import { PainelConfiguracoes } from "./painel";

export const metadata: Metadata = { title: "Configurações" };

export default async function PaginaConfiguracoes({ searchParams }: PageProps<"/configuracoes">) {
  const usuario = await exigirUsuario();
  const supabase = await clienteServidor();
  const { aba } = await searchParams;
  const [{ data: perfil }, { data: pref }, ia] = await Promise.all([
    supabase.from("profiles").select("nome, data_prova").eq("id", usuario.id).maybeSingle(),
    supabase.from("preferencias_usuario").select("fuso_horario, intervalos_revisao_dias, ia_habilitada, orcamento_ia_mensal_usd, limite_questoes_ia_dia, gamificacao, notificacoes").eq("user_id", usuario.id).maybeSingle(),
    estadoIA(usuario.id),
  ]);
  const notif = (pref?.notificacoes ?? {}) as Record<string, boolean>;
  return (
    <>
      <CabecalhoPagina titulo="Configurações" />
      <PainelConfiguracoes
        abaInicial={typeof aba === "string" ? aba : "perfil"}
        email={usuario.email ?? ""}
        perfil={{ nome: perfil?.nome ?? "", dataProva: perfil?.data_prova ?? "" }}
        preferencias={{
          fuso: pref?.fuso_horario ?? "America/Sao_Paulo",
          intervalos: ((pref?.intervalos_revisao_dias as number[] | null) ?? [1, 7, 15, 30]).join(", "),
          iaHabilitada: pref?.ia_habilitada ?? true,
          orcamentoIa: String(pref?.orcamento_ia_mensal_usd ?? 0),
          limiteQuestoesIa: String(pref?.limite_questoes_ia_dia ?? 50),
          gamificacao: pref?.gamificacao ?? true,
          notificacoes: { atividades: notif.atividades ?? true, simulados: notif.simulados ?? true, revisoes: notif.revisoes ?? true, metas: notif.metas ?? true, processamento: notif.processamento ?? true },
        }}
        ia={{ configurada: ia.configurada, provedor: ia.provedor, modelo: ia.modelo, gastoMesUsuarioUsd: ia.gastoMesUsuarioUsd, gastoMesUsd: ia.gastoMesUsd, orcamentoMensalUsd: ia.orcamentoMensalUsd, bloqueada: ia.bloqueadaPorOrcamento }}
      />
    </>
  );
}
