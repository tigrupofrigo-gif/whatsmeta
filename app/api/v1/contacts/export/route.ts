/**
 * GET /api/v1/contacts/export — a base de contatos DE VOLTA para quem opera
 * (issue #2759).
 *
 * A tela de Contatos só importava: `POST /api/v1/contacts/import` existia desde
 * o PR #313 e não tinha porta de saída, então backup, migração entre
 * instalações e pedido de portabilidade (LGPD art. 18, V; GDPR art. 20) se
 * atendiam com SSH + psql — o terminal que o produto existe para eliminar.
 * Excluir já era possível (fila de redação/anonimização de `target_kind=
 * 'contact'`), devolver os dados ao titular, não.
 *
 * ─── O fluxo é o do export que já existe ────────────────────────────────────
 *
 * Mesma forma de `app/api/v1/audit/export/route.ts`:
 *
 *   - papel ANTES de qualquer leitura (`requireRole`, aqui `manager` — ver
 *     abaixo), Zod na query, paginação em BLOCOS porque o PostgREST corta
 *     resposta em `max_rows` (a lição da #2561: `.limit(10_000)` devolvia
 *     1.000 linhas caladas e o arquivo saía pela metade);
 *   - `Content-Type` próprio + `Content-Disposition: attachment;
 *     filename="contatos-YYYY-MM-DD.csv|vcf"` — o mesmo envelope do export de
 *     auditoria, com o prefixo do recurso.
 *
 * Nem um formato a mais: CSV é o que a própria tela importa (`lib/contacts/
 * csv.ts`), vCard é o que o celular importa e o produto já lê (#2712).
 *
 * ─── Papel ──────────────────────────────────────────────────────────────────
 *
 * `manager`, o mesmo do export de auditoria: exportar a base inteira é
 * vazamento de base, não rotina de atendimento (`agent` importa porque
 * cadastro é rotina; levar a base embora não é). O `decrypt_cpf` também exige
 * `manager`, então as duas portas batem e ninguém toma 403 no meio do arquivo.
 *
 * ─── LGPD ───────────────────────────────────────────────────────────────────
 *
 * O audit registra QUEM, QUANDO e QUANTOS registros saíram — nunca o termo de
 * busca nem o conteúdo (mesma régua do export de conversa em PDF, #1982). O
 * CPF viaja só para quem tem papel, decifrado pela RPC que já audita cada
 * chamada própria.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  CABECALHO_DO_CSV,
  linhaDoCsv,
  nomeDoArquivo,
  vcardDoContato,
  type ContatoParaExportar,
  type FormatoDeExport,
} from "@/lib/contacts/exportar";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";
import { contactListQuerySchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import type { Contact } from "@/lib/types/contacts";

import { listContactsHandler } from "../_handler";

export const dynamic = "force-dynamic";

/** A página da lista é esta: é o teto do `limit` do `contactListQuerySchema`. */
const TAMANHO_DA_PAGINA = 100;
// SEM TETO (WhatsMeta). O teto de 10.000 existia porque o arquivo inteiro era
// montado na memória antes de responder. Agora a resposta é um FLUXO: cada
// página lida vira linhas escritas na hora, e a memória fica do tamanho de uma
// página, qualquer que seja o tamanho da base.
const FORMATOS: readonly FormatoDeExport[] = ["csv", "vcf"];

/**
 * O CPF em claro de quem tem cifra, um por contato.
 *
 * A RPC `decrypt_cpf` (migration 0597) valida org + papel por dentro e audita
 * cada chamada; falha aqui degrada para coluna VAZIA, como o próprio get do
 * contato faz — CPF que não sai não pode derrubar o arquivo inteiro.
 */
