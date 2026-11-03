import { describe, expect, it, vi } from "vitest";

import { ErroDoProvedor } from "@/lib/cobranca/provedores/contrato";

import { cobrancaDoAviso, hashDoToken, tokenDoAvisoConfere } from "./aviso";
import { centavosParaReais, criarClienteAsaas, linkSeguro, reaisParaCentavos } from "./cliente";
import { camposDaCobranca, urlDoAviso } from "./conexao";
import { estaPaga, podeCancelar, rotuloDoStatus, situacaoDoStatus } from "./status";

const CHAVE_SANDBOX = "$aact_hmlg_000000000000000000000000abcd";
const CHAVE_PROD = "$aact_prod_000000000000000000000000abcd";

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

function cliente(respostas: Array<Response | (() => Response)>, chave = CHAVE_SANDBOX) {
  const chamadas: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    const r = respostas.shift();
    if (!r) throw new Error("sem resposta preparada");
    return typeof r === "function" ? r() : r;
  });
  const c = criarClienteAsaas({ chave, marca: "Produto", fetch: fetch as unknown as typeof globalThis.fetch, esperar: async () => {} });
  return { c, chamadas };
}

const COBRANCA = {
  id: "pay_123",
  customer: "cus_1",
  status: "PENDING",
  billingType: "PIX",
  value: 150.5,
  dueDate: "2026-11-10",
  invoiceUrl: "https://sandbox.asaas.com/i/pay_123",
  bankSlipUrl: null,
};

describe("cliente HTTP do Asaas das empresas", () => {
  it("a chave vai só no header access_token, na base do ambiente da chave", async () => {
    const { c, chamadas } = cliente([resposta(200, { data: [] }), resposta(200, { companyName: "Loja Teste" })]);
    expect(await c.testar()).toEqual({ ok: true, modo: "teste", contaNome: "Loja Teste" });
    expect(chamadas[0]!.url).toBe("https://api-sandbox.asaas.com/v3/customers?limit=1");
    expect(chamadas[0]!.url).not.toContain("aact");
    expect((chamadas[0]!.init.headers as Record<string, string>).access_token).toBe(CHAVE_SANDBOX);
  });

  it("chave de produção vai à base de produção", async () => {
    const { c, chamadas } = cliente([resposta(200, { data: [] }), resposta(200, {})], CHAVE_PROD);
    await c.testar();
    expect(chamadas[0]!.url.startsWith("https://api.asaas.com/v3/")).toBe(true);
  });

  it("chave recusada pelo Asaas vira motivo legível, sem lançar", async () => {
    const { c } = cliente([resposta(401, { errors: [{ code: "invalid_access_token", description: "x" }] })]);
    expect(await c.testar()).toEqual({ ok: false, motivo: "chave_invalida" });
  });

  it("texto que não é chave do Asaas nem chega a sair", async () => {
    const { c, chamadas } = cliente([], "abc");
    expect(await c.testar()).toEqual({ ok: false, motivo: "chave_invalida" });
    expect(chamadas).toHaveLength(0);
  });

  it("garantirCliente reaproveita o cliente achado pela externalReference (= contato)", async () => {
    const { c, chamadas } = cliente([resposta(200, { data: [{ id: "cus_9" }] })]);
    const id = await c.garantirCliente({ id: "contato-1", nome: "Ana", documento: null, email: null, telefone: null });
    expect(id).toBe("cus_9");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toContain("externalReference=contato-1");
  });

  it("cliente novo sem CPF/CNPJ é recusado antes do POST", async () => {
    const { c, chamadas } = cliente([resposta(200, { data: [] })]);
    await expect(
      c.garantirCliente({ id: "contato-1", nome: "Ana", documento: null, email: null, telefone: null }),
    ).rejects.toMatchObject({ codigo: "documento_obrigatorio" });
    expect(chamadas.map((x) => x.init.method)).toEqual(["GET"]);
  });

  it("cliente novo é criado com notificações do Asaas desligadas", async () => {
    const { c, chamadas } = cliente([resposta(200, { data: [] }), resposta(200, { id: "cus_novo" })]);
    const id = await c.garantirCliente({ id: "contato-1", nome: "Ana", documento: "52998224725", email: "a@b.com", telefone: null });
    expect(id).toBe("cus_novo");
    const corpo = JSON.parse(String(chamadas[1]!.init.body));
    expect(corpo).toMatchObject({ name: "Ana", cpfCnpj: "52998224725", externalReference: "contato-1", notificationDisabled: true });
  });

  it("a cobrança vai em reais, com o negócio como referência", async () => {
    const { c, chamadas } = cliente([resposta(200, COBRANCA)]);
    await c.criarCobranca({ clienteId: "cus_1", forma: "PIX", valorCents: 15050, vencimento: "2026-11-10", descricao: null, referencia: "lead-1" });
    expect(JSON.parse(String(chamadas[0]!.init.body))).toEqual({
      customer: "cus_1",
      billingType: "PIX",
      value: 150.5,
      dueDate: "2026-11-10",
      externalReference: "lead-1",
    });
  });

  it("POST NÃO é repetido em 5xx (sem idempotência, repetir cobraria em dobro)", async () => {
    const { c, chamadas } = cliente([resposta(500, {}), resposta(200, COBRANCA)]);
    await expect(
      c.criarCobranca({ clienteId: "cus_1", forma: "PIX", valorCents: 1000, vencimento: "2026-11-10", descricao: null, referencia: "l" }),
    ).rejects.toBeInstanceOf(ErroDoProvedor);
    expect(chamadas).toHaveLength(1);
  });

  it("GET é repetido em 5xx", async () => {
    const { c, chamadas } = cliente([resposta(503, {}), resposta(200, COBRANCA)]);
    expect((await c.lerCobranca("pay_123")).id).toBe("pay_123");
    expect(chamadas).toHaveLength(2);
  });

  it("cancelar uma cobrança que já sumiu (404) não é falha", async () => {
    const { c } = cliente([resposta(404, { errors: [{ code: "not_found" }] })]);
    await expect(c.cancelarCobranca("pay_x")).resolves.toBeUndefined();
  });

  it("aviso recusado pelo Asaas de forma definitiva cai no cadastro manual (null)", async () => {
    const { c } = cliente([resposta(400, { errors: [{ code: "invalid_url" }] })]);
    expect(await c.cadastrarAviso("https://crm.exemplo.com/x", "tok", "a@b.com", "Cobranças")).toBeNull();
  });
});

