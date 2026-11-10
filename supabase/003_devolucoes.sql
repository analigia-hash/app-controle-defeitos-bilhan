-- =====================================================================
-- 003 · Devoluções dos marketplaces
-- O pessoal da embalagem bipa a etiqueta do pacote que voltou, o app acha
-- loja/pedido/peças e a pessoa marca o estado de cada peça.
-- Não mexe no estoque (decisão da Ana em 09/11/2026: só registra).
-- =====================================================================

-- 1) Espelho das devoluções abertas nas plataformas (preenchido pela edge
--    function devolucoes-sync, nunca pelo app). Uma linha por solicitação.
create table if not exists def_dev_retorno (
  id             bigserial primary key,
  plataforma     text not null,            -- 'Shopee' | 'TikTok Shop' | 'SHEIN'
  loja           text not null,            -- 'jingas' | 'bilhan' | 'bubli'
  devolucao_id   text not null,            -- return_sn / return_id / returnOrderNo
  n_pedido       text,
  rastreio       text,                     -- código de rastreio da volta
  transportadora text,
  status         text,
  motivo         text,
  criado_em      timestamptz,
  itens          jsonb not null default '[]'::jsonb,  -- [{produto, variacao, quantidade, imagem}]
  atualizado_em  timestamptz not null default now(),
  unique (plataforma, loja, devolucao_id)
);
create index if not exists def_dev_retorno_rastreio on def_dev_retorno (upper(rastreio));
create index if not exists def_dev_retorno_pedido   on def_dev_retorno (upper(n_pedido));
comment on table def_dev_retorno is
  'Devoluções solicitadas nas lojas (Shopee, TikTok, SHEIN). Alimentada pela edge function devolucoes-sync. O app só lê.';

-- 2) Devolução recebida (o que a embalagem registrou)
create table if not exists def_devolucoes (
  id              bigserial primary key,
  codigo_lido     text,
  retorno_id      bigint references def_dev_retorno(id),
  plataforma      text,
  loja            text,
  n_pedido        text,
  devolucao_plataforma text,
  rastreio        text,
  motivo_cliente  text,
  identificada    boolean not null default false,
  observacao      text,
  excluido        boolean not null default false,
  criado_por      text,
  criado_em       timestamptz not null default now(),
  editado_por     text,
  editado_em      timestamptz
);
create unique index if not exists def_devolucoes_retorno_unico
  on def_devolucoes (retorno_id) where retorno_id is not null and not excluido;
create index if not exists def_devolucoes_criado on def_devolucoes (criado_em desc);

create table if not exists def_devolucao_itens (
  id            bigserial primary key,
  devolucao_id  bigint not null references def_devolucoes(id) on delete cascade,
  produto       text not null,
  variacao      text,
  sku_id        bigint,
  quantidade    integer not null check (quantidade > 0),
  estado        text not null check (estado in ('estoque', 'defeito', 'perda')),
  defeito_id    bigint references def_tipos_defeito(id),
  observacao    text
);
create index if not exists def_devolucao_itens_dev on def_devolucao_itens (devolucao_id);

-- 3) RLS: qualquer perfil do app lê; escrita só pelas funções abaixo
alter table def_dev_retorno     enable row level security;
alter table def_devolucoes      enable row level security;
alter table def_devolucao_itens enable row level security;

drop policy if exists def_dev_retorno_ler on def_dev_retorno;
create policy def_dev_retorno_ler on def_dev_retorno for select to authenticated using (def_papel() is not null);
drop policy if exists def_devolucoes_ler on def_devolucoes;
create policy def_devolucoes_ler on def_devolucoes for select to authenticated using (def_papel() is not null);
drop policy if exists def_devolucao_itens_ler on def_devolucao_itens;
create policy def_devolucao_itens_ler on def_devolucao_itens for select to authenticated using (def_papel() is not null);

