// Árbol de productos en la web de Shepherdr: una fila «Flota» arriba de los espacios (barra lateral; en el teléfono,
// el cajón) que abre la hoja con el árbol: cada espacio con su TPM (el Assistant) y sus sesiones vivas (tareas que
// trabajan, esperan a Juan o están listas, y los agentes de sus pestañas), bajo la épica de su tarea si el producto
// tiene iniciativas. Tocar un producto lo abre o lo pliega; tocar una sesión abre su terminal; el TPM, su chat.
// Los datos son los de la propia web (en vivo); las épicas, la foto de Iniciativas (/flota/iniciativas.json).
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { definePlugin, goPlace, openItem, openTask, setUI, useSnap } from '@client/kernel.ts'
import { agrupar, estado, ordenar, PALABRA, resumen, VIVA } from './arbol.js'
import { avance } from './iniciativas.js'

type Estado = 'need' | 'ready' | 'merging' | 'work' | 'done' | 'idle'
interface Sesion { clave: string; ref: string; titulo: string; sub: string; estado: Estado; alias: string; abrir: () => void }
interface Epica { titulo: string; tareas: { id: string; estado: string; sesion: string }[] }
interface Producto { archivo: string; error?: string; epicas: Epica[] }

const DOT: Record<Estado, string> = { need: 'bg-need', ready: 'bg-ready', merging: 'bg-focus', work: 'bg-work', done: 'bg-fg2', idle: 'bg-line2' }
const TEXT: Record<Estado, string> = { need: 'text-need-fg', ready: 'text-ready-fg', merging: 'text-fg2', work: 'text-work-fg', done: 'text-fg2', idle: 'text-fg3' }

// Las épicas: la foto que escribe el panel Iniciativas del escritorio. Sin ella, el árbol va sin épicas.
function useIniciativas() {
  const [productos, setProductos] = useState<Producto[]>([])
  useEffect(() => {
    fetch('/flota/iniciativas.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((f) => f && setProductos(f.productos), () => undefined)
  }, [])
  return productos
}

function Cerrar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Cerrar" className="press -mr-2 grid size-11 shrink-0 place-items-center rounded-full text-fg2 hover:bg-hover">
      <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
    </button>
  )
}

const fila = 'press flex min-h-12 w-full items-center gap-2.5 rounded-row pr-2 text-left hover:bg-hover'

