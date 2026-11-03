import Link from "next/link";
import { redirect } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";
export const metadata = { title: "Canais do WhatsApp" };

/**
 * Configurações › Canais do WhatsApp (WhatsMeta).
 *
 * A porta, em Configurações, para os DOIS jeitos de ligar um número: a API
 * oficial da Meta e a conexão não oficial por QR Code. A conexão em si continua
 * morando em Conexões (um lugar só para conectar, ver a saúde e reconectar);
 * esta página explica a diferença e leva à aba certa. Mesma régua de Conexões:
 * só `admin`.
 */
export default async function CanaisPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const t = (texto: string) => traduzir(texto, user.idioma);

  const opcoes = [
    {
      href: "/app/connections?aba=oficial",
      titulo: t("API oficial (Meta)"),
      selo: t("Recomendada para volume e campanhas"),
      pontos: [
        t("Número verificado pela Meta, sem risco de bloqueio por uso de aparelho."),
        t("Mensagens fora da janela de 24 horas só com modelos aprovados pela Meta."),
        t("Exige conta no Gerenciador de Negócios da Meta; a Meta cobra por conversa."),
      ],
      acao: t("Configurar API oficial"),
    },
    {
      href: "/app/connections",
      titulo: t("Não oficial (QR Code)"),
      selo: t("Mais rápida para começar"),
      pontos: [
        t("Conecta o WhatsApp do celular lendo um QR Code, em um minuto."),
        t("Sem custo por mensagem e sem modelos aprovados."),
        t("O número pode ser bloqueado pelo WhatsApp se houver abuso; o sistema já limita o ritmo de envio."),
      ],
      acao: t("Conectar por QR Code"),
    },
  ];

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Canais do WhatsApp")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Escolha como cada número da empresa se conecta. Dá para usar os dois ao mesmo tempo, em números diferentes.")}
        </p>
      </header>
      <div className="grid max-w-4xl gap-4 md:grid-cols-2">
        {opcoes.map((o) => (
          <section key={o.href} className="flex flex-col gap-3 rounded-lg border border-border p-5">
            <div>
              <h2 className="text-lg font-semibold">{o.titulo}</h2>
              <p className="text-xs font-medium text-accent">{o.selo}</p>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {o.pontos.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <Link
              href={o.href}
              className={`${buttonVariants()} mt-auto w-fit`}
            >
              {o.acao}
            </Link>
          </section>
        ))}
      </div>
      <p className="max-w-4xl text-sm text-muted-foreground">
        {t("Depois de conectado, cada número aparece em Conexões com a saúde da conexão, e as conversas chegam na Inbox do mesmo jeito, venham de um canal ou do outro.")}
      </p>
    </div>
  );
}
