import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarrasHorizontais, GraficoSemanas, MapaCalor, MultiSelecao, NOMES_REGRA } from '../components/Graficos.jsx'
import { carregarListas, historicoParametros, linhasPainel, parametrosVigentes } from '../lib/dados.js'
import {
  dataBR,
  dataHoraBR,
  deISO,
  fimSemana,
  hojeISO,
  inicioSemana,
  num,
  num1,
  paraISO,
  reais,
  rotuloSemana,
  somarDias,
  variacao,
} from '../lib/formato.js'
import { mensagemErro } from '../lib/supabase.js'

/* Uma linha entra no período pela sexta-feira da sua semana (semana_fim). */
const PERIODOS = [
  { id: 'semana', nome: 'Esta semana' },
  { id: 'semana_passada', nome: 'Semana passada' },
  { id: 'mes', nome: 'Mês atual' },
  { id: 'mes_passado', nome: 'Mês passado' },
  { id: 'tri', nome: 'Últimos 3 meses' },
  { id: 'custom', nome: 'Personalizado' },
]

const primeiroDia = (d, mesesAtras = 0) => paraISO(new Date(d.getFullYear(), d.getMonth() - mesesAtras, 1))
const ultimoDia = (d, mesesAtras = 0) => paraISO(new Date(d.getFullYear(), d.getMonth() - mesesAtras + 1, 0))

function intervalos(periodo, custom) {
  const hoje = hojeISO()
  const sexta = fimSemana(inicioSemana(hoje))
  const d = deISO(hoje)
  switch (periodo) {
    case 'semana':
      return { de: sexta, ate: sexta, antDe: somarDias(sexta, -7), antAte: somarDias(sexta, -7) }
    case 'semana_passada':
      return { de: somarDias(sexta, -7), ate: somarDias(sexta, -7), antDe: somarDias(sexta, -14), antAte: somarDias(sexta, -14) }
    case 'mes':
      return { de: primeiroDia(d), ate: ultimoDia(d), antDe: primeiroDia(d, 1), antAte: ultimoDia(d, 1) }
    case 'mes_passado':
      return { de: primeiroDia(d, 1), ate: ultimoDia(d, 1), antDe: primeiroDia(d, 2), antAte: ultimoDia(d, 2) }
    case 'tri':
      return { de: primeiroDia(d, 2), ate: ultimoDia(d), antDe: primeiroDia(d, 5), antAte: ultimoDia(d, 3) }
    default: {
      const dias = Math.round((deISO(custom.ate) - deISO(custom.de)) / 86400000) + 1
      return { de: custom.de, ate: custom.ate, antDe: somarDias(custom.de, -dias), antAte: somarDias(custom.de, -1) }
    }
  }
}

const DIMENSOES = [
  { k: 'peca_id', rotulo: 'Peça', lista: 'pecas' },
  { k: 'com_dtf', rotulo: 'DTF' },
  { k: 'cor_id', rotulo: 'Cor', lista: 'cores' },
  { k: 'defeito_id', rotulo: 'Defeito', lista: 'defeitos' },
  { k: 'finalidade_id', rotulo: 'Finalidade', lista: 'finalidades' },
  { k: 'responsavel_id', rotulo: 'Responsável', lista: 'responsaveis' },
]

const filtrosVazios = () => Object.fromEntries(DIMENSOES.map((d) => [d.k, new Set()]))

function somar(linhas) {
  const t = {
    custo: 0, pecas: 0, descarte: 0, costura: 0, dtf: 0, sem_custo: 0,
    pDescarte: 0, pCostura: 0, pDtf: 0, pSem_custo: 0,
  }
  for (const l of linhas) {
    const c = Number(l.custo_total)
    t.custo += c
    t.pecas += l.quantidade
    t[l.regra_custo] += c
    t['p' + l.regra_custo[0].toUpperCase() + l.regra_custo.slice(1)] += l.quantidade
  }
  return t
}