-- 4) Normaliza o que o leitor devolveu: só letras e números, maiúsculo
create or replace function def_dev_normalizar(p text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- 5) Busca pelo código bipado.
--    a) devolução nas plataformas cujo rastreio está DENTRO do código lido
--       (a etiqueta da Jadlog/SHEIN embute o rastreio num código maior),
--       ou cujo nº de pedido / nº da devolução é igual ao código;
--    b) se não achar, pedido de venda com esse número (pacote que voltou sem
--       solicitação, ex.: não entregue).
create or replace function def_dev_buscar(p_codigo text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v text := def_dev_normalizar(p_codigo);
  r jsonb;
begin
  if def_papel() is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if length(v) < 6 then return jsonb_build_object('tipo', 'nada', 'codigo', v, 'resultados', '[]'::jsonb); end if;

  select jsonb_agg(x order by x->>'prioridade', x->>'criado_em' desc) into r from (
    select jsonb_build_object(
      'retorno_id', d.id, 'plataforma', d.plataforma, 'loja', d.loja,
      'n_pedido', d.n_pedido, 'devolucao_id', d.devolucao_id, 'rastreio', d.rastreio,
      'transportadora', d.transportadora, 'status', d.status, 'motivo', d.motivo,
      'criado_em', d.criado_em, 'itens', d.itens,
      'prioridade', case when def_dev_normalizar(d.rastreio) = v then '1' else '2' end,
      'ja_registrada', (select jsonb_build_object('id', g.id, 'criado_em', g.criado_em, 'criado_por', g.criado_por)
                          from def_devolucoes g where g.retorno_id = d.id and not g.excluido limit 1)
    ) x
    from def_dev_retorno d
    where (length(def_dev_normalizar(d.rastreio)) >= 8 and position(def_dev_normalizar(d.rastreio) in v) > 0)
       or upper(d.n_pedido) = v
       or upper(d.devolucao_id) = v
    limit 10
  ) s;

  if r is not null then
    return jsonb_build_object('tipo', 'retorno', 'codigo', v, 'resultados', r);
  end if;

  select jsonb_agg(x) into r from (
    select jsonb_build_object(
      'retorno_id', null, 'plataforma', m.plataforma, 'loja', m.loja, 'n_pedido', m.n_pedido,
      'criado_em', min(m.data_pedido),
      'itens', jsonb_agg(jsonb_build_object('produto', m.nome, 'variacao', m.variacao,
                                            'quantidade', m.qtd, 'sku_id', m.sku_id) order by m.linha),
      'ja_registrada', (select jsonb_build_object('id', g.id, 'criado_em', g.criado_em, 'criado_por', g.criado_por)
                          from def_devolucoes g where upper(g.n_pedido) = v and not g.excluido limit 1)
    ) x
    from venda_marketplace m
    where upper(m.n_pedido) = v
    group by m.plataforma, m.loja, m.n_pedido
  ) s;

  if r is not null then
    return jsonb_build_object('tipo', 'pedido', 'codigo', v, 'resultados', r);
  end if;
  return jsonb_build_object('tipo', 'nada', 'codigo', v, 'resultados', '[]'::jsonb);
end $$;

-- 6) Peças do estoque para a busca manual (modelo/cor/tamanho)
create or replace function def_dev_pecas()
returns table (id bigint, modelo text, cor text, tamanho text)
language sql stable security definer set search_path = public as $$
  select id, modelo, cor, tamanho from peca_sku
  where ativo and def_papel() is not null
  order by modelo, cor, tamanho
$$;

-- 7) Pedidos candidatos quando a etiqueta não identifica: pedidos dos
--    últimos 90 dias que têm as peças encontradas no pacote.
create or replace function def_dev_candidatos(p_skus bigint[])
returns table (plataforma text, loja text, n_pedido text, data_venda date,
               acertos int, total_itens int, tem_devolucao boolean, itens jsonb)
language sql stable security definer set search_path = public as $$
  with ped as (
    select m.plataforma, m.loja, m.n_pedido
    from venda_marketplace m
    where def_papel() is not null
      and m.sku_id = any(p_skus)
      and m.data_venda >= current_date - 90
    group by 1, 2, 3
  )
  select p.plataforma, p.loja, p.n_pedido,
         min(m.data_venda),
         count(distinct m.sku_id) filter (where m.sku_id = any(p_skus))::int,
         count(*)::int,
         exists (select 1 from def_dev_retorno d where upper(d.n_pedido) = upper(p.n_pedido)),
         jsonb_agg(jsonb_build_object('produto', m.nome, 'variacao', m.variacao,
                                      'quantidade', m.qtd, 'sku_id', m.sku_id) order by m.linha)
  from ped p join venda_marketplace m using (plataforma, loja, n_pedido)
  group by p.plataforma, p.loja, p.n_pedido
  order by 5 desc, 7 desc, 4 desc
  limit 15
