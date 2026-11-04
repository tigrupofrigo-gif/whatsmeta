/**
 * O CLIENTE HTTP do Asaas para as cobranças que cada EMPRESA faz aos próprios
 * clientes (WhatsMeta). É a outra ponta do adaptador da cobrança da plataforma
 * (`lib/cobranca/provedores/asaas.ts`), e herda dele as regras de segurança:
 *
 * - A chave vai SÓ no header `access_token`: nunca em query string, log,
 *   mensagem de erro, audit ou Sentry. O erro leva o status HTTP e o `code` do
 *   Asaas (`erroDoAsaas`), nunca a `description`, que pode ecoar dado do pagador.
 * - O ambiente (produção ou sandbox) sai do PREFIXO da chave (`modoDaChaveAsaas`):
 *   a chave de um ambiente nunca é enviada à base do outro.
 * - O Asaas não aceita chave de idempotência. GET e DELETE repetem em 429, 5xx e
 *   rede; POST repete só em 429 (recusado antes de processar). O cliente do
 *   Asaas é procurado pela `externalReference` (= id do contato) antes de criar.
 * - Toda resposta passa por Zod lendo só o que é usado.
 */
import { randomBytes } from "node:crypto";

import { z } from "zod";

import { ASAAS_API_BASE, erroDoAsaas, modoDaChaveAsaas } from "@/lib/cobranca/provedores/asaas";
import { ErroDoProvedor, type Modo } from "@/lib/cobranca/provedores/contrato";
import { logger } from "@/lib/logger";

const TENTATIVAS = 3;
const ESPERA_MAXIMA_MS = 5_000;
const TEMPO_LIMITE_MS = 20_000;

/** As formas de pagamento que a tela oferece. `UNDEFINED` = o cliente escolhe na fatura. */
export const FORMAS_DE_PAGAMENTO = ["PIX", "BOLETO", "CREDIT_CARD", "UNDEFINED"] as const;
export type FormaDePagamento = (typeof FORMAS_DE_PAGAMENTO)[number];

/** Os avisos que acordam a releitura da cobrança. O corpo do aviso é só ponteiro. */
export const EVENTOS_DAS_COBRANCAS = [
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_RESTORED",
  "PAYMENT_REFUNDED",
  "PAYMENT_RECEIVED_IN_CASH_UNDONE",
  "PAYMENT_CHARGEBACK_REQUESTED",
] as const;

const comId = z.object({ id: z.string().min(1), deleted: z.boolean().nullish() });
const lista = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) });

const cobrancaDoAsaas = z.object({
  id: z.string().min(1),
  customer: z.string().min(1),
  status: z.string().min(1).max(64),
  billingType: z.string(),
  value: z.number(),
  dueDate: z.string(),
  description: z.string().nullish(),
  invoiceUrl: z.string().nullish(),
  bankSlipUrl: z.string().nullish(),
  paymentDate: z.string().nullish(),
  clientPaymentDate: z.string().nullish(),
  confirmedDate: z.string().nullish(),
  deleted: z.boolean().nullish(),
});
export type CobrancaDoAsaas = z.infer<typeof cobrancaDoAsaas>;

const pixDoAsaas = z.object({ payload: z.string().min(1), encodedImage: z.string().nullish() });
const contaDoAsaas = z.object({ companyName: z.string().nullish(), name: z.string().nullish() }).passthrough();

export interface DependenciasDoClienteAsaas {
  /** A chave em claro, já aberta pelo chamador. */
  chave: string;
  fetch?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
  /** Nome do produto, que vai no User-Agent. */
  marca: string;
}

function ler<T>(schema: z.ZodType<T>, dados: unknown): T {
  const lido = schema.safeParse(dados);
  if (!lido.success) throw new ErroDoProvedor(200, "resposta_invalida", false);
  return lido.data;
}

function espera(tentativa: number, pedida: string | null): number {
  const ms = pedida !== null && /^\d+$/.test(pedida) ? Number(pedida) * 1000 : 500 * 2 ** (tentativa - 1);
  return Math.min(ms, ESPERA_MAXIMA_MS);
}

