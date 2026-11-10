import { useEffect, useRef, useState } from 'react'

/*
 * Leitor de código de barras / QR pela câmera.
 * Usa o BarcodeDetector do próprio navegador (Chrome do Android) e, se ele não
 * existir (iPhone, PC), a versão em WebAssembly do pacote barcode-detector.
 *
 * A etiqueta tem vários códigos. Cada código novo lido vai para onCodigo(valor);
 * se a função devolver true o leitor fecha, se devolver false ele continua lendo.
 */
const FORMATOS = ['code_128', 'qr_code', 'code_39', 'code_93', 'ean_13', 'itf', 'data_matrix', 'pdf417', 'codabar']

async function criarDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const suportados = await window.BarcodeDetector.getSupportedFormats()
      const f = FORMATOS.filter((x) => suportados.includes(x))
      if (f.length) return new window.BarcodeDetector({ formats: f })
    } catch {
      /* cai na versão em WebAssembly */
    }
  }
  const { BarcodeDetector } = await import('barcode-detector/ponyfill')
  return new BarcodeDetector({ formats: FORMATOS })
}

export default function Leitor({ onCodigo, onFechar }) {
  const video = useRef(null)
  const [erro, setErro] = useState(null)
  const [lidos, setLidos] = useState([])
  const [verificando, setVerificando] = useState(false)

  useEffect(() => {
    let vivo = true
    let stream = null
    let timer = null
    const vistos = new Set()
    let ocupado = false

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (!vivo) return
        video.current.srcObject = stream
        await video.current.play()
        const detector = await criarDetector()

        const ciclo = async () => {
          if (!vivo) return
          if (!ocupado && video.current?.readyState >= 2) {
            try {
              const achados = await detector.detect(video.current)
              const novos = achados.map((a) => String(a.rawValue || '').trim()).filter((v) => v && !vistos.has(v))
              for (const v of novos) {
                vistos.add(v)
                setLidos((l) => [...l, v])
                ocupado = true
                setVerificando(true)
                navigator.vibrate?.(60)
                const achou = await onCodigo(v)
                ocupado = false
                if (vivo) setVerificando(false)
                if (achou || !vivo) return
              }
            } catch {
              /* quadro ruim: tenta no próximo */
            }
          }
          timer = setTimeout(ciclo, 220)
        }
        ciclo()
      } catch (e) {
        if (!vivo) return
        setErro(
          e?.name === 'NotAllowedError'
            ? 'A câmera foi bloqueada. Libere a câmera para este site nas configurações do navegador.'
            : 'Não consegui abrir a câmera neste aparelho. Use o campo para digitar o código.'
        )
      }
    })()

    return () => {
      vivo = false
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
    // onCodigo muda a cada render; o leitor só precisa da primeira
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="leitor">
      {erro ? (
        <div className="aviso erro">{erro}</div>
      ) : (
        <div className="leitor-video">
          <video ref={video} playsInline muted />
          <div className="leitor-mira" />
          <div className="leitor-status">
            {verificando
              ? 'Procurando esse código…'
              : lidos.length === 0
                ? 'Aponte para o código de barras ou QR da etiqueta'
                : `${lidos.length} código(s) lido(s), nenhum é de devolução. Aponte para outro código da etiqueta.`}
          </div>
        </div>
      )}
      <button className="secundario" style={{ width: '100%', marginTop: 10 }} onClick={onFechar}>
        Fechar câmera
      </button>
    </div>
  )
}
