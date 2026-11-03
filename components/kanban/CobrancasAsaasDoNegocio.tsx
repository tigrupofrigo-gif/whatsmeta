"use client";
/**
 * WhatsMeta — seção "Cobranças (Asaas)" do dossiê do negócio, depois de
 * "Propostas". Cria a cobrança no Asaas da empresa para o contato do negócio,
 * mostra o link e o Pix copia e cola prontos para mandar pelo WhatsApp, e a
 * situação de cada uma (o aviso do Asaas marca "Pago" sozinho).
 *
 * Erro de leitura: a seção some em vez de quebrar o dossiê.
 */
import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useAtualizarCobrancaAsaas,
  useCancelarCobrancaAsaas,
  useCobrancasAsaasDoLead,
  useCriarCobrancaAsaas,
  type CobrancaAsaas,
} from "@/hooks/asaas/useAsaas";
import { useT } from "@/hooks/i18n/useT";
import { ROTULO_DA_FORMA, podeCancelar, rotuloDoStatus, situacaoDoStatus } from "@/lib/asaas-clientes/status";
import { copyToClipboard } from "@/lib/clipboard";
import { formatCents } from "@/lib/money";

interface Props {
  leadId: string;
  /** Criar e cancelar é `agent`+, a mesma régua da rota. */
  podeCobrar: boolean;
  /** Só quem administra conecta o Asaas: para os outros, o aviso não é um link. */
  podeConectar: boolean;
}

const COR_DA_SITUACAO = {
  aberta: "neutral",
  vencida: "warning",
  paga: "success",
  encerrada: "neutral",
  processando: "neutral",
} as const;

function dataBR(iso: string): string {
  return iso.slice(0, 10).split("-").reverse().join("/");
}

