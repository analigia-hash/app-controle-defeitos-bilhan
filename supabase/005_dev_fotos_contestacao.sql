-- 005 · Fotos da devolução e contestação na loja
-- Fotos: tiradas pela embalagem ao registrar (ou depois, pela Ana). Ficam no bucket privado "devolucoes".
-- Contestação: só a Ana (admin) envia, pela edge function devolucoes-contestar.

insert into storage.buckets (id, name, public)
values ('devolucoes', 'devolucoes', false)
on conflict (id) do nothing;

create table if not exists def_devolucao_fotos (
  id            bigserial primary key,
  devolucao_id  bigint not null references def_devolucoes(id) on delete cascade,
  path          text not null unique,
  criado_por    text default (auth.jwt() ->> 'email'),
  criado_em     timestamptz not null default now()
);
create index if not exists def_devolucao_fotos_dev on def_devolucao_fotos (devolucao_id);
alter table def_devolucao_fotos enable row level security;
drop policy if exists def_devolucao_fotos_ler on def_devolucao_fotos;
create policy def_devolucao_fotos_ler on def_devolucao_fotos for select to authenticated using (def_papel() is not null);
drop policy if exists def_devolucao_fotos_incluir on def_devolucao_fotos;
create policy def_devolucao_fotos_incluir on def_devolucao_fotos for insert to authenticated with check (def_papel() is not null);

create table if not exists def_dev_contestacao (
  id            bigserial primary key,
  devolucao_id  bigint not null references def_devolucoes(id) on delete cascade,
  plataforma    text not null,
  motivo_codigo text,
  motivo_texto  text,
  comentario    text,
  fotos         jsonb not null default '[]'::jsonb,
  ok            boolean not null,
  resposta      jsonb,
  criado_por    text,
  criado_em     timestamptz not null default now()
);
create index if not exists def_dev_contestacao_dev on def_dev_contestacao (devolucao_id);
alter table def_dev_contestacao enable row level security;
drop policy if exists def_dev_contestacao_ler on def_dev_contestacao;
create policy def_dev_contestacao_ler on def_dev_contestacao for select to authenticated using (def_eh_gestor());

-- arquivos: quem usa o app sobe e vê; ninguém apaga pelo app
drop policy if exists devolucoes_fotos_subir on storage.objects;
create policy devolucoes_fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'devolucoes' and public.def_papel() is not null);
drop policy if exists devolucoes_fotos_ver on storage.objects;
create policy devolucoes_fotos_ver on storage.objects for select to authenticated
  using (bucket_id = 'devolucoes' and public.def_papel() is not null);

insert into configuracao (chave, valor, obs, atualizado_em)
values ('devolucoes.email_disputa', '', 'E-mail que vai nas disputas de devolução da Shopee (a Shopee exige um).', now())
on conflict (chave) do nothing;
