/**
 * Uma cobrança do Asaas (WhatsMeta).
 *
 * GET    — relê a cobrança no Asaas, grava a situação atual e devolve junto o
 *          "Pix copia e cola" (quando a forma permite). Grava, mas é leitura: só
 *          copia para cá o que o Asaas (a fonte da verdade) já diz, e repetir não
 *          muda nada — por isso também serve a quem só pode ver.
 * DELETE — cancela no Asaas a cobrança ainda não paga.
 *
 * A linha é sempre achada pela organização da sessão; o id do path sozinho
 * não alcança cobrança de outra empresa.
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { camposDaCobranca, clienteDaEmpresa, COLUNAS_DA_COBRANCA } from "@/lib/asaas-clientes/conexao";
import { podeCancelar } from "@/lib/asaas-clientes/status";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { ErroDoProvedor } from "@/lib/cobranca/provedores/contrato";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Rota = { params: Promise<{ id: string }> };

async function acharCobranca(organizationId: string, id: string) {
  const { data } = await createAdminClient()
    .from("asaas_cobrancas")
    .select(`${COLUNAS_DA_COBRANCA}, organization_id`)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  return data as ({ asaas_payment_id: string; status: string; forma: string } & Record<string, unknown>) | null;
}

export async function GET(_req: Request, { params }: Rota): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "asaas_cobrancas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return fail("not_found", t("Cobrança não encontrada."), 404, { requestId });

  const cobranca = await acharCobranca(authz.org.orgId, id);
  if (!cobranca) return fail("not_found", t("Cobrança não encontrada."), 404, { requestId });

  const admin = createAdminClient();
  const empresa = await clienteDaEmpresa(admin, authz.org.orgId).catch(() => null);
  if (!empresa) return ok({ ...cobranca, pix_copia_e_cola: null, desatualizada: true }, { requestId });

  try {
    const lida = await empresa.cliente.lerCobranca(cobranca.asaas_payment_id);
    const { data: atual } = await admin
      .from("asaas_cobrancas")
      .update(camposDaCobranca(lida))
      .eq("organization_id", authz.org.orgId)
      .eq("id", id)
      .select(COLUNAS_DA_COBRANCA)
      .single();
    const aberta = podeCancelar(lida.status);
    const pix = aberta && lida.billingType !== "BOLETO" ? await empresa.cliente.pixCopiaECola(lida.id).catch(() => null) : null;
    return ok({ ...(atual ?? cobranca), pix_copia_e_cola: pix, desatualizada: false }, { requestId });
  } catch (e) {
    if (e instanceof ErroDoProvedor && e.status === 404) {
      const { data: atual } = await admin
        .from("asaas_cobrancas")
        .update({ status: "DELETED", updated_at: new Date().toISOString() })
        .eq("organization_id", authz.org.orgId)
        .eq("id", id)
        .select(COLUNAS_DA_COBRANCA)
        .single();
      return ok({ ...(atual ?? cobranca), pix_copia_e_cola: null, desatualizada: false }, { requestId });
    }
    return ok({ ...cobranca, pix_copia_e_cola: null, desatualizada: true }, { requestId });
  }
}

export async function DELETE(_req: Request, { params }: Rota): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "asaas_cobrancas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return fail("not_found", t("Cobrança não encontrada."), 404, { requestId });

  const cobranca = await acharCobranca(authz.org.orgId, id);
  if (!cobranca) return fail("not_found", t("Cobrança não encontrada."), 404, { requestId });
  if (!podeCancelar(cobranca.status)) {
    return fail("state_conflict", t("Só dá para cancelar cobrança que ainda não foi paga."), 409, { requestId });
  }

  const admin = createAdminClient();
  const empresa = await clienteDaEmpresa(admin, authz.org.orgId).catch(() => null);
  if (!empresa) {
    return fail("state_conflict", t("O Asaas não está conectado. Um administrador conecta em Configurações › Asaas."), 409, { requestId });
  }
  try {
    await empresa.cliente.cancelarCobranca(cobranca.asaas_payment_id);
  } catch {
    return fail("upstream_unavailable", t("O Asaas não cancelou agora. Tente de novo em instantes."), 502, { requestId });
  }

  const { data: atual } = await admin
    .from("asaas_cobrancas")
    .update({ status: "DELETED", updated_at: new Date().toISOString() })
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select(COLUNAS_DA_COBRANCA)
    .single();

  void audit({
    action: "asaas.cobranca_cancelada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "asaas_cobrancas",
    resourceId: id,
    requestId,
  });
  return ok(atual ?? { ...cobranca, status: "DELETED" }, { requestId });
}
