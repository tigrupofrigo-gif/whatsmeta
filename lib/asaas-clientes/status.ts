/**
 * O que cada status do Asaas QUER DIZER para quem cobra — puro, sem rede.
 *
 * O vocabulário é do provedor e aberto (o banco não tem CHECK): status que o
 * Asaas inventar amanhã aparece como "Em processamento" em vez de quebrar a tela.
 */
/** Dinheiro na conta (ou cartão aprovado). */
const PAGOS = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
/** Nada mais acontece com esta cobrança. */
const ENCERRADOS = new Set(["REFUNDED", "DELETED", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE"]);

export type SituacaoDaCobranca = "aberta" | "vencida" | "paga" | "encerrada" | "processando";

export function situacaoDoStatus(status: string): SituacaoDaCobranca {
  if (PAGOS.has(status)) return "paga";
  if (ENCERRADOS.has(status)) return "encerrada";
  if (status === "OVERDUE") return "vencida";
  if (status === "PENDING") return "aberta";
  return "processando";
}

export function estaPaga(status: string): boolean {
  return PAGOS.has(status);
}

/** Cancelar só faz sentido no que ainda pode ser pago. */
export function podeCancelar(status: string): boolean {
  return status === "PENDING" || status === "OVERDUE";
}

/** Rótulo em português (chave do dicionário `t()`). */
export const ROTULO_DO_STATUS: Record<string, string> = {
  PENDING: "Aguardando pagamento",
  RECEIVED: "Pago",
  CONFIRMED: "Pago (confirmado)",
  RECEIVED_IN_CASH: "Pago em dinheiro",
  OVERDUE: "Vencida",
  REFUNDED: "Estornada",
  REFUND_REQUESTED: "Estorno solicitado",
  REFUND_IN_PROGRESS: "Estorno em andamento",
  CHARGEBACK_REQUESTED: "Contestada",
  CHARGEBACK_DISPUTE: "Em disputa",
  AWAITING_CHARGEBACK_REVERSAL: "Aguardando reversão",
  DUNNING_REQUESTED: "Em negativação",
  DUNNING_RECEIVED: "Recuperada",
  AWAITING_RISK_ANALYSIS: "Em análise",
  DELETED: "Cancelada",
};

export function rotuloDoStatus(status: string): string {
  return ROTULO_DO_STATUS[status] ?? "Em processamento";
}

export const ROTULO_DA_FORMA: Record<string, string> = {
  PIX: "Pix",
  BOLETO: "Boleto",
  CREDIT_CARD: "Cartão de crédito",
  UNDEFINED: "Cliente escolhe",
};
