-- manifest: WhatsMeta — cobranças do Asaas que cada empresa faz aos próprios clientes. `asaas_conexoes` (chave cifrada com AI_CRED_AES_KEY, token do aviso só como sha256; sem policy para authenticated, lida só pelo service role) e `asaas_cobrancas` (membro lê por RLS; escrita só pelas rotas, com a org da sessão ou do token do aviso). Apêndice idempotente espelhado no baseline.
-- WhatsMeta 9900 — cobranças do Asaas para os clientes de cada empresa.
--
-- O que já existia: o Asaas da COBRANÇA DA PLATAFORMA (`cobranca_*`), em que o
-- dono da instalação cobra a assinatura das empresas. Esta migration é a outra
-- ponta: cada EMPRESA conecta a própria conta do Asaas e cobra os PRÓPRIOS
-- clientes (Pix, boleto, cartão) a partir de um negócio do funil.
--
-- Duas tabelas:
--   asaas_conexoes  — uma linha por empresa: a chave de API cifrada (AES-256-GCM,
--                     mesmo caminho das chaves de IA) e o token do aviso de
--                     pagamento, guardado só como sha256. Sem policy para
--                     `authenticated`: ninguém lê pela sessão; as rotas leem pelo
--                     service role filtrando `organization_id` da sessão.
--   asaas_cobrancas — as cobranças criadas. Membro da empresa LÊ (RLS); escrever
--                     é só das rotas, pelo service role, com a org da sessão ou
--                     do token do aviso — nunca do corpo da requisição.
--
-- Idempotente: este mesmo bloco está no apêndice do `supabase/baseline.sql`,
-- que é o que o install.sh/update.sh aplicam.

create table if not exists public.asaas_conexoes (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  chave_encrypted bytea not null,
  chave_iv bytea not null,
  chave_tag bytea not null,
  chave_last4 text not null,
  modo text not null check (modo in ('producao', 'teste')),
  -- O caminho público do aviso: /api/v1/webhooks/asaas-clientes/<webhook_id_publico>.
  webhook_id_publico uuid not null default gen_random_uuid(),
  -- sha256 hex do token que NÓS geramos e o Asaas ecoa em `asaas-access-token`.
  webhook_token_hash text not null,
  -- id do aviso cadastrado no Asaas (null = cadastro manual pendente).
  webhook_asaas_id text,
  conta_nome text,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_asaas_conexoes_webhook
  on public.asaas_conexoes (webhook_id_publico);

alter table public.asaas_conexoes enable row level security;
revoke all on public.asaas_conexoes from anon, authenticated;

comment on table public.asaas_conexoes is
  'WhatsMeta: conta do Asaas de cada empresa para cobrar os próprios clientes. Chave cifrada com AI_CRED_AES_KEY; lida só pelo service role.';

create table if not exists public.asaas_cobrancas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  asaas_payment_id text not null,
  asaas_customer_id text not null,
  forma text not null check (forma in ('PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED')),
  valor_cents bigint not null check (valor_cents > 0),
  moeda text not null default 'BRL',
  vencimento date not null,
  descricao text,
  -- Vocabulário do Asaas (PENDING, RECEIVED, CONFIRMED, OVERDUE, ...): aberto,
  -- sem CHECK, porque quem o define é o provedor.
  status text not null,
  link_pagamento text,
  boleto_url text,
  pago_em timestamptz,
  modo text not null check (modo in ('producao', 'teste')),
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_asaas_cobrancas_payment unique (organization_id, asaas_payment_id)
);

create index if not exists idx_asaas_cobrancas_lead
  on public.asaas_cobrancas (organization_id, lead_id, created_at desc);

alter table public.asaas_cobrancas enable row level security;
revoke all on public.asaas_cobrancas from anon;
revoke insert, update, delete, truncate on public.asaas_cobrancas from authenticated;
grant select on public.asaas_cobrancas to authenticated;

drop policy if exists tenant_isolation_asaas_cobrancas_select on public.asaas_cobrancas;
create policy tenant_isolation_asaas_cobrancas_select on public.asaas_cobrancas
  for select using (organization_id in (select public.fn_user_org_ids()));

comment on table public.asaas_cobrancas is
  'WhatsMeta: cobranças do Asaas que a empresa gerou para os próprios clientes, presas a um negócio. Membro lê; só as rotas escrevem (service role).';

notify pgrst, 'reload schema';
