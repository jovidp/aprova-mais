/**
 * Conversões entre horário local (fuso do usuário) e instantes UTC, sem
 * dependências externas. Necessário porque o servidor roda em UTC.
 */

const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatador(fuso: string) {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    });
    formatadores.set(fuso, f);
  }
  return f;
}

const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface PartesLocais {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  diaSemana: number;
}

export function partesLocais(instante: Date, fuso: string): PartesLocais {
  const partes = Object.fromEntries(formatador(fuso).formatToParts(instante).map((p) => [p.type, p.value]));
  return {
    ano: Number(partes.year), mes: Number(partes.month), dia: Number(partes.day),
    hora: Number(partes.hour), minuto: Number(partes.minute), diaSemana: DIAS[partes.weekday],
  };
}

/** Diferença (minutos) entre o horário local do fuso e UTC no instante dado. */
function deslocamentoMin(instante: number, fuso: string) {
  const p = partesLocais(new Date(instante), fuso);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto);
  return Math.round((comoUtc - Math.floor(instante / 60000) * 60000) / 60000);
}

/** Instante UTC correspondente a "data local + minutos desde 00:00" no fuso. */
export function instanteLocal(dataLocal: string, minutos: number, fuso: string): Date {
  const [a, m, d] = dataLocal.split("-").map(Number);
  const ingenuo = Date.UTC(a, m - 1, d, 0, minutos);
  let palpite = ingenuo;
  for (let i = 0; i < 3; i++) palpite = ingenuo - deslocamentoMin(palpite, fuso) * 60000;
  return new Date(palpite);
}

/** "AAAA-MM-DD" do instante no fuso. */
export function dataLocal(instante: Date, fuso: string): string {
  const p = partesLocais(instante, fuso);
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

export function diaSemanaDe(data: string): number {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

export function diferencaDias(de: string, ate: string): number {
  const [a1, m1, d1] = de.split("-").map(Number);
  const [a2, m2, d2] = ate.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
}

export function minutosParaHora(minutos: number) {
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

export function horaParaMinutos(hora: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h === 24 && mi === 0) return 1440;
  if (h > 23 || mi > 59) return NaN;
  return h * 60 + mi;
}

export const NOMES_DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const NOMES_DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
