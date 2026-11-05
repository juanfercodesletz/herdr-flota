// El perfil de Claude (ccp, ccw o a secas) del chat que se tiene abierto: un chip en la cabecera del Assistant (en el
// teléfono, al final de su subtítulo) y otro sobre la caja de mensaje de una tarea. Tocarlo abre sus MCP. Los datos
// son la foto que deja el panel Entorno del escritorio (perfiles.py → ~/.herdr/flota/web/perfiles.json, en /flota).
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useUI } from '@client/kernel.ts'
import type { Place } from '@shared/types.ts'
import { ago, mcpLineas } from './calc.js'

interface Terminal {
  address: string; name?: string; space?: string; assistant: boolean; tarea?: string; titulo?: string
  perfil: string; dir: string | null; mcp: Record<string, string[]>; cuenta?: string
}
interface Foto { at: number; terminales: Terminal[] }

// Una sola lectura cada 15 s para todos los chips de la pantalla.
let foto: Foto | null = null
let timer = 0
const subs = new Set<() => void>()
const leer = () => fetch('/flota/perfiles.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((f) => { foto = f; subs.forEach((s) => s()) }, () => {})
// Fuera del hook: una función nueva en cada render hace que React se desuscriba y vuelva a suscribirse, y cada
// vuelta lee de nuevo; así quedó un fetch en bucle (HF-17).
const suscribir = (cb: () => void) => {
  subs.add(cb)
  if (!timer) { void leer(); timer = window.setInterval(leer, 15_000) }
  return () => { subs.delete(cb); if (!subs.size) { clearInterval(timer); timer = 0 } }
}
const leerFoto = () => foto
const useFoto = () => useSyncExternalStore(suscribir, leerFoto)

const donde = (x: Terminal) =>
  x.dir === null ? 'No se pudo leer el entorno de su proceso.'
    : x.dir ? `CLAUDE_CONFIG_DIR=${x.dir.replace(/^\/Users\/[^/]+/, '~')}`
    : 'Sin CLAUDE_CONFIG_DIR: la config global de ~/.claude.json.'

function Hoja({ x, at, onClose }: { x: Terminal; at: number; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [onClose])
  const now = Date.now() / 1000
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Perfil de Claude"
        onClick={(ev) => ev.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-[400px] flex-col gap-4 overflow-y-auto rounded-t-2xl bg-bg px-4 pt-3 pb-[max(env(safe-area-inset-bottom),--spacing(4))] text-fg shadow-sheet sm:rounded-2xl"
      >
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold max-sm:text-[1.0625rem]">
            {x.assistant ? 'Assistant' : x.tarea ? `${x.tarea} ${x.titulo ?? ''}` : x.name ?? x.address}
          </h2>
          <span className="text-[0.75rem] text-fg3 tabular-nums">{ago(at, now)}</span>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="press -mr-2 grid size-9 place-items-center rounded-full text-fg2 hover:bg-hover">
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
        {now - at > 120 ? <p className="rounded-lg bg-well px-3 py-2 text-[0.8125rem] text-work-fg">Dato de {ago(at, now)}: el panel Entorno del escritorio no está abierto.</p> : null}
        <div className="flex flex-col gap-0.5">
          <p className="text-[1rem] font-semibold max-sm:text-[1.125rem]">Claude · {x.perfil}</p>
          <p className="text-[0.8125rem] break-words text-fg2 max-sm:text-[0.875rem]">{donde(x)}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-[0.6875rem] tracking-wide text-fg3 uppercase max-sm:text-[0.75rem]">MCP de su config</p>
          {mcpLineas(x).map((l: string) => <p key={l} className="text-[0.875rem] text-fg max-sm:text-[0.9375rem]">{l}</p>)}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Chip({ x, at }: { x: Terminal; at: number }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title="Perfil de Claude y sus MCP"
        className="press inline-flex h-[20px] shrink-0 items-center gap-1 rounded-md bg-well px-1.5 text-[0.6875rem] font-semibold text-fg2 hover:bg-hover coarse:h-7 coarse:px-2 coarse:text-[0.8125rem]"
      >
        <span className="font-normal text-fg3">Claude</span>{x.perfil}
      </button>
      {open ? <Hoja x={x} at={at} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

/** en la cabecera del Assistant: el suyo, o el de la pestaña del espacio que se muestre */
export function MarcaEspacio({ place }: { place: Place }) {
  const f = useFoto()
  const term = useUI((u) => u.term)
  const ts = f?.terminales ?? []
  const x = term?.startsWith('t:') ? ts.find((t) => t.address === term.slice(2)) : ts.find((t) => t.assistant && t.space === place.id)
  return f && x ? <Chip x={x} at={f.at} /> : null
}

/** sobre la caja de mensaje de una tarea («HF-13/worker»); el Assistant y las pestañas ya lo tienen en la cabecera */
export function MarcaTarea({ chatKey }: { chatKey: string }) {
  const f = useFoto()
  const ref = /^[pt]:/.test(chatKey) ? null : chatKey.slice(0, chatKey.lastIndexOf('/'))
  const x = ref ? f?.terminales.find((t) => t.tarea === ref) : undefined
  return f && x ? <div className="flex justify-end"><Chip x={x} at={f.at} /></div> : null
}
