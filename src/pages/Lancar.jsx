import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import LinhaForm, { CAMPOS, nomeCampo } from '../components/LinhaForm.jsx'
import { useToast } from '../components/Toast.jsx'
import {
  carregarListas,
  excluirLinha,
  fecharSemana,
  garantirSemana,
  linhasSemCusto,
  recalcularSemana,
  salvarLinha,
  sincronizarCores,
} from '../lib/dados.js'
import { hojeISO, inicioSemana, num, rotuloSemana, somarDias } from '../lib/formato.js'
import { mensagemErro } from '../lib/supabase.js'

const CHAVES_COMBINACAO = ['peca_id', 'com_dtf', 'cor_id', 'defeito_id', 'finalidade_id', 'responsavel_id']
const mesmaCombinacao = (a, b) => CHAVES_COMBINACAO.every((k) => a[k] === b[k])

export default function Lancar() {
  const { ehGestor, papel } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const semanaAtual = inicioSemana(hojeISO())
  const inicio = params.get('semana') ? inicioSemana(params.get('semana')) : semanaAtual

  const [listas, setListas] = useState(null)
  const [semana, setSemana] = useState(null)
  const [linhas, setLinhas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)
  const [form, setForm] = useState(null) // { inicial, titulo }
  const [salvando, setSalvando] = useState(false)
  const [duplicada, setDuplicada] = useState(null) // { nova, existente }
  const [resumoAberto, setResumoAberto] = useState(false)
  const [ultima, setUltima] = useState(null)

  // Listas uma vez (as cores vêm do app de estoque)
  useEffect(() => {
    sincronizarCores()
      .catch((e) => console.warn('Sincronizar cores:', e))
      .finally(() =>
        carregarListas(true)
          .then(setListas)
          .catch((e) => setErro(mensagemErro(e)))
      )
  }, [])

  const recarregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const s = await garantirSemana(inicio)
      setSemana(s)
      setLinhas(await linhasSemCusto(s.id))
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setCarregando(false)
    }
  }, [inicio])

  useEffect(() => {
    setForm(null)
    recarregar()
  }, [recarregar])

  const irPara = (novoInicio) => {
    if (novoInicio === semanaAtual) setParams({})
    else setParams({ semana: novoInicio })
  }

  const fechada = semana?.status === 'fechada'
  const podeEscrever = semana && (!fechada || ehGestor)

  const resumo = useMemo(() => {
    const porFinalidade = new Map()
    let total = 0
    for (const l of linhas) {
      porFinalidade.set(l.finalidade, (porFinalidade.get(l.finalidade) ?? 0) + l.quantidade)
      total += l.quantidade
    }
    return { porFinalidade: [...porFinalidade.entries()], total }
  }, [linhas])

  const gravar = async (dados) => {
    setSalvando(true)
    try {
      await salvarLinha({ ...dados, semana_id: semana.id })
      setUltima(dados)
      setForm(null)
      setDuplicada(null)
      toast.ok(dados.id ? 'Linha alterada.' : 'Linha salva.')
      await recarregar()
    } catch (e) {
      toast.erro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  const aoSalvar = (dados) => {
    const existente = linhas.find((l) => l.id !== dados.id && mesmaCombinacao(l, dados))
    if (existente) setDuplicada({ nova: dados, existente })
    else gravar(dados)
  }

  const somarNaExistente = async () => {
    const { nova, existente } = duplicada
    const obs = [existente.observacao, nova.observacao].filter((t) => t && t.trim()).join(' · ')
    setSalvando(true)
    try {
      await salvarLinha({
        ...existente,
        semana_id: semana.id,
        quantidade: existente.quantidade + nova.quantidade,
        observacao: obs || null,
      })
      if (nova.id) await excluirLinha(nova.id)
      setUltima(nova)
      setForm(null)
      setDuplicada(null)
      toast.ok(`Somado: agora são ${existente.quantidade + nova.quantidade} peças nessa linha.`)
      await recarregar()
    } catch (e) {
      toast.erro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  const aoExcluir = async (id) => {
    if (!window.confirm('Excluir esta linha?')) return
    setSalvando(true)
    try {
      await excluirLinha(id)
      setForm(null)
      toast.ok('Linha excluída.')
      await recarregar()
    } catch (e) {
      toast.erro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  const novaLinha = () => setForm({ titulo: 'Nova linha', inicial: { quantidade: null, observacao: '' } })

  const repetirUltima = () => {
    const base = ultima ?? linhas[0]
    if (!base) return
    const inicial = Object.fromEntries(CAMPOS.map((c) => [c.k, base[c.k]]))
    setForm({ titulo: 'Repetindo a última linha — troque só o que muda', inicial: { ...inicial, observacao: '' } })
  }

  const editar = (l) => {
    if (!podeEscrever) return
    setForm({ titulo: 'Editar linha', inicial: { ...l } })
  }

  const alternarFechamento = async () => {
    const fechar = !fechada
    if (fechar && !window.confirm('Fechar a semana? O lançador não poderá mais alterar.')) return
    try {
      await fecharSemana(semana.id, fechar)
      toast.ok(fechar ? 'Semana fechada.' : 'Semana reaberta.')
      recarregar()
    } catch (e) {
      toast.erro(mensagemErro(e))
    }
  }

  const recalcular = async () => {
    if (!window.confirm('Recalcular os custos desta semana com o custo médio e os parâmetros de hoje?')) return
    try {
      const n = await recalcularSemana(semana.id)
      toast.ok(`${n} linhas recalculadas.`)
    } catch (e) {
      toast.erro(mensagemErro(e))
    }
  }

  if (!listas) {
    return erro ? <div className="aviso erro">{erro}</div> : <div className="vazio">Carregando…</div>
  }

  return (
    <div className="lancar">
      <h2 className="titulo-pagina">
        Lançar semana {fechada && <span className="tag">fechada</span>}
      </h2>

      <div className="seletor-semana">
        <button className="secundario" onClick={() => irPara(somarDias(inicio, -7))} aria-label="Semana anterior">
          ‹
        </button>
        <div className="rotulo">
          <small>{inicio === semanaAtual ? 'Semana atual' : 'Semana de referência'}</small>
          <b>{rotuloSemana(inicio)}</b>
        </div>
        <button
          className="secundario"
          onClick={() => irPara(somarDias(inicio, 7))}
          disabled={inicio >= semanaAtual}
          aria-label="Próxima semana"
        >
          ›
        </button>
      </div>

      {erro && <div className="aviso erro">{erro}</div>}
      {fechada && !ehGestor && (
        <div className="aviso atencao">Esta semana já foi fechada. Para corrigir algo, fale com a Ana.</div>
      )}

      {form ? (
        <LinhaForm
          key={form.titulo + (form.inicial.id ?? '')}
          listas={listas}
          inicial={form.inicial}
          titulo={form.titulo}
          salvando={salvando}
          onSalvar={aoSalvar}
          onCancelar={() => setForm(null)}
          onExcluir={form.inicial.id ? () => aoExcluir(form.inicial.id) : null}
        />
      ) : (
        podeEscrever && (
          <div className="acoes-lancar">
            <button className="gigante" onClick={novaLinha}>
              + Nova linha
            </button>
            {(ultima || linhas[0]) && (
              <button className="secundario repetir" onClick={repetirUltima}>
                ↻ Repetir última linha
              </button>
            )}
          </div>
        )
      )}

      {!form && (
        <>
          <div className="card">
            <h3>
              Linhas desta semana <span className="contador">{linhas.length}</span>
            </h3>
            {carregando ? (
              <div className="vazio">Carregando…</div>
            ) : linhas.length === 0 ? (
              <div className="vazio">Nenhuma peça lançada ainda.</div>
            ) : (
              <ul className="lista-linhas">
                {linhas.map((l) => (
                  <li key={l.id}>
                    <button type="button" onClick={() => editar(l)} disabled={!podeEscrever}>
                      <span className="qtd">{l.quantidade}</span>
                      <span className="info">
                        <b>
                          {l.peca} · {l.com_dtf ? 'com DTF' : 'sem DTF'} · {l.cor}
                        </b>
                        <small>
                          {l.defeito} → {l.finalidade} · {l.responsavel}
                        </small>
                        {l.observacao && <small className="obs">{l.observacao}</small>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {linhas.length > 0 && (
            <div className="card resumo">
              <h3>Resumo</h3>
              {resumo.porFinalidade.map(([f, q]) => (
                <div key={f} className="resumo-linha">
                  <span>{f}</span>
                  <b>{num(q)} peças</b>
                </div>
              ))}
              <div className="resumo-linha total">
                <span>Total</span>
                <b>{num(resumo.total)} peças</b>
              </div>
              {podeEscrever && papel === 'lancador' && (
                <button className="gigante verde" style={{ marginTop: 14 }} onClick={() => setResumoAberto(true)}>
                  Enviar
                </button>
              )}
            </div>
          )}

          {ehGestor && semana && (
            <div className="card">
              <h3>Gestão da semana</h3>
              <div className="linha">
                <button className={fechada ? 'secundario' : ''} onClick={alternarFechamento}>
                  {fechada ? 'Reabrir semana' : 'Fechar semana'}
                </button>
                <button className="secundario" onClick={recalcular} disabled={linhas.length === 0}>
                  Recalcular custos
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {duplicada && (
        <div className="modal-fundo">
          <div className="modal">
            <h3>Essa linha já existe</h3>
            <p>
              Já tem <b>{duplicada.existente.quantidade} peças</b> com a mesma combinação nesta semana:
            </p>
            <p className="combinacao">
              {CAMPOS.slice(0, 6)
                .map((c) => nomeCampo(c, duplicada.nova, listas))
                .join(' · ')}
            </p>
            <p>
              Somar as <b>{duplicada.nova.quantidade}</b> peças novas nela?
            </p>
            <button className="gigante verde" disabled={salvando} onClick={somarNaExistente}>
              Somar ({duplicada.existente.quantidade + duplicada.nova.quantidade} peças)
            </button>
            <div className="linha" style={{ marginTop: 10 }}>
              <button className="secundario" disabled={salvando} onClick={() => gravar(duplicada.nova)}>
                Lançar separado
              </button>
              <button className="secundario" onClick={() => setDuplicada(null)}>
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {resumoAberto && (
        <div className="modal-fundo">
          <div className="modal">
            <h3>Enviar a semana</h3>
            <p>
              {rotuloSemana(inicio)} · {linhas.length} linhas · <b>{num(resumo.total)} peças</b>
            </p>
            {resumo.porFinalidade.map(([f, q]) => (
              <div key={f} className="resumo-linha">
                <span>{f}</span>
                <b>{num(q)}</b>
              </div>
            ))}
            <p style={{ fontSize: 13, color: 'var(--texto-suave)' }}>
              Cada linha já fica salva assim que você adiciona. Se lembrar de mais alguma peça, pode
              voltar e lançar até a Ana fechar a semana.
            </p>
            <button
              className="gigante verde"
              onClick={() => {
                setResumoAberto(false)
                toast.ok('Semana enviada. Obrigada!')
              }}
            >
              Confirmar envio
            </button>
            <button className="secundario" style={{ width: '100%', marginTop: 10 }} onClick={() => setResumoAberto(false)}>
              Voltar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
