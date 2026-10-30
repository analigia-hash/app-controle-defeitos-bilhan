-- Finalidade "Vira estampa surpresa": a peça volta para o estoque, custo zero.
-- Nova regra_custo 'sem_custo' e cálculo do unitário centralizado em def_custo_unitario.

alter table def_finalidades drop constraint if exists def_finalidades_regra_custo_check;
alter table def_finalidades add constraint def_finalidades_regra_custo_check
  check (regra_custo in ('descarte', 'costura', 'dtf', 'sem_custo'));

insert into def_finalidades (nome, regra_custo, ordem)
values ('Vira estampa surpresa', 'sem_custo', 4)
on conflict (nome) do nothing;

create or replace function def_custo_unitario(p_regra text, p_medio numeric, p_com_dtf boolean) returns numeric
language sql stable security definer set search_path = public as $$
  select case p_regra
    when 'descarte' then p_medio + case when p_com_dtf then def_param('custo_dtf') else 0 end
    when 'costura' then def_param('custo_dia_costura') / def_param('pecas_por_dia_costura')
    when 'dtf' then def_param('custo_dtf')
    else 0 end
$$;

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
    if v_regra = 'descarte' and new.custo_medio_peca is null then
      raise exception 'Peça sem custo médio no app de estoque. Fale com o admin.';
    end if;
    new.custo_unitario := def_custo_unitario(v_regra, new.custo_medio_peca, new.com_dtf);
  end if;
  new.custo_total := round(new.quantidade * new.custo_unitario, 2);
  return new;
end $$;

create or replace function def_recalcular_semana(p_semana bigint) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  r record;
  v_regra text;
  v_medio numeric;
  v_unit numeric;
begin
  if not def_eh_gestor() then raise exception 'Só o gestor pode recalcular.'; end if;
  for r in select * from def_lancamentos where semana_id = p_semana and not excluido loop
    select regra_custo into v_regra from def_finalidades where id = r.finalidade_id;
    v_medio := def_custo_medio(r.peca_id);
    v_unit := def_custo_unitario(v_regra, v_medio, r.com_dtf);
    update def_lancamentos
       set custo_medio_peca = v_medio, custo_unitario = v_unit,
           custo_total = round(quantidade * v_unit, 2),
           editado_por = auth.jwt() ->> 'email', editado_em = now()
     where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function def_custo_unitario(text, numeric, boolean) from public, anon;
grant execute on function def_custo_unitario(text, numeric, boolean) to authenticated;
