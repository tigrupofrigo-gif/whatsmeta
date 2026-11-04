/**
 * Fatia um CSV grande em LOTES que a rota de importação aceita (WhatsMeta:
 * importação sem limite de linhas).
 *
 * A rota `/api/v1/contacts/import` continua recebendo no máximo
 * `CSV_MAX_DATA_ROWS` linhas por requisição — é o que segura a memória e o
 * tempo de uma requisição só. Quem tira o teto da EXPERIÊNCIA é o navegador:
 * corta o arquivo em lotes, repete o cabeçalho em cada um e envia um por vez.
 *
 * Puro e sem dependência de servidor (o `lib/contacts/csv.ts` puxa `node:crypto`
 * por tabela e não roda no navegador). Não re-serializa campo nenhum: corta o
 * TEXTO nos limites de registro, então delimitador, aspas e quebras de linha
 * dentro de aspas chegam à rota exatamente como estavam no arquivo.
 *
 * As regras de registro são as MESMAS do `parseCsv` da rota — aspas só abrem no
 * começo do campo, `""` é aspa escapada, CRLF/CR/LF fecham o registro, linha em
 * branco não conta. É isso que faz a numeração bater: a rota numera o erro como
 * (posição do registro não vazio no lote) + 2, e somar `índice do lote ×
 * tamanho do lote` devolve a mesma linha que a rota daria ao arquivo inteiro.
 */

const DELIMITADORES = [",", ";", "\t"] as const;

function detectarDelimitador(texto: string): string {
  const primeira = texto.split(/\r\n|\r|\n/, 1)[0] ?? "";
  let melhor: string = DELIMITADORES[0];
  let maior = -1;
  for (const d of DELIMITADORES) {
    let n = 0;
    let emAspas = false;
    for (const ch of primeira) {
      if (ch === '"') emAspas = !emAspas;
      else if (ch === d && !emAspas) n += 1;
    }
    if (n > maior) {
      maior = n;
      melhor = d;
    }
  }
  return melhor;
}

/** Os registros do texto, cada um com o texto ORIGINAL (sem a quebra final). Linhas vazias saem. */
export function registrosDoCsv(bruto: string): string[] {
  const texto = bruto.replace(/^﻿/, "");
  const delimitador = detectarDelimitador(texto);
  const registros: string[] = [];
  let inicio = 0;
  let emAspas = false;
  let inicioDoCampo = true;
  let i = 0;
  const fechar = (fim: number) => {
    const reg = texto.slice(inicio, fim);
    if (reg !== "") registros.push(reg);
  };
  while (i < texto.length) {
    const ch = texto[i]!;
    if (emAspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          i += 2;
          continue;
        }
        emAspas = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"' && inicioDoCampo) {
      emAspas = true;
      inicioDoCampo = false;
      i += 1;
      continue;
    }
    if (ch === delimitador) {
      inicioDoCampo = true;
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      fechar(i);
      if (ch === "\r" && texto[i + 1] === "\n") i += 1;
      i += 1;
      inicio = i;
      inicioDoCampo = true;
      continue;
    }
    inicioDoCampo = false;
    i += 1;
  }
  fechar(texto.length);
  return registros;
}

export interface LotesDoCsv {
  /** Registros de dados (sem o cabeçalho) no arquivo inteiro. */
  totalDeLinhas: number;
  /** Cada lote é um CSV completo: cabeçalho + até `porLote` registros. */
  lotes: string[];
}

/** `null` quando não há cabeçalho e ao menos uma linha de dados. */
export function fatiarCsv(bruto: string, porLote: number): LotesDoCsv | null {
  if (!Number.isInteger(porLote) || porLote < 1) throw new Error("porLote inválido");
  const registros = registrosDoCsv(bruto);
  if (registros.length < 2) return null;
  const [cabecalho, ...dados] = registros;
  const lotes: string[] = [];
  for (let i = 0; i < dados.length; i += porLote) {
    lotes.push([cabecalho!, ...dados.slice(i, i + porLote)].join("\r\n") + "\r\n");
  }
  return { totalDeLinhas: dados.length, lotes };
}

/**
 * Bytes do arquivo → texto. UTF-8 primeiro; se não for UTF-8 válido, é o
 * Windows-1252 do Excel brasileiro (o mesmo par que a rota aceita).
 */
export function textoDoArquivo(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
