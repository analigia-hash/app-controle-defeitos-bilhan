/* Datas trafegam como texto 'AAAA-MM-DD' (dia local), igual ao tipo date do Postgres. */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const inteiro = new Intl.NumberFormat('pt-BR')
const decimal1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const reais = (v) => brl.format(Number(v) || 0)
export const num = (v) => inteiro.format(Number(v) || 0)
export const num1 = (v) => decimal1.format(Number(v) || 0)

export function paraISO(d) {
  const a = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${a}-${m}-${dia}`
}

export function deISO(s) {
  const [a, m, d] = s.split('-').map(Number)
  return new Date(a, m - 1, d)
}

export const hojeISO = () => paraISO(new Date())

export function somarDias(iso, n) {
  const d = deISO(iso)
  d.setDate(d.getDate() + n)
  return paraISO(d)
}

/** dd/mm/aaaa */
export function dataBR(iso) {
  if (!iso) return ''
  const [a, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

/** dd/mm */
export function diaMes(iso) {
  if (!iso) return ''
  const [, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}`
}

export function dataHoraBR(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Semana de referência: do sábado anterior (ou o próprio sábado) até a sexta. */
export function inicioSemana(iso) {
  const d = deISO(iso)
  return somarDias(iso, -((d.getDay() + 1) % 7))
}

export const fimSemana = (inicio) => somarDias(inicio, 6)

export function rotuloSemana(inicio) {
  return `${dataBR(inicio)} a ${dataBR(fimSemana(inicio))}`
}

/** Variação percentual; null quando não há base de comparação. */
export function variacao(atual, anterior) {
  if (!anterior) return null
  return ((atual - anterior) / anterior) * 100
}
