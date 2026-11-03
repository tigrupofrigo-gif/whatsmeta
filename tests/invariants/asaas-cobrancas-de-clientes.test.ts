import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";
import { comoAnon, comoServidor, comoUsuario, criarOrg, criarUsuarios, erroDe, uuid, valor, vincular } from "./cobranca-helpers";

/**
 * WhatsMeta 9900 — as cobranças do Asaas que cada empresa faz aos próprios
 * clientes. Duas tabelas, duas réguas:
 *
 *   asaas_conexoes  — a chave de API cifrada da empresa. Ninguém lê pela sessão
 *                     (nem o admin da própria empresa): só o servidor, filtrando
 *                     a organização à mão.
 *   asaas_cobrancas — membro da empresa LÊ as dela e ZERO das outras; a sessão
 *                     não escreve (só as rotas, pelo service role).
 */

const P = "a5aa0001-0000-4000-8000";
const ORG_A = uuid(P, 1);
const ORG_B = uuid(P, 2);
const AGENTE_A = uuid(P, 11);
const ADMIN_A = uuid(P, 12);
const AGENTE_B = uuid(P, 13);

function cobranca(org: string, pagamento: string): string {
  return `insert into public.asaas_cobrancas
    (organization_id, asaas_payment_id, asaas_customer_id, forma, valor_cents, vencimento, status, modo)
    values ('${org}', '${pagamento}', 'cus_1', 'PIX', 15000, '2026-12-01', 'PENDING', 'teste')`;
}

function conexao(org: string): string {
  return `insert into public.asaas_conexoes
    (organization_id, chave_encrypted, chave_iv, chave_tag, chave_last4, modo, webhook_token_hash)
    values ('${org}', '\\x00', '\\x00', '\\x00', 'abcd', 'teste', repeat('a', 64))`;
}

beforeAll(() => {
  criarUsuarios([
    [AGENTE_A, "agente-a-asaas@invariant.test"],
    [ADMIN_A, "admin-a-asaas@invariant.test"],
    [AGENTE_B, "agente-b-asaas@invariant.test"],
  ]);
  criarOrg(ORG_A, "asaas-a");
  criarOrg(ORG_B, "asaas-b");
  vincular(AGENTE_A, ORG_A, "agent");
  vincular(ADMIN_A, ORG_A, "admin");
  vincular(AGENTE_B, ORG_B, "agent");
  sql(`${cobranca(ORG_A, "pay_a1")}; ${cobranca(ORG_A, "pay_a2")}; ${cobranca(ORG_B, "pay_b1")};`);
  sql(`${conexao(ORG_A)}; ${conexao(ORG_B)};`);
});

describe("asaas_cobrancas — membro lê as da empresa dele, e só elas", () => {
  it("⭐ agente de A lê as 2 de A e zero de B", () => {
    expect(countAs(AGENTE_A, `select count(*) from public.asaas_cobrancas where organization_id = '${ORG_A}';`)).toBe(2);
    expect(countAs(AGENTE_A, `select count(*) from public.asaas_cobrancas where organization_id = '${ORG_B}';`)).toBe(0);
    expect(countAs(AGENTE_A, `select count(*) from public.asaas_cobrancas;`)).toBe(2);
  });

  it("⭐ agente de B lê a de B e zero de A", () => {
    expect(countAs(AGENTE_B, `select count(*) from public.asaas_cobrancas;`)).toBe(1);
    expect(countAs(AGENTE_B, `select count(*) from public.asaas_cobrancas where organization_id = '${ORG_A}';`)).toBe(0);
  });

  it("anon não lê nada", () => {
    expect(erroDe(comoAnon(`select count(*) from public.asaas_cobrancas`))).toContain("42501");
  });

  it("⭐ a sessão não escreve, nem o admin na própria empresa", () => {
    expect(erroDe(comoUsuario(ADMIN_A, cobranca(ORG_A, "pay_forjada")))).toContain("42501");
    expect(erroDe(comoUsuario(ADMIN_A, `update public.asaas_cobrancas set status = 'RECEIVED' where organization_id = '${ORG_A}'`))).toContain("42501");
    expect(erroDe(comoUsuario(ADMIN_A, `delete from public.asaas_cobrancas where organization_id = '${ORG_A}'`))).toContain("42501");
    expect(valor(`select count(*) from public.asaas_cobrancas where status = 'RECEIVED';`)).toBe("0");
  });

  it("controle: o servidor escreve", () => {
    expect(erroDe(comoServidor(cobranca(ORG_A, "pay_servidor")))).toBe("");
  });

  it("a mesma cobrança do Asaas não entra duas vezes na mesma empresa", () => {
    expect(erroDe(cobranca(ORG_A, "pay_a1"))).toContain("23505");
    expect(erroDe(cobranca(ORG_B, "pay_a1"))).toBe("");
  });

  it("valor zero e forma desconhecida são recusados pelo banco", () => {
    expect(erroDe(cobranca(ORG_A, "pay_zero").replace("15000", "0"))).toContain("23514");
    expect(erroDe(cobranca(ORG_A, "pay_ted").replace("'PIX'", "'TED'"))).toContain("23514");
  });
});

