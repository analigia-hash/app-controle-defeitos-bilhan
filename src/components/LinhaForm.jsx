import { useState } from 'react'

/* Ordem do PRD: Peça → Com/Sem DTF → Cor → Defeito principal → Finalidade → Responsável → Quantidade */
export const CAMPOS = [
  { k: 'peca_id', nomeK: 'peca', rotulo: 'Peça', titulo: 'Qual peça?', lista: 'pecas' },
  { k: 'com_dtf', rotulo: 'DTF', titulo: 'A peça já tem DTF aplicado?' },
  { k: 'cor_id', nomeK: 'cor', rotulo: 'Cor', titulo: 'Qual a cor?', lista: 'cores' },
  { k: 'defeito_id', nomeK: 'defeito', rotulo: 'Defeito', titulo: 'Qual o defeito principal?', lista: 'defeitos' },
  { k: 'finalidade_id', nomeK: 'finalidade', rotulo: 'Destino', titulo: 'O que vai acontecer com a peça?', lista: 'finalidades' },
  { k: 'responsavel_id', nomeK: 'responsavel', rotulo: 'Responsável', titulo: 'Quem é o responsável?', lista: 'responsaveis' },
  { k: 'quantidade', rotulo: 'Quantidade', titulo: 'Quantas peças?' },
]

const OPCOES_DTF = [
  { id: true, nome: 'Com DTF' },
  { id: false, nome: 'Sem DTF' },
]

const vazio = (v) => v === undefined || v === null || v === ''

/** Nome do item escolhido; se ele foi desativado depois, usa o nome que veio na linha. */
export function nomeCampo(campo, dados, listas) {
  const v = dados[campo.k]
  if (vazio(v)) return null
  if (campo.k === 'com_dtf') return v ? 'Com DTF' : 'Sem DTF'
  if (campo.k === 'quantidade') return `${v} ${v === 1 ? 'peça' : 'peças'}`
  return listas[campo.lista].find((i) => i.id === v)?.nome ?? dados[campo.nomeK] ?? '—'
}

function proximoPasso(dados) {
  const i = CAMPOS.findIndex((c) => vazio(dados[c.k]))
  return i === -1 ? 'revisar' : i
}

export default function LinhaForm({ listas, inicial, titulo, onSalvar, onExcluir, onCancelar, salvando }) {
  const [dados, setDados] = useState(inicial)
  const [passo, setPasso] = useState(() => proximoPasso(inicial))
  const [voltarRevisar, setVoltarRevisar] = useState(false)
  const [qtdTexto, setQtdTexto] = useState(inicial.quantidade ? String(inicial.quantidade) : '')

  const escolher = (k, valor) => {
    const novo = { ...dados, [k]: valor }
    setDados(novo)
    setPasso(voltarRevisar ? 'revisar' : proximoPasso(novo))
    setVoltarRevisar(false)
  }

  const editarCampo = (i) => {
    setVoltarRevisar(true)
    setPasso(i)
  }

  const qtd = parseInt(qtdTexto, 10)
  const qtdValida = Number.isInteger(qtd) && qtd > 0

  const confirmarQtd = () => {
    if (qtdValida) escolher('quantidade', qtd)
  }

  const somarQtd = (n) => setQtdTexto(String(Math.max(0, (parseInt(qtdTexto, 10) || 0) + n)))

  if (passo === 'revisar') {
    return (
      <div className="card form-linha">
        <h3>{titulo}</h3>
        <ul className="revisao">
          {CAMPOS.map((c, i) => (
            <li key={c.k}>
              <button type="button" onClick={() => editarCampo(i)}>
                <span className="rot">{c.rotulo}</span>
                <span className="val">{nomeCampo(c, dados, listas)}</span>
                <span className="trocar">trocar</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="campo">
          <label htmlFor="obs">Observação (opcional)</label>
          <textarea
            id="obs"
            rows={2}
            value={dados.observacao ?? ''}
            onChange={(e) => setDados({ ...dados, observacao: e.target.value })}
            placeholder="Lote, OP, estampa, fornecedor do tecido…"
          />
        </div>
        <button className="gigante verde" disabled={salvando} onClick={() => onSalvar(dados)}>
          {salvando ? 'Salvando…' : 'Salvar linha'}
        </button>
        <div className="linha" style={{ marginTop: 10 }}>
          <button className="secundario" onClick={onCancelar}>
            Cancelar
          </button>
          {onExcluir && (
            <button className="vermelho" onClick={onExcluir} disabled={salvando}>
              Excluir linha
            </button>
          )}
        </div>
      </div>
    )
  }

  const campo = CAMPOS[passo]
  const opcoes = campo.k === 'com_dtf' ? OPCOES_DTF : campo.lista ? listas[campo.lista] : null
  const feitos = CAMPOS.slice(0, passo).filter((c) => !vazio(dados[c.k]))

  return (
    <div className="card form-linha">
      <div className="progresso">
        {CAMPOS.map((c, i) => (
          <span key={c.k} className={i < passo ? 'feito' : i === passo ? 'atual' : ''} />
        ))}
      </div>

      {feitos.length > 0 && (
        <div className="trilha">
          {feitos.map((c) => (
            <button key={c.k} type="button" onClick={() => editarCampo(CAMPOS.indexOf(c))}>
              {nomeCampo(c, dados, listas)}
            </button>
          ))}
        </div>
      )}

      <h3 className="pergunta">{campo.titulo}</h3>

      {opcoes ? (
        <div className={`opcoes ${opcoes.length <= 2 ? 'duas' : ''}`}>
          {opcoes.map((o) => (
            <button
              key={String(o.id)}
              type="button"
              className={dados[campo.k] === o.id ? 'escolhida' : ''}
              onClick={() => escolher(campo.k, o.id)}
            >
              {o.nome}
            </button>
          ))}
          {opcoes.length === 0 && <div className="vazio">Lista vazia. Fale com a Ana.</div>}
        </div>
      ) : (
        <div>
          <input
            className="visor-qtd"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            autoFocus
            value={qtdTexto}
            onChange={(e) => setQtdTexto(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && confirmarQtd()}
            placeholder="0"
          />
          <div className="atalhos-qtd">
            {[-1, 1, 5, 10].map((n) => (
              <button key={n} type="button" className="secundario" onClick={() => somarQtd(n)}>
                {n > 0 ? `+${n}` : n}
              </button>
            ))}
          </div>
          <button className="gigante" disabled={!qtdValida} onClick={confirmarQtd}>
            Continuar
          </button>
        </div>
      )}

      <div className="linha" style={{ marginTop: 12 }}>
        <button
          className="secundario"
          onClick={() => (passo > 0 && !voltarRevisar ? setPasso(passo - 1) : onCancelar())}
        >
          {passo > 0 && !voltarRevisar ? '← Voltar' : 'Cancelar'}
        </button>
        {voltarRevisar && (
          <button className="secundario" onClick={() => setPasso('revisar')}>
            Manter como está
          </button>
        )}
      </div>
    </div>
  )
}
