/**
 * Cobranças do Asaas de um negócio (WhatsMeta).
 *
 * GET  ?lead_id= — as cobranças do negócio (RLS: membro da empresa lê) e se a
 *                  empresa tem o Asaas conectado (a tela decide o atalho).
 * POST           — cria a cobrança no Asaas para o contato do negócio e grava.
 *
 * O `lead_id` do corpo nunca é confiado sozinho: o negócio é relido na
 * organização da sessão antes de qualquer efeito.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { FORMAS_DE_PAGAMENTO } from "@/lib/asaas-clientes/cliente";
import { camposDaCobranca, clienteDaEmpresa, COLUNAS_DA_COBRANCA } from "@/lib/asaas-clientes/conexao";
import { ROTULO_DA_FORMA } from "@/lib/asaas-clientes/status";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { documentoDoPagador } from "@/lib/cobranca/documento";
import { ErroDoProvedor } from "@/lib/cobranca/provedores/contrato";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { formatCents } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DATA = /^\d{4}-\d{2}-\d{2}$/;

const criarSchema = z.object({
  lead_id: z.string().uuid(),
  forma: z.enum(FORMAS_DE_PAGAMENTO),
  valor_cents: z.number().int().min(500, "O Asaas exige cobrança de pelo menos R$ 5,00.").max(100_000_000),
  vencimento: z.string().regex(DATA),
  descricao: z.string().trim().max(500).optional().nullable(),
  documento: z.string().trim().max(30).optional().nullable(),
});

const MOTIVOS_DO_ASAAS: Record<string, string> = {
  documento_obrigatorio: "Informe o CPF ou CNPJ do cliente: o Asaas exige o documento na primeira cobrança.",
  chave_invalida: "A chave do Asaas deixou de funcionar. Conecte de novo em Configurações › Asaas.",
  sem_permissao: "A chave do Asaas não tem permissão para cobranças.",
  provedor_fora: "O Asaas não respondeu agora. Tente de novo em instantes.",
  sem_resposta: "O Asaas não respondeu agora. Tente de novo em instantes.",
};

function hojeEmSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "asaas_cobrancas" });
  if (!authz.ok) return authz.response;

  const leadId = req.nextUrl.searchParams.get("lead_id");
  if (!leadId || !z.string().uuid().safeParse(leadId).success) {
    return fail("validation_failed", "lead_id inválido.", 422, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asaas_cobrancas")
    .select(COLUNAS_DA_COBRANCA)
    .eq("organization_id", authz.org.orgId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return fail("internal_error", "Falha ao listar as cobranças.", 500, { requestId });

  const { data: conexao } = await createAdminClient()
    .from("asaas_conexoes")
    .select("organization_id")
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();

  return ok({ conectado: conexao !== null, cobrancas: data ?? [] }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "asaas_cobrancas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = criarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const primeira = parsed.error.issues[0]?.message;
    return fail("validation_failed", t(primeira && !primeira.startsWith("Invalid") ? primeira : "Confira os campos da cobrança."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const input = parsed.data;
  if (input.vencimento < hojeEmSaoPaulo()) {
    return fail("validation_failed", t("O vencimento não pode ser uma data passada."), 422, { requestId });
  }
  let documento: string | null = null;
  if (input.documento) {
    documento = documentoDoPagador(input.documento);
    if (!documento) return fail("validation_failed", t("CPF ou CNPJ inválido."), 422, { requestId });
  }

  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("id, contact_id")
    .eq("organization_id", authz.org.orgId)
    .eq("id", input.lead_id)
    .maybeSingle();
  if (!lead) return fail("not_found", t("Negócio não encontrado nesta organização."), 404, { requestId });
  if (!lead.contact_id) {
    return fail("validation_failed", t("Este negócio não tem um contato vinculado. Vincule um contato antes de cobrar."), 422, { requestId });
  }
  const { data: contato } = await supabase
    .from("contacts")
    .select("id, name, display_name, email, phone_number, is_anonymized")
    .eq("organization_id", authz.org.orgId)
    .eq("id", lead.contact_id)
    .maybeSingle();
  if (!contato || contato.is_anonymized) {
    return fail("validation_failed", t("O contato deste negócio não está disponível para cobrança."), 422, { requestId });
  }

  const admin = createAdminClient();
  const empresa = await clienteDaEmpresa(admin, authz.org.orgId).catch(() => null);
  if (!empresa) {
    return fail("state_conflict", t("O Asaas não está conectado. Um administrador conecta em Configurações › Asaas."), 409, { requestId });
  }

  const telefone = typeof contato.phone_number === "string" ? contato.phone_number.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "") : null;
  let criada;
  try {
    const clienteId = await empresa.cliente.garantirCliente({
      id: contato.id,
      nome: (contato.display_name || contato.name || "Cliente").slice(0, 100),
      documento,
      email: contato.email ?? null,
      telefone: telefone && /^\d{10,11}$/.test(telefone) ? telefone : null,
    });
    criada = await empresa.cliente.criarCobranca({
      clienteId,
      forma: input.forma,
      valorCents: input.valor_cents,
      vencimento: input.vencimento,
      descricao: input.descricao ?? null,
      referencia: lead.id,
    });
  } catch (e) {
    if (e instanceof ErroDoProvedor) {
      const motivo = MOTIVOS_DO_ASAAS[e.codigo];
      return fail(
        "validation_failed",
        t(motivo ?? "O Asaas recusou a cobrança. Confira os dados do cliente (CPF/CNPJ, e-mail) e o valor."),
        422,
        { requestId, details: { codigo_asaas: e.codigo } },
      );
    }
    return fail("internal_error", t("Falha ao criar a cobrança no Asaas."), 500, { requestId });
  }

  const { data: linha, error } = await admin
    .from("asaas_cobrancas")
    .upsert(
      {
        organization_id: authz.org.orgId,
        lead_id: lead.id,
        contact_id: contato.id,
        asaas_payment_id: criada.id,
        asaas_customer_id: criada.customer,
        forma: input.forma,
        moeda: "BRL",
        descricao: input.descricao ?? null,
        modo: empresa.conexao.modo,
        criado_por: authz.user.id,
        ...camposDaCobranca(criada),
      },
      { onConflict: "organization_id,asaas_payment_id" },
    )
    .select(COLUNAS_DA_COBRANCA)
    .single();
  if (error || !linha) {
    return fail("internal_error", t("A cobrança foi criada no Asaas, mas não foi gravada aqui. Atualize a página."), 500, { requestId });
  }

  await emitLeadActivity(supabase, {
    organizationId: authz.org.orgId,
    leadId: lead.id,
    contactId: contato.id,
    type: "note",
    sourceModule: "asaas_cobrancas",
    sourceId: linha.id,
    actor: { type: "user", id: authz.user.id },
    reason: `Cobrança Asaas criada: ${formatCents(input.valor_cents, "BRL")} (${ROTULO_DA_FORMA[input.forma]}), vence em ${input.vencimento.split("-").reverse().join("/")}`,
  });

  void audit({
    action: "asaas.cobranca_criada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "asaas_cobrancas",
    resourceId: linha.id,
    requestId,
    metadata: { forma: input.forma, valor_cents: input.valor_cents, modo: empresa.conexao.modo },
  });

  const pix = input.forma === "PIX" ? await empresa.cliente.pixCopiaECola(criada.id).catch(() => null) : null;
  return ok({ ...linha, pix_copia_e_cola: pix }, { requestId, status: 201 });
}
