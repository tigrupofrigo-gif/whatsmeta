/**
 * useImportContacts — POST multipart do CSV para /api/v1/contacts/import.
 *
 * SEM LIMITE DE LINHAS (WhatsMeta): a rota aceita até `CSV_MAX_DATA_ROWS` por
 * requisição; arquivo maior é fatiado aqui no navegador (`lib/contacts/fatiar-csv`)
 * e enviado lote a lote, com o cabeçalho repetido. Os resumos se somam e a linha
 * de cada erro é traduzida para a linha da planilha original.
 *
 * Usa fetch cru (não o apiClient) porque o client serializa body como JSON e
 * não fala FormData — mesmo padrão de hooks/ai/useSkills.ts. Erro é sempre
 * ApiError para o diálogo mostrar `message` direto no toast.
 */
import { ApiError } from "@/lib/api/types";
import type { ApiErrorBody } from "@/lib/api/types";
import { randomId } from "@/lib/random-id";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { fatiarCsv, textoDoArquivo } from "@/lib/contacts/fatiar-csv";

/** O teto da rota por requisição (`CSV_MAX_DATA_ROWS`, lib/contacts/csv.ts). */
export const LINHAS_POR_LOTE = 500;
/** O teto de bytes da rota (`CSV_MAX_BYTES`); abaixo dele e do teto de linhas, o arquivo vai inteiro. */
const BYTES_POR_REQUISICAO = 5 * 1024 * 1024;
const TENTATIVAS_POR_LOTE = 3;

export interface ProgressoDaImportacao {
  lote: number;
  totalDeLotes: number;
  linhasEnviadas: number;
  totalDeLinhas: number;
}

export interface ImportContactsResult {
  total_linhas: number;
  imported: number;
  skipped_duplicates: number;
  errors: Array<{ linha: number; motivo: string }>;
}

async function enviarArquivo(file: File | Blob, nome: string, chave: string): Promise<ImportContactsResult> {
  const form = new FormData();
  form.append("file", file, nome);
  const res = await fetch("/api/v1/contacts/import", {
    method: "POST",
    headers: { "Idempotency-Key": chave },
    body: form,
    credentials: "same-origin",
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const errBody = parsed as ApiErrorBody | null;
    const e = errBody?.error;
    throw new ApiError(
      res.status,
      e?.code ?? "unknown_error",
      e?.details,
      e?.request_id ?? randomId(),
      e?.message,
    );
  }
  return (parsed as { data: ImportContactsResult }).data;
}

const esperar = (ms: number) => new Promise<void>((pronto) => setTimeout(pronto, ms));

/** Falha que vale tentar de novo: rede, limite de requisições, servidor fora. */
function transitoria(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  return e.status === 429 || e.status >= 500;
}

export async function importarCsv(
  file: File,
  aoProgredir?: (p: ProgressoDaImportacao) => void,
): Promise<ImportContactsResult> {
  const texto = textoDoArquivo(await file.arrayBuffer());
  const fatias = fatiarCsv(texto, LINHAS_POR_LOTE);
  // Arquivo que a rota aceita de uma vez (ou que nem tem dados — a rota diz o
  // porquê): vai inteiro e sem mexer, exatamente como antes.
  if (!fatias || (fatias.lotes.length === 1 && file.size <= BYTES_POR_REQUISICAO)) {
    return enviarArquivo(file, file.name, randomId());
  }

  const total: ImportContactsResult = { total_linhas: 0, imported: 0, skipped_duplicates: 0, errors: [] };
  for (let i = 0; i < fatias.lotes.length; i++) {
    aoProgredir?.({
      lote: i + 1,
      totalDeLotes: fatias.lotes.length,
      linhasEnviadas: Math.min(i * LINHAS_POR_LOTE, fatias.totalDeLinhas),
      totalDeLinhas: fatias.totalDeLinhas,
    });
    // Reenviar um lote cuja resposta se perdeu é seguro: a rota pula o contato
    // que já existe com o mesmo telefone ou e-mail (conta como "já existente").
    const chave = randomId();
    const blob = new Blob([fatias.lotes[i]!], { type: "text/csv;charset=utf-8" });
    let resumo: ImportContactsResult | null = null;
    for (let tentativa = 1; resumo === null; tentativa++) {
      try {
        resumo = await enviarArquivo(blob, `lote-${i + 1}.csv`, chave);
      } catch (e) {
        if (tentativa < TENTATIVAS_POR_LOTE && transitoria(e)) {
          await esperar(1500 * tentativa);
          continue;
        }
        const motivo = e instanceof Error && e.message ? e.message : "falha no envio";
        throw new ApiError(
          e instanceof ApiError ? e.status : 0,
          e instanceof ApiError ? e.code : "import_lote_falhou",
          { lote: i + 1, importados_ate_aqui: total.imported },
          randomId(),
          i === 0
            ? motivo
            : `Parou no lote ${i + 1} de ${fatias.lotes.length} (linhas ${i * LINHAS_POR_LOTE + 2} em diante): ${motivo}. ` +
              `${total.imported} contato(s) já foram importados — importar o mesmo arquivo de novo pula quem já entrou (mesmo telefone ou e-mail).`,
        );
      }
    }
    total.total_linhas += resumo.total_linhas;
    total.imported += resumo.imported;
    total.skipped_duplicates += resumo.skipped_duplicates;
    const deslocamento = i * LINHAS_POR_LOTE;
    for (const erro of resumo.errors) total.errors.push({ linha: erro.linha + deslocamento, motivo: erro.motivo });
  }
  aoProgredir?.({
    lote: fatias.lotes.length,
    totalDeLotes: fatias.lotes.length,
    linhasEnviadas: fatias.totalDeLinhas,
    totalDeLinhas: fatias.totalDeLinhas,
  });
  return total;
}

export function useImportContacts(aoProgredir?: (p: ProgressoDaImportacao) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => importarCsv(file, aoProgredir),
    onSuccess: () => {
      // A lista pode ter crescido em qualquer página/filtro — invalida tudo.
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
