"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useConectarAsaas,
  useConexaoAsaas,
  useDesconectarAsaas,
  type EstadoDaConexaoAsaas,
} from "@/hooks/asaas/useAsaas";
import { useT } from "@/hooks/i18n/useT";
import { copyToClipboard } from "@/lib/clipboard";

function mensagemDoErro(e: unknown, padrao: string): string {
  return e instanceof Error && e.message ? e.message : padrao;
}

function CampoCopiavel({ rotulo, valor }: { rotulo: string; valor: string }) {
  const t = useT();
  return (
    <div className="space-y-1">
      <Label>{rotulo}</Label>
      <div className="flex gap-2">
        <Input readOnly value={valor} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            if (await copyToClipboard(valor)) toast.success(t("Copiado."));
          }}
        >
          {t("Copiar")}
        </Button>
      </div>
    </div>
  );
}

export function ConexaoAsaas() {
  const t = useT();
  const { data: conexao, isLoading } = useConexaoAsaas();
  const conectar = useConectarAsaas();
  const desconectar = useDesconectarAsaas();
  const [chave, setChave] = useState("");
  const [trocando, setTrocando] = useState(false);
  const [manual, setManual] = useState<EstadoDaConexaoAsaas["aviso_manual"]>(null);

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;

  const salvar = () => {
    conectar.mutate(chave.trim(), {
      onSuccess: (estado) => {
        setChave("");
        setTrocando(false);
        setManual(estado.aviso_manual ?? null);
        if (estado.aviso_manual) {
          toast.warning(t("Conectado. Falta um passo: cadastre o aviso de pagamento no Asaas (veja abaixo)."));
        } else {
          toast.success(t("Asaas conectado."));
        }
      },
      onError: (e) => toast.error(mensagemDoErro(e, t("Não foi possível conectar o Asaas."))),
    });
  };

  const mostrarFormulario = !conexao?.conectado || trocando;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {conexao?.conectado && (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{t("Conta conectada")}</h2>
            <Badge variant={conexao.modo === "producao" ? "success" : "warning"}>
              {conexao.modo === "producao" ? t("Produção") : t("Sandbox (teste)")}
            </Badge>
          </div>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            {conexao.conta_nome && (
              <>
                <dt className="text-muted-foreground">{t("Conta")}</dt>
                <dd>{conexao.conta_nome}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{t("Chave")}</dt>
            <dd className="font-mono">••••{conexao.chave_final}</dd>
            <dt className="text-muted-foreground">{t("Aviso de pagamento")}</dt>
            <dd>
              {conexao.aviso?.cadastrado
                ? t("Cadastrado automaticamente no Asaas")
                : conexao.aviso?.url
                  ? t("Pendente: cadastre no painel do Asaas")
                  : t("Indisponível: o sistema precisa de um endereço https público")}
            </dd>
          </dl>
          {conexao.modo === "teste" && (
            <p className="text-xs text-muted-foreground">
              {t("No sandbox nenhum dinheiro de verdade é movimentado. Quando a cobrança de teste der certo, troque pela chave de produção.")}
            </p>
          )}
          {!conexao.aviso?.url && (
            <p className="text-xs text-muted-foreground">
              {t("Sem o aviso, a situação das cobranças é atualizada quando alguém clica em Atualizar na cobrança.")}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {!trocando && (
              <Button variant="outline" onClick={() => setTrocando(true)}>
                {t("Trocar chave")}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={desconectar.isPending}
              onClick={() => {
                if (!window.confirm(t("Desconectar o Asaas? As cobranças já criadas continuam no histórico, mas novas cobranças ficam bloqueadas."))) return;
                desconectar.mutate(undefined, {
                  onSuccess: () => {
                    setManual(null);
                    toast.success(t("Asaas desconectado."));
                  },
                  onError: (e) => toast.error(mensagemDoErro(e, t("Não foi possível desconectar."))),
                });
              }}
            >
              {t("Desconectar")}
            </Button>
          </div>
        </section>
      )}

      {manual && (
        <section
          role="alert"
          aria-label={t("Falta um passo: cadastre o aviso de pagamento no Asaas")}
          className="space-y-3 rounded-lg border border-amber-500/50 bg-amber-500/5 p-4"
        >
          <h3 className="font-semibold">{t("Falta um passo: cadastre o aviso de pagamento no Asaas")}</h3>
          <p className="text-sm">
            {t("O Asaas não deixou o sistema cadastrar o aviso sozinho. No Asaas, abra Integrações › Webhooks, clique em Adicionar e preencha assim:")}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>{t("Versão da API: v3, envio sequencial, situação ativa")}</li>
            <li>{t("Eventos: todos os de Cobranças")}</li>
          </ul>
          <CampoCopiavel rotulo={t("URL do webhook")} valor={manual.url} />
          <CampoCopiavel rotulo={t("Token de autenticação")} valor={manual.token} />
          <p className="text-xs text-muted-foreground">
            {t("Guarde o token agora: por segurança ele não é mostrado de novo. Se perder, é só trocar a chave para gerar outro.")}
          </p>
        </section>
      )}

      {mostrarFormulario && (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-base font-semibold">{conexao?.conectado ? t("Trocar chave") : t("Conectar conta do Asaas")}</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t("Entre na sua conta do Asaas.")}</li>
            <li>{t("Abra o menu Integrações › Chaves de API e gere uma chave.")}</li>
            <li>{t("Cole a chave abaixo. Comece pela conta de sandbox do Asaas; troque pela chave de produção quando a cobrança de teste der certo.")}</li>
          </ol>
          <div className="space-y-1">
            <Label htmlFor="chave-asaas">{t("Chave de API do Asaas")}</Label>
            <Input
              id="chave-asaas"
              type="password"
              autoComplete="off"
              placeholder="$aact_hmlg_…"
              value={chave}
              onChange={(e) => setChave(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("A chave é guardada cifrada e nunca é mostrada de novo. O sistema identifica sozinho se é de sandbox ou de produção.")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button disabled={chave.trim().length < 20 || conectar.isPending} onClick={salvar}>
              {conectar.isPending ? t("Conectando…") : t("Salvar e testar")}
            </Button>
            {trocando && (
              <Button variant="ghost" onClick={() => setTrocando(false)}>
                {t("Cancelar")}
              </Button>
            )}
          </div>
        </section>
      )}

      <section className="space-y-2 text-sm text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">{t("Como cobrar um cliente")}</h2>
        <p>
          {t("Abra um negócio no funil e use a seção Cobranças (Asaas): informe valor, vencimento e forma de pagamento. O link de pagamento e o Pix copia e cola ficam prontos para enviar pelo WhatsApp, e o negócio registra quando o cliente pagar.")}
        </p>
      </section>
    </div>
  );
}
