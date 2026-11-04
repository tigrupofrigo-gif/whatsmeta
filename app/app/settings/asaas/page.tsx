import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { ConexaoAsaas } from "./_components/ConexaoAsaas";

export const dynamic = "force-dynamic";
export const metadata = { title: "Asaas" };

/**
 * Configurações › Asaas (WhatsMeta): a empresa conecta a PRÓPRIA conta do
 * Asaas para cobrar os clientes (Pix, boleto, cartão) a partir dos negócios do
 * funil. Só `admin` — a chave movimenta dinheiro da empresa.
 */
export default async function AsaasPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Asaas</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Conecte a conta do Asaas da sua empresa para cobrar seus clientes por Pix, boleto ou cartão direto dos negócios do funil. O pagamento é confirmado aqui automaticamente.",
            idioma,
          )}
        </p>
      </header>
      <ConexaoAsaas />
    </div>
  );
}
