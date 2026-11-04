-- manifest: WhatsMeta — `fn_relatorio_atendimento`: os indicadores de atendimento de um período (volume, mensagens por autor, 1ª resposta humana e geral, duração, conversas sem resposta), cortados por responsável, por número de WhatsApp, por fila (a mesma regra da aba Fila: `fn_comando_da_conversa`), por dia e por hora. `security invoker` (`language sql stable`, como `fn_attendant_metrics`): a RLS de quem chama decide o que entra — o atendente mede só as próprias conversas. Sem índice novo: as mensagens são alcançadas por conversa pelo `idx_messages_conversation_sent`. Apêndice idempotente espelhado no baseline, antes da varredura de anon.
--
-- WhatsMeta 9901 — relatório de atendimento.
--
-- Réguas, escritas para não haver dois números para a mesma pergunta:
--   * período: [p_from, p_to) sobre `messages.sent_at` (a mesma coluna de
--     `fn_attendant_metrics`); dia e hora no fuso `p_fuso` da empresa;
--   * conversa ATIVA no período = teve ao menos uma mensagem nele; grupos fora;
--   * 1ª resposta = da primeira mensagem do cliente NO PERÍODO até a primeira
--     mensagem enviada depois dela — "humana" só conta quem tem `sent_by_user_id`
--     (a régua da tela Desempenho), "geral" conta também a IA e as automações;
--   * fila = `fn_comando_da_conversa` agora: aguardando | automatico | humano |
--     encerrada — a pergunta "onde está esta conversa", respondida pela mesma
--     regra da Inbox;
--   * duração = `service_closed_at - service_started_at` das encerradas no período.
create or replace function public.fn_relatorio_atendimento(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_responsavel uuid default null,
  p_canal uuid default null,
  p_fuso text default 'America/Sao_Paulo'
) returns jsonb
language sql stable
set search_path = public
as $$
  with
  conv as (
    select
      c.id,
      c.contact_id,
      c.assigned_to_user_id,
      c.channel_session_id,
      c.created_at,
      c.service_started_at,
      c.service_closed_at,
      c.awaiting_since,
      public.fn_comando_da_conversa(
        c.status, c.assigned_to_user_id, c.bot_silenced_until,
        coalesce(ct.force_human, false), coalesce(ct.is_blocked, false), now()
      ) as fila
    from public.conversations c
    left join public.contacts ct on ct.id = c.contact_id and ct.organization_id = c.organization_id
    where c.organization_id = p_org
      and coalesce(c.is_group, false) = false
      and (p_responsavel is null or c.assigned_to_user_id = p_responsavel)
      and (p_canal is null or c.channel_session_id = p_canal)
  ),
  msg as (
    select m.conversation_id, m.direction, m.sent_by_user_id, m.sent_via, m.sent_at
    from conv
    join public.messages m
      on m.conversation_id = conv.id
     and m.sent_at >= p_from
     and m.sent_at < p_to
    where m.organization_id = p_org
  ),
  ativas as (
    select conversation_id as id,
           count(*) filter (where direction = 'inbound') as recebidas,
           count(*) filter (where direction = 'outbound') as enviadas
    from msg
    group by conversation_id
  ),
  primeira as (
    select a.id, fi.first_in,
      (select min(m2.sent_at) from public.messages m2
        where m2.conversation_id = a.id and m2.direction = 'outbound'
          and m2.sent_by_user_id is not null and m2.sent_at >= fi.first_in) as first_human_out,
      (select min(m2.sent_at) from public.messages m2
        where m2.conversation_id = a.id and m2.direction = 'outbound'
          and m2.sent_at >= fi.first_in) as first_any_out
    from ativas a
    cross join lateral (
      select min(m.sent_at) as first_in from msg m
      where m.conversation_id = a.id and m.direction = 'inbound'
    ) fi
    where fi.first_in is not null
  ),
  resp as (
    select p.id,
           extract(epoch from (p.first_human_out - p.first_in)) as s_humana,
           extract(epoch from (p.first_any_out - p.first_in)) as s_geral,
           p.first_any_out is null as sem_resposta
    from primeira p
  ),
  base as (
    select conv.*, a.recebidas, a.enviadas, r.s_humana, r.s_geral, coalesce(r.sem_resposta, false) as sem_resposta
    from conv
    join ativas a on a.id = conv.id
    left join resp r on r.id = conv.id
  ),
  encerradas as (
    select conv.*, extract(epoch from (conv.service_closed_at - conv.service_started_at)) as s_duracao
    from conv
    where conv.service_closed_at >= p_from and conv.service_closed_at < p_to
  ),
  dias as (
    select d::date as dia
    from generate_series(
      (p_from at time zone p_fuso)::date,
      ((p_to - interval '1 microsecond') at time zone p_fuso)::date,
      interval '1 day'
    ) as d
  )
  select jsonb_build_object(
    'totais', jsonb_build_object(
      'conversas_ativas', (select count(*) from base),
      'conversas_novas', (select count(*) from conv where created_at >= p_from and created_at < p_to),
      'contatos_atendidos', (select count(distinct contact_id) from base),
      'encerradas', (select count(*) from encerradas),
      'mensagens_recebidas', (select count(*) from msg where direction = 'inbound'),
      'mensagens_enviadas', (select count(*) from msg where direction = 'outbound'),
      'enviadas_por_pessoas', (select count(*) from msg where direction = 'outbound' and sent_by_user_id is not null),
      'enviadas_pela_ia', (select count(*) from msg where direction = 'outbound' and sent_by_user_id is null and sent_via = 'ai'),
      'enviadas_por_automacao', (select count(*) from msg where direction = 'outbound' and sent_by_user_id is null and coalesce(sent_via, '') <> 'ai'),
      'sem_resposta', (select count(*) from base where sem_resposta),
      'primeira_resposta_humana_mediana_s', (select percentile_cont(0.5) within group (order by s_humana) from base where s_humana is not null),
      'primeira_resposta_humana_media_s', (select avg(s_humana) from base where s_humana is not null),
      'primeira_resposta_mediana_s', (select percentile_cont(0.5) within group (order by s_geral) from base where s_geral is not null),
      'duracao_mediana_s', (select percentile_cont(0.5) within group (order by s_duracao) from encerradas where s_duracao is not null and s_duracao >= 0)
    ),
    'fila_agora', jsonb_build_object(
      'aguardando', (select count(*) from conv where fila = 'aguardando'),
      'automatico', (select count(*) from conv where fila = 'automatico'),
      'humano', (select count(*) from conv where fila = 'humano' and service_closed_at is null),
      'espera_mais_longa_s', (select max(extract(epoch from (now() - awaiting_since))) from conv where fila = 'aguardando' and awaiting_since is not null)
    ),
    'por_fila', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fila', fila, 'conversas', n, 'recebidas', rec, 'enviadas', env,
        'primeira_resposta_mediana_s', med
      ) order by n desc)
      from (
        select fila, count(*) as n, sum(recebidas) as rec, sum(enviadas) as env,
               percentile_cont(0.5) within group (order by s_geral) as med
        from base group by fila
      ) f
    ), '[]'::jsonb),
    'por_responsavel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', user_id, 'conversas', n, 'recebidas', rec, 'enviadas', env,
        'encerradas', enc, 'sem_resposta', sr,
        'primeira_resposta_humana_mediana_s', med
      ) order by n desc)
      from (
        select b.assigned_to_user_id as user_id, count(*) as n, sum(b.recebidas) as rec, sum(b.enviadas) as env,
               (select count(*) from encerradas e where e.assigned_to_user_id is not distinct from b.assigned_to_user_id) as enc,
               count(*) filter (where b.sem_resposta) as sr,
               percentile_cont(0.5) within group (order by b.s_humana) as med
        from base b group by b.assigned_to_user_id
      ) r
    ), '[]'::jsonb),
    'por_canal', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel_session_id', x.channel_session_id,
        'nome', coalesce(nullif(cs.display_name, ''), cs.phone_number),
        'telefone', cs.phone_number,
        'conversas', x.n, 'recebidas', x.rec, 'enviadas', x.env, 'sem_resposta', x.sr,
        'primeira_resposta_mediana_s', x.med
      ) order by x.n desc)
      from (
        select channel_session_id, count(*) as n, sum(recebidas) as rec, sum(enviadas) as env,
               count(*) filter (where sem_resposta) as sr,
               percentile_cont(0.5) within group (order by s_geral) as med
        from base group by channel_session_id
      ) x
      left join public.channel_sessions cs on cs.id = x.channel_session_id and cs.organization_id = p_org
    ), '[]'::jsonb),
    'serie_diaria', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dia', to_char(d.dia, 'YYYY-MM-DD'),
        'recebidas', coalesce(m.rec, 0),
        'enviadas', coalesce(m.env, 0),
        'conversas_novas', coalesce(n.novas, 0)
      ) order by d.dia)
      from dias d
      left join (
        select (sent_at at time zone p_fuso)::date as dia,
               count(*) filter (where direction = 'inbound') as rec,
               count(*) filter (where direction = 'outbound') as env
        from msg group by 1
      ) m on m.dia = d.dia
      left join (
        select (created_at at time zone p_fuso)::date as dia, count(*) as novas
        from conv where created_at >= p_from and created_at < p_to group by 1
      ) n on n.dia = d.dia
    ), '[]'::jsonb),
    'por_hora', coalesce((
      select jsonb_agg(jsonb_build_object('hora', h, 'recebidas', coalesce(q.rec, 0)) order by h)
      from generate_series(0, 23) as h
      left join (
        select extract(hour from (sent_at at time zone p_fuso))::int as hora, count(*) as rec
        from msg where direction = 'inbound' group by 1
      ) q on q.hora = h
    ), '[]'::jsonb)
  );
$$;

comment on function public.fn_relatorio_atendimento(uuid, timestamptz, timestamptz, uuid, uuid, text) is
  'WhatsMeta: indicadores de atendimento do período por responsável, número, fila, dia e hora. Security invoker — a RLS de quem chama decide o escopo.';

revoke execute on function public.fn_relatorio_atendimento(uuid, timestamptz, timestamptz, uuid, uuid, text) from public, anon;
grant execute on function public.fn_relatorio_atendimento(uuid, timestamptz, timestamptz, uuid, uuid, text) to authenticated, service_role;
