import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";
import { criarOrg, criarUsuarios, uuid, vincular } from "./cobranca-helpers";

/**
 * WhatsMeta 9901 — `fn_relatorio_atendimento` com dados de régua conhecida.
 *
 * Período: 01/10/2026 00:00 a 08/10/2026 00:00 em São Paulo.
 *   conversa 1 (número 1, do atendente): cliente 02/10 10:00 → atendente 10:05  (humana 300 s)
 *   conversa 2 (número 2, sem dono):     cliente 03/10 14:00 → IA 14:00:30      (geral 30 s)
 *                                        cliente 15:00, sem resposta depois
 *   conversa 3 (número 1, sem dono):     cliente 04/10 09:00, nunca respondida
 *   conversa 4 (número 1):               só mensagem FORA do período
 *   empresa B:                           uma conversa com mensagem no período
 */

const P = "a5aa0002-0000-4000-8000";
const ORG_A = uuid(P, 1);
const ORG_B = uuid(P, 2);
const ADMIN_A = uuid(P, 11);
const ATENDENTE = uuid(P, 12);
const ADMIN_B = uuid(P, 13);
const NUM_1 = uuid(P, 21);
const NUM_2 = uuid(P, 22);
const NUM_B = uuid(P, 23);
const CT = (n: number) => uuid(P, 30 + n);
const CV = (n: number) => uuid(P, 40 + n);
const DE = "2026-10-01T00:00:00-03:00";
const ATE = "2026-10-08T00:00:00-03:00";

function msg(org: string, conversa: string, numero: string, contato: string, direcao: string, quando: string, extra = "") {
  const [colunas, valores] = extra ? extra.split("=") : ["", ""];
  return `insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, sent_at${colunas ? `, ${colunas}` : ""})
    values ('${org}', '${conversa}', '${numero}', '${contato}', 'text', '${direcao}', '${quando}'${valores ? `, ${valores}` : ""});`;
}

