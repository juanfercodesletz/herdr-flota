// Iniciativas en la web de Shepherdr: una fila arriba de los espacios (barra lateral; en el teléfono, el cajón) que
// abre la lista de épicas y tareas sueltas; tocar una épica abre la hoja inferior con sus tareas. Los datos son la
// foto que escribe el panel del escritorio (~/.herdr/flota/web/iniciativas.json, servida en /flota del tailnet), ya
// leída con iniciativas.js (copiado de mods/flota-iniciativas por install.sh).
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { definePlugin } from '@client/kernel.ts'
import { avance, hace, tono, SIN_ARCHIVO } from './iniciativas.js'

interface Tarea { id: string; titulo: string; estado: string; link: string; sesion: string }
interface Epica { id: string; titulo: string; estado: string; link: string; tareas: Tarea[] }
type Producto = { archivo: string; at: number; error?: string; producto: string; epicas: Epica[]; sueltas: Tarea[] }
interface Foto { at: number; productos: Producto[] }

// Los tonos del escritorio: verde lo mergeado, azul con PR, rojo lo bloqueado, gris lo demás.
const DOT: Record<string, string> = { hecha: 'bg-ready', pr: 'bg-focus', bloqueada: 'bg-need', curso: 'bg-fg2', cola: 'bg-line2' }
const BAR = ['hecha', 'pr', 'curso', 'bloqueada'] as const

function useFoto() {
  const [foto, setFoto] = useState<Foto | null | 'error'>(null)
  useEffect(() => {
    const read = () => fetch('/flota/iniciativas.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject())).then(setFoto, () => setFoto('error'))
    read()
    const t = setInterval(read, 15_000)
    return () => clearInterval(t)
  }, [])
  return foto
}

const isLink = (s: string) => /^https?:\/\//.test(s)

function Barra({ e, className }: { e: Epica; className?: string }) {
  const a = avance(e)
  return (
    <span className={clsx('flex h-[5px] overflow-hidden rounded-full bg-line2', className)}>
      {BAR.map((k) => (a[k] ? <span key={k} className={DOT[k]} style={{ width: `${(a[k] / a.total) * 100}%` }} /> : null))}
    </span>
  )
}

function Estado({ estado }: { estado: string }) {
  return <span className={clsx('shrink-0 text-right text-[0.8125rem] phone:text-[0.875rem]', tono(estado) === 'bloqueada' ? 'text-need-fg' : 'text-fg2')}>{estado}</span>
}

function Cerrar({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="press -mr-2 grid size-11 shrink-0 place-items-center rounded-full text-fg2 hover:bg-hover">
      <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
    </button>
  )
}

/** una tarea: punto, título, sesión debajo y su estado; con link abre ClickUp */
function FilaTarea({ t, sub }: { t: Tarea; sub: string }) {
  const body = (
    <>
      <span className={clsx('size-2 shrink-0 rounded-full', DOT[tono(t.estado)])} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={clsx('truncate text-[0.875rem] phone:text-[0.9375rem]', tono(t.estado) === 'hecha' ? 'text-fg2' : 'text-fg')}>{t.titulo}</span>
        <span className="truncate text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{sub}</span>
      </span>
      <Estado estado={t.estado} />
    </>
  )
  const cls = 'flex min-h-14 items-center gap-3 rounded-row px-2 border-b border-line'
  return isLink(t.link) ? <a href={t.link} target="_blank" rel="noreferrer" className={clsx(cls, 'press hover:bg-hover')}>{body}</a> : <div className={cls}>{body}</div>
}

function Hoja({ e, onClose }: { e: Epica; onClose: () => void }) {
  const a = avance(e)
  return (
    <div className="absolute inset-0 z-10 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-label={e.titulo}
        onClick={(ev) => ev.stopPropagation()}
        className="relative flex max-h-[80%] w-full flex-col rounded-t-2xl bg-bg px-4 pt-2 pb-[max(env(safe-area-inset-bottom),--spacing(4))] shadow-sheet"
      >
        <span className="mx-auto mb-2 h-1 w-9 shrink-0 rounded-full bg-line2" />
        <div className="flex items-start gap-2 pb-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 className="text-[1rem] font-semibold phone:text-[1.0625rem]">{e.titulo}</h3>
            <p className="text-[0.8125rem] text-fg3">
              {isLink(e.link) ? <a href={e.link} target="_blank" rel="noreferrer" className="text-fg2 underline underline-offset-2">ClickUp {e.id}</a> : `ClickUp ${e.id}`}
              {e.estado ? <span className={e.estado === 'en riesgo' ? 'text-work-fg' : ''}> · {e.estado}</span> : null} · {a.hecha}/{a.total} merged
            </p>
            <Barra e={e} className="mt-1 w-full" />
          </div>
          <Cerrar onClick={onClose} label="Cerrar tareas" />
        </div>
        <div className="-mx-2 min-h-0 overflow-y-auto">
          {e.tareas.map((t, i) => <FilaTarea key={t.id || i} t={t} sub={t.sesion || (t.id ? `ClickUp ${t.id}` : '')} />)}
          {e.tareas.length === 0 ? <p className="px-2 py-3 text-[0.875rem] text-fg3">Esta épica no tiene tareas.</p> : null}
        </div>
      </div>
    </div>
  )
}

function Panel({ foto, onClose }: { foto: Foto | null | 'error'; onClose: () => void }) {
  const [abierta, setAbierta] = useState<string | null>(null) // "<archivo>#<n>": sigue a la foto nueva
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (abierta ? setAbierta(null) : onClose())
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [abierta, onClose])
  const now = Date.now() / 1000
  const ok = foto && foto !== 'error' ? foto : null
  const sel = ok?.productos.flatMap((p) => (p.error ? [] : p.epicas.map((e, i) => [`${p.archivo}#${i}`, e] as const))).find(([k]) => k === abierta)?.[1]
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Iniciativas"
        onClick={(ev) => ev.stopPropagation()}
        className="relative flex h-[88dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-2xl bg-bg text-fg shadow-sheet sm:h-[80dvh] sm:rounded-2xl"
      >
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <h2 className="flex-1 text-[0.9375rem] font-semibold phone:text-[1.0625rem]">Iniciativas</h2>
          {ok ? <span className="text-[0.75rem] text-fg3 tabular-nums">{hace(ok.at, now)}</span> : null}
          <Cerrar onClick={onClose} label="Cerrar" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-[max(env(safe-area-inset-bottom),--spacing(4))]">
          {foto === 'error' ? <p className="px-2 py-2 text-[0.875rem] text-fg2">Sin datos: /flota no responde en este Mac.</p> : null}
          {foto === null ? <p className="px-2 py-2 text-[0.875rem] text-fg3">Leyendo…</p> : null}
          {ok && now - ok.at > 120 ? <p className="mx-2 mb-2 rounded-lg bg-well px-3 py-2 text-[0.8125rem] text-work-fg">Dato de {hace(ok.at, now)}: el panel del escritorio no está abierto.</p> : null}
          {ok && ok.productos.length === 0 ? <p className="px-2 py-2 text-[0.875rem] text-fg2">{SIN_ARCHIVO}</p> : null}
          {ok?.productos.map((p) =>
            p.error ? (
              <p key={p.archivo} className="px-2 py-2 text-[0.875rem] text-need-fg">{p.error}</p>
            ) : (
              <section key={p.archivo} className="pb-3">
                <h3 className="px-2 pt-2 pb-1 text-[0.6875rem] tracking-wide text-fg3 uppercase phone:text-[0.75rem]">
                  {p.producto} <span className="normal-case tracking-normal">· el TPM lo escribió {hace(p.at, now)}</span>
                </h3>
                {p.epicas.map((e, i) => {
                  const a = avance(e)
                  return (
                    <button key={e.id || i} type="button" onClick={() => setAbierta(`${p.archivo}#${i}`)} aria-haspopup="dialog" className="press flex min-h-14 w-full items-center gap-3 rounded-row border-b border-line px-2 text-left hover:bg-hover">
                      <svg viewBox="0 0 24 24" className="size-[18px] shrink-0 text-fg2" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="m3 13 9 5 9-5" /></svg>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[0.875rem] font-semibold phone:text-[0.9375rem]">{e.titulo}</span>
                        <span className="truncate text-[0.75rem] text-fg3 phone:text-[0.8125rem]">
                          Épica · {a.total} tareas{e.estado ? <span className={e.estado === 'en riesgo' ? 'text-work-fg' : ''}> · {e.estado}</span> : null}
                        </span>
                      </span>
                      <span className="flex w-16 shrink-0 flex-col items-end gap-1">
                        <span className="text-[0.8125rem] text-fg2 tabular-nums">{a.hecha}/{a.total}</span>
                        <Barra e={e} className="w-full" />
                      </span>
                    </button>
                  )
                })}
                {p.sueltas.map((t, i) => <FilaTarea key={t.id || i} t={t} sub={`Tarea suelta${t.sesion ? ` · ${t.sesion}` : ''}`} />)}
              </section>
            ),
          )}
        </div>
        {sel ? <Hoja e={sel} onClose={() => setAbierta(null)} /> : null}
      </div>
    </div>,
    document.body,
  )
}

