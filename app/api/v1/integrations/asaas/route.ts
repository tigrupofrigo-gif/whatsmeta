/**
 * A conexão da EMPRESA com a própria conta do Asaas (WhatsMeta).
 *
 * GET    — o estado: conectada?, ambiente, final da chave, nome da conta, aviso.
 * PUT    — grava (ou troca) a chave: testa no Asaas, cifra, cadastra o aviso
 *          de pagamento. Quando o Asaas recusa o cadastro do aviso, devolve URL e
 *          token UMA vez para o cadastro manual no painel do Asaas.
 * DELETE — desconecta: remove o aviso no Asaas (melhor esforço) e apaga a linha.
 *          As cobranças já criadas ficam no histórico.
 *
 * Só `admin`: a chave movimenta dinheiro da empresa.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { abrirChave, cifrarChave, lerConexao, marcaDoProduto, urlDoAviso } from "@/lib/asaas-clientes/conexao";
import { criarClienteAsaas, novoTokenDoAviso } from "@/lib/asaas-clientes/cliente";
import { hashDoToken } from "@/lib/asaas-clientes/aviso";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { modoDaChaveAsaas } from "@/lib/cobranca/provedores/asaas";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ chave: z.string().trim().min(20).max(300) });

const MOTIVOS: Record<string, string> = {
  chave_invalida: "O Asaas recusou a chave. Confira se copiou a chave inteira, começando por $aact_.",
  sem_permissao: "A chave não tem permissão para cobranças. Gere uma chave com acesso total no Asaas.",
  provedor_fora: "O Asaas não respondeu agora. Tente de novo em instantes.",
};

function estado(conexao: Awaited<ReturnType<typeof lerConexao>>) {
  if (!conexao) return { conectado: false as const };
  return {
    conectado: true as const,
    modo: conexao.modo,
    chave_final: conexao.chave_last4,
    conta_nome: conexao.conta_nome,
    aviso: {
      url: urlDoAviso(conexao.webhook_id_publico),
      cadastrado: conexao.webhook_asaas_id !== null,
    },
    atualizado_em: conexao.updated_at,
  };
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "asaas_conexoes" });
  if (!authz.ok) return authz.response;
  try {
    const conexao = await lerConexao(createAdminClient(), authz.org.orgId);
    return ok(estado(conexao), { requestId });
  } catch {
    return fail("internal_error", "Falha ao ler a conexão com o Asaas.", 500, { requestId });
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "asaas_conexoes" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Cole a chave de API do Asaas."), 422, { requestId });
  const chave = parsed.data.chave;
  if (modoDaChaveAsaas(chave) === null) {
    return fail("validation_failed", t("Isto não parece uma chave do Asaas: ela começa com $aact_prod_ ou $aact_hmlg_."), 422, { requestId });
  }

  const cliente = criarClienteAsaas({ chave, marca: marcaDoProduto() });
  const teste = await cliente.testar();
  if (!teste.ok) return fail("validation_failed", t(MOTIVOS[teste.motivo] ?? MOTIVOS.provedor_fora!), 422, { requestId });

  let colunas: ReturnType<typeof cifrarChave>;
  try {
    colunas = cifrarChave(chave);
  } catch {
    return fail("internal_error", t("A instalação não tem a chave de cifra (AI_CRED_AES_KEY). Fale com quem instalou o sistema."), 500, { requestId });
  }

  const admin = createAdminClient();
  const anterior = await lerConexao(admin, authz.org.orgId).catch(() => null);

  // O aviso antigo sai com a chave ANTIGA (pode ser de outra conta do Asaas).
  if (anterior?.webhook_asaas_id) {
    const chaveAntiga = abrirChave(anterior);
    if (chaveAntiga) {
      await criarClienteAsaas({ chave: chaveAntiga, marca: marcaDoProduto() })
        .removerAviso(anterior.webhook_asaas_id)
        .catch((e: unknown) => logger.warn("asaas_clientes.aviso_antigo_ficou", { codigo: (e as { codigo?: string }).codigo ?? null }));
    }
  }

  const idPublico = anterior?.webhook_id_publico ?? randomUUID();
  const token = novoTokenDoAviso();
  const url = urlDoAviso(idPublico);
  let avisoId: string | null = null;
  if (url) {
    try {
      avisoId = await cliente.cadastrarAviso(`${url}?c=${randomUUID().slice(0, 8)}`, token, authz.user.email, `Cobranças ${marcaDoProduto()}`);
    } catch {
      avisoId = null;
    }
  }

  const { error } = await admin.from("asaas_conexoes").upsert(
    {
      organization_id: authz.org.orgId,
      ...colunas,
      modo: teste.modo,
      webhook_id_publico: idPublico,
      webhook_token_hash: hashDoToken(token),
      webhook_asaas_id: avisoId,
      conta_nome: teste.contaNome,
      criado_por: authz.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (error) {
    if (avisoId) await cliente.removerAviso(avisoId).catch(() => undefined);
    return fail("internal_error", t("Falha ao gravar a conexão com o Asaas."), 500, { requestId });
  }

  void audit({
    action: "asaas.conectado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "asaas_conexoes",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { modo: teste.modo, aviso_automatico: avisoId !== null },
  });

  const conexao = await lerConexao(admin, authz.org.orgId).catch(() => null);
  return ok(
    {
      ...estado(conexao),
      // O token só existe em claro AGORA: sem ele o cadastro manual é impossível.
      aviso_manual: avisoId === null && url ? { url, token } : null,
    },
    { requestId },
  );
}

export async function DELETE(): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "asaas_conexoes" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const conexao = await lerConexao(admin, authz.org.orgId).catch(() => null);
  if (!conexao) return ok({ conectado: false }, { requestId });

  if (conexao.webhook_asaas_id) {
    const chave = abrirChave(conexao);
    if (chave) {
      await criarClienteAsaas({ chave, marca: marcaDoProduto() })
        .removerAviso(conexao.webhook_asaas_id)
        .catch(() => undefined);
    }
  }
  const { error } = await admin.from("asaas_conexoes").delete().eq("organization_id", authz.org.orgId);
  if (error) return fail("internal_error", "Falha ao desconectar o Asaas.", 500, { requestId });

  void audit({
    action: "asaas.desconectado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "asaas_conexoes",
    resourceId: authz.org.orgId,
    requestId,
  });
  return ok({ conectado: false }, { requestId });
}
