/**
 * Peças puras do painel de relatórios: a janela de cada atalho de período, a
 * duração legível e o CSV exportado.
 */

export const CHAVES_DE_PERIODO = ["hoje", "ontem", "7d", "30d", "mes", "mes-passado", "personalizado"] as const;
export type ChaveDePeriodo = (typeof CHAVES_DE_PERIODO)[number];

const DIA_MS = 86_400_000;

function inicioDoDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * A janela `[from, to)` do atalho, no relógio de quem está olhando. `null` no
 * personalizado sem as duas datas, ou com o fim antes do início. O dia final do
 * personalizado é INCLUSIVO para quem escolhe (01 a 31 = o mês inteiro).
 */
export function janelaDoPeriodo(
  chave: ChaveDePeriodo,
  agora: Date,
  inicio = "",
  fim = "",
): { from: string; to: string } | null {
  const hoje = inicioDoDia(agora);
  const amanha = new Date(hoje.getTime() + DIA_MS);
  let de: Date;
  let ate: Date;
  switch (chave) {
    case "hoje":
      de = hoje;
      ate = amanha;
      break;
    case "ontem":
      de = new Date(hoje.getTime() - DIA_MS);
      ate = hoje;
      break;
    case "7d":
      de = new Date(amanha.getTime() - 7 * DIA_MS);
      ate = amanha;
      break;
    case "30d":
      de = new Date(amanha.getTime() - 30 * DIA_MS);
      ate = amanha;
      break;
    case "mes":
      de = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      ate = amanha;
      break;
    case "mes-passado":
      de = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      ate = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      break;
    case "personalizado": {
      const [ai, mi, di] = inicio.split("-").map(Number);
      const [af, mf, df] = fim.split("-").map(Number);
      if (!ai || !mi || !di || !af || !mf || !df) return null;
      de = new Date(ai, mi - 1, di);
      ate = new Date(af, mf - 1, df + 1);
      if (ate.getTime() <= de.getTime()) return null;
      break;
    }
  }
  return { from: de.toISOString(), to: ate.toISOString() };
}

/** Segundos → "45 s", "4 min 20 s", "1 h 05 min", "2 d 3 h". `null` → "—". */
export function duracao(segundos: number | null | undefined): string {
  if (segundos === null || segundos === undefined || !Number.isFinite(segundos)) return "—";
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ${String(s % 60).padStart(2, "0")} s`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

function celula(v: unknown): string {
  const texto = v === null || v === undefined ? "" : String(v);
  // Fórmula em planilha começa com = + - @: neutraliza, como o export de contatos.
  const seguro = /^[=+\-@]/.test(texto) && !/^-?\d/.test(texto) ? `'${texto}` : texto;
  return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** Uma tabela em CSV com `;` (o separador que o Excel em português abre direto). */
export function linhasParaCsv(cabecalho: readonly string[], linhas: ReadonlyArray<readonly unknown[]>): string {
  return [cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n";
}

export function baixarCsv(nome: string, conteudo: string): void {
  const blob = new Blob(["﻿" + conteudo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
