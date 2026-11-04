/**
 * A CONEXÃO de uma empresa com a própria conta do Asaas — leitura, cifra e o
 * que se grava a partir de uma cobrança lida no provedor.
 *
 * Server-only: usa o service role. Quem chama SEMPRE passa o `organization_id`
 * da sessão (ou do token do aviso), nunca do corpo da requisição.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveBranding } from "@/lib/branding";
import { bufToBytea, byteaToBuffer, decryptKey, encryptKey } from "@/lib/crypto/aes_gcm";
import { env } from "@/lib/env";
import { urlPublicaUsavel } from "@/lib/escalacao/url-publica";

import { criarClienteAsaas, linkSeguro, reaisParaCentavos, type ClienteAsaas, type CobrancaDoAsaas } from "./cliente";
import { estaPaga } from "./status";

export interface LinhaDaConexao {
  organization_id: string;
  chave_encrypted: string;
  chave_iv: string;
  chave_tag: string;
  chave_last4: string;
  modo: "producao" | "teste";
  webhook_id_publico: string;
  webhook_token_hash: string;
  webhook_asaas_id: string | null;
  conta_nome: string | null;
  updated_at: string;
}

const COLUNAS =
  "organization_id, chave_encrypted, chave_iv, chave_tag, chave_last4, modo, webhook_id_publico, webhook_token_hash, webhook_asaas_id, conta_nome, updated_at";

/** As colunas de `asaas_cobrancas` que a tela lê. */
export const COLUNAS_DA_COBRANCA =
  "id, lead_id, contact_id, asaas_payment_id, forma, valor_cents, moeda, vencimento, descricao, status, link_pagamento, boleto_url, pago_em, modo, created_at";

/** O nome do produto, para o User-Agent e o nome do aviso no Asaas. */
export function marcaDoProduto(): string {
  return resolveBranding(env.APP_NAME, null).name;
}

export function cifrarChave(chave: string) {
  const c = encryptKey(chave);
  return {
    chave_encrypted: bufToBytea(c.ciphertext),
    chave_iv: bufToBytea(c.iv),
    chave_tag: bufToBytea(c.tag),
    chave_last4: c.last4,
  };
}

/** `null` quando a cifra não abre (chave de instalação trocada, coluna corrompida). */
export function abrirChave(linha: Pick<LinhaDaConexao, "chave_encrypted" | "chave_iv" | "chave_tag">): string | null {
  try {
    return decryptKey({
      ciphertext: byteaToBuffer(linha.chave_encrypted),
      iv: byteaToBuffer(linha.chave_iv),
      tag: byteaToBuffer(linha.chave_tag),
    });
  } catch {
    return null;
  }
}

export async function lerConexao(admin: SupabaseClient, organizationId: string): Promise<LinhaDaConexao | null> {
  const { data, error } = await admin.from("asaas_conexoes").select(COLUNAS).eq("organization_id", organizationId).maybeSingle();
  if (error) throw error;
  return (data as LinhaDaConexao | null) ?? null;
}

export async function conexaoPeloAviso(admin: SupabaseClient, idPublico: string): Promise<LinhaDaConexao | null> {
  const { data, error } = await admin.from("asaas_conexoes").select(COLUNAS).eq("webhook_id_publico", idPublico).maybeSingle();
  if (error) throw error;
  return (data as LinhaDaConexao | null) ?? null;
}

/** O cliente HTTP desta empresa, ou `null` quando não há conexão que abra. */
export async function clienteDaEmpresa(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ cliente: ClienteAsaas; conexao: LinhaDaConexao } | null> {
  const conexao = await lerConexao(admin, organizationId);
  if (!conexao) return null;
  const chave = abrirChave(conexao);
  if (!chave) return null;
  return { cliente: criarClienteAsaas({ chave, marca: marcaDoProduto() }), conexao };
}

/**
 * O endereço que o Asaas chama. O Asaas só entrega aviso em https público:
 * fora disso, `null`, e a tela explica que falta configurar o domínio.
 */
export function urlDoAviso(idPublico: string, base = env.NEXT_PUBLIC_APP_URL ?? ""): string | null {
  const limpa = base.trim().replace(/\/+$/, "");
  if (!URL.canParse(limpa)) return null;
  if (new URL(limpa).protocol !== "https:" || !urlPublicaUsavel(limpa)) return null;
  return `${limpa}/api/v1/webhooks/asaas-clientes/${idPublico}`;
}

/** O que se grava em `asaas_cobrancas` a partir da cobrança lida no Asaas. */
export function camposDaCobranca(c: CobrancaDoAsaas) {
  const pagoEm = c.clientPaymentDate ?? c.paymentDate ?? c.confirmedDate ?? null;
  return {
    status: c.deleted === true ? "DELETED" : c.status,
    valor_cents: reaisParaCentavos(c.value),
    vencimento: c.dueDate,
    link_pagamento: linkSeguro(c.invoiceUrl),
    boleto_url: linkSeguro(c.bankSlipUrl),
    pago_em: estaPaga(c.status) && pagoEm ? `${pagoEm}T12:00:00-03:00` : null,
    updated_at: new Date().toISOString(),
  };
}
