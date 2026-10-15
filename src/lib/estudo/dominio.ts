/**
 * Índice de domínio por assunto.
 *
 * Evidência: respostas do aluno (prática e simulados), ponderadas pela
 * dificuldade (fácil 0,8 · médio 1,0 · difícil 1,25), mais as revisões feitas.
 *
 * 1. Taxa ponderada p = Σ(peso × acerto) / Σ(peso).
 * 2. Limite inferior de Wilson (95%) de p com n respostas: estimativa
 *    conservadora que pune amostras pequenas.
 * 3. Taxa recente (30 dias), usada quando há ao menos 5 respostas no período.
 * 4. Índice (0–100) = 100 × (0,7 × Wilson + 0,3 × recente), ou 100 × Wilson
 *    sem dados recentes, mais até 5 pontos por revisões bem avaliadas.
 *
 * Classificação (regra 13: nada de "domínio" com pouca evidência):
 * - Não iniciado: n = 0.
 * - Em aprendizado: n < 10 (evidência insuficiente), qualquer que seja a taxa.
 * - Necessita reforço: p < 0,6 ou taxa recente < 0,5.
 * - Domínio consistente: n ≥ 30, Wilson ≥ 0,75 e recente (se houver) ≥ 0,75.
 * - Bom desempenho: Wilson ≥ 0,6.
 * - Caso contrário: em aprendizado.
 */

export type NivelDominio = "nao_iniciado" | "em_aprendizado" | "necessita_reforco" | "bom_desempenho" | "dominio_consistente";

export interface EvidenciaAssunto {
  respondidas: number;
  acertos: number;
  respondidasFacil: number;
  acertosFacil: number;
  respondidasMedio: number;
  acertosMedio: number;
  respondidasDificil: number;
  acertosDificil: number;
  respondidas30d: number;
  acertos30d: number;
  revisoesRegistradas: number;
  revisoesBoas: number;
}

export interface ResultadoDominio {
  nivel: NivelDominio;
  indice: number;
  taxa: number | null;
  taxaPonderada: number | null;
  limiteInferior: number | null;
  taxaRecente: number | null;
  evidenciaSuficiente: boolean;
}

export const MIN_EVIDENCIA = 10;
export const MIN_DOMINIO = 30;

const PESOS = { facil: 0.8, medio: 1, dificil: 1.25 };

export function wilsonInferior(acertos: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = acertos / n;
  const z2 = z * z;
  const centro = p + z2 / (2 * n);
  const margem = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centro - margem) / (1 + z2 / n));
}

export function calcularDominio(e: EvidenciaAssunto): ResultadoDominio {
  const n = e.respondidas;
  if (n === 0) {
    return { nivel: "nao_iniciado", indice: 0, taxa: null, taxaPonderada: null, limiteInferior: null, taxaRecente: null, evidenciaSuficiente: false };
  }
  const taxa = e.acertos / n;

  // Respostas sem dificuldade registrada contam como "médio".
  const semDificuldade = Math.max(0, n - e.respondidasFacil - e.respondidasMedio - e.respondidasDificil);
  const acertosSemDificuldade = Math.max(0, e.acertos - e.acertosFacil - e.acertosMedio - e.acertosDificil);
  const somaPesos = e.respondidasFacil * PESOS.facil + (e.respondidasMedio + semDificuldade) * PESOS.medio + e.respondidasDificil * PESOS.dificil;
  const somaAcertos = e.acertosFacil * PESOS.facil + (e.acertosMedio + acertosSemDificuldade) * PESOS.medio + e.acertosDificil * PESOS.dificil;
  const taxaPonderada = somaPesos > 0 ? somaAcertos / somaPesos : taxa;

  const limiteInferior = wilsonInferior(taxaPonderada * n, n);
  const taxaRecente = e.respondidas30d >= 5 ? e.acertos30d / e.respondidas30d : null;
  const bonusRevisao = Math.min(5, e.revisoesBoas);
  const indice = Math.round(Math.min(100, 100 * (taxaRecente === null ? limiteInferior : 0.7 * limiteInferior + 0.3 * taxaRecente) + bonusRevisao));
  const evidenciaSuficiente = n >= MIN_EVIDENCIA;

  let nivel: NivelDominio;
  if (!evidenciaSuficiente) nivel = "em_aprendizado";
  else if (taxaPonderada < 0.6 || (taxaRecente !== null && taxaRecente < 0.5)) nivel = "necessita_reforco";
  else if (n >= MIN_DOMINIO && limiteInferior >= 0.75 && (taxaRecente === null || taxaRecente >= 0.75)) nivel = "dominio_consistente";
  else if (limiteInferior >= 0.6) nivel = "bom_desempenho";
  else nivel = "em_aprendizado";

  return { nivel, indice, taxa, taxaPonderada, limiteInferior, taxaRecente, evidenciaSuficiente };
}

export const ROTULO_NIVEL: Record<NivelDominio, string> = {
  nao_iniciado: "Não iniciado",
  em_aprendizado: "Em aprendizado",
  necessita_reforco: "Necessita reforço",
  bom_desempenho: "Bom desempenho",
  dominio_consistente: "Domínio consistente",
};

export const COR_NIVEL: Record<NivelDominio, "outline" | "info" | "destructive" | "success" | "default"> = {
  nao_iniciado: "outline",
  em_aprendizado: "info",
  necessita_reforco: "destructive",
  bom_desempenho: "success",
  dominio_consistente: "default",
};

/** Converte a linha de dados_dominio() (snake_case, contagens em texto) para a evidência. */
export function evidenciaDeLinha(l: Record<string, unknown>): EvidenciaAssunto {
  const n = (k: string) => Number(l[k] ?? 0);
  return {
    respondidas: n("respondidas"), acertos: n("acertos"),
    respondidasFacil: n("respondidas_facil"), acertosFacil: n("acertos_facil"),
    respondidasMedio: n("respondidas_medio"), acertosMedio: n("acertos_medio"),
    respondidasDificil: n("respondidas_dificil"), acertosDificil: n("acertos_dificil"),
    respondidas30d: n("respondidas_30d"), acertos30d: n("acertos_30d"),
    revisoesRegistradas: n("revisoes_registradas"), revisoesBoas: n("revisoes_boas"),
  };
}
