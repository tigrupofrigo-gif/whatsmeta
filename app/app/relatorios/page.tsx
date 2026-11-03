import type { Metadata } from "next";

import { requireAuth } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";

import { RelatoriosClient } from "./_components/RelatoriosClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relatórios de atendimento" };

/**
 * Relatórios de atendimento (WhatsMeta): os indicadores do período por
 * responsável, número de WhatsApp, fila, dia e hora. Quem gerencia vê a
 * empresa inteira e filtra por pessoa; o atendente vê só as próprias conversas
 * (a rota força o filtro e a RLS confirma).
 */
export default async function RelatoriosPage() {
  const user = await requireAuth();
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex h-full flex-col gap-6 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Relatórios de atendimento")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Volume, tempo de resposta e fila do atendimento, por responsável, número de WhatsApp e período.")}
        </p>
      </header>
      <RelatoriosClient />
    </div>
  );
}
