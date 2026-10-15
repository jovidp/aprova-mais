import type { Metadata } from "next";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { estadoIA } from "@/lib/ia";
import { CabecalhoPagina } from "@/components/ui/layout";
import { carregarOpcoesFiltro } from "@/lib/servidor/opcoes-filtro";
import { ConfiguradorSimulado } from "./configurador";

export const metadata: Metadata = { title: "Gerar simulado" };

export default async function PaginaGerarSimulado({ searchParams }: PageProps<"/simulados/gerar">) {
  const usuario = await exigirUsuario();
  const sp = await searchParams;
  const supabase = await clienteServidor();
  const [opcoes, ia, { data: regras }, { data: editais }, { count: questoes }] = await Promise.all([
    carregarOpcoesFiltro(supabase, usuario.id),
    estadoIA(usuario.id),
    supabase.from("simulados_regras_pontuacao").select("id, nome, descricao, pontos_acerto, pontos_erro, pontos_branco, nota_nao_negativa").order("nome"),
    supabase.from("editais").select("id, titulo, concurso_id").eq("owner_id", usuario.id).order("created_at", { ascending: false }),
    supabase.from("questoes").select("id", { count: "exact", head: true }).eq("status", "aprovada"),
  ]);
  return (
    <>
      <CabecalhoPagina
        titulo="Gerar simulado"
        descricao="Escolha o tipo e os parâmetros. A plataforma seleciona questões do seu banco e, se faltar conteúdo e você permitir, gera questões originais a partir dos seus materiais."
      />
      <ConfiguradorSimulado
        opcoes={opcoes}
        ia={ia}
        regras={(regras ?? []).map((r) => ({ ...r, pontos_acerto: Number(r.pontos_acerto), pontos_erro: Number(r.pontos_erro), pontos_branco: Number(r.pontos_branco) }))}
        editais={editais ?? []}
        questoesDisponiveis={questoes ?? 0}
        tipoInicial={typeof sp.tipo === "string" ? sp.tipo : undefined}
        disciplinaInicial={typeof sp.disciplina === "string" ? sp.disciplina : undefined}
      />
    </>
  );
}
