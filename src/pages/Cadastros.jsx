import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../components/Toast.jsx'
import {
  LISTAS,
  carregarListas,
  custosMedios,
  historicoParametros,
  listarPerfis,
  modelosEstoque,
  novoParametro,
  parametrosVigentes,
  removerPerfil,
  salvarItemLista,
  salvarPerfil,
  sincronizarCores,
} from '../lib/dados.js'
import { dataBR, dataHoraBR, hojeISO, reais } from '../lib/formato.js'
import { mensagemErro } from '../lib/supabase.js'

const SECOES = [
  { id: 'pecas', nome: 'Peças' },
  { id: 'defeitos', nome: 'Defeitos' },
  { id: 'finalidades', nome: 'Finalidades' },
  { id: 'responsaveis', nome: 'Responsáveis' },
  { id: 'cores', nome: 'Cores' },
  { id: 'parametros', nome: 'Custos' },
  { id: 'usuarios', nome: 'Usuários' },
]

const REGRAS = [
  { id: 'descarte', nome: 'Descarte (custo médio da peça + DTF se tiver)' },
  { id: 'costura', nome: 'Costura (dia de costura ÷ peças por dia)' },
  { id: 'dtf', nome: 'DTF (custo do DTF)' },
  { id: 'sem_custo', nome: 'Sem custo (a peça volta para o estoque)' },
]

