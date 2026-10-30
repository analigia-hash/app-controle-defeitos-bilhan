import { useEffect, useRef, useState } from 'react'
import { diaMes, num, reais } from '../lib/formato.js'

export const CORES_FINALIDADE = {
  descarte: '#dc2626',
  costura: '#2563eb',
  dtf: '#7c3aed',
}
export const NOMES_REGRA = { descarte: 'Descarte', costura: 'Costura', dtf: 'DTF', sem_custo: 'Estampa surpresa (sem custo)' }

/** Custo por semana: barras empilhadas por finalidade + linha do total. */
export function GraficoSemanas({ semanas }) {
  const [foco, setFoco] = useState(null)
  if (semanas.length === 0) return <div className="vazio">Sem dados no período.</div>

  const larg = Math.max(560, semanas.length * 56)
  const alt = 240
  const m = { t: 24, r: 12, b: 34, l: 64 }
  const w = larg - m.l - m.r
  const h = alt - m.t - m.b
  const max = Math.max(...semanas.map((s) => s.total), 1)
  const passo = w / semanas.length
  const barra = Math.min(36, passo * 0.62)
  const y = (v) => m.t + h - (v / max) * h
  const xc = (i) => m.l + passo * i + passo / 2
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)

  return (
    <div className="grafico-wrap">
      <svg viewBox={`0 0 ${larg} ${alt}`} style={{ minWidth: larg }} role="img" aria-label="Custo por semana">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={larg - m.r} y1={y(t)} y2={y(t)} stroke="#e5e7eb" />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" className="eixo">
              {reais(t).replace(',00', '')}
            </text>
          </g>
        ))}
        {semanas.map((s, i) => {
          let topo = 0
          return (
            <g key={s.inicio} onMouseEnter={() => setFoco(i)} onMouseLeave={() => setFoco(null)} onClick={() => setFoco(i)}>
              <rect x={m.l + passo * i} y={m.t} width={passo} height={h} fill={foco === i ? '#f3f4f6' : 'transparent'} />
              {['descarte', 'costura', 'dtf'].map((r) => {
                const v = s[r]
                if (!v) return null
                const y0 = y(topo + v)
                const hh = y(topo) - y0
                topo += v
                return <rect key={r} x={xc(i) - barra / 2} y={y0} width={barra} height={Math.max(hh, 0)} fill={CORES_FINALIDADE[r]} />
              })}
              <text x={xc(i)} y={alt - m.b + 16} textAnchor="middle" className="eixo">
                {diaMes(s.fim)}
              </text>
            </g>
          )
        })}
        <polyline
          fill="none"
          stroke="#111827"
          strokeWidth="2"
          points={semanas.map((s, i) => `${xc(i)},${y(s.total)}`).join(' ')}
        />
        {semanas.map((s, i) => (
          <circle key={s.inicio} cx={xc(i)} cy={y(s.total)} r="3.5" fill="#111827" />
        ))}
      </svg>
      <div className="legenda">
        {Object.entries(CORES_FINALIDADE).map(([r, c]) => (
          <span key={r}>
            <i style={{ background: c }} /> {NOMES_REGRA[r]}
          </span>
        ))}
        <span>
          <i style={{ background: '#111827', height: 2 }} /> Total
        </span>
      </div>
      {foco !== null && (
        <div className="detalhe-semana">
          Semana até {diaMes(semanas[foco].fim)}: <b>{reais(semanas[foco].total)}</b> · {num(semanas[foco].pecas)} peças
          {' — '}
          {['descarte', 'costura', 'dtf'].map((r) => `${NOMES_REGRA[r]} ${reais(semanas[foco][r])}`).join(' · ')}
        </div>
      )}
    </div>
  )
}

