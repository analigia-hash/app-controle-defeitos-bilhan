import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider.jsx'
import Login from './pages/Login.jsx'
import Lancar from './pages/Lancar.jsx'
import Historico from './pages/Historico.jsx'
import Painel from './pages/Painel.jsx'
import Cadastros from './pages/Cadastros.jsx'
import Devolucoes from './pages/Devolucoes.jsx'

/* Cada aba tem uma cor própria, no mesmo padrão do app de estoque. */
const ABAS = [
  { rota: '/lancar',    nome: 'Lançar semana', cor: '#2563eb', clara: '#eff6ff', escura: '#1e40af', papel: 'lancador' },
  { rota: '/devolucoes', nome: 'Devoluções',   cor: '#be185d', clara: '#fdf2f8', escura: '#9d174d', papel: 'lancador' },
  { rota: '/historico', nome: 'Meu histórico', cor: '#0f766e', clara: '#f0fdfa', escura: '#115e59', papel: 'lancador' },
  { rota: '/painel',    nome: 'Painel',        cor: '#d97706', clara: '#fffbeb', escura: '#92400e', papel: 'gestor' },
  { rota: '/cadastros', nome: 'Cadastros',     cor: '#7c3aed', clara: '#f5f3ff', escura: '#5b21b6', papel: 'admin' },
]

const NOME_PAPEL = { lancador: 'lançador', gestor: 'gestor', admin: 'admin' }

function TelaCarregando() {
  return (
    <div className="centro-tela">
      <div style={{ textAlign: 'center', color: '#6b7280' }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>⏳</div>
        Carregando…
      </div>
    </div>
  )
}

function SemAcesso({ email, sair }) {
  return (
    <div className="centro-tela">
      <div className="caixa-login">
        <h1>Sem acesso</h1>
        <p style={{ marginBottom: 16 }}>
          O e-mail <b>{email}</b> entrou, mas ainda não tem perfil neste app.
        </p>
        <div className="aviso atencao">
          Peça para a Ana cadastrar este e-mail em <b>Cadastros → Usuários</b>.
        </div>
        <button className="secundario" style={{ width: '100%' }} onClick={sair}>
          Sair e tentar com outro e-mail
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const { sessao, email, papel, ehGestor, ehAdmin, carregando, sair } = useAuth()
  const local = useLocation()

  if (carregando) return <TelaCarregando />
  if (!sessao) return <Login />
  if (!papel) return <SemAcesso email={email} sair={sair} />

  const pode = (p) => p === 'lancador' || (p === 'gestor' && ehGestor) || (p === 'admin' && ehAdmin)
  const visiveis = ABAS.filter((a) => pode(a.papel))
  const atual = visiveis.find((a) => local.pathname.startsWith(a.rota)) ?? visiveis[0]

  const estilo = { '--cor': atual.cor, '--cor-clara': atual.clara, '--cor-escura': atual.escura }
  const so = (p, el) => (pode(p) ? el : <Navigate to="/lancar" replace />)

  return (
    <div className="app" style={estilo}>
      <header className="topo">
        <div className="marca">DEFEITOS · BILHAN</div>
        <div className="usuario">
          <span>
            {email} · <b>{NOME_PAPEL[papel]}</b>
          </span>
          <button onClick={sair}>Sair</button>
        </div>
      </header>

      <nav className="abas">
        {visiveis.map((a) => (
          <NavLink key={a.rota} to={a.rota} className={({ isActive }) => (isActive ? 'ativa' : '')}>
            {a.nome}
          </NavLink>
        ))}
      </nav>

      <main className="conteudo">
        <Routes>
          <Route path="/" element={<Navigate to={ehGestor ? '/painel' : '/lancar'} replace />} />
          <Route path="/lancar" element={<Lancar />} />
          <Route path="/devolucoes" element={<Devolucoes />} />
          <Route path="/historico" element={<Historico />} />
          <Route path="/painel" element={so('gestor', <Painel />)} />
          <Route path="/cadastros" element={so('admin', <Cadastros />)} />
          <Route path="*" element={<Navigate to="/lancar" replace />} />
        </Routes>
      </main>
    </div>
  )
}
