import { supabase } from './supabase.js'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw error
  return data
}

export const ESTADOS = [
  { id: 'estoque', nome: 'Volta pro estoque', curto: 'Estoque', cor: '#16a34a' },
  { id: 'defeito', nome: 'Defeito', curto: 'Defeito', cor: '#d97706' },
  { id: 'perda', nome: 'Perda / não volta', curto: 'Perda', cor: '#dc2626' },
  // não é botão da peça: entra pelo "+ Veio peça de outra loja"
  { id: 'outra_loja', nome: 'Peça de outra loja', curto: 'Outra loja', cor: '#7c3aed', fixo: true },
]
export const estadoPorId = (id) => ESTADOS.find((e) => e.id === id)

const NOME_LOJA = {
  'Shopee|jingas': 'Shopee Jingas',
  'Shopee|bilhan': 'Shopee Bilhan',
  'TikTok Shop|bubli': 'TikTok Bubli',
  'TikTok Shop|bilhan': 'TikTok Bilhan',
  'SHEIN|bilhan': 'SHEIN Bilhan',
}
export const nomeLoja = (plataforma, loja) =>
  plataforma ? NOME_LOJA[`${plataforma}|${loja}`] ?? `${plataforma} ${loja ?? ''}`.trim() : 'Loja não identificada'

/** Procura o código bipado nas devoluções das lojas e, se não achar, nos pedidos de venda. */
export const buscarCodigo = (codigo) => rpc('def_dev_buscar', { p_codigo: codigo })

/** Pede para a função devolucoes-sync puxar as devoluções das lojas agora (leva ~30 s). */
export const sincronizarDevolucoes = () => rpc('def_dev_sincronizar')

export const pecasEstoque = () => rpc('def_dev_pecas')

export const candidatos = (skuIds) => rpc('def_dev_candidatos', { p_skus: skuIds })

export const salvarDevolucao = (dev) => rpc('def_dev_salvar', { p: dev })

export const vincularPedido = (id, plataforma, loja, nPedido) =>
  rpc('def_dev_vincular', { p_id: id, p_plataforma: plataforma, p_loja: loja, p_n_pedido: nPedido })

export const excluirDevolucao = (id) => rpc('def_dev_excluir', { p_id: id })

/** Devoluções recebidas desde a data (com as peças). */
export async function listarDevolucoes(desdeISO) {
  const { data, error } = await supabase
    .from('def_devolucoes')
    .select('*, itens:def_devolucao_itens(*)')
    .eq('excluido', false)
    .gte('criado_em', desdeISO)
    .order('criado_em', { ascending: false })
    .limit(500)
  if (error) throw error
  return data
}