function Arbol({ onClose }: { onClose: () => void }) {
  const snap = useSnap()
  const productos = useIniciativas()
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [onClose])
  // Tocar algo cierra la hoja y lo abre detrás.
  const ir = (fn: () => void) => () => { onClose(); fn() }

  const lista = (snap?.places ?? []).filter((p) => !p.home).map((p) => {
    const tpm = p.assistantTab ? { estado: estado(p.assistantTab.state) as Estado } : null
    const tareas = snap!.tasks.filter((t) => t.place === p.id && !t.archived && VIVA(t.status)).map((t): Sesion => ({
      clave: t.id, ref: t.id, titulo: t.name, sub: t.report?.msg ?? '', estado: estado(t.status) as Estado, alias: '',
      // su terminal, como «Open terminal» de la web: el chat de la tarea con su hoja Terminal
      abrir: ir(() => { openTask(t.id); if (t.agent) openItem('terminal') }),
    }))
    const pestanas = (p.tabs ?? []).filter((tb) => tb.cli && tb.state).map((tb): Sesion => ({
      clave: tb.term, ref: '', titulo: tb.name, sub: tb.prog ?? '', estado: estado(tb.state) as Estado, alias: '',
      abrir: ir(() => { goPlace(p.id); setUI({ term: tb.term }) }),
    }))
    const sesiones: Sesion[] = ordenar([...tareas, ...pestanas])
    const prod = productos.find((x) => !x.error && x.archivo === `${p.name}.json`)
    return { p, tpm, sesiones, grupos: agrupar(sesiones, prod) as { epica: Epica | null; sesiones: Sesion[] }[], r: resumen(sesiones, tpm) as { texto: string; estado: Estado } }
  })

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Flota"
        onClick={(ev) => ev.stopPropagation()}
        className="relative flex h-[88dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-2xl bg-bg text-fg shadow-sheet sm:h-[80dvh] sm:rounded-2xl"
      >
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <h2 className="flex-1 text-[0.9375rem] font-semibold phone:text-[1.0625rem]">Flota</h2>
          <Cerrar onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-[max(env(safe-area-inset-bottom),--spacing(4))]">
          {snap === null ? <p className="px-2 py-2 text-[0.875rem] text-fg3">Leyendo…</p> : null}
          {lista.map(({ p, tpm, sesiones, grupos, r }) => {
            const abierto = abiertos.has(p.id)
            return (
              <section key={p.id} className="border-b border-line pb-1">
                <button
                  type="button"
                  aria-expanded={abierto}
                  onClick={() => setAbiertos((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })}
                  className={clsx(fila, 'pl-2')}
                >
                  <svg viewBox="0 0 16 16" className={clsx('size-3.5 shrink-0 text-fg3 transition-transform', abierto && 'rotate-90')} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
                  <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold">{p.name}</span>
                  <span className={clsx('shrink-0 text-[0.8125rem]', r.estado === 'idle' ? 'text-fg3' : TEXT[r.estado])}>{r.texto}</span>
                </button>
                {abierto ? (
                  <>
                    <button type="button" onClick={ir(() => goPlace(p.id))} className={clsx(fila, 'pl-7')}>
                      <span className="shrink-0 rounded-[3px] bg-[#d97757] px-1 font-mono text-[0.625rem] font-semibold text-[#111]">TPM</span>
                      <span className="min-w-0 flex-1 truncate text-[0.875rem] phone:text-[0.9375rem]">{p.assistantTab?.name ?? 'Assistant'}</span>
                      <span className={clsx('shrink-0 text-[0.8125rem]', tpm && tpm.estado !== 'idle' ? TEXT[tpm.estado] : 'text-fg3')}>{tpm ? PALABRA[tpm.estado] : '—'}</span>
                    </button>
                    {sesiones.length === 0 ? <p className="py-2 pl-7 text-[0.8125rem] text-fg3">Sin sesiones vivas</p> : null}
                    {grupos.map((g) => {
                      const a = g.epica ? avance(g.epica) : null
                      return (
                        <div key={g.epica?.titulo ?? '—'}>
                          {g.epica ? (
                            <p className="flex items-center gap-2 pt-2 pr-2 pb-1 pl-7 text-[0.75rem] text-fg3 phone:text-[0.8125rem]">
                              <span className="min-w-0 flex-1 truncate">{g.epica.titulo}</span>
                              <span className="shrink-0 tabular-nums">{a!.hecha}/{a!.total}</span>
                            </p>
                          ) : null}
                          {g.sesiones.map((x) => (
                            <button key={x.clave} type="button" onClick={x.abrir} className={clsx(fila, g.epica ? 'pl-10' : 'pl-7')}>
                              <span className={clsx('size-2 shrink-0 rounded-full', DOT[x.estado])} />
                              <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-[0.875rem] phone:text-[0.9375rem]">
                                  {x.ref ? <span className="mr-1.5 text-fg3 tabular-nums">{x.ref}</span> : null}
                                  {x.titulo}
                                </span>
                                {x.sub ? <span className="truncate text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{x.sub}</span> : null}
                              </span>
                              <span className={clsx('shrink-0 text-[0.8125rem]', TEXT[x.estado])}>{PALABRA[x.estado]}</span>
                            </button>
                          ))}
                        </div>
                      )
                    })}
                  </>
                ) : null}
              </section>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Una fila arriba de la lista de espacios, como Iniciativas; un punto rojo si algo de la flota espera a Juan.
function Abridor() {
  const [open, setOpen] = useState(false)
  const snap = useSnap()
  const espera = !!snap?.places.some((p) => !p.home && (estado(p.assistantTab?.state) === 'need' || (p.tabs ?? []).some((tb) => tb.cli && estado(tb.state) === 'need')))
    || !!snap?.tasks.some((t) => !t.archived && estado(t.status) === 'need')
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="press mx-1.5 mb-1 flex min-h-8 items-center gap-2 rounded-row px-2 text-left text-fg2 hover:bg-hover hover:text-fg coarse:min-h-11 phone:mx-2 phone:min-h-12 phone:gap-3 phone:px-3 phone:text-fg"
      >
        <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-fg3 coarse:text-fg2 phone:size-5 phone:text-fg2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M5 4v16M5 8h6M5 16h6M15 6h4M15 10h4M15 14h4M15 18h4" />
        </svg>
        <span className="flex-1">Flota</span>
        {espera ? <span className="size-2 rounded-full bg-need" aria-label="algo espera por ti" /> : null}
      </button>
      {open ? <Arbol onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export default definePlugin({
  name: 'flota-arbol',
  setup(reg) {
    const Lugares = reg.views.places
    reg.views.places = function LugaresConFlota() {
      return (
        <>
          <Abridor />
          {Lugares ? <Lugares /> : null}
        </>
      )
    }
  },
})
