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
    .select(
      '*, itens:def_devolucao_itens(*), fotos:def_devolucao_fotos(id, path), retorno:def_dev_retorno(plataforma, status, devolucao_id)'
    )
    .eq('excluido', false)
    .gte('criado_em', desdeISO)
    .order('criado_em', { ascending: false })
    .limit(500)
  if (error) throw error
  return data
}

/* ---------------- fotos ---------------- */
const BUCKET = 'devolucoes'

/** Reduz a foto (até 1600 px, JPEG) antes de subir: a Shopee e o TikTok recusam arquivos grandes. */
export async function comprimirFoto(file, max = 1600, qualidade = 0.82) {
  let src
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    src = await new Promise((res, rej) => {
      const url = URL.createObjectURL(file)
      const im = new Image()
      im.onload = () => {
        URL.revokeObjectURL(url)
        res(im)
      }
      im.onerror = rej
      im.src = url
    })
  }
  const f = Math.min(1, max / Math.max(src.width, src.height))
  const cv = document.createElement('canvas')
  cv.width = Math.round(src.width * f)
  cv.height = Math.round(src.height * f)
  cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height)
  return await new Promise((res) => cv.toBlob(res, 'image/jpeg', qualidade))
}

/** Sobe as fotos de uma devolução. Devolve quantas subiram. */
export async function subirFotos(devolucaoId, blobs) {
  let n = 0
  for (const [i, blob] of blobs.entries()) {
    const path = `${devolucaoId}/${Date.now()}-${i}.jpg`
    const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
    if (up.error) throw up.error
    const { error } = await supabase.from('def_devolucao_fotos').insert({ devolucao_id: devolucaoId, path })
    if (error) throw error
    n++
  }
  return n
}

/** Links temporários (1 h) para mostrar as fotos. */
export async function linksFotos(paths) {
  if (!paths.length) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
  if (error) throw error
  return Object.fromEntries(data.map((d) => [d.path, d.signedUrl]))
}

/* ---------------- contestação (só admin) ---------------- */
async function contestar(corpo) {
  const { data, error } = await supabase.functions.invoke('devolucoes-contestar', { body: corpo })
  if (error) {
    // a função devolve { erro } mesmo com status de erro
    try {
      const j = await error.context?.json?.()
      if (j?.erro) throw new Error(j.erro)
    } catch (e) {
      if (e?.message) throw e
    }
    throw error
  }
  return data
}
export const opcoesContestacao = (devolucaoId) => contestar({ acao: 'opcoes', devolucao_id: devolucaoId })
export const enviarContestacao = (dados) => contestar({ acao: 'enviar', ...dados })

export async function listarContestacoes(ids) {
  if (!ids.length) return []
  const { data, error } = await supabase
    .from('def_dev_contestacao')
    .select('id, devolucao_id, plataforma, motivo_texto, ok, resposta, criado_em')
    .in('devolucao_id', ids)
    .order('criado_em', { ascending: false })
  if (error) throw error
  return data
}
