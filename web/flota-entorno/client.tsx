// Entorno en la web de Shepherdr (3.2): un botón en la fila de arriba de la lista de espacios (en el teléfono, la del
// cajón) que abre el panel como diálogo (hoja en el teléfono). Los datos son la foto que escribe el panel del
// escritorio (~/.herdr/flota/web/entorno.json, servida en /flota del tailnet) y las filas salen del mismo cálculo
// (calc.js, copiado de mods/flota-entorno por install.sh). Se viste con el sistema de diseño de la web (ds.css) y
// entorno.css; la web 3.2 no trae Tailwind.
import { useSyncExternalStore } from 'react'
import { definePlugin, setUI } from '@client/kernel.ts'
import { openDialog } from '@client/overlay.tsx'
import { IB } from '@client/ui.tsx'
import { ago, clamp, entorno, level } from './calc.js'
import { MarcaEspacio, MarcaTarea } from './perfil.tsx'
import './entorno.css'

type Level = 'none' | 'ok' | 'near' | 'over'
interface Row { k: string; pct?: number | null; c: number; val: string; right: string; note?: string; warn?: string }
type Foto = Parameters<typeof entorno>[0] & { at: number }

// Una sola lectura cada 15 s para el botón y el panel, y solo mientras alguno está en pantalla.
let foto: Foto | null | 'error' = null
let timer = 0
const subs = new Set<() => void>()
const leer = () =>
  fetch('/flota/entorno.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject())).then((f) => { foto = f }, () => { foto = 'error' }).then(() => subs.forEach((s) => s()))
const suscribir = (cb: () => void) => {
  subs.add(cb)
  if (!timer) { void leer(); timer = window.setInterval(leer, 15_000) }
  return () => { subs.delete(cb); if (!subs.size) { clearInterval(timer); timer = 0 } }
}
const leerFoto = () => foto
const useFoto = () => useSyncExternalStore(suscribir, leerFoto)

// Los mismos tonos del escritorio: gris lo que va bien, ámbar cerca del techo, rojo encima (entorno.css).
function Fila({ k, pct, c, val, right, note, warn }: Row) {
  const l = level(pct, c) as Level
  return (
    <div className="fe-row">
      <div className="fe-l">
        <span className="fe-k">{k}</span>
        <span className="fe-r">{right}</span>
        <span className={`fe-v ${l}`}>{val}</span>
      </div>
      <div className="fe-bar">
        <i className={l} style={{ width: `${clamp(pct ?? 0)}%` }} />
        {c < 100 ? <b style={{ left: `${c}%` }} /> : null}
      </div>
      {warn ? <p className="warn">{warn}</p> : null}
      {note ? <p>{note}</p> : null}
    </div>
  )
}

const Encabezado = ({ left, right }: { left: string; right: string }) => (
  <div className="fe-cap"><span>{left}</span><span>{right}</span></div>
)

function Panel({ close }: { close: () => void }) {
  const foto = useFoto()
  const now = Date.now() / 1000
  const f = foto && foto !== 'error' ? foto : null
  const e = f ? entorno(f, now) : null
  return (
    <div className="fe">
      <div className="fe-hd">
        <h2>Entorno</h2>
        {f ? <span className="hint">{ago(f.at, now)}</span> : null}
        <IB icon="x" label="Cerrar" onClick={close} />
      </div>
      {foto === 'error' ? <p>Sin datos: /flota no responde en este Mac.</p> : null}
      {f && now - f.at > 120 ? <p className="old">Dato de {ago(f.at, now)}: el panel del escritorio no está abierto.</p> : null}
      {e ? (
        <>
          <div>
            <div className="fe-head">{e.head}</div>
            <p>{e.sub}</p>
          </div>
          <div className="fe-sec">
            <Encabezado left="Cupo semanal" right="Reinicia" />
            {e.seats.map((r: Row) => <Fila key={r.k} {...r} />)}
          </div>
          <div className="fe-sec">
            <Encabezado left="Este Mac" right="Presupuesto" />
            {(e.mac || []).map((r: Row) => <Fila key={r.k} {...r} />)}
            {e.macNote ? <p className="near">{e.macNote}</p> : null}
            {e.mac ? null : <p>Midiendo…</p>}
          </div>
          <p>La raya marca el techo. Solo se colorea lo que está cerca o encima.</p>
        </>
      ) : foto === null ? <p>Midiendo…</p> : null}
    </div>
  )
}

/** el botón: un punto ámbar o rojo si algo está cerca o encima de su techo */
function Boton() {
  const foto = useFoto()
  const e = foto && foto !== 'error' ? entorno(foto) : null
  const ls = (e ? [...e.seats, ...(e.mac || [])] : []).map((r: Row) => level(r.pct, r.c) as Level)
  const worst = ls.includes('over') ? 'over' : ls.includes('near') ? 'near' : null
  const abrir = () => {
    setUI({ drawer: false })
    openDialog((close) => <Panel close={close} />, { label: 'Entorno' })
  }
  return (
    <IB icon="gauge" label={worst ? `Entorno: algo está ${worst === 'over' ? 'sobre' : 'cerca de'} su techo` : 'Entorno'} aria-haspopup="dialog" onClick={abrir}>
      {worst ? <span className={`fe-dot ${worst}`} /> : null}
    </IB>
  )
}

export default definePlugin({
  name: 'flota-entorno',
  setup(reg) {
    reg.sideHead.push(Boton)
    reg.header.push({ order: 5, phone: true, View: MarcaEspacio })
    reg.taskHeader.push({ order: 5, View: MarcaTarea })
  },
})
