import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider.jsx'
import Contestar from '../components/Contestar.jsx'
import { TirarFotos, VerFotos } from '../components/DevFotos.jsx'
import Leitor from '../components/Leitor.jsx'
import { useToast } from '../components/Toast.jsx'
import { carregarListas } from '../lib/dados.js'
import {
  ESTADOS,
  buscarCodigo,
  candidatos,
  comprimirFoto,
  estadoPorId,
  excluirDevolucao,
  listarContestacoes,
  listarDevolucoes,
  nomeLoja,
  pecasEstoque,
  salvarDevolucao,
  sincronizarDevolucoes,
  subirFotos,
  vincularPedido,
} from '../lib/devolucoes.js'
import { dataBR, dataHoraBR, hojeISO, num, somarDias } from '../lib/formato.js'
import { mensagemErro } from '../lib/supabase.js'

/** A SHEIN manda motivo + detalhe colados ("…da páginaDivergência…"): separa. */
const limparMotivo = (m) => (m ? String(m).replace(/([a-zà-ú])([A-ZÀ-Ú])/g, '$1 · $2') : m)

const ESPERA_SYNC = 40 // segundos que a devolucoes-sync leva para trazer as lojas

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */
export default function Devolucoes() {
  const toast = useToast()
  const [defeitos, setDefeitos] = useState([])
  const [etapa, setEtapa] = useState({ nome: 'inicio' }) // inicio | camera | escolher | conferir
  const [codigo, setCodigo] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [aviso, setAviso] = useState(null) // { tipo, texto, codigo }
  const [recarregarLista, setRecarregarLista] = useState(0)
  const sincronizou = useRef(false)
  const campo = useRef(null)

  useEffect(() => {
    carregarListas(true)
      .then((l) => setDefeitos(l.defeitos))
      .catch(() => {})
  }, [])

  const voltarInicio = () => {
    setEtapa({ nome: 'inicio' })
    setCodigo('')
    setTimeout(() => campo.current?.focus(), 50)
  }

  const abrirResultado = (res, codigoLido) => {
    const lista = res.resultados ?? []
    if (lista.length === 1) setEtapa({ nome: 'conferir', origem: { ...lista[0], codigo_lido: codigoLido } })
    else setEtapa({ nome: 'escolher', lista, codigoLido })
  }

  /** Procura um código. Devolve true se achou (o leitor da câmera fecha). */
  const procurar = useCallback(async (valor, { daCamera = false } = {}) => {
    const v = String(valor || '').trim()
    if (!v) return false
    setBuscando(true)
    setAviso(null)
    try {
      const res = await buscarCodigo(v)
      if (res.tipo !== 'nada') {
        abrirResultado(res, v)
        return true
      }
      // Não achou: a devolução pode ter sido aberta há pouco. Pede uma
      // sincronização (uma vez por visita) e tenta de novo sozinho.
      if (!sincronizou.current) {
        sincronizou.current = true
        await sincronizarDevolucoes().catch(() => {})
        if (!daCamera) {
          setAviso({ tipo: 'esperando', texto: 'Atualizando as devoluções das lojas…', codigo: v })
          await new Promise((r) => setTimeout(r, ESPERA_SYNC * 1000))
          const res2 = await buscarCodigo(v)
          if (res2.tipo !== 'nada') {
            setAviso(null)
            abrirResultado(res2, v)
            return true
          }
        }
      }
      if (!daCamera) setAviso({ tipo: 'nada', texto: 'Não achei esse código em nenhuma loja.', codigo: v })
      return false
    } catch (e) {
      toast.erro(mensagemErro(e))
      return false
    } finally {
      setBuscando(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const registrarManual = (codigoLido) =>
    setEtapa({ nome: 'conferir', origem: { codigo_lido: codigoLido ?? null, itens: [] } })

  const aoSalvar = () => {
    setRecarregarLista((n) => n + 1)
    voltarInicio()
  }

  /* ---------- telas ---------- */
  if (etapa.nome === 'conferir') {
    return (
      <div className="devolucoes">
        <h2 className="titulo-pagina">Devolução</h2>
        <Conferencia origem={etapa.origem} defeitos={defeitos} onSalvo={aoSalvar} onCancelar={voltarInicio} />
      </div>
    )
  }

  if (etapa.nome === 'escolher') {
    return (
      <div className="devolucoes">
        <h2 className="titulo-pagina">Qual destas?</h2>
        <div className="card">
          <p className="explica">Esse código apareceu em mais de uma devolução. Toque na que corresponde ao pacote.</p>
          <ul className="lista-linhas">
            {etapa.lista.map((r, i) => (
              <li key={i}>
                <button onClick={() => setEtapa({ nome: 'conferir', origem: { ...r, codigo_lido: etapa.codigoLido } })}>
                  <span className="info">
                    <b>
                      {nomeLoja(r.plataforma, r.loja)} · pedido {r.n_pedido}
                    </b>
                    <small>{resumoItens(r.itens)}</small>
                    {r.criado_em && <small>Pedido de devolução em {dataBR(r.criado_em)}</small>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button className="secundario" style={{ width: '100%', marginTop: 12 }} onClick={voltarInicio}>
            Voltar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="devolucoes">
      <h2 className="titulo-pagina">Devoluções</h2>

      {etapa.nome === 'camera' ? (
        <div className="card">
          <Leitor
            onCodigo={(v) => procurar(v, { daCamera: true })}
            onFechar={voltarInicio}
          />
          <button className="secundario" style={{ width: '100%', marginTop: 10 }} onClick={() => registrarManual(null)}>
            Nenhum código funciona — registrar à mão
          </button>
        </div>
      ) : (
        <div className="card">
          <button className="gigante" onClick={() => setEtapa({ nome: 'camera' })} disabled={buscando}>
            📷 Ler etiqueta com a câmera
          </button>
          <form
            className="busca-codigo"
            onSubmit={(e) => {
              e.preventDefault()
              procurar(codigo)
            }}
          >
            <label htmlFor="codigo">ou bipe / digite o código da etiqueta</label>
            <div className="linha">
              <input
                id="codigo"
                ref={campo}
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Ex.: BR2689422548477 ou nº do pedido"
              />
              <button type="submit" disabled={buscando || !codigo.trim()}>
                {buscando ? '…' : 'Buscar'}
              </button>
            </div>
          </form>

          {aviso?.tipo === 'esperando' && (
            <div className="aviso atencao">
              {aviso.texto} Leva uns {ESPERA_SYNC} segundos, não precisa fazer nada.
            </div>
          )}
          {aviso?.tipo === 'nada' && (
            <div className="aviso erro">
              <b>{aviso.texto}</b>
              <div style={{ marginTop: 6 }}>
                Tente outro código da etiqueta (rastreio, nº do pedido). Se nenhum funcionar, abra o pacote e
                registre as peças à mão.
              </div>
              <button className="gigante" style={{ marginTop: 10 }} onClick={() => registrarManual(aviso.codigo)}>
                Registrar à mão
              </button>
            </div>
          )}
        </div>
      )}

      <ListaDevolucoes recarregar={recarregarLista} defeitos={defeitos} />
    </div>
  )
}

function resumoItens(itens) {
  return (itens ?? []).map((i) => `${i.quantidade}× ${i.produto}${i.variacao ? ` (${i.variacao})` : ''}`).join(' · ')
}

/* ------------------------------------------------------------------ */
/* Conferência: estado de cada peça e salvar                           */
/* ------------------------------------------------------------------ */
function Conferencia({ origem: origemInicial, defeitos, onSalvo, onCancelar }) {
  const toast = useToast()
  const [origem, setOrigem] = useState({ ...origemInicial, motivo: limparMotivo(origemInicial.motivo) })
  const [itens, setItens] = useState(() =>
    (origemInicial.itens ?? []).map((i) => ({
      produto: i.produto,
      variacao: i.variacao,
      sku_id: i.sku_id ?? null,
      pedida: Number(i.quantidade) || 1,
      quantidade: Number(i.quantidade) || 1,
      estado: null,
      defeito_id: null,
    }))
  )
  const [observacao, setObservacao] = useState('')
  const [fotos, setFotos] = useState([])
  const [salvando, setSalvando] = useState(false)
  const [adicionando, setAdicionando] = useState(origemInicial.itens?.length ? false : true)
  const [procurando, setProcurando] = useState(false)

  const identificada = !!origem.n_pedido
  const ja = origem.ja_registrada

  const mudar = (i, campos) => setItens((l) => l.map((it, k) => (k === i ? { ...it, ...campos } : it)))
  const remover = (i) => setItens((l) => l.filter((_, k) => k !== i))

  const pendentes = itens.filter((i) => !i.estado || (i.estado === 'defeito' && !i.defeito_id) || !(i.quantidade > 0))
  const podeSalvar = itens.length > 0 && pendentes.length === 0 && !ja && !salvando

  const salvar = async () => {
    setSalvando(true)
    try {
      const id = await salvarDevolucao({
        codigo_lido: origem.codigo_lido,
        retorno_id: origem.retorno_id ?? null,
        plataforma: origem.plataforma ?? null,
        loja: origem.loja ?? null,
        n_pedido: origem.n_pedido ?? null,
        devolucao_id: origem.devolucao_id ?? null,
        rastreio: origem.rastreio ?? null,
        motivo: origem.motivo ?? null,
        observacao: observacao.trim() || null,
        itens: itens.map((i) => ({
          produto: i.produto,
          variacao: i.variacao,
          sku_id: i.sku_id,
          quantidade: i.quantidade,
          estado: i.estado,
          defeito_id: i.estado === 'defeito' ? i.defeito_id : null,
        })),
      })
      if (fotos.length) {
        try {
          await subirFotos(id, fotos.map((f) => f.blob))
        } catch (e) {
          toast.erro(`A devolução foi salva, mas as fotos não subiram: ${mensagemErro(e)}`)
        }
      }
      toast.ok(identificada ? 'Devolução registrada.' : 'Registrada como não identificada. A Ana resolve depois.')
      onSalvo()
    } catch (e) {
      toast.erro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <div className="card dev-cabecalho">
        {identificada ? (
          <>
            <div className="dev-loja">{nomeLoja(origem.plataforma, origem.loja)}</div>
            <div className="dev-pedido">Pedido {origem.n_pedido}</div>
            {origem.motivo && (
              <div className="dev-motivo">
                <small>Motivo da cliente</small>
                {origem.motivo}
              </div>
            )}
            {!origem.retorno_id && (
              <div className="aviso atencao" style={{ marginTop: 10 }}>
                Esse pedido não tem pedido de devolução na loja. Pode ser pacote não entregue que voltou.
              </div>
            )}
          </>
        ) : (
          <>
            <div className="dev-loja">Devolução não identificada</div>
            <p className="explica" style={{ margin: '6px 0 0' }}>
              Coloque abaixo as peças que vieram no pacote. Depois toque em <b>Procurar pedido</b>: o app mostra os
              pedidos que têm essas peças.
            </p>
          </>
        )}
        {ja && (
          <div className="aviso erro" style={{ marginTop: 10 }}>
            Esta devolução já foi registrada em {dataHoraBR(ja.criado_em)}
            {ja.criado_por ? ` por ${ja.criado_por}` : ''}. Não precisa registrar de novo.
          </div>
        )}
      </div>

      <div className="card">
        <h3>
          Peças <span className="contador">{itens.reduce((s, i) => s + (i.quantidade || 0), 0)}</span>
        </h3>
        {identificada && itens.length > 0 && (
          <p className="explica">Abra o pacote e diga como chegou cada peça.</p>
        )}
        {itens.length === 0 && !adicionando && <div className="vazio">Nenhuma peça.</div>}

        <ul className="dev-itens">
          {itens.map((it, i) => (
            <li key={i}>
              <div className="dev-item-nome">
                <b>{it.produto}</b>
                {it.variacao && <small>{it.variacao}</small>}
              </div>

              <div className="dev-qtd">
                <span>Quantidade que chegou</span>
                <button className="secundario" onClick={() => mudar(i, { quantidade: Math.max(1, it.quantidade - 1) })}>
                  −
                </button>
                <b>{it.quantidade}</b>
                <button className="secundario" onClick={() => mudar(i, { quantidade: it.quantidade + 1 })}>
                  +
                </button>
              </div>
              {it.pedida && it.quantidade < it.pedida && (
                <small className="dev-falta">Faltam {it.pedida - it.quantidade} em relação à devolução.</small>
              )}

              {it.estado === 'outra_loja' ? (
                <div className="dev-outra-loja">
                  <b>Não é peça nossa</b> — fica registrada para contestar a devolução.
                  <div className="campo" style={{ marginTop: 8 }}>
                    <label>Descreva a peça (marca, modelo, cor, tamanho)</label>
                    <input
                      type="text"
                      value={it.variacao ?? ''}
                      onChange={(e) => mudar(i, { variacao: e.target.value })}
                      placeholder="Ex.: blusa de outra marca, azul, M"
                    />
                  </div>
                </div>
              ) : (
              <div className="opcoes dev-estados">
                {ESTADOS.filter((e) => !e.fixo).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={it.estado === e.id ? 'escolhida' : ''}
                    style={it.estado === e.id ? { background: e.cor, borderColor: e.cor } : null}
                    onClick={() => mudar(i, { estado: e.id })}
                  >
                    {e.nome}
                  </button>
                ))}
              </div>
              )}

              {it.estado === 'defeito' && (
                <div className="campo">
                  <label>Qual o defeito?</label>
                  <select
                    value={it.defeito_id ?? ''}
                    onChange={(e) => mudar(i, { defeito_id: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">Escolha…</option>
                    {defeitos.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nome}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {!it.pedida && (
                <button className="link-remover" onClick={() => remover(i)}>
                  remover peça
                </button>
              )}
            </li>
          ))}
        </ul>

        {adicionando ? (
          <EscolherPeca
            onEscolher={(p) => {
              setItens((l) => [
                ...l,
                {
                  produto: p.modelo,
                  variacao: `${p.cor} ${p.tamanho}`,
                  sku_id: p.id,
                  pedida: null,
                  quantidade: 1,
                  estado: null,
                  defeito_id: null,
                },
              ])
              setAdicionando(false)
            }}
            onCancelar={itens.length ? () => setAdicionando(false) : null}
          />
        ) : (
          <div className="dev-adicionar">
            <button className="secundario" onClick={() => setAdicionando(true)}>
              + {identificada ? 'Veio outra peça nossa' : 'Adicionar peça'}
            </button>
            <button
              className="secundario"
              onClick={() =>
                setItens((l) => [
                  ...l,
                  {
                    produto: 'Peça de outra loja',
                    variacao: '',
                    sku_id: null,
                    pedida: null,
                    quantidade: 1,
                    estado: 'outra_loja',
                    defeito_id: null,
                  },
                ])
              }
            >
              + Veio peça de outra loja
            </button>
          </div>
        )}
      </div>

      {!identificada && itens.some((i) => i.sku_id) && (
        <div className="card">
          {procurando ? (
            <Candidatos
              skuIds={itens.map((i) => i.sku_id).filter(Boolean)}
              onEscolher={(c) => {
                setOrigem((o) => ({ ...o, plataforma: c.plataforma, loja: c.loja, n_pedido: c.n_pedido }))
                setProcurando(false)
              }}
              onFechar={() => setProcurando(false)}
            />
          ) : (
            <button className="gigante" onClick={() => setProcurando(true)}>
              🔎 Procurar pedido
            </button>
          )}
        </div>
      )}

      <div className="card">
        <h3>
          Fotos <span className="contador">{fotos.length}</span>
        </h3>
        <p className="explica">
          Tire foto do pacote aberto e de cada peça, principalmente se veio peça errada, faltando ou com defeito. É a
          prova para contestar a devolução.
        </p>
        <TirarFotos fotos={fotos} onMudar={setFotos} />
      </div>

      <div className="card">
        <div className="campo">
          <label htmlFor="obs-dev">Observação (opcional)</label>
          <textarea
            id="obs-dev"
            rows={2}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Peça trocada, veio sem etiqueta, embalagem violada…"
          />
        </div>
        {pendentes.length > 0 && itens.length > 0 && (
          <div className="explica" style={{ marginBottom: 8 }}>
            Falta marcar como chegou {pendentes.length === 1 ? '1 peça' : `${pendentes.length} peças`}.
          </div>
        )}
        <button className="gigante verde" disabled={!podeSalvar} onClick={salvar}>
          {salvando ? 'Salvando…' : identificada ? 'Salvar devolução' : 'Salvar sem pedido'}
        </button>
        <button className="secundario" style={{ width: '100%', marginTop: 10 }} onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Escolher peça do estoque: modelo → cor → tamanho                     */
/* ------------------------------------------------------------------ */
let cachePecas = null

function EscolherPeca({ onEscolher, onCancelar }) {
  const [pecas, setPecas] = useState(cachePecas)
  const [modelo, setModelo] = useState('')
  const [cor, setCor] = useState('')
  const [erro, setErro] = useState(null)

  useEffect(() => {
    if (cachePecas) return
    pecasEstoque()
      .then((p) => {
        cachePecas = p
        setPecas(p)
      })
      .catch((e) => setErro(mensagemErro(e)))
  }, [])

  const modelos = useMemo(() => [...new Set((pecas ?? []).map((p) => p.modelo))], [pecas])
  const cores = useMemo(
    () => [...new Set((pecas ?? []).filter((p) => p.modelo === modelo).map((p) => p.cor))],
    [pecas, modelo]
  )
  const tamanhos = useMemo(
    () => (pecas ?? []).filter((p) => p.modelo === modelo && p.cor === cor),
    [pecas, modelo, cor]
  )

  if (erro) return <div className="aviso erro">{erro}</div>
  if (!pecas) return <div className="vazio">Carregando peças…</div>

  return (
    <div className="escolher-peca">
      <div className="campo">
        <label>Modelo</label>
        <select
          value={modelo}
          onChange={(e) => {
            setModelo(e.target.value)
            setCor('')
          }}
        >
          <option value="">Escolha…</option>
          {modelos.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>
      {modelo && (
        <div className="campo">
          <label>Cor</label>
          <select value={cor} onChange={(e) => setCor(e.target.value)}>
            <option value="">Escolha…</option>
            {cores.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      )}
      {cor && (
        <div className="campo">
          <label>Tamanho</label>
          <div className="opcoes">
            {tamanhos.map((t) => (
              <button key={t.id} type="button" onClick={() => onEscolher(t)}>
                {t.tamanho}
              </button>
            ))}
          </div>
        </div>
      )}
      {onCancelar && (
        <button className="secundario" style={{ width: '100%' }} onClick={onCancelar}>
          Cancelar
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Pedidos candidatos (últimos 90 dias que têm as peças)                */
/* ------------------------------------------------------------------ */
function Candidatos({ skuIds, onEscolher, onFechar }) {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    candidatos(skuIds)
      .then(setLista)
      .catch((e) => setErro(mensagemErro(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuIds.join(',')])

  return (
    <div>
      <h3>Pedidos com essas peças</h3>
      {erro && <div className="aviso erro">{erro}</div>}
      {!lista && !erro && <div className="vazio">Procurando…</div>}
      {lista && lista.length === 0 && (
        <div className="vazio">Nenhum pedido dos últimos 90 dias tem essas peças. Salve sem pedido.</div>
      )}
      {lista && lista.length > 0 && (
        <>
          <p className="explica">
            Os de cima batem com mais peças. <b>Tem devolução</b> = a cliente pediu devolução na loja (mais provável).
          </p>
          <ul className="lista-linhas">
            {lista.map((c) => (
              <li key={`${c.plataforma}${c.n_pedido}`}>
                <button onClick={() => onEscolher(c)}>
                  <span className="qtd">{c.acertos}</span>
                  <span className="info">
                    <b>
                      {nomeLoja(c.plataforma, c.loja)} · {c.n_pedido}
                      {c.tem_devolucao && <span className="tag-dev">tem devolução</span>}
                    </b>
                    <small>
                      {dataBR(c.data_venda)} · {resumoItens(c.itens)}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button className="secundario" style={{ width: '100%', marginTop: 12 }} onClick={onFechar}>
        Fechar
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Lista das devoluções recebidas                                       */
/* ------------------------------------------------------------------ */
function ListaDevolucoes({ recarregar, defeitos }) {
  const { ehGestor, ehAdmin } = useAuth()
  const toast = useToast()
  const [dias, setDias] = useState(7)
  const [filtro, setFiltro] = useState('todas')
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState(null)
  const [aberta, setAberta] = useState(null)
  const [vinculando, setVinculando] = useState(null)
  const [contestando, setContestando] = useState(null)
  const [contestacoes, setContestacoes] = useState({})
  const [subindo, setSubindo] = useState(null)

  const carregar = useCallback(() => {
    setErro(null)
    listarDevolucoes(somarDias(hojeISO(), -(dias - 1)) + 'T00:00:00-03:00')
      .then((l) => {
        setLista(l)
        if (ehAdmin)
          listarContestacoes(l.map((d) => d.id))
            .then((cs) => {
              const m = {}
              for (const c of cs) (m[c.devolucao_id] ??= []).push(c)
              setContestacoes(m)
            })
            .catch(() => {})
      })
      .catch((e) => setErro(mensagemErro(e)))
  }, [dias, ehAdmin])

  const maisFotos = async (d, files) => {
    setSubindo(d.id)
    try {
      const blobs = []
      for (const f of Array.from(files || [])) if (f.type.startsWith('image/')) blobs.push(await comprimirFoto(f))
      const n = await subirFotos(d.id, blobs)
      toast.ok(`${n} foto(s) adicionada(s).`)
      carregar()
    } catch (e) {
      toast.erro(mensagemErro(e))
    } finally {
      setSubindo(null)
    }
  }

  useEffect(() => {
    carregar()
  }, [carregar, recarregar])

  const visiveis = (lista ?? []).filter((d) => filtro === 'todas' || !d.identificada)
  const naoIdent = (lista ?? []).filter((d) => !d.identificada).length

  const totais = useMemo(() => {
    const t = { estoque: 0, defeito: 0, perda: 0, outra_loja: 0 }
    for (const d of visiveis) for (const i of d.itens) t[i.estado] += i.quantidade
    return t
  }, [visiveis])

  const nomeDefeito = (id) => defeitos.find((d) => d.id === id)?.nome

  const excluir = async (d) => {
    if (!window.confirm('Excluir esta devolução?')) return
    try {
      await excluirDevolucao(d.id)
      toast.ok('Devolução excluída.')
      carregar()
    } catch (e) {
      toast.erro(mensagemErro(e))
    }
  }

  const vincular = async (d, c) => {
    try {
      await vincularPedido(d.id, c.plataforma, c.loja, c.n_pedido)
      toast.ok(`Ligada ao pedido ${c.n_pedido}.`)
      setVinculando(null)
      carregar()
    } catch (e) {
      toast.erro(mensagemErro(e))
    }
  }

  return (
    <div className="card">
      <h3>
        Recebidas <span className="contador">{visiveis.length}</span>
      </h3>
      <div className="sub-abas">
        {[
          [1, 'Hoje'],
          [7, '7 dias'],
          [30, '30 dias'],
        ].map(([n, r]) => (
          <button key={n} className={dias === n ? 'ativa' : ''} onClick={() => setDias(n)}>
            {r}
          </button>
        ))}
        <button className={filtro === 'nao' ? 'ativa' : ''} onClick={() => setFiltro(filtro === 'nao' ? 'todas' : 'nao')}>
          Não identificadas{naoIdent ? ` (${naoIdent})` : ''}
        </button>
      </div>

      {visiveis.length > 0 && (
        <div className="dev-totais">
          {ESTADOS.filter((e) => !e.fixo || totais[e.id] > 0).map((e) => (
            <span key={e.id} style={{ color: e.cor }}>
              <b>{num(totais[e.id])}</b> {e.curto.toLowerCase()}
            </span>
          ))}
        </div>
      )}

      {erro && <div className="aviso erro">{erro}</div>}
      {!lista && !erro && <div className="vazio">Carregando…</div>}
      {lista && visiveis.length === 0 && <div className="vazio">Nenhuma devolução nesse período.</div>}

      <ul className="lista-linhas dev-lista">
        {visiveis.map((d) => (
          <li key={d.id}>
            <button onClick={() => setAberta(aberta === d.id ? null : d.id)}>
              <span className="info">
                <b>
                  {d.identificada ? `${nomeLoja(d.plataforma, d.loja)} · ${d.n_pedido}` : 'Não identificada'}
                  {d.fotos.length > 0 && <span className="tag-fotos">📷 {d.fotos.length}</span>}
                  {contestacoes[d.id]?.[0] &&
                    (contestacoes[d.id][0].ok ? (
                      <span className="tag-dev">contestada</span>
                    ) : (
                      <span className="tag-dev recusada">contestação recusada</span>
                    ))}
                </b>
                <small>
                  {dataHoraBR(d.criado_em)} ·{' '}
                  {d.itens.map((i) => (
                    <span key={i.id} className="dev-chip" style={{ color: estadoPorId(i.estado)?.cor }}>
                      {i.quantidade}× {estadoPorId(i.estado)?.curto}
                    </span>
                  ))}
                </small>
              </span>
            </button>
            {aberta === d.id && (
              <div className="dev-detalhe">
                {d.itens.map((i) => (
                  <div key={i.id}>
                    <b style={{ color: estadoPorId(i.estado)?.cor }}>{estadoPorId(i.estado)?.nome}</b> · {i.quantidade}×{' '}
                    {i.produto}
                    {i.variacao ? ` (${i.variacao})` : ''}
                    {i.defeito_id ? ` · ${nomeDefeito(i.defeito_id) ?? 'defeito'}` : ''}
                  </div>
                ))}
                {d.motivo_cliente && <div>Motivo da cliente: {d.motivo_cliente}</div>}
                {d.observacao && <div>Obs.: {d.observacao}</div>}
                {d.codigo_lido && <div className="dev-codigo">Código lido: {d.codigo_lido}</div>}
                <div>Registrado por {d.criado_por ?? '—'}</div>
                <VerFotos paths={d.fotos.map((f) => f.path)} />
                <label className="botao secundario botao-fotos">
                  {subindo === d.id ? 'Subindo…' : '📷 Adicionar fotos'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    hidden
                    disabled={subindo === d.id}
                    onChange={(e) => maisFotos(d, e.target.files)}
                  />
                </label>
                {ehAdmin &&
                  (contestacoes[d.id] ?? []).map((c) => (
                    <div key={c.id} className={c.ok ? 'dev-contest ok' : 'dev-contest erro'}>
                      {dataHoraBR(c.criado_em)} · {c.motivo_texto} ·{' '}
                      {c.ok
                        ? 'enviada'
                        : `recusada: ${c.resposta?.disputa?.message ?? c.resposta?.tentativas?.at(-1)?.message ?? 'erro'}`}
                    </div>
                  ))}
                {ehGestor && (
                  <div className="linha" style={{ marginTop: 8 }}>
                    {ehAdmin && d.retorno_id && ['Shopee', 'TikTok Shop'].includes(d.plataforma) && (
                      <button onClick={() => setContestando(d)}>Contestar</button>
                    )}
                    {!d.identificada && d.itens.some((i) => i.sku_id) && (
                      <button className="secundario" onClick={() => setVinculando(d)}>
                        Procurar pedido
                      </button>
                    )}
                    <button className="vermelho" onClick={() => excluir(d)}>
                      Excluir
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {contestando && (
        <Contestar
          dev={contestando}
          nomeDefeito={nomeDefeito}
          onFechar={() => setContestando(null)}
          onEnviado={carregar}
        />
      )}

      {vinculando && (
        <div className="modal-fundo">
          <div className="modal">
            <Candidatos
              skuIds={vinculando.itens.map((i) => i.sku_id).filter(Boolean)}
              onEscolher={(c) => vincular(vinculando, c)}
              onFechar={() => setVinculando(null)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
