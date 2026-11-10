-- 004 · Peça de outra loja na devolução (a cliente devolveu uma peça que não é nossa)
alter table def_devolucao_itens drop constraint if exists def_devolucao_itens_estado_check;
alter table def_devolucao_itens add constraint def_devolucao_itens_estado_check
  check (estado in ('estoque', 'defeito', 'perda', 'outra_loja'));
comment on column def_devolucao_itens.estado is
  'estoque | defeito | perda | outra_loja (a cliente devolveu uma peça que não é nossa — base para contestar a devolução)';
