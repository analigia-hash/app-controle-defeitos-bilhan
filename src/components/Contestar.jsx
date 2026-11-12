import { useEffect, useMemo, useState } from 'react'
import { enviarContestacao, nomeLoja, opcoesContestacao } from '../lib/devolucoes.js'
import { dataHoraBR } from '../lib/formato.js'
import { VerFotos } from './DevFotos.jsx'

const CHAVE_EMAIL = 'dev_email_disputa'

/* Texto e motivo sugeridos a partir do que a embalagem registrou. */
function sugestao(dev, nomeDefeito) {
  const outra = dev.itens.filter((i) => i.estado === 'outra_loja')
  const perda = dev.itens.filter((i) => i.estado === 'perda')
  const defeito = dev.itens.filter((i) => i.estado === 'defeito')
  const partes = []
  let motivoShopee = null
  if (outra.length) {
    partes.push(
      `Recebemos na devolução uma peça que não é da nossa loja (${outra.map((i) => i.variacao || 'sem descrição').join('; ')}). A peça que vendemos não foi devolvida.`
    )
    motivoShopee = '49'
  }
  if (perda.length && !outra.length) {
    partes.push(`A devolução chegou faltando: ${perda.map((i) => `${i.quantidade}× ${i.produto}${i.variacao ? ` (${i.variacao})` : ''}`).join(', ')}.`)
    motivoShopee ??= '48'
  }
  if (defeito.length) {
    partes.push(
      `A peça voltou com problema que não existia no envio: ${defeito.map((i) => nomeDefeito(i.defeito_id) ?? 'defeito').join(', ')}.`
    )
    motivoShopee ??= '47'
  }
  partes.push('Seguem fotos tiradas na abertura do pacote.')
  return { texto: partes.join(' '), motivoShopee }
}

export default function Contestar({ dev, nomeDefeito, onFechar, onEnviado }) {
  const [op, setOp] = useState(null)
  const [erro, setErro] = useState(null)
  const sug = useMemo(() => sugestao(dev, nomeDefeito), [dev, nomeDefeito])
  const [motivo, setMotivo] = useState('')
  const [comentario, setComentario] = useState(sug.texto)
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_EMAIL) ?? ''
    } catch {
      return ''
    }
  })
  const fotosSalvas = dev.fotos.map((f) => f.path)
  const [fotos, setFotos] = useState(fotosSalvas)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)

  useEffect(() => {
    opcoesContestacao(dev.id)
      .then((o) => {
        setOp(o)
        if (o.plataforma === 'Shopee' && sug.motivoShopee && o.motivos?.some((m) => m.codigo === sug.motivoShopee)) {
          setMotivo(sug.motivoShopee)
        }
      })
      .catch((e) => setErro(e.message || String(e)))
  }, [dev.id, sug.motivoShopee])

  const escolhido = op?.motivos?.find((m) => m.codigo === motivo)
  const pronto = op?.pode && motivo && comentario.trim() && (!op.precisa_email || /\S+@\S+\.\S+/.test(email))

  const enviar = async () => {
    const loja = nomeLoja(dev.plataforma, dev.loja)
    if (!window.confirm(`Enviar a contestação para a ${loja}? Isso não pode ser desfeito pelo app.`)) return
    setEnviando(true)
    setErro(null)
    try {
      if (op.precisa_email) {
        try {
          localStorage.setItem(CHAVE_EMAIL, email)
        } catch {
          /* sem armazenamento: tudo bem */
        }
      }
      const r = await enviarContestacao({
        devolucao_id: dev.id,
        motivo,
        motivo_texto: escolhido?.texto ?? motivo,
        comentario: comentario.trim(),
        email: op.precisa_email ? email.trim() : undefined,
        fotos,
      })
      setResultado(r)
      if (r.ok) onEnviado?.()
    } catch (e) {
      setErro(e.message || String(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="modal-fundo">
      <div className="modal contestar">
        <h3>Contestar devolução</h3>
        <div className="explica">
          {nomeLoja(dev.plataforma, dev.loja)} · pedido {dev.n_pedido}
        </div>

        {erro && <div className="aviso erro">{erro}</div>}
        {!op && !erro && <div className="vazio">Consultando a loja…</div>}

        {resultado ? (
          resultado.ok ? (
            <div className="aviso ok">
              <b>Contestação enviada.</b> Acompanhe a resposta na Central do Vendedor da loja.
            </div>
          ) : (
            <div className="aviso erro">
              <b>A loja não aceitou:</b> {resultado.erro}
            </div>
          )
        ) : (
          op && (
            <>
              <div className="dev-motivo" style={{ marginBottom: 12 }}>
                <small>Situação na loja</small>
                {op.status ?? '—'}
                {op.prazo && <> · prazo para contestar: <b>{dataHoraBR(op.prazo)}</b></>}
                {op.motivo_cliente && <div style={{ marginTop: 4 }}>Cliente disse: “{op.motivo_cliente}”</div>}
              </div>

              {!op.pode ? (
                <div className="aviso atencao">{op.aviso}</div>
              ) : (
                <>
                  <div className="campo">
                    <label>Motivo</label>
                    <div className="contestar-motivos">
                      {op.motivos.map((m) => (
                        <label key={m.codigo} className={motivo === m.codigo ? 'escolhido' : ''}>
                          <input type="radio" name="motivo" checked={motivo === m.codigo} onChange={() => setMotivo(m.codigo)} />
                          <span>
                            {m.texto}
                            {m.exige && <small>{m.exige}</small>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="campo">
                    <label>Explicação para a loja</label>
                    <textarea rows={4} value={comentario} onChange={(e) => setComentario(e.target.value)} />
                  </div>

                  {op.precisa_email && (
                    <div className="campo">
                      <label>E-mail para a Shopee responder</label>
                      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com.br" />
                    </div>
                  )}

                  <div className="campo">
                    <label>
                      Fotos que vão junto ({fotos.length} de {fotosSalvas.length})
                    </label>
                    {fotosSalvas.length === 0 ? (
                      <div className="aviso atencao">
                        Esta devolução não tem fotos. Sem foto a contestação quase sempre é recusada: adicione fotos antes.
                      </div>
                    ) : (
                      <>
                        <VerFotos paths={fotosSalvas} />
                        <button
                          type="button"
                          className="secundario pequeno"
                          onClick={() => setFotos(fotos.length ? [] : fotosSalvas)}
                        >
                          {fotos.length ? 'Enviar sem fotos' : 'Enviar com as fotos'}
                        </button>
                      </>
                    )}
                  </div>

                  <button className="gigante vermelho" disabled={!pronto || enviando} onClick={enviar}>
                    {enviando ? 'Enviando…' : 'Enviar contestação'}
                  </button>
                </>
              )}
            </>
          )
        )}
        <button className="secundario" style={{ width: '100%', marginTop: 10 }} onClick={onFechar}>
          Fechar
        </button>
      </div>
    </div>
  )
}