function relatorio(usuario: string, org: string, filtros = "null, null"): Record<string, unknown> {
  const saida = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${usuario}","role":"authenticated"}', false);
    select public.fn_relatorio_atendimento('${org}', '${DE}', '${ATE}', ${filtros}, 'America/Sao_Paulo')::text;
  `);
  return JSON.parse(saida.trim().split("\n").at(-1)!);
}

beforeAll(() => {
  criarUsuarios([
    [ADMIN_A, "admin-a-relatorio@invariant.test"],
    [ATENDENTE, "atendente-relatorio@invariant.test"],
    [ADMIN_B, "admin-b-relatorio@invariant.test"],
  ]);
  criarOrg(ORG_A, "relatorio-a");
  criarOrg(ORG_B, "relatorio-b");
  vincular(ADMIN_A, ORG_A, "admin");
  vincular(ATENDENTE, ORG_A, "agent");
  vincular(ADMIN_B, ORG_B, "admin");
  sql(`
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, display_name, phone_number)
      values ('${NUM_1}', '${ORG_A}', 'rel-num-1', '\\x00'::bytea, 'Comercial', '5548999990001'),
             ('${NUM_2}', '${ORG_A}', 'rel-num-2', '\\x00'::bytea, 'Suporte', '5548999990002'),
             ('${NUM_B}', '${ORG_B}', 'rel-num-b', '\\x00'::bytea, 'Outra', '5548999990003');
    insert into public.contacts (id, organization_id, display_name) values
      ('${CT(1)}', '${ORG_A}', 'C1'), ('${CT(2)}', '${ORG_A}', 'C2'), ('${CT(3)}', '${ORG_A}', 'C3'),
      ('${CT(4)}', '${ORG_A}', 'C4'), ('${CT(5)}', '${ORG_B}', 'C5');
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, assigned_to_user_id, created_at) values
      ('${CV(1)}', '${ORG_A}', '${CT(1)}', '${NUM_1}', 'open', '${ATENDENTE}', '2026-10-02T09:59:00-03:00'),
      ('${CV(2)}', '${ORG_A}', '${CT(2)}', '${NUM_2}', 'open', null, '2026-10-03T13:59:00-03:00'),
      ('${CV(3)}', '${ORG_A}', '${CT(3)}', '${NUM_1}', 'open', null, '2026-09-20T08:00:00-03:00'),
      ('${CV(4)}', '${ORG_A}', '${CT(4)}', '${NUM_1}', 'open', null, '2026-09-01T08:00:00-03:00'),
      ('${CV(5)}', '${ORG_B}', '${CT(5)}', '${NUM_B}', 'open', null, '2026-10-02T08:00:00-03:00');
  `);
  sql(
    [
      msg(ORG_A, CV(1), NUM_1, CT(1), "inbound", "2026-10-02T10:00:00-03:00"),
      msg(ORG_A, CV(1), NUM_1, CT(1), "outbound", "2026-10-02T10:05:00-03:00", `sent_by_user_id, sent_via='${ATENDENTE}', 'crm'`),
      msg(ORG_A, CV(2), NUM_2, CT(2), "inbound", "2026-10-03T14:00:00-03:00"),
      msg(ORG_A, CV(2), NUM_2, CT(2), "outbound", "2026-10-03T14:00:30-03:00", "sent_via='ai'"),
      msg(ORG_A, CV(2), NUM_2, CT(2), "inbound", "2026-10-03T15:00:00-03:00"),
      msg(ORG_A, CV(3), NUM_1, CT(3), "inbound", "2026-10-04T09:00:00-03:00"),
      msg(ORG_A, CV(4), NUM_1, CT(4), "inbound", "2026-09-15T09:00:00-03:00"),
      msg(ORG_B, CV(5), NUM_B, CT(5), "inbound", "2026-10-02T11:00:00-03:00"),
    ].join("\n"),
  );
});

describe("fn_relatorio_atendimento — a régua", () => {
  it("⭐ totais do período", () => {
    const r = relatorio(ADMIN_A, ORG_A).totais as Record<string, number>;
    expect(r.conversas_ativas).toBe(3);
    expect(r.conversas_novas).toBe(2);
    expect(r.mensagens_recebidas).toBe(4);
    expect(r.mensagens_enviadas).toBe(2);
    expect(r.enviadas_por_pessoas).toBe(1);
    expect(r.enviadas_pela_ia).toBe(1);
    expect(r.enviadas_por_automacao).toBe(0);
    expect(r.sem_resposta).toBe(1);
    expect(r.primeira_resposta_humana_mediana_s).toBe(300);
    expect(r.primeira_resposta_mediana_s).toBe(165); // mediana de 300 e 30
  });

  it("por número e por responsável", () => {
    const r = relatorio(ADMIN_A, ORG_A);
    const canais = r.por_canal as Array<{ nome: string; conversas: number }>;
    expect(Object.fromEntries(canais.map((c) => [c.nome, c.conversas]))).toEqual({ Comercial: 2, Suporte: 1 });
    const resp = r.por_responsavel as Array<{ user_id: string | null; conversas: number; primeira_resposta_humana_mediana_s: number | null }>;
    expect(resp.find((x) => x.user_id === ATENDENTE)).toMatchObject({ conversas: 1, primeira_resposta_humana_mediana_s: 300 });
    expect(resp.find((x) => x.user_id === null)).toMatchObject({ conversas: 2 });
  });

  it("por fila: a mesma regra da aba Fila", () => {
    const filas = relatorio(ADMIN_A, ORG_A).por_fila as Array<{ fila: string; conversas: number }>;
    expect(Object.fromEntries(filas.map((f) => [f.fila, f.conversas]))).toEqual({ automatico: 2, humano: 1 });
  });

  it("série por dia no fuso da empresa e mensagens por hora", () => {
    const r = relatorio(ADMIN_A, ORG_A);
    const serie = r.serie_diaria as Array<{ dia: string; recebidas: number; enviadas: number }>;
    expect(serie).toHaveLength(7);
    expect(serie.find((d) => d.dia === "2026-10-03")).toMatchObject({ recebidas: 2, enviadas: 1 });
    const horas = r.por_hora as Array<{ hora: number; recebidas: number }>;
    expect(horas).toHaveLength(24);
    expect(horas.filter((h) => h.recebidas > 0).map((h) => h.hora)).toEqual([9, 10, 14, 15]);
  });

  it("filtros por responsável e por número", () => {
    const soAtendente = relatorio(ADMIN_A, ORG_A, `'${ATENDENTE}', null`).totais as Record<string, number>;
    expect(soAtendente.conversas_ativas).toBe(1);
    const soSuporte = relatorio(ADMIN_A, ORG_A, `null, '${NUM_2}'`).totais as Record<string, number>;
    expect(soSuporte.conversas_ativas).toBe(1);
    expect(soSuporte.mensagens_recebidas).toBe(2);
  });

  it("⭐ isolamento: o admin de B pedindo os números de A recebe zero", () => {
    const r = relatorio(ADMIN_B, ORG_A).totais as Record<string, number>;
    expect(r.conversas_ativas).toBe(0);
    expect(r.mensagens_recebidas).toBe(0);
    const proprios = relatorio(ADMIN_B, ORG_B).totais as Record<string, number>;
    expect(proprios.conversas_ativas).toBe(1);
  });

  it("anon não executa", () => {
    expect(() =>
      sql(`set role anon; select public.fn_relatorio_atendimento('${ORG_A}', '${DE}', '${ATE}');`),
    ).toThrow(/permission denied/);
  });
});
