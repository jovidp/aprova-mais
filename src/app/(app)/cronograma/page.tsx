import type { Metadata } from "next";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { CabecalhoPagina } from "@/components/ui/layout";
import { dataLocal, instanteLocal, somarDias } from "@/lib/estudo/tempo";
import { fusoDoUsuario, inicioDaSemana } from "@/lib/servidor/painel";
import { processarPendencias } from "@/lib/servidor/cronograma";
import { projetar } from "@/lib/estudo/projecao";
import { Agenda, type AtividadeAgenda } from "./agenda";
import { PainelCronograma } from "./painel";

export const metadata: Metadata = { title: "Meu Cronograma" };

export default async function PaginaCronograma({ searchParams }: PageProps<"/cronograma">) {
  const usuario = await exigirUsuario();
  const sp = await searchParams;
  const supabase = await clienteServidor();
  const fuso = await fusoDoUsuario(supabase, usuario.id);
  const hoje = dataLocal(new Date(), fuso);
  const semana = typeof sp.semana === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.semana) ? inicioDaSemana(sp.semana) : inicioDaSemana(hoje);

  // Manutenção: atividades vencidas viram pendências com proposta de novo horário.
  await processarPendencias(supabase, usuario.id);

  const inicioSemana = instanteLocal(semana, 0, fuso).toISOString();
  const fimSemana = instanteLocal(somarDias(semana, 7), 0, fuso).toISOString();
  const [{ data: atividades }, { data: disp }, { data: pref }, { data: bloqueios }, { data: propostas }, { data: perfil }, { data: secoes }, { data: progresso }, { data: metas }, { data: disciplinas }] = await Promise.all([
    supabase.from("atividades_planejadas").select("id, tipo, titulo, descricao, inicio, fim, status, prioridade, origem, material_id, pagina_inicio, pagina_fim, assunto_id, quantidade_questoes, disciplinas(nome)")
      .eq("user_id", usuario.id).gte("inicio", inicioSemana).lt("inicio", fimSemana).neq("status", "cancelada").order("inicio"),
    supabase.from("disponibilidade_semanal").select("dia_semana, inicio_min, fim_min").eq("user_id", usuario.id),
    supabase.from("preferencias_usuario").select("dias_descanso").eq("user_id", usuario.id).maybeSingle(),
    supabase.from("bloqueios_agenda").select("id, inicio, fim, motivo").eq("user_id", usuario.id).gte("fim", new Date().toISOString()).order("inicio"),
    supabase.from("replanejamentos").select("id, motivo, proposta_inicio, proposta_fim, atividades_planejadas(titulo, inicio)").eq("user_id", usuario.id).eq("status", "pendente").order("proposta_inicio"),
    supabase.from("profiles").select("data_prova, created_at").eq("id", usuario.id).single(),
    supabase.from("material_secoes").select("pagina_inicio, pagina_fim, material_id").eq("user_id", usuario.id).in("tipo", ["teoria", "resumo"]),
    supabase.from("progresso_leitura").select("material_id, paginas_lidas").eq("user_id", usuario.id),
    supabase.from("metas").select("tipo, periodo, alvo").eq("user_id", usuario.id).eq("ativa", true).eq("tipo", "questoes"),
    supabase.from("disciplinas").select("id, nome").order("nome"),
  ]);

  const janelas = (disp ?? []).map((j) => ({ diaSemana: j.dia_semana, inicioMin: j.inicio_min, fimMin: j.fim_min }));
  const diasDescanso = (pref?.dias_descanso as number[] | undefined) ?? [];
  const horasSemanais = janelas.filter((j) => !diasDescanso.includes(j.diaSemana)).reduce((s, j) => s + (j.fimMin - j.inicioMin), 0) / 60;

  // Páginas de teoria (total) e lidas dentro dessas seções.
  const lidas = new Map((progresso ?? []).map((p) => [p.material_id, new Set(p.paginas_lidas as number[])]));
  let paginasTotais = 0;
  let paginasLidas = 0;
  for (const s of secoes ?? []) {
    paginasTotais += s.pagina_fim - s.pagina_inicio + 1;
    const conjunto = lidas.get(s.material_id);
    if (conjunto) for (let p = s.pagina_inicio; p <= s.pagina_fim; p++) if (conjunto.has(p)) paginasLidas++;
  }
  const metaDiaria = (metas ?? []).find((m) => m.periodo === "diaria");
  const diasAteProva = perfil?.data_prova ? Math.max(0, Math.round((Date.parse(perfil.data_prova) - Date.parse(hoje)) / 86400000)) : 0;
  const projecao = projetar({
    hoje, dataInicio: (perfil?.created_at ?? new Date().toISOString()).slice(0, 10), dataProva: perfil?.data_prova ?? null,
    paginasTotais, paginasLidas, horasSemanais, paginasPorHora: 12, minutosPorQuestao: 3, reservaRevisao: 0.2,
    questoesAlvoRestantes: metaDiaria ? Number(metaDiaria.alvo) * diasAteProva : 0,
  });

  const lista: AtividadeAgenda[] = ((atividades ?? []) as unknown as (Omit<AtividadeAgenda, "disciplina"> & { disciplinas: { nome: string } | null })[])
    .map((a) => ({ ...a, disciplina: a.disciplinas?.nome ?? null }));

  return (
    <>
      <CabecalhoPagina titulo="Meu Cronograma" descricao="Planejamento adaptativo: distribui leitura, questões e revisões pela sua disponibilidade, peso e desempenho de cada disciplina." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Agenda semana={semana} hoje={hoje} fuso={fuso} atividades={lista} disciplinas={disciplinas ?? []} semDisponibilidade={janelas.length === 0} />
        <PainelCronograma
          janelas={janelas} diasDescanso={diasDescanso} horasSemanais={horasSemanais}
          bloqueios={bloqueios ?? []}
          propostas={((propostas ?? []) as unknown as { id: string; motivo: string; proposta_inicio: string; proposta_fim: string; atividades_planejadas: { titulo: string; inicio: string } }[])
            .map((p) => ({ id: p.id, motivo: p.motivo, inicio: p.proposta_inicio, fim: p.proposta_fim, titulo: p.atividades_planejadas.titulo, original: p.atividades_planejadas.inicio }))}
          projecao={projecao} dataProva={perfil?.data_prova ?? null}
        />
      </div>
    </>
  );
}
