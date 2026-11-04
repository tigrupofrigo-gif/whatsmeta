/**
 * POST /api/v1/webhooks/asaas-clientes/[id] — o aviso de pagamento do Asaas
 * para as cobranças que uma EMPRESA faz aos próprios clientes (WhatsMeta).
 *
 * O `[id]` é o `webhook_id_publico` da conexão: diz de qual empresa é o aviso.
 * O Asaas autentica com o token que NÓS geramos, ecoado em `asaas-access-token`
 * (sem HMAC nem horário) — então o corpo é só PONTEIRO, e a decisão vem da
 * RELEITURA da cobrança na API do Asaas com a chave da empresa.
 *
 * Respostas: aviso de cobrança que não é daqui, ou de forma inesperada → 200 sem
 * efeito (recusar faria o Asaas pausar a fila); Asaas fora na releitura → 503,
 * e ele reentrega.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { camposDaCobranca, clienteDaEmpresa, conexaoPeloAviso } from "@/lib/asaas-clientes/conexao";
import { cobrancaDoAviso, tokenDoAvisoConfere } from "@/lib/asaas-clientes/aviso";
import { estaPaga, ROTULO_DA_FORMA } from "@/lib/asaas-clientes/status";
import { audit } from "@/lib/audit";
import { ErroDoProvedor } from "@/lib/cobranca/provedores/contrato";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import { formatCents } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const LIMITE_DO_CORPO = 262_144;

type Rota = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Rota): Promise<Response> {
  const requestId = randomUUID();
  const naoExiste = () => fail("not_found", "Not found", 404, { requestId });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return naoExiste();

  if (Number(req.headers.get("content-length") ?? "0") > LIMITE_DO_CORPO) {
    return fail("payload_too_large", "Aviso grande demais.", 413, { requestId });
  }
  const corpo = await req.text();
  if (Buffer.byteLength(corpo, "utf8") > LIMITE_DO_CORPO) {
    return fail("payload_too_large", "Aviso grande demais.", 413, { requestId });
  }

  const admin = createAdminClient();
  const conexao = await conexaoPeloAviso(admin, id).catch(() => null);
  if (!conexao) return naoExiste();
  if (!tokenDoAvisoConfere(req.headers.get("asaas-access-token"), conexao.webhook_token_hash)) {
    logger.warn("asaas_clientes.aviso_recusado", { organization_id: conexao.organization_id });
    return fail("unauthorized", "Token inválido.", 401, { requestId });
  }

  const ponteiro = cobrancaDoAviso(corpo);
  if (!ponteiro) return ok({ ignorado: "forma_inesperada" }, { requestId });

  const orgId = conexao.organization_id;
  const { data: linha } = await admin
    .from("asaas_cobrancas")
    .select("id, lead_id, contact_id, status, forma, valor_cents")
    .eq("organization_id", orgId)
    .eq("asaas_payment_id", ponteiro.cobrancaId)
    .maybeSingle();
  // Cobrança criada fora do CRM (no painel do Asaas): não é desta tela.
  if (!linha) return ok({ ignorado: "cobranca_de_fora" }, { requestId });

  const empresa = await clienteDaEmpresa(admin, orgId).catch(() => null);
  if (!empresa) return ok({ ignorado: "sem_chave" }, { requestId });

  let campos: ReturnType<typeof camposDaCobranca>;
  try {
    campos = camposDaCobranca(await empresa.cliente.lerCobranca(ponteiro.cobrancaId));
  } catch (e) {
    if (e instanceof ErroDoProvedor && e.status === 404) {
      // Apagada no Asaas: a linha fica no histórico como cancelada.
      await admin
        .from("asaas_cobrancas")
        .update({ status: "DELETED", updated_at: new Date().toISOString() })
        .eq("organization_id", orgId)
        .eq("id", linha.id);
      return ok({ recebido: true }, { requestId });
    }
    return fail("unavailable", "Tente de novo em instantes.", 503, { requestId });
  }

  const { error } = await admin.from("asaas_cobrancas").update(campos).eq("organization_id", orgId).eq("id", linha.id);
  if (error) return fail("internal_error", "Não foi possível registrar o aviso.", 500, { requestId });

  const acabouDePagar = !estaPaga(linha.status) && estaPaga(campos.status);
  if (acabouDePagar) {
    if (linha.lead_id) {
      await emitLeadActivity(admin, {
        organizationId: orgId,
        leadId: linha.lead_id,
        contactId: linha.contact_id,
        type: "note",
        sourceModule: "asaas_cobrancas",
        sourceId: linha.id,
        actor: { type: "webhook_source", id: "asaas" },
        reason: `Pagamento confirmado pelo Asaas: ${formatCents(campos.valor_cents, "BRL")} (${ROTULO_DA_FORMA[linha.forma] ?? linha.forma})`,
      }).catch(() => undefined);
    }
    void audit({
      action: "asaas.cobranca_paga",
      actorUserId: null,
      organizationId: orgId,
      resourceType: "asaas_cobrancas",
      resourceId: linha.id,
      requestId,
      metadata: { evento: ponteiro.evento },
    });
  }
  return ok({ recebido: true }, { requestId });
}