function LinhaItem({ item, secao, modelos, onSalvar }) {
  const [e, setE] = useState(item)
  const mudou = JSON.stringify(e) !== JSON.stringify(item)
  const novo = !item.id
  return (
    <tr className={e.ativo ? '' : 'inativo'}>
      <td>
        <input
          value={e.nome}
          onChange={(ev) => setE({ ...e, nome: ev.target.value })}
          placeholder={novo ? 'Novo item…' : ''}
          disabled={secao === 'cores'}
        />
      </td>
      {secao === 'pecas' && (
        <td>
          <select value={e.modelo_estoque ?? ''} onChange={(ev) => setE({ ...e, modelo_estoque: ev.target.value })}>
            <option value="">— escolha —</option>
            {modelos.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </td>
      )}
      {secao === 'finalidades' && (
        <td>
          <select value={e.regra_custo ?? ''} onChange={(ev) => setE({ ...e, regra_custo: ev.target.value })}>
            <option value="">— escolha —</option>
            {REGRAS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
        </td>
      )}
      <td style={{ width: 90 }}>
        <input type="number" value={e.ordem ?? 0} onChange={(ev) => setE({ ...e, ordem: Number(ev.target.value) })} />
      </td>
      <td style={{ width: 90, textAlign: 'center' }}>
        <input
          type="checkbox"
          className="check"
          checked={e.ativo}
          onChange={(ev) => setE({ ...e, ativo: ev.target.checked })}
          aria-label="Ativo"
        />
      </td>
      <td style={{ width: 110 }}>
        <button
          className="pequeno"
          disabled={!mudou || !e.nome.trim()}
          onClick={async () => {
            const ok = await onSalvar({ ...e, nome: e.nome.trim() })
            if (ok && novo) setE(item)
          }}
        >
          {novo ? 'Adicionar' : 'Salvar'}
        </button>
      </td>
    </tr>
  )
}

function EditorLista({ secao, itens, onRecarregar }) {
  const toast = useToast()
  const [modelos, setModelos] = useState([])
  const [custos, setCustos] = useState([])

  useEffect(() => {
    if (secao !== 'pecas') return
    modelosEstoque().then(setModelos).catch(() => {})
    custosMedios().then(setCustos).catch(() => {})
  }, [secao, itens])

  const salvar = async (item) => {
    try {
      await salvarItemLista(LISTAS[secao], item)
      toast.ok('Salvo.')
      onRecarregar()
      return true
    } catch (e) {
      toast.erro(mensagemErro(e))
      return false
    }
  }

  const sincronizar = async () => {
    try {
      const n = await sincronizarCores()
      toast.ok(n ? `${n} cores novas vieram do estoque.` : 'As cores já estão em dia com o estoque.')
      onRecarregar()
    } catch (e) {
      toast.erro(mensagemErro(e))
    }
  }

  const novo = { nome: '', ativo: true, ordem: (itens.at(-1)?.ordem ?? 0) + 1 }

  return (
    <div className="card">
      {secao === 'cores' ? (
        <div className="aviso info">
          As cores vêm do app de estoque. Aqui você só desativa uma cor para ela sumir do formulário.{' '}
          <button className="pequeno" onClick={sincronizar}>
            Buscar cores novas
          </button>
        </div>
      ) : (
        <p className="explica">
          Item desativado some do formulário, mas continua no histórico e no painel. Renomear muda o nome em
          todas as semanas.
        </p>
      )}
      {secao === 'pecas' && custos.length > 0 && (
        <div className="custos-medios">
          {custos.map((c) => (
            <span key={c.peca_id}>
              {c.peca}: <b>{c.custo_medio === null ? 'sem custo!' : reais(c.custo_medio)}</b>{' '}
              <small>({c.skus} SKUs)</small>
            </span>
          ))}
        </div>
      )}
      <div className="tabela-wrap">
        <table className="editor">
          <thead>
            <tr>
              <th>Nome</th>
              {secao === 'pecas' && <th>Modelo no estoque (custo médio)</th>}
              {secao === 'finalidades' && <th>Regra de custo</th>}
              <th>Ordem</th>
              <th style={{ textAlign: 'center' }}>Ativo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <LinhaItem key={i.id + JSON.stringify(i)} item={i} secao={secao} modelos={modelos} onSalvar={salvar} />
            ))}
            {secao !== 'cores' && <LinhaItem key={'novo' + itens.length} item={novo} secao={secao} modelos={modelos} onSalvar={salvar} />}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const PARAMETROS = [
  { chave: 'custo_dia_costura', nome: 'Custo de 1 dia de costura (R$)', passo: '0.01' },
  { chave: 'pecas_por_dia_costura', nome: 'Peças por dia de costura', passo: '1' },
  { chave: 'custo_dtf', nome: 'Custo do DTF por peça (R$)', passo: '0.01' },
]

function Parametros() {
  const toast = useToast()
  const [hist, setHist] = useState(null)
  const [form, setForm] = useState({ chave: 'custo_dia_costura', valor: '', vigente: hojeISO() })

  const carregar = useCallback(() => {
    historicoParametros()
      .then(setHist)
      .catch((e) => toast.erro(mensagemErro(e)))
  }, [toast])
  useEffect(carregar, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!hist) return <div className="vazio">Carregando…</div>
  const vig = parametrosVigentes(hist, hojeISO())
  const porPeca = vig.custo_dia_costura && vig.pecas_por_dia_costura ? vig.custo_dia_costura / vig.pecas_por_dia_costura : null

  const salvar = async () => {
    const valor = Number(String(form.valor).replace(',', '.'))
    if (!(valor > 0)) return toast.erro('Informe um valor maior que zero.')
    try {
      await novoParametro(form.chave, valor, form.vigente)
      toast.ok('Novo valor registrado.')
      setForm({ ...form, valor: '' })
      carregar()
    } catch (e) {
      toast.erro(mensagemErro(e))
    }
  }

  return (
    <>
      <div className="kpis">
        {PARAMETROS.map((p) => (
          <div key={p.chave} className="kpi">
            <div className="rot">{p.nome}</div>
            <div className="val">
              {vig[p.chave] === undefined ? '—' : p.chave === 'pecas_por_dia_costura' ? vig[p.chave] : reais(vig[p.chave])}
            </div>
          </div>
        ))}
        <div className="kpi">
          <div className="rot">Costura por peça</div>
          <div className="val">{porPeca === null ? '—' : reais(porPeca)}</div>
        </div>
      </div>

      <div className="card">
        <h3>Mudar um valor</h3>
        <p className="explica">
          O valor novo vale para lançamentos enviados a partir da data de vigência. Semanas já lançadas não mudam
          (a não ser que o gestor use "Recalcular custos" na semana).
        </p>
        <div className="linha">
          <div className="campo">
            <label>Parâmetro</label>
            <select value={form.chave} onChange={(e) => setForm({ ...form, chave: e.target.value })}>
              {PARAMETROS.map((p) => (
                <option key={p.chave} value={p.chave}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label>Novo valor</label>
            <input inputMode="decimal" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
          </div>
          <div className="campo">
            <label>Vale a partir de</label>
            <input type="date" value={form.vigente} onChange={(e) => setForm({ ...form, vigente: e.target.value })} />
          </div>
        </div>
        <button onClick={salvar}>Registrar</button>
      </div>

      <div className="card">
        <h3>Histórico</h3>
        <div className="tabela-wrap">
          <table>
            <thead>
              <tr>
                <th>Parâmetro</th>
                <th className="num">Valor</th>
                <th>Vigente desde</th>
                <th>Por</th>
                <th>Em</th>
              </tr>
            </thead>
            <tbody>
              {hist.map((h) => (
                <tr key={h.id}>
                  <td>{PARAMETROS.find((p) => p.chave === h.chave)?.nome ?? h.chave}</td>
                  <td className="num">{String(h.valor).replace('.', ',')}</td>
                  <td>{dataBR(h.vigente_desde)}</td>
                  <td>{h.criado_por}</td>
                  <td>{dataHoraBR(h.criado_em)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

const PAPEIS = [
  { id: 'lancador', nome: 'Lançador — só lança, não vê R$' },
  { id: 'gestor', nome: 'Gestor — painel e fechar semana' },
  { id: 'admin', nome: 'Admin — tudo + listas e custos' },
]

function Usuarios() {
  const toast = useToast()
  const [lista, setLista] = useState(null)
  const [novo, setNovo] = useState({ email: '', nome: '', papel: 'lancador' })

  const carregar = useCallback(() => {
    listarPerfis()
      .then(setLista)
      .catch((e) => toast.erro(mensagemErro(e)))
  }, [toast])
  useEffect(carregar, []) // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = async (p) => {
    try {
      await salvarPerfil(p)
      toast.ok('Usuário salvo.')
      carregar()
      return true
    } catch (e) {
      toast.erro(mensagemErro(e))
      return false
    }
  }

  const remover = async (email) => {
    if (!window.confirm(`Tirar o acesso de ${email} a este app?`)) return
    try {
      await removerPerfil(email)
      toast.ok('Acesso removido.')
      carregar()
    } catch (e) {
      toast.erro(mensagemErro(e))
    }
  }

  if (!lista) return <div className="vazio">Carregando…</div>

  return (
    <div className="card">
      <p className="explica">
        O login (e-mail e senha) é o mesmo dos outros apps da empresa, criado no Supabase em Authentication →
        Users. Aqui você só diz o que cada pessoa pode fazer neste app.
      </p>
      <div className="tabela-wrap">
        <table className="editor">
          <thead>
            <tr>
              <th>E-mail</th>
              <th>Nome</th>
              <th>Papel</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.email}>
                <td>{p.email}</td>
                <td>{p.nome}</td>
                <td>
                  <select value={p.papel} onChange={(e) => salvar({ ...p, papel: e.target.value })}>
                    {PAPEIS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nome}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button className="pequeno secundario" onClick={() => remover(p.email)}>
                    Remover
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <input
                  type="email"
                  placeholder="email@…"
                  value={novo.email}
                  onChange={(e) => setNovo({ ...novo, email: e.target.value })}
                />
              </td>
              <td>
                <input placeholder="Sandy" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
              </td>
              <td>
                <select value={novo.papel} onChange={(e) => setNovo({ ...novo, papel: e.target.value })}>
                  {PAPEIS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nome}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  className="pequeno"
                  disabled={!novo.email.includes('@')}
                  onClick={async () => (await salvar(novo)) && setNovo({ email: '', nome: '', papel: 'lancador' })}
                >
                  Adicionar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Cadastros() {
  const [secao, setSecao] = useState('pecas')
  const [listas, setListas] = useState(null)
  const [erro, setErro] = useState(null)

  const recarregar = useCallback(() => {
    carregarListas(false)
      .then(setListas)
      .catch((e) => setErro(mensagemErro(e)))
  }, [])
  useEffect(recarregar, [recarregar])

  return (
    <div>
      <h2 className="titulo-pagina">Cadastros</h2>
      <div className="sub-abas">
        {SECOES.map((s) => (
          <button key={s.id} className={secao === s.id ? 'ativa' : ''} onClick={() => setSecao(s.id)}>
            {s.nome}
          </button>
        ))}
      </div>
      {erro && <div className="aviso erro">{erro}</div>}
      {secao === 'parametros' ? (
        <Parametros />
      ) : secao === 'usuarios' ? (
        <Usuarios />
      ) : !listas ? (
        <div className="vazio">Carregando…</div>
      ) : (
        <EditorLista secao={secao} itens={listas[secao]} onRecarregar={recarregar} />
      )}
    </div>
  )
}
