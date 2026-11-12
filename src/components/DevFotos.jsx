import { useEffect, useRef, useState } from 'react'
import { comprimirFoto, linksFotos } from '../lib/devolucoes.js'

/** Escolher / tirar fotos antes de salvar. `fotos` = [{ blob, url }] */
export function TirarFotos({ fotos, onMudar }) {
  const input = useRef(null)
  const [lendo, setLendo] = useState(false)

  const adicionar = async (files) => {
    setLendo(true)
    const novas = []
    for (const f of Array.from(files || [])) {
      if (!f.type.startsWith('image/')) continue
      try {
        const blob = await comprimirFoto(f)
        novas.push({ blob, url: URL.createObjectURL(blob) })
      } catch {
        /* imagem ilegível: ignora */
      }
    }
    onMudar([...fotos, ...novas])
    setLendo(false)
    if (input.current) input.current.value = ''
  }

  return (
    <div>
      <div className="dev-fotos">
        {fotos.map((f, i) => (
          <div key={f.url} className="dev-foto">
            <img src={f.url} alt={`Foto ${i + 1}`} />
            <button type="button" aria-label="Remover foto" onClick={() => onMudar(fotos.filter((_, k) => k !== i))}>
              ×
            </button>
          </div>
        ))}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => adicionar(e.target.files)}
      />
      <button type="button" className="secundario" style={{ width: '100%' }} disabled={lendo} onClick={() => input.current?.click()}>
        {lendo ? 'Preparando…' : `📷 ${fotos.length ? 'Mais fotos' : 'Tirar fotos'}`}
      </button>
    </div>
  )
}

/** Mostra as fotos já salvas (links temporários). */
export function VerFotos({ paths }) {
  const [links, setLinks] = useState({})
  const chave = paths.join('|')
  useEffect(() => {
    linksFotos(paths)
      .then(setLinks)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])
  if (!paths.length) return null
  return (
    <div className="dev-fotos">
      {paths.map((p) => (
        <a key={p} className="dev-foto" href={links[p]} target="_blank" rel="noreferrer">
          {links[p] ? <img src={links[p]} alt="Foto da devolução" /> : <span />}
        </a>
      ))}
    </div>
  )
}