describe("asaas_conexoes — a chave cifrada é só do servidor", () => {
  it("⭐ nem o admin da própria empresa lê a linha pela sessão", () => {
    expect(erroDe(comoUsuario(ADMIN_A, `select count(*) from public.asaas_conexoes`))).toContain("42501");
    expect(erroDe(comoUsuario(AGENTE_B, `select count(*) from public.asaas_conexoes`))).toContain("42501");
  });

  it("anon não lê", () => {
    expect(erroDe(comoAnon(`select count(*) from public.asaas_conexoes`))).toContain("42501");
  });

  it("controle: o servidor lê as duas", () => {
    expect(valor(`${comoServidor("select count(*) from public.asaas_conexoes")}`)).toBe("2");
  });

  it("uma conexão por empresa", () => {
    expect(erroDe(conexao(ORG_A))).toContain("23505");
  });
});

describe("LGPD — anonimizar o contato apaga a descrição, mantém o registro financeiro", () => {
  const CONTATO = uuid(P, 201);

  it("⭐ a descrição some; valor, situação e id do Asaas ficam", () => {
    sql(`insert into public.contacts (id, organization_id, name) values ('${CONTATO}', '${ORG_A}', 'Maria da Silva');`);
    sql(`insert into public.asaas_cobrancas
           (organization_id, contact_id, asaas_payment_id, asaas_customer_id, forma, valor_cents, vencimento, status, modo, descricao)
           values ('${ORG_A}', '${CONTATO}', 'pay_lgpd', 'cus_1', 'PIX', 9900, '2026-12-01', 'RECEIVED', 'teste', 'Consulta da Maria da Silva');`);
    sql(`update public.contacts set is_anonymized = true, anonymized_at = now(), name = 'Cliente Anonimizado #1' where id = '${CONTATO}';`);
    expect(valor(`select coalesce(descricao, '<nula>') || '|' || valor_cents || '|' || status || '|' || asaas_payment_id
                    from public.asaas_cobrancas where asaas_payment_id = 'pay_lgpd';`)).toBe("<nula>|9900|RECEIVED|pay_lgpd");
  });

  it("a cobrança de outro contato não é tocada", () => {
    sql(`update public.asaas_cobrancas set descricao = 'outra' where asaas_payment_id = 'pay_a1';`);
    expect(valor(`select descricao from public.asaas_cobrancas where asaas_payment_id = 'pay_a1';`)).toBe("outra");
  });

  it("a função do gatilho não é chamável pela sessão", () => {
    expect(valor(`select has_function_privilege('authenticated', 'public.fn_asaas_redige_cobrancas_de_contato_anonimizado()', 'execute')::text;`)).toBe("false");
    expect(valor(`select has_function_privilege('anon', 'public.fn_asaas_redige_cobrancas_de_contato_anonimizado()', 'execute')::text;`)).toBe("false");
  });
});
