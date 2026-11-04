"use client";
/**
 * O painel de relatórios de atendimento. Lê `/api/v1/reports/atendimento`; a
 * régua de cada número está escrita na `fn_relatorio_atendimento` (migration
 * 9901) e o texto de ajuda de cada cartão diz qual é.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

import {
  CHAVES_DE_PERIODO,
  baixarCsv,
  duracao,
  janelaDoPeriodo,
  linhasParaCsv,
  type ChaveDePeriodo,
} from "./relatorio-util";

interface Totais {
  conversas_ativas: number;
  conversas_novas: number;
  contatos_atendidos: number;
  encerradas: number;
  mensagens_recebidas: number;
  mensagens_enviadas: number;
  enviadas_por_pessoas: number;
  enviadas_pela_ia: number;
  enviadas_por_automacao: number;
  sem_resposta: number;
  primeira_resposta_humana_mediana_s: number | null;
  primeira_resposta_humana_media_s: number | null;
  primeira_resposta_mediana_s: number | null;
  duracao_mediana_s: number | null;
}

interface Relatorio {
  periodo: { from: string; to: string; fuso: string };
  filtros: { responsavel: string | null; canal: string | null; pode_ver_equipe: boolean };
  totais: Totais;
  fila_agora: { aguardando: number; automatico: number; humano: number; espera_mais_longa_s: number | null };
  por_fila: Array<{ fila: string; conversas: number; recebidas: number; enviadas: number; primeira_resposta_mediana_s: number | null }>;
  por_responsavel: Array<{
    user_id: string | null;
    nome: string | null;
    conversas: number;
    recebidas: number;
    enviadas: number;
    encerradas: number;
    sem_resposta: number;
    primeira_resposta_humana_mediana_s: number | null;
  }>;
  por_canal: Array<{
    channel_session_id: string;
    nome: string | null;
    telefone: string | null;
    conversas: number;
    recebidas: number;
    enviadas: number;
    sem_resposta: number;
    primeira_resposta_mediana_s: number | null;
  }>;
  serie_diaria: Array<{ dia: string; recebidas: number; enviadas: number; conversas_novas: number }>;
  por_hora: Array<{ hora: number; recebidas: number }>;
  opcoes: { canais: Array<{ id: string; nome: string }>; responsaveis: Array<{ id: string; nome: string | null }> };
}

const ROTULO_DA_FILA: Record<string, string> = {
  aguardando: "Aguardando atendente",
  automatico: "Com a IA (automático)",
  humano: "Em atendimento humano",
  encerrada: "Encerrada",
};

const ROTULO_DO_PERIODO: Record<ChaveDePeriodo, string> = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  mes: "Este mês",
  "mes-passado": "Mês passado",
  personalizado: "Personalizado",
};

const TODOS = "";

function numero(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("pt-BR");
}

function Indicador({ titulo, valor, ajuda }: { titulo: string; valor: string; ajuda: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-xs text-muted-foreground">{titulo}</span>
        <span className="text-2xl font-semibold tabular-nums">{valor}</span>
        <span className="text-[11px] leading-snug text-muted-foreground">{ajuda}</span>
      </CardContent>
    </Card>
  );
}

const ESTILO_DO_TOOLTIP = {
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  fontSize: 12,
};

export function RelatoriosClient() {
  const t = useT();
  const [periodo, setPeriodo] = useState<ChaveDePeriodo>("30d");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [canal, setCanal] = useState(TODOS);
  const [responsavel, setResponsavel] = useState(TODOS);

  const janela = useMemo(() => janelaDoPeriodo(periodo, new Date(), inicio, fim), [periodo, inicio, fim]);

  const query = useQuery({
    queryKey: ["relatorio-atendimento", janela?.from, janela?.to, canal, responsavel],
    enabled: janela !== null,
    queryFn: async () => {
      const qs = new URLSearchParams({ from: janela!.from, to: janela!.to });
      if (canal) qs.set("canal", canal);
      if (responsavel) qs.set("responsavel", responsavel);
      return (await apiClient.get<{ data: Relatorio }>(`/api/v1/reports/atendimento?${qs}`)).data;
    },
  });
  const r = query.data;

  const nomeDoResponsavel = (id: string | null, nome: string | null) => (id ? nome || t("Atendente") : t("Sem responsável"));

  const exportar = () => {
    if (!r) return;
    const partes = [
      linhasParaCsv(
        [t("Indicador"), t("Valor")],
        [
          [t("Conversas atendidas"), r.totais.conversas_ativas],
          [t("Conversas novas"), r.totais.conversas_novas],
          [t("Contatos atendidos"), r.totais.contatos_atendidos],
          [t("Mensagens recebidas"), r.totais.mensagens_recebidas],
          [t("Mensagens enviadas"), r.totais.mensagens_enviadas],
          [t("Enviadas por pessoas"), r.totais.enviadas_por_pessoas],
          [t("Enviadas pela IA"), r.totais.enviadas_pela_ia],
          [t("Enviadas por automações"), r.totais.enviadas_por_automacao],
          [t("Sem resposta"), r.totais.sem_resposta],
          [t("1ª resposta humana (mediana, s)"), Math.round(r.totais.primeira_resposta_humana_mediana_s ?? 0)],
          [t("1ª resposta geral (mediana, s)"), Math.round(r.totais.primeira_resposta_mediana_s ?? 0)],
          [t("Encerradas"), r.totais.encerradas],
          [t("Duração do atendimento (mediana, s)"), Math.round(r.totais.duracao_mediana_s ?? 0)],
        ],
      ),
      linhasParaCsv(
        [t("Responsável"), t("Conversas"), t("Recebidas"), t("Enviadas"), t("Encerradas"), t("Sem resposta"), t("1ª resposta humana (mediana, s)")],
        r.por_responsavel.map((x) => [
          nomeDoResponsavel(x.user_id, x.nome),
          x.conversas,
          x.recebidas,
          x.enviadas,
          x.encerradas,
          x.sem_resposta,
          Math.round(x.primeira_resposta_humana_mediana_s ?? 0),
        ]),
      ),
      linhasParaCsv(
        [t("Número de WhatsApp"), t("Conversas"), t("Recebidas"), t("Enviadas"), t("Sem resposta"), t("1ª resposta (mediana, s)")],
        r.por_canal.map((x) => [x.nome || x.telefone || "", x.conversas, x.recebidas, x.enviadas, x.sem_resposta, Math.round(x.primeira_resposta_mediana_s ?? 0)]),
      ),
      linhasParaCsv(
        [t("Dia"), t("Recebidas"), t("Enviadas"), t("Conversas novas")],
        r.serie_diaria.map((d) => [d.dia, d.recebidas, d.enviadas, d.conversas_novas]),
      ),
    ];
    baixarCsv(`relatorio-atendimento-${r.periodo.from.slice(0, 10)}-a-${r.periodo.to.slice(0, 10)}.csv`, partes.join("\n"));
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("Período")}
          <select
            className="h-9 rounded-md border border-border bg-transparent px-2 text-sm text-foreground"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value as ChaveDePeriodo)}
          >
            {CHAVES_DE_PERIODO.map((c) => (
              <option key={c} value={c}>
                {t(ROTULO_DO_PERIODO[c])}
              </option>
            ))}
          </select>
        </label>
        {periodo === "personalizado" && (
          <>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("De")}
              <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="h-9" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("Até")}
              <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="h-9" />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("Número de WhatsApp")}
          <select
            className="h-9 rounded-md border border-border bg-transparent px-2 text-sm text-foreground"
            value={canal}
            onChange={(e) => setCanal(e.target.value)}
          >
            <option value={TODOS}>{t("Todos os números")}</option>
            {r?.opcoes.canais.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        {r?.filtros.pode_ver_equipe && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("Responsável")}
            <select
              className="h-9 rounded-md border border-border bg-transparent px-2 text-sm text-foreground"
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
            >
              <option value={TODOS}>{t("Toda a equipe")}</option>
              {r.opcoes.responsaveis.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome || t("Atendente")}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button variant="outline" className="ml-auto" disabled={!r} onClick={exportar}>
          {t("Exportar CSV")}
        </Button>
      </div>

      {janela === null && <p className="text-sm text-muted-foreground">{t("Escolha a data de início e de fim.")}</p>}

      {query.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label={t("Carregando o relatório")}>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {query.isError && (
        <p className="text-sm text-destructive">
          {query.error instanceof Error && query.error.message ? query.error.message : t("Não foi possível montar o relatório.")}
        </p>
      )}

      {r && (
        <>
          {/* Fila agora */}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{t("Fila agora")}</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Indicador
                titulo={t("Aguardando atendente")}
                valor={numero(r.fila_agora.aguardando)}
                ajuda={
                  r.fila_agora.espera_mais_longa_s
                    ? `${t("Espera mais longa:")} ${duracao(r.fila_agora.espera_mais_longa_s)}`
                    : t("Ninguém esperando uma pessoa.")
                }
              />
              <Indicador titulo={t("Com a IA (automático)")} valor={numero(r.fila_agora.automatico)} ajuda={t("Conversas abertas que a IA está atendendo.")} />
              <Indicador titulo={t("Em atendimento humano")} valor={numero(r.fila_agora.humano)} ajuda={t("Conversas abertas com um responsável.")} />
            </div>
          </section>

          {/* Indicadores do período */}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{t("No período")}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Indicador titulo={t("Conversas atendidas")} valor={numero(r.totais.conversas_ativas)} ajuda={t("Com ao menos uma mensagem no período.")} />
              <Indicador titulo={t("Conversas novas")} valor={numero(r.totais.conversas_novas)} ajuda={`${numero(r.totais.contatos_atendidos)} ${t("contatos atendidos")}`} />
              <Indicador
                titulo={t("1ª resposta humana")}
                valor={duracao(r.totais.primeira_resposta_humana_mediana_s)}
                ajuda={`${t("Mediana. Média:")} ${duracao(r.totais.primeira_resposta_humana_media_s)}`}
              />
              <Indicador
                titulo={t("1ª resposta (com IA)")}
                valor={duracao(r.totais.primeira_resposta_mediana_s)}
                ajuda={t("Mediana, contando respostas da IA e de automações.")}
              />
              <Indicador titulo={t("Mensagens recebidas")} valor={numero(r.totais.mensagens_recebidas)} ajuda={t("Enviadas pelos clientes.")} />
              <Indicador
                titulo={t("Mensagens enviadas")}
                valor={numero(r.totais.mensagens_enviadas)}
                ajuda={`${numero(r.totais.enviadas_por_pessoas)} ${t("por pessoas")} · ${numero(r.totais.enviadas_pela_ia)} ${t("pela IA")} · ${numero(r.totais.enviadas_por_automacao)} ${t("automáticas")}`}
              />
              <Indicador titulo={t("Sem resposta")} valor={numero(r.totais.sem_resposta)} ajuda={t("O cliente escreveu e ninguém respondeu depois.")} />
              <Indicador
                titulo={t("Atendimentos encerrados")}
                valor={numero(r.totais.encerradas)}
                ajuda={`${t("Duração mediana:")} ${duracao(r.totais.duracao_mediana_s)}`}
              />
            </div>
          </section>

          {/* Gráficos */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("Mensagens por dia")}</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={r.serie_diaria} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="dia" tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)} fontSize={11} />
                    <YAxis allowDecimals={false} fontSize={11} />
                    <Tooltip contentStyle={ESTILO_DO_TOOLTIP} labelFormatter={(d) => String(d).split("-").reverse().join("/")} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="recebidas" name={t("Recebidas")} stroke="var(--color-accent)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="enviadas" name={t("Enviadas")} stroke="var(--color-text-muted)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("Horário de pico (mensagens recebidas)")}</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={r.por_hora} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="hora" tickFormatter={(h: number) => `${h}h`} fontSize={11} />
                    <YAxis allowDecimals={false} fontSize={11} />
                    <Tooltip contentStyle={ESTILO_DO_TOOLTIP} labelFormatter={(h) => `${h}h`} />
                    <Bar dataKey="recebidas" name={t("Recebidas")} fill="var(--color-accent)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Por responsável */}
          {r.filtros.pode_ver_equipe && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("Por responsável")}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Responsável")}</TableHead>
                      <TableHead className="text-right">{t("Conversas")}</TableHead>
                      <TableHead className="text-right">{t("Recebidas")}</TableHead>
                      <TableHead className="text-right">{t("Enviadas")}</TableHead>
                      <TableHead className="text-right">{t("Encerradas")}</TableHead>
                      <TableHead className="text-right">{t("Sem resposta")}</TableHead>
                      <TableHead className="text-right">{t("1ª resposta humana")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.por_responsavel.map((x) => (
                      <TableRow key={x.user_id ?? "sem"}>
                        <TableCell className="font-medium">{nomeDoResponsavel(x.user_id, x.nome)}</TableCell>
                        <TableCell className="text-right tabular-nums">{numero(x.conversas)}</TableCell>
                        <TableCell className="text-right tabular-nums">{numero(x.recebidas)}</TableCell>
                        <TableCell className="text-right tabular-nums">{numero(x.enviadas)}</TableCell>
                        <TableCell className="text-right tabular-nums">{numero(x.encerradas)}</TableCell>
                        <TableCell className="text-right tabular-nums">{numero(x.sem_resposta)}</TableCell>
                        <TableCell className="text-right tabular-nums">{duracao(x.primeira_resposta_humana_mediana_s)}</TableCell>
                      </TableRow>
                    ))}
                    {r.por_responsavel.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-sm text-muted-foreground">
                          {t("Sem atendimentos no período.")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Por número */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("Por número de WhatsApp")}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Número")}</TableHead>
                      <TableHead className="text-right">{t("Conversas")}</TableHead>
                      <TableHead className="text-right">{t("Recebidas")}</TableHead>
                      <TableHead className="text-right">{t("Sem resposta")}</TableHead>
                      <TableHead className="text-right">{t("1ª resposta")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.por_canal.map((x) => (
                      <TableRow key={x.channel_session_id}>
                        <TableCell className="font-medium">{x.nome || x.telefone || t("Número sem nome")}</TableCell>
                        <TableCell className="text-right tabular-nums">{numero(x.conversas)}</TableCell>
                        <TableCell className="text-right tabular-nums">{numero(x.recebidas)}</TableCell>
                        <TableCell className="text-right tabular-nums">{numero(x.sem_resposta)}</TableCell>
                        <TableCell className="text-right tabular-nums">{duracao(x.primeira_resposta_mediana_s)}</TableCell>
                      </TableRow>
                    ))}
                    {r.por_canal.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-sm text-muted-foreground">
                          {t("Sem atendimentos no período.")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Por fila */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("Por fila")}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Fila (situação atual)")}</TableHead>
                      <TableHead className="text-right">{t("Conversas")}</TableHead>
                      <TableHead className="text-right">{t("Recebidas")}</TableHead>
                      <TableHead className="text-right">{t("1ª resposta")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.por_fila.map((x) => (
                      <TableRow key={x.fila}>
                        <TableCell className="font-medium">{t(ROTULO_DA_FILA[x.fila] ?? x.fila)}</TableCell>
                        <TableCell className="text-right tabular-nums">{numero(x.conversas)}</TableCell>
                        <TableCell className="text-right tabular-nums">{numero(x.recebidas)}</TableCell>
                        <TableCell className="text-right tabular-nums">{duracao(x.primeira_resposta_mediana_s)}</TableCell>
                      </TableRow>
                    ))}
                    {r.por_fila.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-sm text-muted-foreground">
                          {t("Sem atendimentos no período.")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