/** Barras horizontais ordenadas. itens: [{ nome, custo, pecas }] */
export function BarrasHorizontais({ itens, medida = 'custo' }) {
  if (itens.length === 0) return <div className="vazio">Sem dados no período.</div>
  const max = Math.max(...itens.map((i) => i[medida]), 1)
  return (
    <ul className="barras">
      {itens.map((i) => (
        <li key={i.nome}>
          <span className="nome" title={i.nome}>
            {i.nome}
          </span>
          <span className="trilho">
            <span className="enchimento" style={{ width: `${(i[medida] / max) * 100}%` }} />
          </span>
          <span className="valor">
            {medida === 'custo' ? (
              <>
                <b>{reais(i.custo)}</b> <small>{num(i.pecas)} pç</small>
              </>
            ) : (
              <>
                <b>{num(i.pecas)} pç</b> <small>{reais(i.custo)}</small>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Tabela cruzada com cor de fundo proporcional ao valor (mapa de calor). */
export function MapaCalor({ linhas, chaveLinha, chaveColuna, medida = 'custo' }) {
  const valor = (l) => (medida === 'custo' ? Number(l.custo_total) : l.quantidade)
  const totLinha = new Map()
  const totColuna = new Map()
  const celulas = new Map()
  for (const l of linhas) {
    const a = l[chaveLinha]
    const b = l[chaveColuna]
    const v = valor(l)
    totLinha.set(a, (totLinha.get(a) ?? 0) + v)
    totColuna.set(b, (totColuna.get(b) ?? 0) + v)
    celulas.set(`${a}\u0000${b}`, (celulas.get(`${a}\u0000${b}`) ?? 0) + v)
  }
  if (celulas.size === 0) return <div className="vazio">Sem dados no período.</div>

  const ordem = (mapa) => [...mapa.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k)
  const lin = ordem(totLinha)
  const col = ordem(totColuna)
  const max = Math.max(...celulas.values())
  const fmt = (v) => (medida === 'custo' ? reais(v).replace(/,\d\d$/, '') : num(v))

  return (
    <div className="tabela-wrap">
      <table className="calor">
        <thead>
          <tr>
            <th />
            {col.map((c) => (
              <th key={c} className="num">
                {c}
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {lin.map((a) => (
            <tr key={a}>
              <th>{a}</th>
              {col.map((b) => {
                const v = celulas.get(`${a}\u0000${b}`) ?? 0
                const f = v / max
                return (
                  <td
                    key={b}
                    className="num"
                    style={{
                      background: v ? `rgba(217, 119, 6, ${0.08 + f * 0.85})` : undefined,
                      color: f > 0.55 ? '#fff' : undefined,
                    }}
                  >
                    {v ? fmt(v) : ''}
                  </td>
                )
              })}
              <td className="num">
                <b>{fmt(totLinha.get(a))}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Seleção múltipla compacta para os filtros do painel. Vazio = todos. */
export function MultiSelecao({ rotulo, opcoes, valor, onChange }) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!aberto) return
    const fora = (e) => ref.current && !ref.current.contains(e.target) && setAberto(false)
    document.addEventListener('pointerdown', fora)
    return () => document.removeEventListener('pointerdown', fora)
  }, [aberto])

  const alternar = (id) => {
    const novo = new Set(valor)
    if (novo.has(id)) novo.delete(id)
    else novo.add(id)
    onChange(novo)
  }

  const resumo =
    valor.size === 0
      ? 'Todos'
      : valor.size === 1
        ? opcoes.find((o) => valor.has(o.id))?.nome
        : `${valor.size} selecionados`

  return (
    <div className="campo multi" ref={ref}>
      <label>{rotulo}</label>
      <button type="button" className={`multi-botao ${valor.size ? 'ativo' : ''}`} onClick={() => setAberto((a) => !a)}>
        <span>{resumo}</span>
        <span aria-hidden>▾</span>
      </button>
      {aberto && (
        <div className="multi-lista">
          {opcoes.map((o) => (
            <label key={String(o.id)} className="multi-opcao">
              <input type="checkbox" checked={valor.has(o.id)} onChange={() => alternar(o.id)} />
              <span>
                {o.nome}
                {o.ativo === false && <small> (desativado)</small>}
              </span>
            </label>
          ))}
          {valor.size > 0 && (
            <button type="button" className="link-discreto" onClick={() => onChange(new Set())}>
              Limpar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
