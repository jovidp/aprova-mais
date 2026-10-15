import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slugificar } from "@/lib/materiais/normalizacao";
import { normalizarNomeDisciplina } from "@/lib/materiais/disciplinas";
import { similaridadeTitulos } from "@/lib/materiais/taxonomia";

/**
 * Localiza (por slug, entre globais e próprias) ou cria a disciplina do usuário.
 * Variações de grafia são unificadas pelo catálogo de nomes canônicos.
 */
export async function garantirDisciplina(supabase: SupabaseClient, userId: string, nomeBruto: string): Promise<string> {
  const nome = normalizarNomeDisciplina(nomeBruto).slice(0, 160);
  const slug = slugificar(nome) || "disciplina";
  const { data: existentes, error } = await supabase
    .from("disciplinas")
    .select("id, owner_id")
    .eq("slug", slug)
    .or(`owner_id.is.null,owner_id.eq.${userId}`);
  if (error) throw error;
  const propria = existentes?.find((d) => d.owner_id === userId) ?? existentes?.[0];
  if (propria) return propria.id;
  const { data, error: erroInsercao } = await supabase
    .from("disciplinas")
    .insert({ owner_id: userId, nome, slug })
    .select("id")
    .single();
  if (erroInsercao) {
    // Corrida com outra requisição: busca de novo.
    if (erroInsercao.code === "23505") return garantirDisciplina(supabase, userId, nome);
    throw erroInsercao;
  }
  return data.id;
}

export interface CacheAssuntos {
  porDisciplina: Map<string, { id: string; nome: string }[]>;
  subPorAssunto: Map<string, { id: string; nome: string }[]>;
}

export function novoCacheAssuntos(): CacheAssuntos {
  return { porDisciplina: new Map(), subPorAssunto: new Map() };
}

/**
 * Localiza ou cria o assunto. Reaproveita assunto existente com nome muito
 * parecido (ex.: "Direitos e Deveres Ind. e Coletivos" ≈ "...Individuais e Coletivos").
 */
export async function garantirAssunto(
  supabase: SupabaseClient, userId: string, disciplinaId: string, nome: string, cache: CacheAssuntos, ordem = 0,
): Promise<string> {
  let lista = cache.porDisciplina.get(disciplinaId);
  if (!lista) {
    const { data, error } = await supabase
      .from("assuntos").select("id, nome").eq("disciplina_id", disciplinaId)
      .or(`owner_id.is.null,owner_id.eq.${userId}`);
    if (error) throw error;
    lista = data ?? [];
    cache.porDisciplina.set(disciplinaId, lista);
  }
  const igual = lista.find((a) => slugificar(a.nome) === slugificar(nome)) ?? lista.find((a) => similaridadeTitulos(a.nome, nome) >= 0.85);
  if (igual) return igual.id;

  const slug = slugificar(nome) || "assunto";
  const { data, error } = await supabase
    .from("assuntos")
    .upsert({ owner_id: userId, disciplina_id: disciplinaId, nome: nome.slice(0, 200), slug, ordem }, { onConflict: "owner_id,disciplina_id,slug" })
    .select("id, nome")
    .single();
  if (error) throw error;
  lista.push(data);
  return data.id;
}

export async function garantirSubassunto(
  supabase: SupabaseClient, userId: string, assuntoId: string, nome: string, cache: CacheAssuntos, ordem = 0,
): Promise<string> {
  let lista = cache.subPorAssunto.get(assuntoId);
  if (!lista) {
    const { data, error } = await supabase
      .from("subassuntos").select("id, nome").eq("assunto_id", assuntoId)
      .or(`owner_id.is.null,owner_id.eq.${userId}`);
    if (error) throw error;
    lista = data ?? [];
    cache.subPorAssunto.set(assuntoId, lista);
  }
  const igual = lista.find((s) => slugificar(s.nome) === slugificar(nome)) ?? lista.find((s) => similaridadeTitulos(s.nome, nome) >= 0.9);
  if (igual) return igual.id;
  const slug = slugificar(nome) || "subassunto";
  const { data, error } = await supabase
    .from("subassuntos")
    .upsert({ owner_id: userId, assunto_id: assuntoId, nome: nome.slice(0, 240), slug, ordem }, { onConflict: "owner_id,assunto_id,slug" })
    .select("id, nome")
    .single();
  if (error) throw error;
  lista.push(data);
  return data.id;
}

/** Garante a disciplina na lista de estudo do usuário (usuario_disciplinas). */
export async function vincularDisciplinaAoUsuario(supabase: SupabaseClient, userId: string, disciplinaId: string) {
  const { error } = await supabase
    .from("usuario_disciplinas")
    .upsert({ user_id: userId, disciplina_id: disciplinaId }, { onConflict: "user_id,disciplina_id", ignoreDuplicates: true });
  if (error) throw error;
}