function agrupar(linhas, chave) {
  const m = new Map()
  for (const l of linhas) {
    const g = m.get(l[chave]) ?? { nome: l[chave], custo: 0, pecas: 0 }
    g.custo += Number(l.custo_total)
    g.pecas += l.quantidade
    m.set(l[chave], g)
  }
  return [...m.values()]
}

function Variacao({ atual, anterior, inverter = true }) {
  const v = variacao(atual, anterior)
  if (v === null) return <span className="var neutra">sem base anterior</span>
  // Para defeitos, subir é ruim (vermelho) e cair é bom (verde).
  const ruim = inverter ? v > 0 : v < 0
  return (
    <span className={`var ${v === 0 ? 'neutra' : ruim ? 'ruim' : 'boa'}`}>
      {v > 0 ? '▲' : v < 0 ? '▼' : '='} {num1(Math.abs(v))}% vs. anterior
    </span>
  )
}

function exportarCSV(linhas, de, ate) {
  const cab = [
    'Semana', 'Peça', 'DTF', 'Cor', 'Defeito', 'Finalidade', 'Responsável', 'Quantidade',
    'Custo médio peça', 'Custo unitário', 'Custo total', 'Observação', 'Lançado por', 'Lançado em',
  ]
  const dec = (v) => (v === null || v === undefined ? '' : String(Number(v).toFixed(2)).replace('.', ','))
  const esc = (v) => {
    const s = String(v ?? '')
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const corpo = linhas.map((l) =>
    [
      rotuloSemana(l.semana_inicio), l.peca, l.com_dtf ? 'Com DTF' : 'Sem DTF', l.cor, l.defeito,
      l.finalidade, l.responsavel, l.quantidade, dec(l.custo_medio_peca), dec(l.custo_unitario),
      dec(l.custo_total), l.observacao, l.criado_por, dataHoraBR(l.criado_em),
    ]
      .map(esc)
      .join(';')
  )
  const csv = '﻿' + [cab.join(';'), ...corpo].join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `defeitos_${de}_a_${ate}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function Painel() {
  const [periodo, setPeriodo] = useState('mes')
  const [custom, setCustom] = useState(() => ({ de: primeiroDia(new Date()), ate: hojeISO() }))
  const [filtros, setFiltros] = useState(filtrosVazios)
  const [listas, setListas] = useState(null)
  const [params, setParams] = useState({})
  const [dados, setDados] = useState(null) // { atual, anterior }
  const [erro, setErro] = useState(null)
  const [medidaPeca, setMedidaPeca] = useState('pecas')

  const iv = useMemo(() => intervalos(periodo, custom), [periodo, custom])

  useEffect(() => {
    carregarListas(false).then(setListas).catch((e) => setErro(mensagemErro(e)))
    historicoParametros()
      .then((h) => setParams(parametrosVigentes(h, hojeISO())))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (iv.de > iv.ate) return
    let vivo = true
    setDados(null)
    setErro(null)
    linhasPainel(iv.antDe, iv.ate)
      .then((todas) => {
        if (!vivo) return
        setDados({
          atual: todas.filter((l) => l.semana_fim >= iv.de),
          anterior: todas.filter((l) => l.semana_fim >= iv.antDe && l.semana_fim <= iv.antAte),
        })
      })
      .catch((e) => vivo && setErro(mensagemErro(e)))
    return () => {
      vivo = false
    }
  }, [iv])

  const aplicaFiltros = (linhas) =>
    linhas.filter((l) => DIMENSOES.every((d) => filtros[d.k].size === 0 || filtros[d.k].has(l[d.k])))

  const atual = useMemo(() => (dados ? aplicaFiltros(dados.atual) : []), [dados, filtros]) // eslint-disable-line react-hooks/exhaustive-deps
  const anterior = useMemo(() => (dados ? aplicaFiltros(dados.anterior) : []), [dados, filtros]) // eslint-disable-line react-hooks/exhaustive-deps

  const t = useMemo(() => somar(atual), [atual])
  const ta = useMemo(() => somar(anterior), [anterior])

  // Todas as semanas do período, inclusive as sem lançamento, para a tendência não enganar.
  const semanas = useMemo(() => {
    const porSemana = new Map()
    for (const l of atual) {
      const s = porSemana.get(l.semana_inicio) ?? { descarte: 0, costura: 0, dtf: 0, sem_custo: 0, total: 0, pecas: 0 }
      s[l.regra_custo] += Number(l.custo_total)
      s.total += Number(l.custo_total)
      s.pecas += l.quantidade
      porSemana.set(l.semana_inicio, s)
    }
    const lista = []
    const limite = iv.ate > hojeISO() ? fimSemana(inicioSemana(hojeISO())) : iv.ate
    for (let fim = fimSemana(inicioSemana(iv.de)); fim <= limite; fim = somarDias(fim, 7)) {
      if (fim < iv.de) continue
      const inicio = somarDias(fim, -6)
      lista.push({ inicio, fim, ...(porSemana.get(inicio) ?? { descarte: 0, costura: 0, dtf: 0, total: 0, pecas: 0 }) })
    }
    return lista
  }, [atual, iv])

  const porDefeito = useMemo(() => agrupar(atual, 'defeito').sort((a, b) => b.custo - a.custo), [atual])
  const porResp = useMemo(() => agrupar(atual, 'responsavel').sort((a, b) => b.custo - a.custo), [atual])
  const porPeca = useMemo(
    () => agrupar(atual, 'peca').sort((a, b) => b[medidaPeca] - a[medidaPeca]),
    [atual, medidaPeca]
  )

  const diasCostura = params.pecas_por_dia_costura ? t.pCostura / params.pecas_por_dia_costura : null
  const diasCosturaAnt = params.pecas_por_dia_costura ? ta.pCostura / params.pecas_por_dia_costura : null

  const algumFiltro = DIMENSOES.some((d) => filtros[d.k].size > 0)

  return (
    <div>
      <h2 className="titulo-pagina">Painel de defeitos</h2>

      {/* Filtros */}
      <div className="filtros">
        <div className="campo">
          <label htmlFor="periodo">Período</label>
          <select id="periodo" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {PERIODOS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </div>
        {periodo === 'custom' && (
          <>
            <div className="campo">
              <label htmlFor="de">De</label>
              <input id="de" type="date" value={custom.de} onChange={(e) => setCustom({ ...custom, de: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="ate">Até</label>
              <input id="ate" type="date" value={custom.ate} onChange={(e) => setCustom({ ...custom, ate: e.target.value })} />
            </div>
          </>
        )}
        {listas &&
          DIMENSOES.map((d) => (
            <MultiSelecao
              key={d.k}
              rotulo={d.rotulo}
              opcoes={
                d.k === 'com_dtf'
                  ? [
                      { id: true, nome: 'Com DTF' },
                      { id: false, nome: 'Sem DTF' },
                    ]
                  : listas[d.lista]
              }
              valor={filtros[d.k]}
              onChange={(v) => setFiltros({ ...filtros, [d.k]: v })}
            />
          ))}
      </div>

      <div className="barra-resultado">
        <span>
          Semanas que terminam entre <b>{dataBR(iv.de)}</b> e <b>{dataBR(iv.ate)}</b>
          {' · '}comparando com {dataBR(iv.antDe)} a {dataBR(iv.antAte)}
        </span>
        {algumFiltro && (
          <button className="link-discreto" onClick={() => setFiltros(filtrosVazios())}>
            Limpar filtros
          </button>
        )}
      </div>

      {erro && <div className="aviso erro">{erro}</div>}
      {iv.de > iv.ate && <div className="aviso atencao">A data inicial está depois da final.</div>}

      {!dados ? (
        !erro && <div className="vazio">Carregando…</div>
      ) : (
        <>
          {/* Cartões */}
          <div className="kpis">
            <div className="kpi destaque">
              <div className="rot">Custo total</div>
              <div className="val">{reais(t.custo)}</div>
              <Variacao atual={t.custo} anterior={ta.custo} />
            </div>
            <div className="kpi">
              <div className="rot">Peças com defeito</div>
              <div className="val">{num(t.pecas)}</div>
              <Variacao atual={t.pecas} anterior={ta.pecas} />
            </div>
            <div className="kpi">
              <div className="rot">Dias de costura em retrabalho</div>
              <div className="val">{diasCostura === null ? '—' : num1(diasCostura)}</div>
              {diasCostura !== null && <Variacao atual={diasCostura} anterior={diasCosturaAnt} />}
            </div>
          </div>
          <div className="kpis">
            {[
              ['descarte', 'pDescarte'],
              ['costura', 'pCostura'],
              ['dtf', 'pDtf'],
              ['sem_custo', 'pSem_custo'],
            ].map(([r, p]) => (
              <div key={r} className={`kpi kpi-${r}`}>
                <div className="rot">{NOMES_REGRA[r]}</div>
                <div className="val">{reais(t[r])}</div>
                <div className="sub">{num(t[p])} peças</div>
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Custo por semana</h3>
            <GraficoSemanas semanas={semanas} />
          </div>

          <div className="grade-2">
            <div className="card">
              <h3>Custo por tipo de defeito</h3>
              <BarrasHorizontais itens={porDefeito} />
            </div>
            <div className="card">
              <h3>Custo por responsável</h3>
              <BarrasHorizontais itens={porResp} />
            </div>
          </div>

          <div className="card">
            <h3 className="cab-semana">
              <span>Por tipo de peça</span>
              <span className="alternador">
                <button className={medidaPeca === 'pecas' ? 'ativo' : ''} onClick={() => setMedidaPeca('pecas')}>
                  Peças
                </button>
                <button className={medidaPeca === 'custo' ? 'ativo' : ''} onClick={() => setMedidaPeca('custo')}>
                  R$
                </button>
              </span>
            </h3>
            <BarrasHorizontais itens={porPeca} medida={medidaPeca} />
          </div>

          <div className="card">
            <h3>Responsável × defeito (R$)</h3>
            <MapaCalor linhas={atual} chaveLinha="responsavel" chaveColuna="defeito" medida="custo" />
          </div>

          <div className="card">
            <h3>Defeito × cor (peças)</h3>
            <MapaCalor linhas={atual} chaveLinha="defeito" chaveColuna="cor" medida="pecas" />
          </div>

          {/* Detalhe */}
          <div className="card">
            <h3 className="cab-semana">
              <span>
                Todas as linhas <span className="contador">{atual.length}</span>
              </span>
              <button className="pequeno" onClick={() => exportarCSV(atual, iv.de, iv.ate)} disabled={atual.length === 0}>
                Exportar Excel (CSV)
              </button>
            </h3>
            {atual.length === 0 ? (
              <div className="vazio">Nenhuma linha no período.</div>
            ) : (
              <div className="tabela-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Semana</th>
                      <th>Peça</th>
                      <th>DTF</th>
                      <th>Cor</th>
                      <th>Defeito</th>
                      <th>Finalidade</th>
                      <th>Responsável</th>
                      <th className="num">Qtd</th>
                      <th className="num">Custo</th>
                      <th>Observação</th>
                      <th>Lançou</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {atual.map((l) => (
                      <tr key={l.id}>
                        <td>{rotuloSemana(l.semana_inicio)}</td>
                        <td>{l.peca}</td>
                        <td>{l.com_dtf ? 'Com' : 'Sem'}</td>
                        <td>{l.cor}</td>
                        <td>{l.defeito}</td>
                        <td>{l.finalidade}</td>
                        <td>{l.responsavel}</td>
                        <td className="num">{num(l.quantidade)}</td>
                        <td className="num">{reais(l.custo_total)}</td>
                        <td className="obs-celula">{l.observacao}</td>
                        <td>{l.criado_por?.split('@')[0]}</td>
                        <td>
                          <Link to={`/lancar?semana=${l.semana_inicio}`}>editar</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={7}>Total</th>
                      <th className="num">{num(t.pecas)}</th>
                      <th className="num">{reais(t.custo)}</th>
                      <th colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
