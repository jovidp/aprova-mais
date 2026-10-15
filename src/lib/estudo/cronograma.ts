/**
 * Gerador de cronograma e replanejamento (funções puras).
 *
 * 1. Monta os blocos livres a partir da disponibilidade semanal, descontando
 *    dias de descanso, bloqueios, atividades já marcadas e horários passados.
 * 2. Reserva um bloco por dia para revisões vencidas, quando houver.
 * 3. Distribui os demais blocos entre disciplinas por peso (round-robin
 *    ponderado suave), que intercala as disciplinas em vez de agrupá-las.
 * 4. Dentro de cada disciplina alterna leitura do próximo trecho não lido e
 *    questões do que já foi lido, conforme a proporção configurada.
 */
import { dataLocal, diaSemanaDe, diferencaDias, instanteLocal, somarDias } from "./tempo";

export interface JanelaDisponibilidade {
  diaSemana: number;
  inicioMin: number;
  fimMin: number;
}

export interface Intervalo {
  inicio: Date;
  fim: Date;
}

export interface DisciplinaPlano {
  id: string;
  nome: string;
  /** Peso do edital/usuário (> 0). */
  peso: number;
  /** 1 (muito fácil) a 5 (muito difícil). */
  dificuldade: number;
  prioridade: number;
  /** Taxa de acerto observada (0–1) ou nulo sem evidência suficiente. */
  taxaAcerto: number | null;
}

export interface TrechoConteudo {
  disciplinaId: string;
  materialId: string;
  assuntoId: string | null;
  titulo: string;
  paginaInicio: number;
  paginaFim: number;
}

export interface RevisaoPendente {
  id: string;
  titulo: string;
  disciplinaId: string | null;
  assuntoId: string | null;
}

export interface ParametrosCronograma {
  duracaoBlocoMin: number;
  pausaMin: number;
  /** Fração dos blocos de cada disciplina dedicada à leitura (o resto vira questões). */
  proporcaoLeitura: number;
  paginasPorHora: number;
  minutosPorQuestao: number;
}

export const PARAMETROS_PADRAO: ParametrosCronograma = {
  duracaoBlocoMin: 50,
  pausaMin: 10,
  proporcaoLeitura: 0.5,
  paginasPorHora: 12,
  minutosPorQuestao: 3,
};

export type TipoAtividade = "leitura" | "questoes" | "revisao" | "flashcards" | "simulado" | "correcao_erros" | "outro";

export interface AtividadeGerada {
  tipo: TipoAtividade;
  titulo: string;
  descricao?: string;
  disciplinaId: string | null;
  assuntoId: string | null;
  materialId: string | null;
  paginaInicio: number | null;
  paginaFim: number | null;
  quantidadeQuestoes: number | null;
  inicio: Date;
  fim: Date;
  prioridade: number;
}

export interface EntradaCronograma {
  dataInicio: string;
  dias: number;
  fuso: string;
  agora: Date;
  janelas: JanelaDisponibilidade[];
  diasDescanso: number[];
  bloqueios: Intervalo[];
  ocupados: Intervalo[];
  disciplinas: DisciplinaPlano[];
  conteudo: TrechoConteudo[];
  revisoes: RevisaoPendente[];
  dataProva?: string | null;
  parametros?: Partial<ParametrosCronograma>;
}

export function sobrepoe(a: Intervalo, b: Intervalo) {
  return a.inicio < b.fim && b.inicio < a.fim;
}

