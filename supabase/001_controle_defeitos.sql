-- =====================================================================
-- App Controle de Defeitos — Bilhan
-- Tabelas com prefixo def_ no mesmo Supabase do app de estoque.
-- Toda escrita passa por funções (RPC) que checam papel, semana aberta
-- e calculam/congelam o custo. O lançador nunca lê colunas de custo:
-- a tabela def_lancamentos só é legível por gestor/admin.
-- =====================================================================

-- ---------- Perfis ----------
create table if not exists def_perfil (
  email text primary key,
  nome  text,
  papel text not null check (papel in ('lancador', 'gestor', 'admin'))
);

-- Quem já é master no estoque vira admin; produção vira lançador.
insert into def_perfil (email, papel)
select email, case when papel = 'master' then 'admin' else 'lancador' end
from dtf_perfil
on conflict (email) do nothing;

create or replace function def_papel() returns text
language sql stable security definer set search_path = public as $$
  select papel from def_perfil where email = auth.jwt() ->> 'email'
$$;

create or replace function def_eh_gestor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(def_papel() in ('gestor', 'admin'), false)
$$;

create or replace function def_eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(def_papel() = 'admin', false)
$$;

-- ---------- Listas ----------
create table if not exists def_pecas (
  id bigint generated always as identity primary key,
  nome text not null unique,
  modelo_estoque text not null,          -- peca_sku.modelo de onde sai o custo médio
  ativo boolean not null default true,
  ordem int not null default 0
);

create table if not exists def_cores (
  id bigint generated always as identity primary key,
  nome text not null unique,
  ativo boolean not null default true,
  ordem int not null default 0
);

create table if not exists def_tipos_defeito (
  id bigint generated always as identity primary key,
  nome text not null unique,
  ativo boolean not null default true,
  ordem int not null default 0
);

create table if not exists def_finalidades (
  id bigint generated always as identity primary key,
  nome text not null unique,
  regra_custo text not null check (regra_custo in ('descarte', 'costura', 'dtf')),
  ativo boolean not null default true,
  ordem int not null default 0
);

create table if not exists def_responsaveis (
  id bigint generated always as identity primary key,
  nome text not null unique,
  ativo boolean not null default true,
  ordem int not null default 0
);

create table if not exists def_parametros_custo (
  id bigint generated always as identity primary key,
  chave text not null check (chave in ('custo_dia_costura', 'pecas_por_dia_costura', 'custo_dtf')),
  valor numeric not null check (valor > 0),
  vigente_desde date not null default current_date,
  criado_por text default (auth.jwt() ->> 'email'),
  criado_em timestamptz not null default now()
);

-- ---------- Lançamento ----------
create table if not exists def_semanas (
  id bigint generated always as identity primary key,
  inicio date not null unique,           -- sábado
  fim date not null,                     -- sexta
  status text not null default 'aberta' check (status in ('aberta', 'fechada')),
  fechada_por text,
  fechada_em timestamptz
);

create table if not exists def_lancamentos (
  id bigint generated always as identity primary key,
  semana_id bigint not null references def_semanas(id),
  peca_id bigint not null references def_pecas(id),
  com_dtf boolean not null,
  cor_id bigint not null references def_cores(id),
  defeito_id bigint not null references def_tipos_defeito(id),
  finalidade_id bigint not null references def_finalidades(id),
  responsavel_id bigint not null references def_responsaveis(id),
  quantidade int not null check (quantidade > 0),
  custo_medio_peca numeric,
  custo_unitario numeric not null default 0,
  custo_total numeric not null default 0,
  observacao text,
  foto_url text,
  excluido boolean not null default false,
  criado_por text,
  criado_em timestamptz not null default now(),
  editado_por text,
  editado_em timestamptz,
  excluido_por text,
  excluido_em timestamptz
);
create index if not exists def_lancamentos_semana_idx on def_lancamentos (semana_id) where not excluido;

-- ---------- Seeds ----------
insert into def_pecas (nome, modelo_estoque, ordem) values
  ('Camiseta', 'CAMISETA PADRAO', 1),
  ('Cropped padrão', 'CROPPED PADRAO', 2),
  ('Cropped SHEIN', 'CROPPED SHEIN', 3),
  ('Moletom', 'MOLETOM CANGURU', 4)
on conflict (nome) do nothing;

insert into def_tipos_defeito (nome, ordem) values
  ('Furo no tecido', 1), ('Mancha de óleo', 2), ('Manchas diversas', 3),
  ('Barra sem fazer', 4), ('Gola mal feita', 5), ('Tonalidade', 6),
  ('DTF falha', 7), ('DTF torto', 8), ('DTF local errado', 9)
