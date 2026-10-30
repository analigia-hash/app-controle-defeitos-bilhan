import { supabase } from './supabase.js'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw error
  return data
}

/* ---------- Listas ---------- */

export const LISTAS = {
  pecas: 'def_pecas',
  cores: 'def_cores',
  defeitos: 'def_tipos_defeito',
  finalidades: 'def_finalidades',
  responsaveis: 'def_responsaveis',
}

/** Carrega as cinco listas. somenteAtivos=true é o que o formulário usa. */
export async function carregarListas(somenteAtivos = true) {
  const pares = await Promise.all(
    Object.entries(LISTAS).map(async ([chave, tabela]) => {
      let q = supabase.from(tabela).select('*').order('ordem').order('nome')
      if (somenteAtivos) q = q.eq('ativo', true)
      const { data, error } = await q
      if (error) throw error
      return [chave, data]
    })
  )
  return Object.fromEntries(pares)
}

export async function salvarItemLista(tabela, item) {
  const { id, ...campos } = item
  const q = id
    ? supabase.from(tabela).update(campos).eq('id', id)
    : supabase.from(tabela).insert(campos)
  const { error } = await q
  if (error) throw error
}

export const sincronizarCores = () => rpc('def_sincronizar_cores')
export const modelosEstoque = () => rpc('def_modelos_estoque')
export const custosMedios = () => rpc('def_custos_medios')

/* ---------- Semanas ---------- */

export const garantirSemana = (dataISO) => rpc('def_semana_garantir', { p_data: dataISO })
export const fecharSemana = (id, fechar) => rpc('def_fechar_semana', { p_semana: id, p_fechar: fechar })
export const recalcularSemana = (id) => rpc('def_recalcular_semana', { p_semana: id })

/* ---------- Linhas ---------- */

/** Linhas sem valores em R$: de uma semana, ou (sem semana) o histórico de quem chamou. */
export const linhasSemCusto = (semanaId = null) => rpc('def_linhas_sem_custo', { p_semana: semanaId })

export function salvarLinha(l) {
  return rpc('def_salvar_linha', {
    p_id: l.id ?? null,
    p_semana: l.semana_id,
    p_peca: l.peca_id,
    p_com_dtf: l.com_dtf,
    p_cor: l.cor_id,
    p_defeito: l.defeito_id,
    p_finalidade: l.finalidade_id,
    p_responsavel: l.responsavel_id,
    p_quantidade: l.quantidade,
    p_observacao: l.observacao ?? null,
  })
}

export const excluirLinha = (id) => rpc('def_excluir_linha', { p_id: id })

/** Linhas do painel (com custo) cujas semanas terminam dentro do intervalo. */
export async function linhasPainel(de, ate) {
  const todas = []
  const passo = 1000
  for (let ini = 0; ; ini += passo) {
    const { data, error } = await supabase
      .from('def_painel')
      .select('*')
      .gte('semana_fim', de)
      .lte('semana_fim', ate)
      .order('semana_inicio')
      .order('id')
      .range(ini, ini + passo - 1)
    if (error) throw error
    todas.push(...data)
    if (data.length < passo) break
  }
  return todas
}

/* ---------- Parâmetros ---------- */

export async function historicoParametros() {
  const { data, error } = await supabase
    .from('def_parametros_custo')
    .select('*')
    .order('vigente_desde', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw error
  return data
}

/** Valor vigente hoje de cada chave. */
export function parametrosVigentes(historico, hoje) {
  const vig = {}
  for (const p of historico) {
    if (p.vigente_desde <= hoje && vig[p.chave] === undefined) vig[p.chave] = Number(p.valor)
  }
  return vig
}

export async function novoParametro(chave, valor, vigenteDesde) {
  const { error } = await supabase
    .from('def_parametros_custo')
    .insert({ chave, valor, vigente_desde: vigenteDesde })
  if (error) throw error
}

/* ---------- Usuários ---------- */

export async function listarPerfis() {
  const { data, error } = await supabase.from('def_perfil').select('*').order('email')
  if (error) throw error
  return data
}

export async function salvarPerfil(p) {
  const { error } = await supabase
    .from('def_perfil')
    .upsert({ email: p.email.trim().toLowerCase(), nome: p.nome || null, papel: p.papel })
  if (error) throw error
}

export async function removerPerfil(email) {
  const { error } = await supabase.from('def_perfil').delete().eq('email', email)
  if (error) throw error
}
