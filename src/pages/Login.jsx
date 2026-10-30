import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  // Senha é o caminho padrão: o link por e-mail depende do serviço de envio do
  // Supabase, que tem limite baixo por hora.
  const [modoSenha, setModoSenha] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState(null) // { tipo, texto }

  const traduzir = (msg) => {
    const m = String(msg || '')
    if (/signups not allowed|user not found/i.test(m))
      return 'Este e-mail não está cadastrado. Peça para a Ana criar o seu usuário.'
    if (/invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.'
    if (/address .* is invalid|email_address_invalid/i.test(m))
      return 'O envio de e-mail do sistema está recusando este endereço no momento. Entre com a senha.'
    if (/email not confirmed/i.test(m))
      return 'Este e-mail ainda não foi confirmado. Use "Receber link por e-mail" para confirmar.'
    if (/rate limit|too many requests|for security purposes/i.test(m))
      return 'O limite de e-mails por hora estourou. Entre com a senha ou espere cerca de uma hora.'
    if (/redirect|not allowed/i.test(m))
      return 'O endereço deste site não está autorizado no Supabase (Authentication → URL Configuration → Redirect URLs).'
    if (/failed to fetch/i.test(m)) return 'Sem conexão com a internet.'
    return m
  }

  const enviarLink = async (e) => {
    e.preventDefault()
    const alvo = email.trim().toLowerCase()
    if (!alvo) return
    setEnviando(true)
    setAviso(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: alvo,
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
    })
    setEnviando(false)
    if (error) setAviso({ tipo: 'erro', texto: traduzir(error.message) })
    else
      setAviso({
        tipo: 'ok',
        texto: `Link enviado para ${alvo}. Abra o e-mail e toque em "Log In". Se não chegar em 1 minuto, olhe o spam.`,
      })
  }

  const entrarComSenha = async (e) => {
    e.preventDefault()
    setEnviando(true)
    setAviso(null)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: senha,
    })
    setEnviando(false)
    if (error) setAviso({ tipo: 'erro', texto: traduzir(error.message) })
  }

  return (
    <div className="centro-tela">
      <div className="caixa-login">
        <h1>Controle de Defeitos</h1>
        <p>Peças com defeito · Bilhan</p>

        <form onSubmit={modoSenha ? entrarComSenha : enviarLink}>
          <div className="campo">
            <label htmlFor="email">Seu e-mail</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@empresa.com.br"
              autoComplete="username"
              required
            />
          </div>

          {modoSenha && (
            <div className="campo">
              <label htmlFor="senha">Senha</label>
              <input
                id="senha"
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
          )}

          {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}

          <button type="submit" className="gigante" disabled={enviando}>
            {enviando ? 'Aguarde…' : modoSenha ? 'Entrar' : 'Receber link por e-mail'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button
            type="button"
            className="link-discreto"
            onClick={() => {
              setModoSenha((v) => !v)
              setAviso(null)
            }}
          >
            {modoSenha ? 'Esqueci a senha — receber link por e-mail' : 'Entrar com senha'}
          </button>
        </div>

        <p style={{ fontSize: 12, marginTop: 20, marginBottom: 0, lineHeight: 1.5 }}>
          Depois de entrar, este aparelho continua logado — não precisa repetir toda semana.
        </p>
      </div>
    </div>
  )
}