on conflict (nome) do nothing;

insert into def_finalidades (nome, regra_custo, ordem) values
  ('Sem salvação', 'descarte', 1),
  ('Corrigir na costura', 'costura', 2),
  ('Corrigir no DTF', 'dtf', 3)
on conflict (nome) do nothing;

insert into def_responsaveis (nome, ordem) values
  ('Malharia', 1), ('Corte', 2), ('Costura interna', 3), ('Costura externa', 4),
  ('Equipe terceiros', 5), ('Equipe Ana', 6), ('Equipe Kelly', 7),
  ('Equipe Milena', 8), ('Equipe Sandy', 9)
on conflict (nome) do nothing;

insert into def_parametros_custo (chave, valor, vigente_desde, criado_por)
select * from (values
  ('custo_dia_costura', 280::numeric, date '2026-01-01', 'seed'),
  ('pecas_por_dia_costura', 100::numeric, date '2026-01-01', 'seed'),
  ('custo_dtf', 2::numeric, date '2026-01-01', 'seed')
) v
where not exists (select 1 from def_parametros_custo);

-- ---------- Cálculo de custo ----------
-- Custo médio do app de estoque: média do custo_total dos SKUs ativos do modelo.
create or replace function def_custo_medio(p_peca bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select round(avg(c.custo_total)::numeric, 4)
  from def_pecas p
  join peca_sku s on upper(s.modelo) = upper(p.modelo_estoque) and s.ativo
  join peca_custo c on c.sku_id = s.id
  where p.id = p_peca
$$;

create or replace function def_param(p_chave text, p_em date default current_date) returns numeric
language sql stable security definer set search_path = public as $$
  select valor from def_parametros_custo
  where chave = p_chave and vigente_desde <= p_em
  order by vigente_desde desc, id desc
  limit 1
$$;

-- Congela custo médio e unitário ao inserir, ou quando peça/DTF/finalidade
-- mudam. Mudar só a quantidade mantém o unitário já congelado.
create or replace function def_lancamentos_calcular() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_regra text;
begin
  if tg_op = 'INSERT'
     or new.peca_id is distinct from old.peca_id
     or new.com_dtf is distinct from old.com_dtf
     or new.finalidade_id is distinct from old.finalidade_id then
    select regra_custo into v_regra from def_finalidades where id = new.finalidade_id;
    new.custo_medio_peca := def_custo_medio(new.peca_id);
    if v_regra = 'descarte' then
      if new.custo_medio_peca is null then
        raise exception 'Peça sem custo médio no app de estoque. Fale com o admin.';
      end if;
      new.custo_unitario := new.custo_medio_peca
        + case when new.com_dtf then def_param('custo_dtf') else 0 end;
    elsif v_regra = 'costura' then
      new.custo_unitario := def_param('custo_dia_costura') / def_param('pecas_por_dia_costura');
    else
      new.custo_unitario := def_param('custo_dtf');
    end if;
  end if;
  new.custo_total := round(new.quantidade * new.custo_unitario, 2);
  return new;
end $$;

drop trigger if exists def_lancamentos_calcular on def_lancamentos;
create trigger def_lancamentos_calcular
  before insert or update of peca_id, com_dtf, finalidade_id, quantidade on def_lancamentos
  for each row execute function def_lancamentos_calcular();

-- ---------- RLS ----------
alter table def_perfil enable row level security;
alter table def_pecas enable row level security;
alter table def_cores enable row level security;
alter table def_tipos_defeito enable row level security;
alter table def_finalidades enable row level security;
alter table def_responsaveis enable row level security;
alter table def_parametros_custo enable row level security;
alter table def_semanas enable row level security;
alter table def_lancamentos enable row level security;

drop policy if exists def_perfil_ler on def_perfil;
create policy def_perfil_ler on def_perfil for select to authenticated
  using (email = auth.jwt() ->> 'email' or def_eh_admin());
drop policy if exists def_perfil_admin on def_perfil;
create policy def_perfil_admin on def_perfil for all to authenticated
  using (def_eh_admin()) with check (def_eh_admin());

do $$
declare t text;
begin
  foreach t in array array['def_pecas', 'def_cores', 'def_tipos_defeito', 'def_finalidades', 'def_responsaveis'] loop
    execute format('drop policy if exists %1$s_ler on %1$s', t);
    execute format('create policy %1$s_ler on %1$s for select to authenticated using (def_papel() is not null)', t);
    execute format('drop policy if exists %1$s_admin on %1$s', t);
    execute format('create policy %1$s_admin on %1$s for all to authenticated using (def_eh_admin()) with check (def_eh_admin())', t);
  end loop;
end $$;

drop policy if exists def_parametros_ler on def_parametros_custo;
create policy def_parametros_ler on def_parametros_custo for select to authenticated using (def_eh_gestor());
drop policy if exists def_parametros_admin on def_parametros_custo;
create policy def_parametros_admin on def_parametros_custo for insert to authenticated with check (def_eh_admin());

drop policy if exists def_semanas_ler on def_semanas;
create policy def_semanas_ler on def_semanas for select to authenticated using (def_papel() is not null);

-- Só gestor/admin leem a tabela de linhas (é onde estão os custos).
drop policy if exists def_lancamentos_ler on def_lancamentos;
create policy def_lancamentos_ler on def_lancamentos for select to authenticated using (def_eh_gestor());

-- ---------- Visão do painel ----------
create or replace view def_painel with (security_invoker = true) as
select l.id, l.semana_id, s.inicio as semana_inicio, s.fim as semana_fim, s.status as semana_status,
       l.peca_id, p.nome as peca, l.com_dtf, l.cor_id, c.nome as cor,
       l.defeito_id, d.nome as defeito, l.finalidade_id, f.nome as finalidade, f.regra_custo,
       l.responsavel_id, r.nome as responsavel, l.quantidade,
       l.custo_medio_peca, l.custo_unitario, l.custo_total, l.observacao,
       l.criado_por, l.criado_em, l.editado_por, l.editado_em
from def_lancamentos l
join def_semanas s on s.id = l.semana_id
join def_pecas p on p.id = l.peca_id
join def_cores c on c.id = l.cor_id
join def_tipos_defeito d on d.id = l.defeito_id
join def_finalidades f on f.id = l.finalidade_id
join def_responsaveis r on r.id = l.responsavel_id
where not l.excluido;

-- ---------- RPCs ----------
create or replace function def_sincronizar_cores() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if def_papel() is null then raise exception 'Sem acesso.'; end if;
  insert into def_cores (nome)
  select distinct s.cor from peca_sku s
  where s.ativo and coalesce(trim(s.cor), '') <> ''
  on conflict (nome) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Semana de referência: sábado anterior (ou o próprio sábado) até a sexta.
create or replace function def_semana_garantir(p_data date default current_date) returns def_semanas
language plpgsql security definer set search_path = public as $$
declare
  v_inicio date := p_data - ((extract(dow from p_data)::int + 1) % 7);
  v_sem def_semanas;
begin
  if def_papel() is null then raise exception 'Sem acesso.'; end if;
  insert into def_semanas (inicio, fim) values (v_inicio, v_inicio + 6)
  on conflict (inicio) do nothing;
  select * into v_sem from def_semanas where inicio = v_inicio;
  return v_sem;
end $$;

create or replace function def_fechar_semana(p_semana bigint, p_fechar boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not def_eh_gestor() then raise exception 'Só o gestor pode fechar ou reabrir a semana.'; end if;
  update def_semanas
     set status = case when p_fechar then 'fechada' else 'aberta' end,
         fechada_por = case when p_fechar then auth.jwt() ->> 'email' end,
         fechada_em = case when p_fechar then now() end
   where id = p_semana;
end $$;

create or replace function def_pode_escrever(p_semana bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select def_eh_gestor()
      or (def_papel() = 'lancador'
          and exists (select 1 from def_semanas where id = p_semana and status = 'aberta'))
$$;

-- Cria (p_id nulo) ou edita uma linha. Devolve o id.
create or replace function def_salvar_linha(
  p_id bigint, p_semana bigint, p_peca bigint, p_com_dtf boolean, p_cor bigint,
  p_defeito bigint, p_finalidade bigint, p_responsavel bigint, p_quantidade int,
  p_observacao text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_semana_atual bigint;
  v_email text := auth.jwt() ->> 'email';
begin
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'A quantidade precisa ser maior que zero.';
  end if;
  if not def_pode_escrever(p_semana) then
    raise exception 'Esta semana está fechada. Só o gestor pode alterar.';
  end if;

  if p_id is null then
    insert into def_lancamentos (semana_id, peca_id, com_dtf, cor_id, defeito_id, finalidade_id,
                                 responsavel_id, quantidade, observacao, criado_por)
    values (p_semana, p_peca, p_com_dtf, p_cor, p_defeito, p_finalidade,
            p_responsavel, p_quantidade, nullif(trim(p_observacao), ''), v_email)
    returning id into v_id;
  else
    select semana_id into v_semana_atual from def_lancamentos where id = p_id and not excluido;
    if v_semana_atual is null then raise exception 'Linha não encontrada.'; end if;
    if not def_pode_escrever(v_semana_atual) then
      raise exception 'Esta semana está fechada. Só o gestor pode alterar.';
    end if;
    update def_lancamentos
       set semana_id = p_semana, peca_id = p_peca, com_dtf = p_com_dtf, cor_id = p_cor,
           defeito_id = p_defeito, finalidade_id = p_finalidade, responsavel_id = p_responsavel,
           quantidade = p_quantidade, observacao = nullif(trim(p_observacao), ''),
           editado_por = v_email, editado_em = now()
     where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Exclusão lógica: some do painel, mas fica no banco.
create or replace function def_excluir_linha(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_semana bigint;
begin
  select semana_id into v_semana from def_lancamentos where id = p_id and not excluido;
  if v_semana is null then raise exception 'Linha não encontrada.'; end if;
  if not def_pode_escrever(v_semana) then
    raise exception 'Esta semana está fechada. Só o gestor pode alterar.';
  end if;
  update def_lancamentos
     set excluido = true, excluido_por = auth.jwt() ->> 'email', excluido_em = now()
   where id = p_id;
end $$;

-- Linhas sem nenhum valor em R$ (é o que o lançador enxerga).
-- Com semana: todas as linhas daquela semana. Sem semana: o histórico de quem chamou.
create or replace function def_linhas_sem_custo(p_semana bigint default null)
returns table (
  id bigint, semana_id bigint, semana_inicio date, semana_fim date, semana_status text,
  peca_id bigint, peca text, com_dtf boolean, cor_id bigint, cor text,
  defeito_id bigint, defeito text, finalidade_id bigint, finalidade text,
  responsavel_id bigint, responsavel text, quantidade int, observacao text,
  criado_por text, criado_em timestamptz
)
language sql stable security definer set search_path = public as $$
  select l.id, l.semana_id, s.inicio, s.fim, s.status,
         l.peca_id, p.nome, l.com_dtf, l.cor_id, c.nome,
         l.defeito_id, d.nome, l.finalidade_id, f.nome,
         l.responsavel_id, r.nome, l.quantidade, l.observacao, l.criado_por, l.criado_em
  from def_lancamentos l
  join def_semanas s on s.id = l.semana_id
  join def_pecas p on p.id = l.peca_id
  join def_cores c on c.id = l.cor_id
  join def_tipos_defeito d on d.id = l.defeito_id
  join def_finalidades f on f.id = l.finalidade_id
  join def_responsaveis r on r.id = l.responsavel_id
  where not l.excluido
    and def_papel() is not null
    and (case when p_semana is not null then l.semana_id = p_semana
              else l.criado_por = auth.jwt() ->> 'email' end)
  order by s.inicio desc, l.id desc
  limit 1000
$$;

-- Recalcula uma semana com o custo médio e os parâmetros de hoje.
create or replace function def_recalcular_semana(p_semana bigint) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
  r record;
  v_regra text;
  v_medio numeric;
  v_unit numeric;
begin
  if not def_eh_gestor() then raise exception 'Só o gestor pode recalcular.'; end if;
  n := 0;
  for r in select * from def_lancamentos where semana_id = p_semana and not excluido loop
    select regra_custo into v_regra from def_finalidades where id = r.finalidade_id;
    v_medio := def_custo_medio(r.peca_id);
    v_unit := case v_regra
      when 'descarte' then v_medio + case when r.com_dtf then def_param('custo_dtf') else 0 end
      when 'costura' then def_param('custo_dia_costura') / def_param('pecas_por_dia_costura')
      else def_param('custo_dtf') end;
    update def_lancamentos
       set custo_medio_peca = v_medio, custo_unitario = v_unit,
           custo_total = round(quantidade * v_unit, 2),
           editado_por = auth.jwt() ->> 'email', editado_em = now()
     where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Custo médio atual de cada peça (tela de parâmetros).
create or replace function def_custos_medios()
returns table (peca_id bigint, peca text, modelo_estoque text, custo_medio numeric, skus int)
language sql stable security definer set search_path = public as $$
  select p.id, p.nome, p.modelo_estoque, round(avg(c.custo_total)::numeric, 2), count(c.sku_id)::int
  from def_pecas p
  left join peca_sku s on upper(s.modelo) = upper(p.modelo_estoque) and s.ativo
  left join peca_custo c on c.sku_id = s.id
  where def_eh_gestor()
  group by p.id, p.nome, p.modelo_estoque, p.ordem
  order by p.ordem
$$;

-- Modelos existentes no estoque (para o admin ligar peça → modelo).
create or replace function def_modelos_estoque() returns setof text
language sql stable security definer set search_path = public as $$
  select distinct modelo from peca_sku where ativo and def_eh_admin() order by 1
$$;

-- Ninguém anônimo chama as funções def_.
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname like 'def\_%' loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
