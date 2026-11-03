/**
 * O AVISO de pagamento do Asaas — conferência do token e leitura do ponteiro.
 * Server-only (`node:crypto`); a parte que a tela usa mora em `./status`.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/** sha256 hex do token do aviso — é só isto que o banco guarda. */
export function hashDoToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const eventoDoAviso = z.object({
  id: z.string().min(1).max(100).optional(),
  event: z.string().regex(/^[A-Z_]{1,64}$/),
  payment: z.object({ id: z.string().min(1).max(100) }).nullish(),
});

/**
 * Confere o `asaas-access-token` contra o hash gravado, em tempo constante
 * (compara os dois sha256: tamanho sempre igual). Nunca lança. `null` = recusa.
 */
export function tokenDoAvisoConfere(recebido: string | null, hashGravado: string): boolean {
  if (!recebido || !/^[0-9a-f]{64}$/.test(hashGravado)) return false;
  const a = Buffer.from(hashDoToken(recebido), "hex");
  const b = Buffer.from(hashGravado, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * O corpo do aviso é só PONTEIRO: o id da cobrança a reler. Forma inesperada
 * (aviso de outro tipo, sem pagamento) devolve `null` e a rota responde 200
 * sem efeito — recusar faria o Asaas pausar a fila de avisos.
 */
export function cobrancaDoAviso(corpoCru: string): { evento: string; cobrancaId: string } | null {
  let json: unknown;
  try {
    json = JSON.parse(corpoCru);
  } catch {
    return null;
  }
  const lido = eventoDoAviso.safeParse(json);
  if (!lido.success || !lido.data.payment) return null;
  return { evento: lido.data.event, cobrancaId: lido.data.payment.id };
}