// Una fila arriba de la lista de espacios (barra lateral y cajón del teléfono): el pie ya va lleno con Shepherdr,
// Entorno y Add machine.
function Abridor() {
  const [open, setOpen] = useState(false)
  const foto = useFoto()
  // un punto rojo si hay tareas bloqueadas
  const bloqueadas = foto && foto !== 'error' && foto.productos.some((p) => !p.error && [...p.epicas.flatMap((e) => e.tareas), ...p.sueltas].some((t) => tono(t.estado) === 'bloqueada'))
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="press mx-1.5 mb-1 flex min-h-8 items-center gap-2 rounded-row px-2 text-left text-fg2 hover:bg-hover hover:text-fg coarse:min-h-11 phone:mx-2 phone:min-h-12 phone:gap-3 phone:px-3 phone:text-fg"
      >
        <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-fg3 coarse:text-fg2 phone:size-5 phone:text-fg2" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="m3 13 9 5 9-5" />
        </svg>
        <span className="flex-1">Iniciativas</span>
        {bloqueadas ? <span className="size-2 rounded-full bg-need" aria-label="hay tareas bloqueadas" /> : null}
      </button>
      {open ? <Panel foto={foto} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export default definePlugin({
  name: 'flota-iniciativas',
  setup(reg) {
    const Lugares = reg.views.places
    reg.views.places = function LugaresConIniciativas() {
      return (
        <>
          <Abridor />
          {Lugares ? <Lugares /> : null}
        </>
      )
    }
  },
})
