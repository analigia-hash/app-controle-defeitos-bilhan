import { createContext, useCallback, useContext, useState } from 'react'

const Ctx = createContext(null)

export function ToastProvider({ children }) {
  const [lista, setLista] = useState([])

  const mostrar = useCallback((texto, tipo = 'ok', duracao = 3200) => {
    const id = Date.now() + Math.random()
    setLista((l) => [...l, { id, texto, tipo }])
    setTimeout(() => setLista((l) => l.filter((t) => t.id !== id)), duracao)
  }, [])

  const api = {
    ok: (t) => mostrar(t, 'ok'),
    erro: (t) => mostrar(t, 'erro', 5000),
    info: (t) => mostrar(t, 'info'),
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts">
        {lista.map((t) => (
          <div key={t.id} className={`toast ${t.tipo}`}>
            {t.texto}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>')
  return ctx
}