/** Blocos de estudo possíveis, já descontados indisponibilidades e conflitos. */
export function montarBlocos(entrada: EntradaCronograma, p: ParametrosCronograma): Intervalo[] {
  const blocos: Intervalo[] = [];
  const impedimentos = [...entrada.bloqueios, ...entrada.ocupados];
  let ultimoDia = entrada.dias;
  if (entrada.dataProva) ultimoDia = Math.min(ultimoDia, diferencaDias(entrada.dataInicio, entrada.dataProva));

  for (let d = 0; d < ultimoDia; d++) {
    const data = somarDias(entrada.dataInicio, d);
    const diaSemana = diaSemanaDe(data);
    if (entrada.diasDescanso.includes(diaSemana)) continue;
    const janelas = entrada.janelas.filter((j) => j.diaSemana === diaSemana).sort((a, b) => a.inicioMin - b.inicioMin);
    for (const janela of janelas) {
      let cursor = janela.inicioMin;
      while (cursor + Math.min(p.duracaoBlocoMin, 25) <= janela.fimMin) {
        const fimMin = Math.min(cursor + p.duracaoBlocoMin, janela.fimMin);
        const bloco = { inicio: instanteLocal(data, cursor, entrada.fuso), fim: instanteLocal(data, fimMin, entrada.fuso) };
        if (bloco.inicio > entrada.agora && !impedimentos.some((i) => sobrepoe(i, bloco))) blocos.push(bloco);
        cursor = fimMin + p.pausaMin;
      }
    }
  }
  return blocos;
}

/** Peso efetivo: mais tempo para disciplinas difíceis, prioritárias e com desempenho baixo. */
export function pesoEfetivo(d: DisciplinaPlano) {
  const fatorDificuldade = 1 + (Math.min(5, Math.max(1, d.dificuldade)) - 3) * 0.15;
  const fatorPrioridade = 1 + (Math.min(5, Math.max(1, d.prioridade)) - 3) * 0.15;
  const fatorDesempenho = d.taxaAcerto === null ? 1 : Math.min(1.6, Math.max(0.6, 1 + (0.7 - d.taxaAcerto) * 0.8));
  return Math.max(0.01, d.peso) * fatorDificuldade * fatorPrioridade * fatorDesempenho;
}

/** Round-robin ponderado suave (nginx): proporcional e intercalado. */
export function distribuirPorPeso<T extends { id: string }>(itens: T[], pesos: number[], quantidade: number): T[] {
  if (itens.length === 0) return [];
  const atual = itens.map(() => 0);
  const total = pesos.reduce((s, p) => s + p, 0);
  const saida: T[] = [];
  for (let n = 0; n < quantidade; n++) {
    let melhor = 0;
    for (let i = 0; i < itens.length; i++) {
      atual[i] += pesos[i];
      if (atual[i] > atual[melhor]) melhor = i;
    }
    atual[melhor] -= total;
    saida.push(itens[melhor]);
  }
  return saida;
}