/** Link do provedor que vira href: só https. Uma resposta adulterada com `javascript:` nunca chega à tela. */
export function linkSeguro(u: string | null | undefined): string | null {
  if (!u || !URL.canParse(u)) return null;
  return new URL(u).protocol === "https:" ? u : null;
}

/** Centavos → reais com duas casas, que é o que o Asaas recebe em `value`. */
export function centavosParaReais(cents: number): number {
  return Math.round(cents) / 100;
}

/** Reais (número do Asaas) → centavos inteiros, sem o erro de ponto flutuante. */
export function reaisParaCentavos(reais: number): number {
  return Math.round(reais * 100);
}

/** O token do aviso de pagamento: 32 bytes aleatórios, gerados por nós. */
export function novoTokenDoAviso(): string {
  return randomBytes(32).toString("base64url");
}

export function criarClienteAsaas(dep: DependenciasDoClienteAsaas) {
  const modo: Modo | null = modoDaChaveAsaas(dep.chave);
  const buscar = dep.fetch ?? fetch;
  const esperar = dep.esperar ?? ((ms: number) => new Promise<void>((pronto) => setTimeout(pronto, ms)));
  const userAgent = `cobrancas-de-clientes/${dep.marca}`;

  async function chamar(metodo: "GET" | "POST" | "PUT" | "DELETE", caminho: string, corpo?: Record<string, unknown>): Promise<unknown> {
    if (modo === null) throw new ErroDoProvedor(null, "chave_invalida", false, true);
    const base = ASAAS_API_BASE[modo];
    const headers: Record<string, string> = { access_token: dep.chave, "user-agent": userAgent, accept: "application/json" };
    const body = corpo === undefined ? undefined : JSON.stringify(corpo);
    if (body !== undefined) headers["content-type"] = "application/json";
    for (let tentativa = 1; ; tentativa += 1) {
      let erro: ErroDoProvedor;
      let pedida: string | null = null;
      try {
        const r = await buscar(`${base}${caminho}`, {
          method: metodo,
          headers,
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        });
        if (r.ok) {
          return await r.json().catch(() => {
            throw new ErroDoProvedor(r.status, "resposta_invalida", false);
          });
        }
        erro = erroDoAsaas(r.status, await r.json().catch(() => null));
        pedida = r.headers.get("retry-after");
      } catch (e) {
        if (e instanceof ErroDoProvedor) throw e;
        erro = new ErroDoProvedor(null, "sem_resposta", true);
      }
      const repetivel = metodo === "POST" ? erro.status === 429 : erro.transitorio;
      if (!(tentativa < TENTATIVAS && repetivel)) throw erro;
      logger.warn("asaas_clientes.nova_tentativa", { status: erro.status, codigo: erro.codigo, tentativa });
      await esperar(espera(tentativa, pedida));
    }
  }

  return {
    modo,

    /** A chave autentica? Devolve o nome da conta quando o Asaas o informa. */
    async testar(): Promise<{ ok: true; modo: Modo; contaNome: string | null } | { ok: false; motivo: string }> {
      if (modo === null) return { ok: false, motivo: "chave_invalida" };
      try {
        ler(lista(z.unknown()), await chamar("GET", "/customers?limit=1"));
      } catch (e) {
        if (!(e instanceof ErroDoProvedor)) throw e;
        if (e.status === 401) return { ok: false, motivo: "chave_invalida" };
        if (e.status === 403) return { ok: false, motivo: "sem_permissao" };
        return { ok: false, motivo: "provedor_fora" };
      }
      let contaNome: string | null = null;
      try {
        const conta = ler(contaDoAsaas, await chamar("GET", "/myAccount/commercialInfo"));
        contaNome = conta.companyName ?? conta.name ?? null;
      } catch {
        // O nome é cortesia da tela: a chave já provou que serve.
      }
      return { ok: true, modo, contaNome };
    },

    /**
     * O cliente do Asaas deste contato: procura pela `externalReference` antes de
     * criar (cura o clique repetido). O documento só é exigido para CRIAR; um
     * cliente já existente sem documento recebe o informado.
     */
    async garantirCliente(contato: {
      id: string;
      nome: string;
      documento: string | null;
      email: string | null;
      telefone: string | null;
    }): Promise<string> {
      const consulta = new URLSearchParams({ externalReference: contato.id, limit: "10" });
      const achado = ler(lista(comId), await chamar("GET", `/customers?${consulta}`)).data.find((c) => c.deleted !== true);
      if (achado) {
        if (contato.documento) {
          await chamar("PUT", `/customers/${encodeURIComponent(achado.id)}`, { cpfCnpj: contato.documento });
        }
        return achado.id;
      }
      if (!contato.documento) throw new ErroDoProvedor(null, "documento_obrigatorio", false);
      return ler(
        comId,
        await chamar("POST", "/customers", {
          name: contato.nome,
          cpfCnpj: contato.documento,
          email: contato.email ?? undefined,
          mobilePhone: contato.telefone ?? undefined,
          externalReference: contato.id,
          // O aviso ao pagador sai pelo WhatsApp da empresa, com a marca dela.
          notificationDisabled: true,
        }),
      ).id;
    },

    async criarCobranca(dados: {
      clienteId: string;
      forma: FormaDePagamento;
      valorCents: number;
      vencimento: string;
      descricao: string | null;
      referencia: string;
    }): Promise<CobrancaDoAsaas> {
      return ler(
        cobrancaDoAsaas,
        await chamar("POST", "/payments", {
          customer: dados.clienteId,
          billingType: dados.forma,
          value: centavosParaReais(dados.valorCents),
          dueDate: dados.vencimento,
          description: dados.descricao ?? undefined,
          externalReference: dados.referencia,
        }),
      );
    },

    async lerCobranca(id: string): Promise<CobrancaDoAsaas> {
      return ler(cobrancaDoAsaas, await chamar("GET", `/payments/${encodeURIComponent(id)}`));
    },

    /** 404 é o efeito desejado (já apagada): não é falha. */
    async cancelarCobranca(id: string): Promise<void> {
      try {
        await chamar("DELETE", `/payments/${encodeURIComponent(id)}`);
      } catch (e) {
        if (!(e instanceof ErroDoProvedor && e.status === 404)) throw e;
      }
    },

    /** O "Pix copia e cola" da cobrança. `null` quando a forma não é Pix ou o Asaas não gerou. */
    async pixCopiaECola(id: string): Promise<string | null> {
      try {
        return ler(pixDoAsaas, await chamar("GET", `/payments/${encodeURIComponent(id)}/pixQrCode`)).payload;
      } catch (e) {
        if (e instanceof ErroDoProvedor && !e.transitorio) return null;
        throw e;
      }
    },

    /**
     * Cadastra o aviso de pagamento desta empresa. Recusa definitiva (conta sem
     * webhook por API, limite, URL recusada) volta `null`: a tela mostra URL e
     * token para o cadastro manual, com o MESMO token.
     */
    async cadastrarAviso(url: string, token: string, email: string, nome: string): Promise<string | null> {
      try {
        return ler(
          comId,
          await chamar("POST", "/webhooks", {
            name: nome,
            url,
            email,
            enabled: true,
            interrupted: false,
            apiVersion: 3,
            sendType: "SEQUENTIALLY",
            authToken: token,
            events: [...EVENTOS_DAS_COBRANCAS],
          }),
        ).id;
      } catch (e) {
        const definitiva = e instanceof ErroDoProvedor && !e.transitorio && e.status !== null && e.status >= 400 && e.status !== 401;
        if (!definitiva) throw e;
        logger.warn("asaas_clientes.aviso_manual", { status: e.status, codigo: e.codigo });
        return null;
      }
    },

    /** Remove o aviso desta empresa no Asaas. 404 = já removido. */
    async removerAviso(id: string): Promise<void> {
      try {
        await chamar("DELETE", `/webhooks/${encodeURIComponent(id)}`);
      } catch (e) {
        if (!(e instanceof ErroDoProvedor && e.status === 404)) throw e;
      }
    },
  };
}

export type ClienteAsaas = ReturnType<typeof criarClienteAsaas>;
