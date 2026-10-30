import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { linhasSemCusto } from '../lib/dados.js'
import { num, rotuloSemana } from '../lib/formato.js'
import { mensagemErro } from '../lib/supabase.js'

/* Histórico dos próprios lançamentos — só quantidades, nunca R$. */
export default function Historico() {
  const [linhas, setLinhas] = useState(null)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    linhasSemCusto(null)
      .then(setLinhas)
      .catch((e) => setErro(mensagemErro(e)))
  }, [])

  const semanas = useMemo(() => {
    const mapa = new Map()
    for (const l of linhas ?? []) {
      if (!mapa.has(l.semana_inicio)) mapa.set(l.semana_inicio, { status: l.semana_status, linhas: [] })
      mapa.get(l.semana_inicio).linhas.push(l)
    }
    return [...mapa.entries()]
  }, [linhas])

  if (erro) return <div className="aviso erro">{erro}</div>
  if (!linhas) return <div className="vazio">Carregando…</div>

  return (
    <div>
      <h2 className="titulo-pagina">Meu histórico</h2>
      {semanas.length === 0 && <div className="vazio">Você ainda não lançou nenhuma peça.</div>}
      {semanas.map(([inicio, s]) => (
        <div key={inicio} className="card">
          <h3 className="cab-semana">
            <span>{rotuloSemana(inicio)}</span>
            <span className={`tag-status ${s.status}`}>{s.status}</span>
          </h3>
          <ul className="lista-linhas compacta">
            {s.linhas.map((l) => (
              <li key={l.id}>
                <div>
                  <span className="qtd">{l.quantidade}</span>
                  <span className="info">
                    <b>
                      {l.peca} · {l.com_dtf ? 'com DTF' : 'sem DTF'} · {l.cor}
                    </b>
                    <small>
                      {l.defeito} → {l.finalidade} · {l.responsavel}
                    </small>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="barra-resultado" style={{ marginTop: 8, marginBottom: 0 }}>
            <span>{num(s.linhas.reduce((t, l) => t + l.quantidade, 0))} peças</span>
            {s.status === 'aberta' && <Link to={`/lancar?semana=${inicio}`}>Abrir semana</Link>}
          </div>
        </div>
      ))}
    </div>
  )
}