export function gerarCronograma(entrada: EntradaCronograma): AtividadeGerada[] {
  const p = { ...PARAMETROS_PADRAO, ...(entrada.parametros ?? {}) };
  const blocos = montarBlocos(entrada, p);
  const atividades: AtividadeGerada[] = [];
  const livres: Intervalo[] = [];

  // Revisões: um bloco por dia enquanto houver pendências (até 2 por bloco de 50 min por assunto).
  const revisoes = [...entrada.revisoes];
  const diasComRevisao = new Set<string>();
  for (const bloco of blocos) {
    const dia = dataLocal(bloco.inicio, entrada.fuso);
    if (revisoes.length > 0 && !diasComRevisao.has(dia)) {
      diasComRevisao.add(dia);
      const lote = revisoes.splice(0, Math.max(1, Math.floor((bloco.fim.getTime() - bloco.inicio.getTime()) / 60000 / 10)));
      atividades.push({
        tipo: "revisao",
        titulo: lote.length === 1 ? `Revisão: ${lote[0].titulo}` : `Revisões do dia (${lote.length})`,
        descricao: lote.map((r) => r.titulo).join(" · "),
        disciplinaId: lote.length === 1 ? lote[0].disciplinaId : null,
        assuntoId: lote.length === 1 ? lote[0].assuntoId : null,
        materialId: null, paginaInicio: null, paginaFim: null, quantidadeQuestoes: null,
        inicio: bloco.inicio, fim: bloco.fim, prioridade: 4,
      });
    } else {
      livres.push(bloco);
    }
  }

  const disciplinas = entrada.disciplinas.filter((d) => d.peso > 0);
  if (disciplinas.length === 0) return atividades;
  const ordem = distribuirPorPeso(disciplinas, disciplinas.map(pesoEfetivo), livres.length);

  const filas = new Map<string, TrechoConteudo[]>();
  for (const t of entrada.conteudo) filas.set(t.disciplinaId, [...(filas.get(t.disciplinaId) ?? []), t]);
  const lidos = new Map<string, TrechoConteudo[]>();
  const contador = new Map<string, number>();

  livres.forEach((bloco, i) => {
    const disciplina = ordem[i];
    const n = contador.get(disciplina.id) ?? 0;
    contador.set(disciplina.id, n + 1);
    const minutos = Math.round((bloco.fim.getTime() - bloco.inicio.getTime()) / 60000);
    const fila = filas.get(disciplina.id) ?? [];
    const jaLido = lidos.get(disciplina.id) ?? [];
    // Alterna leitura/questões; sem conteúdo novo, só questões; sem nada lido ainda, leitura primeiro.
    const querLeitura = fila.length > 0 && (jaLido.length === 0 || (n % Math.round(1 / Math.max(0.1, 1 - p.proporcaoLeitura))) !== 1);
    const base = { disciplinaId: disciplina.id, inicio: bloco.inicio, fim: bloco.fim, prioridade: Math.min(5, Math.max(1, disciplina.prioridade)) };

    if (querLeitura) {
      const trecho = fila[0];
      const capacidade = Math.max(1, Math.round((p.paginasPorHora * minutos) / 60));
      const fim = Math.min(trecho.paginaFim, trecho.paginaInicio + capacidade - 1);
      atividades.push({
        ...base, tipo: "leitura",
        titulo: `Leitura: ${trecho.titulo} (p. ${trecho.paginaInicio}–${fim})`,
        assuntoId: trecho.assuntoId, materialId: trecho.materialId,
        paginaInicio: trecho.paginaInicio, paginaFim: fim, quantidadeQuestoes: null,
      });
      if (fim >= trecho.paginaFim) fila.shift();
      else fila[0] = { ...trecho, paginaInicio: fim + 1 };
      lidos.set(disciplina.id, [...jaLido, trecho]);
    } else {
      const assunto = jaLido[jaLido.length - 1];
      const quantidade = Math.max(5, Math.floor(minutos / p.minutosPorQuestao));
      atividades.push({
        ...base, tipo: "questoes",
        titulo: assunto ? `Questões: ${assunto.titulo}` : `Questões de ${disciplina.nome}`,
        assuntoId: assunto?.assuntoId ?? null, materialId: null,
        paginaInicio: null, paginaFim: null, quantidadeQuestoes: quantidade,
      });
    }
  });

  return atividades.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}

/**
 * Replanejamento: propõe o primeiro bloco livre (a partir de agora) que comporte a
 * duração da atividade pendente, respeitando disponibilidade, descanso e conflitos.
 * Não altera nada; o usuário aceita, rejeita ou modifica a proposta.
 */
export function proporRealocacao(
  pendente: { inicio: Date; fim: Date },
  entrada: Omit<EntradaCronograma, "disciplinas" | "conteudo" | "revisoes">,
): Intervalo | null {
  const duracao = pendente.fim.getTime() - pendente.inicio.getTime();
  const duracaoMin = Math.round(duracao / 60000);
  const blocos = montarBlocos(
    { ...entrada, disciplinas: [], conteudo: [], revisoes: [] },
    { ...PARAMETROS_PADRAO, duracaoBlocoMin: duracaoMin, pausaMin: 0 },
  );
  const candidato = blocos.find((b) => b.fim.getTime() - b.inicio.getTime() >= duracao);
  return candidato ? { inicio: candidato.inicio, fim: new Date(candidato.inicio.getTime() + duracao) } : null;
}
