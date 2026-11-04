/**
 * GET /api/v1/reports/atendimento — o painel de relatórios de atendimento
 * (WhatsMeta): indicadores do período por responsável, número de WhatsApp, fila,
 * dia e hora, mais as opções dos filtros.
 *
 * Query: `from`, `to` (ISO-8601 com fuso; padrão: últimos 30 dias),
 * `responsavel` (uuid), `canal` (uuid do número).
 *
 * Papel: `agent` lê, mas mede SÓ as próprias conversas — o filtro de responsável
 * é forçado para ele, como a tela Desempenho faz. A régua de cada número está
 * escrita na `fn_relatorio_atendimento` (migration 9901), que roda com a sessão
 * de quem chama (RLS), nunca com o service role.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { fusoDaOrganizacao } from "@/lib/propostas/data-no-fuso";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;
/** Uma janela maior que isto vira consulta cara demais para uma tela. */
const JANELA_MAXIMA_MS = 400 * 24 * 60 * 60 * 1000;

const querySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  responsavel: z.string().uuid().optional(),
  canal: z.string().uuid().optional(),
});

interface LinhaDeResponsavel {
  user_id: string | null;
  [k: string]: unknown;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "metrics" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    responsavel: url.searchParams.get("responsavel") ?? undefined,
    canal: url.searchParams.get("canal") ?? undefined,
  });
  if (!parsed.success) return fail("validation_failed", t("Filtros inválidos."), 422, { requestId });

  const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
  const from = parsed.data.from ? new Date(parsed.data.from) : new Date(to.getTime() - TRINTA_DIAS_MS);
  if (from.getTime() >= to.getTime()) {
    return fail("validation_failed", t("O início do período precisa ser antes do fim."), 422, { requestId });
  }
  if (to.getTime() - from.getTime() > JANELA_MAXIMA_MS) {
    return fail("validation_failed", t("Escolha um período de até 400 dias."), 422, { requestId });
  }

  const gerente = authz.user.is_platform_admin || ROLE_RANK[authz.org.role] >= ROLE_RANK.manager;
  const responsavel = gerente ? (parsed.data.responsavel ?? null) : authz.user.id;

  const supabase = await createClient();
  const fuso = await fusoDaOrganizacao(supabase, authz.org.orgId);

  const { data, error } = await supabase.rpc("fn_relatorio_atendimento", {
    p_org: authz.org.orgId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_responsavel: responsavel,
    p_canal: parsed.data.canal ?? null,
    p_fuso: fuso,
  });
  if (error) return fail("internal_error", t("Não foi possível montar o relatório."), 500, { requestId });

  const relatorio = (data ?? {}) as { por_responsavel?: LinhaDeResponsavel[] } & Record<string, unknown>;

  // Opções dos filtros: os números da empresa e, para quem gerencia, a equipe.
  const { data: canais } = await supabase
    .from("channel_sessions")
    .select("id, display_name, phone_number")
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: true });

  let equipe: Array<{ user_id: string }> = [];
  if (gerente) {
    const { data: membros } = await supabase
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", authz.org.orgId);
    equipe = (membros ?? []) as Array<{ user_id: string }>;
  }

  // Nomes: os mesmos de Desempenho (metadado do usuário no auth).
  const ids = new Set<string>([authz.user.id, ...equipe.map((m) => m.user_id)]);
  for (const r of relatorio.por_responsavel ?? []) if (r.user_id) ids.add(r.user_id);
  const nomes = new Map<string, string>();
  if (isServiceRoleConfigured()) {
    const admin = createAdminClient();
    await Promise.all(
      [...ids].map(async (id) => {
        const { data: res } = await admin.auth.admin.getUserById(id);
        const u = res?.user;
        const nome = (u?.user_metadata?.full_name as string | undefined) || u?.email || null;
        if (nome) nomes.set(id, nome);
      }),
    );
  }

  return ok(
    {
      periodo: { from: from.toISOString(), to: to.toISOString(), fuso },
      filtros: { responsavel, canal: parsed.data.canal ?? null, pode_ver_equipe: gerente },
      ...relatorio,
      por_responsavel: (relatorio.por_responsavel ?? []).map((r) => ({
        ...r,
        nome: r.user_id ? (nomes.get(r.user_id) ?? null) : null,
      })),
      opcoes: {
        // O rótulo do NÚMERO de WhatsApp (não de contato): o nome dado à
        // conexão, ou o telefone dela.
        canais: ((canais ?? []) as Array<{ id: string; display_name: string | null; phone_number: string | null }>).map(
          (numero) => ({
            id: numero.id,
            nome: [numero.display_name, numero.phone_number].find((v) => (v ?? "").trim() !== "") ?? "",
          }),
        ),
        responsaveis: (gerente ? equipe.map((m) => m.user_id) : [authz.user.id]).map((id) => ({
          id,
          nome: nomes.get(id) ?? null,
        })),
      },
    },
    { requestId },
  );
}
