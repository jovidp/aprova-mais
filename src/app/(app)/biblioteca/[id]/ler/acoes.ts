"use server";

import { z } from "zod";
import { exigirUsuario } from "@/lib/auth";
import { clienteServidor } from "@/lib/supabase/servidor";
import { executarAcao } from "@/lib/servidor/acao";
import { ErroApp } from "@/lib/erros";

const uuid = z.string().uuid();

export async function registrarLeitura(materialId: string, pagina: number, segundos: number) {
  return executarAcao("leitor.progresso", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.rpc("registrar_leitura", {
      p_material_id: uuid.parse(materialId),
      p_pagina: z.number().int().min(1).parse(pagina),
      p_segundos: Math.min(3600, Math.max(0, Math.round(segundos))),
    });
    if (error) throw error;
    return null;
  });
}

/** Sessão de estudo de leitura (tempo efetivamente registrado). */
export async function registrarSessaoLeitura(entrada: { materialId: string; inicio: string; fim: string }) {
  return executarAcao("leitor.sessao", async () => {
    const usuario = await exigirUsuario();
    const d = z.object({ materialId: uuid, inicio: z.string().datetime(), fim: z.string().datetime() }).parse(entrada);
    const inicio = new Date(d.inicio);
    const fim = new Date(Math.min(new Date(d.fim).getTime(), Date.now()));
    if (fim.getTime() - inicio.getTime() < 60_000) return null; // menos de 1 minuto não conta
    const supabase = await clienteServidor();
    const { data: material } = await supabase.from("materiais").select("disciplina_id").eq("id", d.materialId).maybeSingle();
    const { error } = await supabase.from("sessoes_estudo").insert({
      user_id: usuario.id, tipo: "leitura", origem: "leitor", material_id: d.materialId, disciplina_id: material?.disciplina_id ?? null,
      inicio: inicio.toISOString(), fim: new Date(Math.min(fim.getTime(), inicio.getTime() + 16 * 3600_000)).toISOString(),
    });
    if (error) throw error;
    return null;
  });
}

export async function buscarNoMaterial(materialId: string, termo: string) {
  return executarAcao("leitor.busca", async () => {
    const usuario = await exigirUsuario();
    const t = z.string().trim().min(2).max(120).parse(termo);
    const supabase = await clienteServidor();
    // Busca literal (sem acento/caixa) para achar exatamente o trecho no PDF.
    const { data, error } = await supabase
      .from("material_paginas")
      .select("numero, texto")
      .eq("material_id", uuid.parse(materialId))
      .eq("user_id", usuario.id)
      .ilike("texto", `%${t.replace(/[%_]/g, "")}%`)
      .order("numero")
      .limit(200);
    if (error) throw error;
    const alvo = t.toLowerCase();
    return (data ?? []).map((p) => {
      const pos = p.texto.toLowerCase().indexOf(alvo);
      const inicio = Math.max(0, pos - 60);
      return { pagina: p.numero as number, trecho: `${inicio > 0 ? "…" : ""}${p.texto.slice(inicio, pos + t.length + 80).replace(/\s+/g, " ")}…` };
    });
  });
}

const esquemaAnotacao = z.object({
  materialId: uuid,
  pagina: z.number().int().min(1),
  tipo: z.enum(["nota", "marcador", "destaque"]),
  texto: z.string().max(10000).optional().default(""),
  trecho: z.string().max(4000).optional().default(""),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function salvarAnotacao(entrada: z.input<typeof esquemaAnotacao>) {
  return executarAcao("leitor.anotacao", async () => {
    const usuario = await exigirUsuario();
    const d = esquemaAnotacao.parse(entrada);
    if (d.tipo === "nota" && !d.texto.trim()) throw new ErroApp("Escreva a anotação.");
    const supabase = await clienteServidor();
    const { data, error } = await supabase.from("anotacoes").insert({
      user_id: usuario.id, material_id: d.materialId, pagina: d.pagina, tipo: d.tipo,
      texto: d.texto || null, trecho: d.trecho || null, cor: d.cor ?? null,
    }).select("id, pagina, tipo, texto, trecho, cor, created_at").single();
    if (error) throw error;
    return data;
  });
}

export async function excluirAnotacao(id: string) {
  return executarAcao("leitor.anotacao.excluir", async () => {
    await exigirUsuario();
    const supabase = await clienteServidor();
    const { error } = await supabase.from("anotacoes").delete().eq("id", uuid.parse(id));
    if (error) throw error;
    return null;
  });
}
