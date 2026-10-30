import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const Ctx = createContext(null)

/* Papéis do PRD: lancador (só quantidades), gestor (painel + fechar semana), admin (listas e custos). */
export function AuthProvider({ children }) {
  const [sessao, setSessao] = useState(null)
  const [papel, setPapel] = useState(null)
  const [carregando, setCarregando] = useState(true)

  // 1) Sessão atual + mudanças de login/logout
  useEffect(() => {
    let vivo = true
    supabase.auth.getSession().then(({ data }) => {
      if (!vivo) return
      setSessao(data.session)
      if (!data.session) setCarregando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => {
      setSessao(s)
      if (!s) {
        setPapel(null)
        setCarregando(false)
      }
    })
    return () => {
      vivo = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // 2) Descobre o papel via RPC def_papel()
  useEffect(() => {
    if (!sessao) return
    let vivo = true
    setCarregando(true)
    supabase.rpc('def_papel').then(({ data, error }) => {
      if (!vivo) return
      if (error) console.error('Erro ao ler def_papel():', error)
      setPapel(error ? null : (data ?? null))
      setCarregando(false)
    })
    return () => {
      vivo = false
    }
  }, [sessao])

  const valor = {
    sessao,
    usuario: sessao?.user ?? null,
    email: sessao?.user?.email ?? null,
    papel,
    ehGestor: papel === 'gestor' || papel === 'admin',
    ehAdmin: papel === 'admin',
    carregando,
    sair: () => supabase.auth.signOut(),
  }

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return ctx
}
