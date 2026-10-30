import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !chave) {
  throw new Error(
    'Faltam as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY. ' +
      'Local: crie o arquivo .env na raiz do projeto. ' +
      'Netlify: cadastre em Site configuration → Environment variables e refaça o deploy.'
  )
}

export const supabase = createClient(url, chave, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  },
})

/** Traduz erros técnicos do Supabase para português claro. */
export function mensagemErro(erro) {
  if (!erro) return 'Erro desconhecido.'
  const msg = String(erro.message || erro)
  const cod = erro.code || ''

  if (cod === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'Você não tem permissão para isso.'
  }
  if (cod === '23505' || /duplicate key/i.test(msg)) {
    return 'Já existe um item com esse nome.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Sem conexão com a internet. Verifique a rede e tente de novo.'
  }
  if (/jwt|token|not authenticated/i.test(msg)) {
    return 'Sua sessão expirou. Saia e entre de novo.'
  }
  return msg
}