describe("dinheiro e links", () => {
  it("centavos ↔ reais sem erro de ponto flutuante", () => {
    expect(centavosParaReais(15050)).toBe(150.5);
    expect(reaisParaCentavos(0.1 + 0.2)).toBe(30);
    expect(reaisParaCentavos(150.5)).toBe(15050);
  });

  it("só link https vira href", () => {
    expect(linkSeguro("https://asaas.com/i/1")).toBe("https://asaas.com/i/1");
    expect(linkSeguro("javascript:alert(1)")).toBeNull();
    expect(linkSeguro("http://asaas.com/i/1")).toBeNull();
    expect(linkSeguro(null)).toBeNull();
  });
});

describe("situação da cobrança", () => {
  it.each([
    ["PENDING", "aberta", false, true],
    ["OVERDUE", "vencida", false, true],
    ["RECEIVED", "paga", true, false],
    ["CONFIRMED", "paga", true, false],
    ["RECEIVED_IN_CASH", "paga", true, false],
    ["REFUNDED", "encerrada", false, false],
    ["DELETED", "encerrada", false, false],
    ["STATUS_NOVO_DO_ASAAS", "processando", false, false],
  ] as const)("%s → %s", (status, situacao, paga, cancelavel) => {
    expect(situacaoDoStatus(status)).toBe(situacao);
    expect(estaPaga(status)).toBe(paga);
    expect(podeCancelar(status)).toBe(cancelavel);
  });

  it("status desconhecido tem rótulo, não quebra a tela", () => {
    expect(rotuloDoStatus("PENDING")).toBe("Aguardando pagamento");
    expect(rotuloDoStatus("XYZ")).toBe("Em processamento");
  });

  it("camposDaCobranca marca pago_em só quando está paga", () => {
    expect(camposDaCobranca({ ...COBRANCA, status: "PENDING", paymentDate: "2026-11-05" }).pago_em).toBeNull();
    const paga = camposDaCobranca({ ...COBRANCA, status: "RECEIVED", paymentDate: "2026-11-05" });
    expect(paga.pago_em).toBe("2026-11-05T12:00:00-03:00");
    expect(paga.valor_cents).toBe(15050);
    expect(camposDaCobranca({ ...COBRANCA, deleted: true }).status).toBe("DELETED");
  });
});

describe("aviso de pagamento", () => {
  it("o token confere contra o hash gravado, e só ele", () => {
    const hash = hashDoToken("segredo-do-aviso");
    expect(tokenDoAvisoConfere("segredo-do-aviso", hash)).toBe(true);
    expect(tokenDoAvisoConfere("outro", hash)).toBe(false);
    expect(tokenDoAvisoConfere(null, hash)).toBe(false);
    expect(tokenDoAvisoConfere("segredo-do-aviso", "não-é-hash")).toBe(false);
  });

  it("o corpo é só ponteiro: evento + id da cobrança", () => {
    expect(cobrancaDoAviso(JSON.stringify({ id: "evt_1", event: "PAYMENT_RECEIVED", payment: { id: "pay_1", value: 999 } }))).toEqual({
      evento: "PAYMENT_RECEIVED",
      cobrancaId: "pay_1",
    });
    expect(cobrancaDoAviso("não é json")).toBeNull();
    expect(cobrancaDoAviso(JSON.stringify({ event: "SUBSCRIPTION_CREATED" }))).toBeNull();
  });

  it("o endereço do aviso exige https público", () => {
    const id = "6f1d5b0e-6a8c-4c0e-9f0a-1b2c3d4e5f60";
    expect(urlDoAviso(id, "https://crm.minhaempresa.com.br/")).toBe(`https://crm.minhaempresa.com.br/api/v1/webhooks/asaas-clientes/${id}`);
    expect(urlDoAviso(id, "http://crm.minhaempresa.com.br")).toBeNull();
    expect(urlDoAviso(id, "https://localhost:3000")).toBeNull();
    expect(urlDoAviso(id, "")).toBeNull();
  });
});
