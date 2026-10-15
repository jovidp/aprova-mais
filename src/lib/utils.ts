import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...entradas: ClassValue[]) {
  return twMerge(clsx(entradas));
}

const formatadorNumero = new Intl.NumberFormat("pt-BR");
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 0 });

export function formatarNumero(valor: number | null | undefined) {
  return valor === null || valor === undefined ? "—" : formatadorNumero.format(valor);
}

export function formatarPercentual(valor: number | null | undefined) {
  return valor === null || valor === undefined || Number.isNaN(valor) ? "—" : `${formatadorPercentual.format(valor)}%`;
}

/** Percentual com denominador explícito; nulo quando não há base. */
export function percentual(parte: number, total: number): number | null {
  return total > 0 ? (100 * parte) / total : null;
}

export function formatarDuracao(segundos: number | null | undefined) {
  if (segundos === null || segundos === undefined) return "—";
  const s = Math.max(0, Math.round(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`;
  if (m > 0) return `${m}min ${String(r).padStart(2, "0")}s`;
  return `${r}s`;
}

export function formatarCronometro(segundos: number) {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(r).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatarData(data: string | Date | null | undefined, opcoes: Intl.DateTimeFormatOptions = { dateStyle: "short" }) {
  if (!data) return "—";
  const d = typeof data === "string" ? new Date(data.length === 10 ? `${data}T12:00:00` : data) : data;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...opcoes }).format(d);
}

export function formatarDataHora(data: string | Date | null | undefined) {
  return formatarData(data, { dateStyle: "short", timeStyle: "short" });
}

export function formatarBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export const ROTULO_DIFICULDADE: Record<string, string> = { facil: "Fácil", medio: "Médio", dificil: "Difícil" };
export const ROTULO_TIPO_QUESTAO: Record<string, string> = { multipla_escolha: "Múltipla escolha", certo_errado: "Certo ou errado" };
export const ROTULO_ORIGEM_QUESTAO: Record<string, string> = {
  ia: "Autoral (IA)",
  manual: "Autoral (manual)",
  importada_licenciada: "Base licenciada",
};