function daquiA(dias: number): string {
  const d = new Date(Date.now() + dias * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

/** "R$ 1.234,56" digitado do jeito brasileiro → centavos. */
function centavosDoTexto(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.]/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function mensagemDoErro(e: unknown, padrao: string): string {
  return e instanceof Error && e.message ? e.message : padrao;
}

export function CobrancasAsaasDoNegocio({ leadId, podeCobrar, podeConectar }: Props): React.ReactElement | null {
  const t = useT();
  const { data, isLoading, isError } = useCobrancasAsaasDoLead(leadId);
  const criar = useCriarCobrancaAsaas(leadId);
  const atualizar = useAtualizarCobrancaAsaas(leadId);
  const cancelar = useCancelarCobrancaAsaas(leadId);

  const [abrindo, setAbrindo] = useState(false);
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(daquiA(3));
  const [forma, setForma] = useState<CobrancaAsaas["forma"]>("PIX");
  const [descricao, setDescricao] = useState("");
  const [documento, setDocumento] = useState("");
  const [pix, setPix] = useState<Record<string, string>>({});

  if (isError) return null;

  const cobrancas = data?.cobrancas ?? [];

  const mensagemParaWhatsApp = (c: CobrancaAsaas) => {
    const partes = [
      t("Olá! Segue a cobrança no valor de") + ` ${formatCents(c.valor_cents, c.moeda)}, ` + t("com vencimento em") + ` ${dataBR(c.vencimento)}.`,
    ];
    if (c.link_pagamento) partes.push(`${t("Pague por aqui:")} ${c.link_pagamento}`);
    if (pix[c.id]) partes.push(`${t("Ou use o Pix copia e cola:")} ${pix[c.id]}`);
    return partes.join("\n\n");
  };

  const copiar = async (texto: string, aviso: string) => {
    if (await copyToClipboard(texto)) toast.success(aviso);
  };

  const enviar = () => {
    const valorCents = centavosDoTexto(valor);
    if (valorCents === null) {
      toast.error(t("Informe um valor válido."));
      return;
    }
    criar.mutate(
      {
        lead_id: leadId,
        forma,
        valor_cents: valorCents,
        vencimento,
        descricao: descricao.trim() || null,
        documento: documento.trim() || null,
      },
      {
        onSuccess: (nova) => {
          if (nova.pix_copia_e_cola) setPix((p) => ({ ...p, [nova.id]: nova.pix_copia_e_cola! }));
          setAbrindo(false);
          setValor("");
          setDescricao("");
          setDocumento("");
          toast.success(t("Cobrança criada no Asaas."));
        },
        onError: (e) => toast.error(mensagemDoErro(e, t("Não foi possível criar a cobrança."))),
      },
    );
  };

  return (
    <div className="border-t border-border pt-3" data-testid="cobrancas-asaas">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">{t("Cobranças (Asaas)")}</h3>
      {isLoading && <p className="text-xs text-text-muted">{t("Carregando…")}</p>}

      {!isLoading && data && !data.conectado && cobrancas.length === 0 && (
        <p className="text-xs text-text-muted">
          {podeConectar ? (
            <>
              {t("O Asaas ainda não está conectado.")}{" "}
              <Link href="/app/settings/asaas" className="font-medium text-accent hover:underline">
                {t("Conectar agora")}
              </Link>
            </>
          ) : (
            t("O Asaas ainda não está conectado. Peça a um administrador para conectar em Configurações › Asaas.")
          )}
        </p>
      )}

      {!isLoading && data?.conectado && cobrancas.length === 0 && !abrindo && (
        <p className="text-xs text-text-muted">{t("Nenhuma cobrança ainda")}</p>
      )}

      {cobrancas.length > 0 && (
        <ul className="space-y-2">
          {cobrancas.map((c) => {
            const situacao = situacaoDoStatus(c.status);
            const aberta = podeCancelar(c.status);
            return (
              <li key={c.id} className="rounded-md border border-border p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{formatCents(c.valor_cents, c.moeda)}</span>
                  <Badge variant={COR_DA_SITUACAO[situacao]}>{t(rotuloDoStatus(c.status))}</Badge>
                </div>
                <div className="mt-0.5 text-text-muted">
                  {t(ROTULO_DA_FORMA[c.forma] ?? c.forma)} · {t("vence")} {dataBR(c.vencimento)}
                  {c.pago_em ? ` · ${t("pago em")} ${dataBR(c.pago_em)}` : ""}
                  {c.modo === "teste" ? ` · ${t("sandbox")}` : ""}
                </div>
                {c.descricao && <div className="mt-0.5 truncate">{c.descricao}</div>}
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  {aberta && (
                    <button
                      type="button"
                      className="font-medium text-accent hover:underline"
                      onClick={() => copiar(mensagemParaWhatsApp(c), t("Mensagem copiada. Cole na conversa do WhatsApp."))}
                    >
                      {t("Copiar mensagem p/ WhatsApp")}
                    </button>
                  )}
                  {c.link_pagamento && (
                    <a href={c.link_pagamento} target="_blank" rel="noreferrer noopener" className="hover:underline">
                      {t("Abrir fatura")}
                    </a>
                  )}
                  {pix[c.id] && aberta && (
                    <button type="button" className="hover:underline" onClick={() => copiar(pix[c.id]!, t("Pix copia e cola copiado."))}>
                      {t("Copiar Pix")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="hover:underline disabled:opacity-50"
                    disabled={atualizar.isPending}
                    onClick={() =>
                      atualizar.mutate(c.id, {
                        onSuccess: (lida) => {
                          if (lida.pix_copia_e_cola) setPix((p) => ({ ...p, [c.id]: lida.pix_copia_e_cola! }));
                        },
                        onError: (e) => toast.error(mensagemDoErro(e, t("Não foi possível atualizar."))),
                      })
                    }
                  >
                    {t("Atualizar")}
                  </button>
                  {aberta && podeCobrar && (
                    <button
                      type="button"
                      className="text-error-fg hover:underline disabled:opacity-50"
                      disabled={cancelar.isPending}
                      onClick={() => {
                        if (!window.confirm(t("Cancelar esta cobrança no Asaas? O link de pagamento deixa de funcionar."))) return;
                        cancelar.mutate(c.id, {
                          onSuccess: () => toast.success(t("Cobrança cancelada.")),
                          onError: (e) => toast.error(mensagemDoErro(e, t("Não foi possível cancelar."))),
                        });
                      }}
                    >
                      {t("Cancelar")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data?.conectado && podeCobrar && !abrindo && (
        <button
          type="button"
          onClick={() => setAbrindo(true)}
          className="mt-2 inline-block text-xs font-medium text-accent hover:underline"
        >
          {t("Nova cobrança")}
        </button>
      )}

      {abrindo && (
        <div className="mt-2 space-y-2 rounded-md border border-border p-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="asaas-valor" className="text-xs">{t("Valor (R$)")}</Label>
              <Input id="asaas-valor" inputMode="decimal" placeholder="150,00" value={valor} onChange={(e) => setValor(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="asaas-vencimento" className="text-xs">{t("Vencimento")}</Label>
              <Input id="asaas-vencimento" type="date" min={daquiA(0)} value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="asaas-forma" className="text-xs">{t("Forma de pagamento")}</Label>
            <select
              id="asaas-forma"
              className="h-9 w-full rounded-md border border-border bg-transparent px-2 text-sm"
              value={forma}
              onChange={(e) => setForma(e.target.value as CobrancaAsaas["forma"])}
            >
              <option value="PIX">{t("Pix")}</option>
              <option value="BOLETO">{t("Boleto")}</option>
              <option value="CREDIT_CARD">{t("Cartão de crédito")}</option>
              <option value="UNDEFINED">{t("Cliente escolhe (Pix, boleto ou cartão)")}</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="asaas-descricao" className="text-xs">{t("Descrição (aparece na fatura)")}</Label>
            <Input id="asaas-descricao" maxLength={500} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="asaas-documento" className="text-xs">{t("CPF ou CNPJ do cliente")}</Label>
            <Input id="asaas-documento" inputMode="numeric" value={documento} onChange={(e) => setDocumento(e.target.value)} />
            <p className="text-[11px] text-text-muted">{t("Obrigatório na primeira cobrança deste cliente; depois o Asaas já tem.")}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={criar.isPending} onClick={enviar}>
              {criar.isPending ? t("Criando…") : t("Criar cobrança")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAbrindo(false)}>
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
