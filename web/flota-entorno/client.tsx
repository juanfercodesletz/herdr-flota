// Entorno en la web de Shepherdr: un botón al pie de la barra lateral (en el teléfono, al pie del cajón) que abre
// el panel. Los datos son la foto que escribe el panel del escritorio (~/.herdr/flota/web/entorno.json, servida en
// /flota del tailnet) y las filas salen del mismo cálculo (calc.js, copiado de mods/flota-entorno por install.sh).
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { definePlugin } from '@client/kernel.ts'
import { FootButton } from '@client/ui.tsx'
import { ago, clamp, entorno, level } from './calc.js'

type Level = 'none' | 'ok' | 'near' | 'over'
interface Row { k: string; pct?: number | null; c: number; val: string; right: string; note?: string }
type Foto = Parameters<typeof entorno>[0] & { at: number }

// Los mismos tonos del escritorio: gris lo que va bien, ámbar cerca del techo, rojo encima.
const FILL: Record<Level, string> = { none: 'bg-fg3', ok: 'bg-fg2', near: 'bg-work', over: 'bg-need' }
const TEXT: Record<Level, string> = { none: 'text-fg3', ok: 'text-fg2', near: 'text-work-fg', over: 'text-need-fg' }

function useFoto() {
  const [foto, setFoto] = useState<Foto | null | 'error'>(null)
  useEffect(() => {
    const read = () => fetch('/flota/entorno.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject())).then(setFoto, () => setFoto('error'))
    read()
    const t = setInterval(read, 15_000)
    return () => clearInterval(t)
  }, [])
  return foto
}

function Fila({ k, pct, c, val, right, note }: Row) {
  const l = level(pct, c) as Level
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[0.875rem] text-fg phone:text-[0.9375rem]">{k}</span>
        <span className="w-[96px] shrink-0 text-right text-[0.75rem] text-fg3 tabular-nums phone:text-[0.8125rem]">{right}</span>
        <span className={clsx('w-[60px] shrink-0 text-right text-[0.8125rem] font-medium tabular-nums phone:text-[0.9375rem]', TEXT[l])}>{val}</span>
      </div>
      <div className="relative h-[3px] w-full rounded-full bg-line2">
        <div className={clsx('h-full rounded-full', FILL[l])} style={{ width: `${clamp(pct ?? 0)}%` }} />
        {c < 100 ? <div className="absolute -top-[2px] h-[7px] w-px bg-fg opacity-50" style={{ left: `${c}%` }} /> : null}
      </div>
      {note ? <p className="text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{note}</p> : null}
    </div>
  )
}

function Encabezado({ left, right }: { left: string; right: string }) {
  const cls = 'text-[0.6875rem] tracking-wide text-fg3 uppercase phone:text-[0.75rem]'
  return (
    <div className="flex gap-2">
      <span className={clsx('flex-1', cls)}>{left}</span>
      <span className={clsx('w-[96px] text-right', cls)}>{right}</span>
      <span className="w-[60px]" />
    </div>
  )
}

function Panel({ foto, onClose }: { foto: Foto | null | 'error'; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [onClose])
  const now = Date.now() / 1000
  const e = foto && foto !== 'error' ? entorno(foto, now) : null
  const viejo = foto && foto !== 'error' && now - foto.at > 120
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Entorno"
        onClick={(ev) => ev.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-[400px] flex-col overflow-y-auto rounded-t-2xl bg-bg px-4 pt-3 pb-[max(env(safe-area-inset-bottom),--spacing(4))] text-fg shadow-sheet sm:rounded-2xl"
      >
        <div className="flex items-center gap-2 pb-3">
          <h2 className="flex-1 text-[0.9375rem] font-semibold phone:text-[1.0625rem]">Entorno</h2>
          {foto && foto !== 'error' ? <span className="text-[0.75rem] text-fg3 tabular-nums">{ago(foto.at, now)}</span> : null}
          <button type="button" onClick={onClose} aria-label="Cerrar" className="press -mr-2 grid size-9 place-items-center rounded-full text-fg2 hover:bg-hover">
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
        {foto === 'error' ? <p className="pb-4 text-[0.875rem] text-fg2">Sin datos: /flota no responde en este Mac.</p> : null}
        {viejo ? <p className="mb-3 rounded-lg bg-well px-3 py-2 text-[0.8125rem] text-work-fg">Dato de {ago(foto.at, now)}: el panel del escritorio no está abierto.</p> : null}
        {e ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-0.5">
              <p className="text-[1rem] font-semibold phone:text-[1.125rem]">{e.head}</p>
              <p className="text-[0.8125rem] text-fg2 phone:text-[0.875rem]">{e.sub}</p>
            </div>
            <div className="flex flex-col gap-3.5">
              <Encabezado left="Cupo semanal" right="Reinicia" />
              {e.seats.map((r: Row) => <Fila key={r.k} {...r} />)}
            </div>
            <div className="flex flex-col gap-3.5">
              <Encabezado left="Este Mac" right="Presupuesto" />
              {(e.mac || []).map((r: Row) => <Fila key={r.k} {...r} />)}
            </div>
            <p className="text-[0.75rem] text-fg3">La raya marca el techo. Solo se colorea lo que está cerca o encima.</p>
          </div>
        ) : foto === null ? <p className="pb-4 text-[0.875rem] text-fg3">Midiendo…</p> : null}
      </div>
    </div>,
    document.body,
  )
}

/** el botón del pie: un punto ámbar o rojo si algo está cerca o encima de su techo */
function Boton() {
  const [open, setOpen] = useState(false)
  const foto = useFoto()
  const e = foto && foto !== 'error' ? entorno(foto) : null
  const rows: Row[] = e ? [...e.seats, ...(e.mac || [])] : []
  const worst = rows.map((r) => level(r.pct, r.c)).find((l) => l === 'over') ?? rows.map((r) => level(r.pct, r.c)).find((l) => l === 'near')
  return (
    <>
      <FootButton onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
        <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-fg3 coarse:text-fg2 phone:size-5 phone:text-fg2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 13V9M8 13V3M13 13V6" />
        </svg>
        Entorno
        {worst ? <span className={clsx('size-2 rounded-full', FILL[worst as Level])} /> : null}
      </FootButton>
      {open ? <Panel foto={foto} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export default definePlugin({
  name: 'flota-entorno',
  setup(reg) {
    reg.sideFoot.push({ order: 50, View: Boton })
  },
})