$$;

-- 8) Salvar uma devolução recebida
create or replace function def_dev_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_email text := auth.jwt() ->> 'email';
  v_ret bigint := nullif(p->>'retorno_id', '')::bigint;
  it jsonb;
begin
  if def_papel() is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p->'itens', '[]'::jsonb)) = 0 then
    raise exception 'Informe pelo menos uma peça.';
  end if;
  if v_ret is not null and exists (select 1 from def_devolucoes where retorno_id = v_ret and not excluido) then
    raise exception 'Esta devolução já foi registrada.';
  end if;

  insert into def_devolucoes (codigo_lido, retorno_id, plataforma, loja, n_pedido, devolucao_plataforma,
                              rastreio, motivo_cliente, identificada, observacao, criado_por)
  values (nullif(p->>'codigo_lido', ''), v_ret, nullif(p->>'plataforma', ''), nullif(p->>'loja', ''),
          nullif(p->>'n_pedido', ''), nullif(p->>'devolucao_id', ''), nullif(p->>'rastreio', ''),
          nullif(p->>'motivo', ''), nullif(p->>'n_pedido', '') is not null,
          nullif(p->>'observacao', ''), v_email)
  returning id into v_id;

  for it in select * from jsonb_array_elements(p->'itens') loop
    insert into def_devolucao_itens (devolucao_id, produto, variacao, sku_id, quantidade, estado, defeito_id, observacao)
    values (v_id, it->>'produto', nullif(it->>'variacao', ''), nullif(it->>'sku_id', '')::bigint,
            (it->>'quantidade')::int, it->>'estado', nullif(it->>'defeito_id', '')::bigint,
            nullif(it->>'observacao', ''));
  end loop;
  return v_id;
end $$;

-- 9) Ligar uma devolução "não identificada" a um pedido (gestor)
create or replace function def_dev_vincular(p_id bigint, p_plataforma text, p_loja text, p_n_pedido text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not def_eh_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  update def_devolucoes
     set plataforma = p_plataforma, loja = p_loja, n_pedido = nullif(p_n_pedido, ''),
         identificada = nullif(p_n_pedido, '') is not null,
         retorno_id = coalesce(retorno_id, (select d.id from def_dev_retorno d
                                             where upper(d.n_pedido) = upper(p_n_pedido) limit 1)),
         editado_por = auth.jwt() ->> 'email', editado_em = now()
   where id = p_id;
end $$;

-- 10) Excluir (gestor)
create or replace function def_dev_excluir(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not def_eh_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  update def_devolucoes set excluido = true, editado_por = auth.jwt() ->> 'email', editado_em = now()
   where id = p_id;
end $$;

-- 11) Pedir uma sincronização na hora (botão do app / busca que não achou)
create or replace function def_dev_sincronizar() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if def_papel() is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  perform net.http_post(
    url := 'https://nhhagrnemdhoollkhbma.supabase.co/functions/v1/devolucoes-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oaGFncm5lbWRob29sbGtoYm1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNjA0OTAsImV4cCI6MjA5ODgzNjQ5MH0.Sjta_idFNjjebiv5fCkl34xPZSIDyuvE18q6oyKZ6S8'),
    body := '{"dias":45}'::jsonb,
    timeout_milliseconds := 5000);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'def_dev_buscar(text)', 'def_dev_pecas()', 'def_dev_candidatos(bigint[])', 'def_dev_salvar(jsonb)',
    'def_dev_vincular(bigint,text,text,text)', 'def_dev_excluir(bigint)', 'def_dev_sincronizar()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 12) Sincronização automática de hora em hora
select cron.unschedule('devolucoes-sync-1h') where exists (select 1 from cron.job where jobname = 'devolucoes-sync-1h');
select cron.schedule('devolucoes-sync-1h', '13 * * * *', $c$
  select net.http_post(
    url := 'https://nhhagrnemdhoollkhbma.supabase.co/functions/v1/devolucoes-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oaGFncm5lbWRob29sbGtoYm1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNjA0OTAsImV4cCI6MjA5ODgzNjQ5MH0.Sjta_idFNjjebiv5fCkl34xPZSIDyuvE18q6oyKZ6S8'),
    body := '{"dias":45}'::jsonb,
    timeout_milliseconds := 5000);
$c$);
