// El perfil de Claude (ccp, ccw o a secas) del chat que se tiene abierto: un chip en la cabecera del chat de un
// espacio (el de su Assistant) y en la de una tarea abierta (el de su agente). Tocarlo abre sus MCP. Los datos son la
// foto que deja el panel Entorno del escritorio (perfiles.py → ~/.herdr/flota/web/perfiles.json, en /flota).
import { useSyncExternalStore } from 'react'
import type { Thread } from '@client/kernel.ts'
import { openDialog } from '@client/overlay.tsx'
import { IB } from '@client/ui.tsx'
import { ago, mcpLineas } from './calc.js'

interface Terminal {
  address: string; sesion?: string; name?: string; space?: string; assistant: boolean; tarea?: string; titulo?: string
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

// Las direcciones (t1) se repiten entre la sesión de Shepherdr y la de la app Herdr.
const clave = (x: Terminal) => `${x.sesion ?? ''}:${x.address}`

/** la hoja de un chip: sigue a la foto mientras está abierta (el terminal, por su sesión y dirección) */
function Hoja({ de, close }: { de: string; close: () => void }) {
  const f = useFoto()
  const x = f?.terminales.find((t) => clave(t) === de)
  const now = Date.now() / 1000
  return (
    <div className="fe">
      <div className="fe-hd">
        <h2>{!x ? 'Perfil de Claude' : x.assistant ? 'Assistant' : x.tarea ? `${x.tarea} ${x.titulo ?? ''}` : x.name ?? x.address}</h2>
        {f ? <span className="hint">{ago(f.at, now)}</span> : null}
        <IB icon="x" label="Cerrar" onClick={close} />
      </div>
      {f && now - f.at > 120 ? <p className="old">Dato de {ago(f.at, now)}: el panel Entorno del escritorio no está abierto.</p> : null}
      {x ? (
        <>
          <div>
            <div className="fe-head">Claude · {x.perfil}</div>
            <p className="wrap">{donde(x)}</p>
          </div>
          <div className="fe-mcp">
            <div className="fe-cap"><span>MCP de su config</span></div>
            {mcpLineas(x).map((l: string) => <div key={l}>{l}</div>)}
          </div>
        </>
      ) : <p>Ese agente ya no corre.</p>}
    </div>
  )
}

function Chip({ x }: { x: Terminal }) {
  return (
    <button
      type="button"
      className="fe-chip"
      aria-haspopup="dialog"
      title="Perfil de Claude y sus MCP"
      onClick={() => openDialog((close) => <Hoja de={clave(x)} close={close} />, { label: 'Perfil de Claude' })}
    >
      <span>Claude</span>{x.perfil}
    </button>
  )
}

/** en la cabecera del chat de un espacio: el de su Assistant (con una tarea en el centro, el suyo va en MarcaTarea) */
export function MarcaEspacio({ thread }: { thread: Pick<Thread, 'place' | 'task'> }) {
  const f = useFoto()
  const x = thread.task ? undefined : f?.terminales.find((t) => t.assistant && t.space === thread.place)
  return x ? <Chip x={x} /> : null
}

/** en la cabecera de una tarea abierta (en el panel o en el centro): el de su agente; `task.id` es «HF-13» */
export function MarcaTarea({ thread }: { thread: { task?: { id: string } } }) {
  const f = useFoto()
  const x = thread.task ? f?.terminales.find((t) => t.tarea === thread.task!.id) : undefined
  return x ? <Chip x={x} /> : null
}
