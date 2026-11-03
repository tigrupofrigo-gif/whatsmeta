"use client";
/**
 * Dados do Asaas da empresa (WhatsMeta): a conexão (Configurações › Asaas) e as
 * cobranças de um negócio (dossiê do negócio).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface EstadoDaConexaoAsaas {
  conectado: boolean;
  modo?: "producao" | "teste";
  chave_final?: string;
  conta_nome?: string | null;
  aviso?: { url: string | null; cadastrado: boolean };
  atualizado_em?: string;
  aviso_manual?: { url: string; token: string } | null;
}

export interface CobrancaAsaas {
  id: string;
  lead_id: string | null;
  contact_id: string | null;
  asaas_payment_id: string;
  forma: "PIX" | "BOLETO" | "CREDIT_CARD" | "UNDEFINED";
  valor_cents: number;
  moeda: string;
  vencimento: string;
  descricao: string | null;
  status: string;
  link_pagamento: string | null;
  boleto_url: string | null;
  pago_em: string | null;
  modo: "producao" | "teste";
  created_at: string;
  pix_copia_e_cola?: string | null;
}

export interface NovaCobrancaAsaas {
  lead_id: string;
  forma: CobrancaAsaas["forma"];
  valor_cents: number;
  vencimento: string;
  descricao?: string | null;
  documento?: string | null;
}

const CHAVE_DA_CONEXAO = ["asaas", "conexao"] as const;
const chaveDasCobrancas = (leadId: string) => ["asaas", "cobrancas", leadId] as const;

export function useConexaoAsaas() {
  return useQuery({
    queryKey: CHAVE_DA_CONEXAO,
    queryFn: async () => apiClient.get<{ data: EstadoDaConexaoAsaas }>("/api/v1/integrations/asaas"),
    select: (res) => res.data,
  });
}

export function useConectarAsaas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chave: string) =>
      (await apiClient.put<{ data: EstadoDaConexaoAsaas }>("/api/v1/integrations/asaas", { chave })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE_DA_CONEXAO }),
  });
}

export function useDesconectarAsaas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => apiClient.delete<{ data: { conectado: false } }>("/api/v1/integrations/asaas"),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE_DA_CONEXAO }),
  });
}

export function useCobrancasAsaasDoLead(leadId: string) {
  return useQuery({
    queryKey: chaveDasCobrancas(leadId),
    queryFn: async () =>
      apiClient.get<{ data: { conectado: boolean; cobrancas: CobrancaAsaas[] } }>(
        `/api/v1/integrations/asaas/cobrancas?lead_id=${leadId}`,
      ),
    select: (res) => res.data,
  });
}

export function useCriarCobrancaAsaas(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nova: NovaCobrancaAsaas) =>
      (await apiClient.post<{ data: CobrancaAsaas }>("/api/v1/integrations/asaas/cobrancas", nova)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: chaveDasCobrancas(leadId) }),
  });
}

/** Relê no Asaas: atualiza a situação e traz o Pix copia e cola. */
export function useAtualizarCobrancaAsaas(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await apiClient.get<{ data: CobrancaAsaas }>(`/api/v1/integrations/asaas/cobrancas/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: chaveDasCobrancas(leadId) }),
  });
}

export function useCancelarCobrancaAsaas(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await apiClient.delete<{ data: CobrancaAsaas }>(`/api/v1/integrations/asaas/cobrancas/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: chaveDasCobrancas(leadId) }),
  });
}