async function decifraCpfs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  contatos: readonly Contact[],
  destino: Map<string, string>,
): Promise<void> {
  for (const contato of contatos) {
    if (!contato.cpf_hash) continue;
    const { data, error } = await supabase.rpc("decrypt_cpf", { p_contact_id: contato.id });
    if (error) {
      console.warn("[contacts.export] decrypt_cpf RPC indisponível", error.message);
      continue;
    }
    if (typeof data === "string" && data !== "") destino.set(contato.id, data);
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", {
    requestId,
    resource: "contacts",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const url = new URL(req.url);
  // 422 em formato desconhecido, igual ao export de conversa: silenciar o
  // pedido errado aqui é como quem integra descobre que a URL mudou.
  const bruto = (url.searchParams.get("formato") ?? "csv").toLowerCase();
  if (!FORMATOS.includes(bruto as FormatoDeExport)) {
    return fail(
      "validation_failed",
      t("Formato não suportado: use ?formato=csv ou ?formato=vcf."),
      422,
      { requestId },
    );
  }
  const formato = bruto as FormatoDeExport;

  const filtros = contactListQuerySchema.safeParse({
    search: url.searchParams.get("search") ?? undefined,
    // `getAll` (#1274): a repetição na URL sóe viva por aqui, como na lista.
    tag: url.searchParams.getAll("tag"),
    modo: url.searchParams.get("modo") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    pessoais: url.searchParams.get("pessoais") ?? undefined,
    blocked: url.searchParams.get("blocked") ?? undefined,
    order_by: url.searchParams.get("order_by") ?? undefined,
    order_dir: url.searchParams.get("order_dir") ?? undefined,
    limit: String(TAMANHO_DA_PAGINA),
  });
  if (!filtros.success) {
    return fail("validation_failed", t("Query inválida."), 422, {
      details: filtros.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const supabase = await createClient();
  // O MESMO handler da tela: é ele que garante que exportar é exportar o que a
  // lista mostra — escopo da org ATIVA, `kind='person'`, lápide de fusão, piso
  // de busca, etiquetas em E/OU. Reescrever o WHERE aqui seria uma SEGUNDA
  // resposta para a mesma pergunta, pronta para divergir da primeira.
  const ctx = {
    organization_id: authz.org.orgId,
    actor: { type: "user" as const, id: authz.user.id },
    requestId,
    idioma: authz.user.idioma,
  };

  const paraExportar = (c: Contact, cpfs: Map<string, string>): ContatoParaExportar => ({
    name: c.name,
    display_name: c.display_name,
    email: c.email,
    phone_number: c.phone_number,
    cpf: cpfs.get(c.id) ?? null,
    birthdate: c.birthdate,
    tags: c.tags,
  });

  // A PRIMEIRA página é lida antes de responder: erro de filtro ou de
  // permissão ainda vira um 4xx legível, e não um arquivo vazio.
  let primeira: Awaited<ReturnType<typeof listContactsHandler>>;
  try {
    primeira = await listContactsHandler(supabase, ctx, { ...filtros.data, cursor: undefined });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }

  const codificador = new TextEncoder();
  let total = 0;
  const auditar = (completo: boolean) =>
    audit({
      action: "contacts.exported",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "contact",
      resourceId: null,
      requestId,
      metadata: {
        actor_type: "user",
        formato,
        total,
        // `truncado` mantém o nome do campo que o audit já tinha: agora só é
        // verdade quando o fluxo foi interrompido no meio (rede, banco).
        truncado: !completo,
        // O FILTRO, nunca o TEXTO do filtro: termo de busca é dado de quem foi
        // buscado, e o audit de export existe para provar que saiu QUANTO, não
        // para guardar quem a pessoa estava procurando.
        filtros: {
          busca: filtros.data.search !== undefined,
          etiquetas: filtros.data.tag?.length ?? 0,
          origem: filtros.data.source ?? null,
          pessoais: filtros.data.pessoais,
        },
      },
    });

  const fluxo = new ReadableStream<Uint8Array>({
    async start(controle) {
      const escrever = (texto: string) => controle.enqueue(codificador.encode(texto));
      try {
        if (formato === "csv") escrever(`\uFEFF${CABECALHO_DO_CSV}\n`);
        let pagina = primeira;
        for (;;) {
          const cpfs = new Map<string, string>();
          if (formato === "csv") await decifraCpfs(supabase, pagina.contacts, cpfs);
          for (const c of pagina.contacts) {
            const contato = paraExportar(c, cpfs);
            if (formato === "csv") escrever(`${linhaDoCsv(contato)}\n`);
            else {
              const cartao = vcardDoContato(contato);
              if (cartao) escrever(cartao);
            }
            total += 1;
          }
          if (!pagina.has_more || !pagina.cursor || pagina.contacts.length === 0) break;
          pagina = await listContactsHandler(supabase, ctx, { ...filtros.data, cursor: pagina.cursor });
        }
        await auditar(true);
        controle.close();
      } catch (err) {
        logger.error("contacts.export.fluxo_interrompido", { request_id: requestId, erro: err instanceof Error ? err.message : String(err) });
        await auditar(false);
        controle.error(err);
      }
    },
  });

  return new Response(fluxo, {
    status: 200,
    headers: {
      "Content-Type": formato === "csv" ? "text/csv; charset=utf-8" : "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeDoArquivo(formato)}"`,
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}
