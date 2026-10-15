/** Status exibido de um simulado a partir das tentativas (Não iniciado / Em andamento / Concluído / Interrompido). */
export type StatusSimulado = "nao_iniciado" | "em_andamento" | "concluido" | "interrompido";

export const ROTULO_STATUS_SIMULADO: Record<StatusSimulado, { rotulo: string; variante: "outline" | "info" | "success" | "warning" }> = {
  nao_iniciado: { rotulo: "Não iniciado", variante: "outline" },
  em_andamento: { rotulo: "Em andamento", variante: "info" },
  concluido: { rotulo: "Concluído", variante: "success" },
  interrompido: { rotulo: "Interrompido", variante: "warning" },
};

export function statusDoSimulado(tentativas: { status: string; numero: number }[]): StatusSimulado {
  if (tentativas.length === 0) return "nao_iniciado";
  if (tentativas.some((t) => t.status === "em_andamento" || t.status === "pausada")) return "em_andamento";
  const ultima = [...tentativas].sort((a, b) => b.numero - a.numero)[0];
  return ultima.status === "interrompida" ? "interrompido" : "concluido";
}
