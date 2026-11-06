// Iniciativas en la web de Shepherdr: una fila arriba de los espacios (barra lateral; en el teléfono, el cajón) que
// abre la lista de épicas y tareas sueltas; tocar una épica abre la hoja inferior con sus tareas. Los datos son la
// foto que escribe el panel del escritorio (~/.herdr/flota/web/iniciativas.json, servida en /flota del tailnet), ya
// leída con iniciativas.js (copiado de mods/flota-iniciativas por install.sh). Pestañas Tablero (una columna por
// estado) y Gantt (el plan del día por salida a producción) con la misma foto; en el teléfono, todo a lo alto.
// Pestaña Decisiones: las preguntas que el TPM copia de la base del Gantt; tocar una opción la manda a /flota/respuesta
// (mods/flota-iniciativas/respuestas.py), que la guarda en ~/.herdr/flota/respuestas/<archivo> para el TPM.
// Muestra los productos del espacio abierto (en el teléfono, el del cajón) según su id en el campo `espacios`; Home, todos.
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { definePlugin, placeOf, useSnap, useUI } from '@client/kernel.ts'
import { Tab, Tabs } from '@client/ui.tsx'
import { ahora, avance, chip, cuantas, dicha, eje, esperan, explicacion, gantt, hace, hhmm, LEYENDA, pie, pos, SALIDAS, SIN_ARCHIVO, SIN_INICIATIVAS, SIN_PLAN, delEspacio, esHome, tablero, textosFila, tono, tonoChip } from './iniciativas.js'

interface Tarea {
  id: string; titulo: string; estado: string; link: string; sesion: string
  salida: string; desde: string; hasta: string; estimada: boolean; ritmo: string; nota: string; equipo: string
}
interface Tramo { x: number; w: number; texto: string; estimada: boolean; hecha: boolean; tono: string }
type Fila = Tarea & { de: string; barras: Tramo[]; hecha: boolean; espera: boolean; quien: string; enlace: string; sinBarra: string }
/** lo que devuelve gantt(): el eje en horas, la hora actual y los bloques */
interface G { h0: number; h1: number; ya: number | null; marcas: number[]; grupos: { salida: string; titulo: string; filas: Fila[] }[] }
interface Epica { id: string; titulo: string; estado: string; link: string; tareas: Tarea[] }
interface Decision {
  id: string; pregunta: string; opciones: string[]; recomendada: string; contexto: string; de: string; tarea: string
  frena: boolean; estado: 'abierta' | 'respondida' | 'cerrada'; respuesta: string; texto: string
}
type Producto = { archivo: string; at: number; error?: string; aviso?: string; producto: string; espacios?: string[]; epicas: Epica[]; sueltas: Tarea[]; decisiones?: Decision[] }
/** lo que Juan tocó en esta página, por "<archivo>#<id>", hasta que la foto del escritorio lo traiga */
/** at: cuándo lo guardó respuestas.py (reloj del Mac); una foto leída después ya lo trae y manda ella */
type Mias = Record<string, { respuesta: string; texto: string; at?: number; error?: string; guardando?: boolean }>
/** total: cuántos productos hay en todos los espacios (los de `productos` son los del espacio abierto); medidas: las horas
 * de las tareas de herdr-task, para el Gantt */
interface Foto { at: number; productos: Producto[]; total?: number; medidas?: unknown[] }

// Los tonos del escritorio: verde lo mergeado, azul con PR, rojo lo bloqueado, gris lo demás.
const DOT: Record<string, string> = { hecha: 'bg-ready', pr: 'bg-focus', bloqueada: 'bg-need', curso: 'bg-fg2', cola: 'bg-line2', riesgo: 'bg-work', espera: 'bg-merged' }
// El chip y el contorno de la barra del Gantt, en el mismo tono.
const EQUIPO: Record<string, string> = { AI: 'text-focus', Backend: 'text-work-fg', Frontend: 'text-ready-fg', Acciones: 'text-merged', DevOps: 'text-fg2' }
// Las barras del Gantt, del color del equipo (si la tarea lo dice); si no, del estado.
const EQUIPO_BG: Record<string, string> = { AI: 'bg-focus', Backend: 'bg-work', Frontend: 'bg-ready', Acciones: 'bg-merged', DevOps: 'bg-fg2' }
const VISTAS = [['iniciativas', 'Iniciativas'], ['tablero', 'Tablero'], ['gantt', 'Gantt'], ['decisiones', 'Decisiones']] as const
type Vista = (typeof VISTAS)[number][0]
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

/** una tarjeta del tablero: todas del mismo alto; con link abre ClickUp */
function Tarjeta({ t }: { t: Tarea & { de: string } }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5">
        <span className={clsx('size-1.5 shrink-0 rounded-full', DOT[tono(t.estado)])} />
        <span className="truncate font-mono text-[0.6875rem] text-fg3">{t.id}</span>
      </span>
      <span className="line-clamp-2 text-[0.875rem] leading-snug">{t.titulo}</span>
      <span className="mt-auto truncate text-[0.75rem] text-fg3">{t.de}</span>
      <span className="h-4 truncate text-[0.75rem] leading-4 text-fg2">{t.sesion}</span>
    </>
  )
  const cls = clsx('flex h-[7.5rem] min-w-0 flex-col gap-1 rounded-lg border bg-bg p-2.5 text-left', tono(t.estado) === 'bloqueada' ? 'border-need' : 'border-line')
  return isLink(t.link) ? <a href={t.link} target="_blank" rel="noreferrer" className={clsx(cls, 'press hover:bg-hover')}>{body}</a> : <div className={cls}>{body}</div>
}

function Tablero({ p }: { p: Producto }) {
  const { columnas, merged } = tablero(p) as { columnas: { estado: string; tareas: (Tarea & { de: string })[] }[]; merged: number }
  return (
    <div className="flex flex-col gap-3 px-2">
      {columnas.map((c) => (
        <div key={c.estado}>
          <h4 className="flex items-center gap-2 py-1.5 text-[0.8125rem] font-semibold phone:text-[0.875rem]">
            <span className={clsx('size-2 rounded-full', DOT[tono(c.estado)])} />
            {c.estado[0].toUpperCase() + c.estado.slice(1)}
            <span className="font-normal text-fg3 tabular-nums">{c.tareas.length}</span>
          </h4>
          {c.tareas.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
              {c.tareas.map((t, i) => <Tarjeta key={t.id || i} t={t} />)}
            </div>
          ) : null}
        </div>
      ))}
      <p className="text-[0.8125rem] text-fg3">Merged · {merged}</p>
    </div>
  )
}

// Rayada: lo estimado, como en el artefacto del Gantt.
const RAYAS = { backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.3) 0 4px, transparent 4px 8px)' }
interface Rotulo { h: number; texto: string; tipo: 'ahora' | 'salida' | 'hora'; x: number; w: number; ancla: 'izq' | 'centro' | 'der' }
interface Fuera { texto: string; x: number; w: number; ancla: 'izq' | 'der' }

/** el ancho de un elemento, en px, al día con el panel */
function useAncho(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, w]
}

/** el eje de un bloque: ahora, las salidas con su nombre y las horas que quepan, sin chocar ni salirse (eje()) */
function Regla({ g, w }: { g: G; w: number }) {
  return (
    <div className="relative h-4 text-[0.6875rem] tabular-nums" aria-hidden="true">
      {(eje(g, w, 6.6) as Rotulo[]).map((r) => (
        <span
          key={r.texto}
          className={clsx('absolute flex whitespace-nowrap', r.ancla === 'centro' && 'justify-center', r.ancla === 'der' && 'justify-end',
            r.tipo === 'ahora' ? 'font-semibold text-orange-500' : r.tipo === 'salida' ? 'font-semibold text-fg' : 'text-fg3')}
          style={{ left: `${r.x}%`, width: r.w }}
        >{r.texto}</span>
      ))}
    </div>
  )
}

/** la pista de una fila: rayas finas en las horas rotuladas, punteadas en las salidas de 07, 12 y 19, la hora actual
 * en naranja y las barras (sólida = medida o escrita, rayada = estimada, tenue = ya terminada). El texto de una barra va
 * dentro si cabe y si no al lado (textosFila); lo de ayer que apenas asoma, en texto */
function Pista({ f, g, w }: { f: Fila; g: G; w: number }) {
  const P = (h: number) => `${pos(h, g.h0, g.h1)}%`
  const { barras, fuera } = textosFila(f, w, 5.8) as { barras: (Tramo & { dentro: boolean })[]; fuera: Fuera | null }
  return (
    <span className="relative mt-1 block h-5">
      {g.marcas.map((h) => <span key={h} className="absolute inset-y-0 border-l border-line" style={{ left: P(h) }} />)}
      {SALIDAS.filter((h) => h > g.h0 && h < g.h1).map((h) => <span key={h} className="absolute inset-y-0 border-l border-dashed border-fg3" style={{ left: P(h) }} />)}
      {barras.map((b, i) => (
        <span
          key={i}
          title={b.texto}
          className={clsx('absolute inset-y-0 flex items-center overflow-hidden rounded-[4px] text-[0.625rem] font-medium whitespace-nowrap', b.hecha ? 'text-fg' : 'text-bg')}
          style={{ left: `${b.x}%`, width: `${b.w}%` }}
        >
          {/* tenue o rayada, la opacidad va en el fondo y no en el texto, que se lee entero */}
          <span className={clsx('absolute inset-0', b.tono ? DOT[b.tono] : EQUIPO_BG[f.equipo] || DOT[tonoChip(f)], b.hecha ? 'opacity-40' : b.estimada ? 'opacity-75' : 'opacity-90')} style={b.estimada ? RAYAS : undefined} />
          {/* el relleno va en el texto: la barra mide sus horas aunque sea de un minuto */}
          {b.dentro ? <span className="relative px-1">{b.texto}</span> : null}
        </span>
      ))}
      {fuera ? (
        <span
          className={clsx('absolute inset-y-0 flex min-w-0 items-center text-[0.625rem] text-fg2', fuera.ancla === 'der' && 'justify-end')}
          style={fuera.ancla === 'izq' ? { left: `${fuera.x}%`, width: `${fuera.w}%` } : { right: `${100 - fuera.x}%`, width: `${fuera.w}%` }}
        ><span className="truncate bg-bg px-0.5">{fuera.texto}</span></span>
      ) : null}
      {g.ya != null ? <span className="absolute -inset-y-1 w-0.5 bg-orange-500" style={{ left: P(g.ya) }} /> : null}
    </span>
  )
}

/** cómo se lee, al pie como el subtítulo del artefacto: los chips y las barras */
function Leyenda() {
  return (
    <div className="flex flex-col gap-1.5 pt-2.5 text-[0.75rem] text-fg3">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {(LEYENDA as [string, string, string][]).map(([c, t, dice]) => (
          <span key={c} className="inline-flex items-center gap-1"><span className={clsx('rounded-full px-1.5 leading-4 text-bg', DOT[t])}>{c}</span>{dice}</span>
        ))}
      </div>
      <p className="leading-snug">{explicacion('rayada')}</p>
    </div>
  )
}

/** el Gantt del día (skill gantt-flota): una tarjeta por salida («Hoy» sin salidas) con su eje, como en el artefacto;
 * cada fila con su equipo, su chip, su enlace, su nombre (hasta dos líneas; entero al pasar el dedo o el ratón) y su
 * nota, y las barras debajo a todo el ancho, así se lee a 390 px sin desplazarse. Al pie, lo listo hoy o ya en
 * producción, los riesgos, cómo se lee, y las decisiones que esperan, que se responden aquí mismo con las tarjetas de la
 * pestaña Decisiones (el mismo componente, el mismo guardado) */
function Gantt({ p, medidas, at, mias, setMias }: { p: Producto; medidas: unknown[]; at: number; mias: Mias; setMias: (f: (m: Mias) => Mias) => void }) {
  const g = gantt(p, medidas) as G
  const { produccion, riesgos } = pie(p, g) as { produccion: { titulo: string; items: string[] }; riesgos: string[] }
  const [ref, ancho] = useAncho()
  const [enteros, setEnteros] = useState<Record<string, boolean>>({}) // las filas con el título entero (tocadas)
  const w = Math.max(160, ancho - 26) // la pista: la tarjeta menos su relleno (12 + 12) y su borde
  const equipos = [...new Set(g.grupos.flatMap((x) => x.filas).map((f) => f.equipo))].filter((e) => EQUIPO_BG[e])
  const tarjeta = (titulo: string, items: string[], vacio: string) => (
    <div className="rounded-lg border border-line px-3 py-2.5">
      <h4 className="text-[0.875rem] font-semibold">{titulo}</h4>
      {items.length ? (
        <ul className="mt-1 list-disc space-y-1 pl-4 text-[0.8125rem] text-fg">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
      ) : <p className="mt-1 text-[0.8125rem] text-fg3">{vacio}</p>}
    </div>
  )
  return (
    <div className="px-2" ref={ref}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2 text-[0.75rem] text-fg3">
        <span>Revisado a las {hhmm(ahora(at, 0, 24) ?? 0)}</span>
        {equipos.map((e) => <span key={e} className="inline-flex items-center gap-1.5"><span className={clsx('size-2.5 rounded-[3px]', EQUIPO_BG[e])} />{e}</span>)}
      </p>
      {!g.grupos.length ? <p className="py-1 text-[0.875rem] text-fg3">{SIN_PLAN}</p> : g.grupos.map((x) => (
        <section key={x.salida} className="mb-2.5 rounded-lg border border-line px-3 pt-2">
          <h4 className="flex items-baseline gap-1.5 pb-1">
            <span className="text-[0.875rem] font-semibold max-sm:text-[0.9375rem]">{x.titulo}</span>
            <span className="text-[0.75rem] text-fg3">{x.filas.length} {x.filas.length === 1 ? 'tarea' : 'tareas'}</span>
          </h4>
          {ancho ? <Regla g={g} w={w} /> : null}
          {x.filas.map((f, i) => {
            const k = `${x.salida}#${f.id || i}`
            const body = (
              <>
                <span className="flex min-w-0 items-center gap-1.5 text-[0.6875rem]">
                  {f.quien ? <span className={clsx('shrink-0 font-semibold tracking-wide uppercase', EQUIPO[f.quien] || 'text-fg3')}>{f.quien}</span> : null}
                  <span className={clsx('shrink-0 rounded-full px-1.5 leading-4 text-bg', DOT[tonoChip(f)])}>{chip(f)}</span>
                  {isLink(f.link) ? (
                    <a href={f.link} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="shrink-0 text-focus underline underline-offset-2">{f.enlace || 'enlace'}</a>
                  ) : <span className="shrink-0 text-fg3">{f.enlace || 'sin enlace'}</span>}
                </span>
                <span className={clsx(!enteros[k] && 'line-clamp-2', 'text-[0.875rem] leading-snug font-medium max-sm:text-[0.9375rem]', f.hecha ? 'text-fg2' : 'text-fg')}>{f.titulo}</span>
                <span className={clsx(!enteros[k] && 'truncate', 'text-[0.75rem] text-fg3 max-sm:text-[0.8125rem]')}>{f.nota}</span>
                {ancho ? <Pista f={f} g={g} w={w} /> : null}
              </>
            )
            // Tocar la fila muestra (o vuelve a cortar) el título y la nota enteros; el enlace va en su palabra.
            return (
              <div
                key={k}
                role="button"
                tabIndex={0}
                aria-expanded={Boolean(enteros[k])}
                title={[f.titulo, f.nota].filter(Boolean).join('\n')}
                onClick={() => setEnteros((e) => ({ ...e, [k]: !e[k] }))}
                onKeyDown={(ev) => ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), setEnteros((e) => ({ ...e, [k]: !e[k] })))}
                className="press -mx-2 flex cursor-pointer flex-col gap-0.5 rounded-row border-t border-line px-2 py-2 hover:bg-hover"
              >{body}</div>
            )
          })}
        </section>
      ))}
      <div className="mt-1 grid gap-2">
        {tarjeta(produccion.titulo, produccion.items, produccion.titulo === 'Listo hoy' ? 'Nada terminado hoy todavía.' : '—')}
        {tarjeta('Riesgos', riesgos, 'Sin riesgos a la vista: nada bloqueado, en riesgo ni atrasado.')}
      </div>
      <Leyenda />
      <h4 className="pt-4 pb-2 text-[0.9375rem] font-semibold">Decisiones que esperan por ti</h4>
      <div className="-mx-2"><Decisiones p={p} mias={mias} setMias={setMias} /></div>
    </div>
  )
}

/** una decisión con lo que se tocó aquí encima (mientras el TPM no la cierre) */
function conMia(p: Producto, d: Decision, mias: Mias): Decision {
  const m = mias[`${p.archivo}#${d.id}`]
  // una foto escrita por un panel anterior a HF-19 no trae `texto`
  return m && !m.error && d.estado !== 'cerrada' ? { ...d, estado: 'respondida', respuesta: m.respuesta, texto: m.texto } : { ...d, texto: d.texto ?? '' }
}
const abiertasDe = (p: Producto, mias: Mias) => (p.error ? 0 : (p.decisiones ?? []).filter((d) => conMia(p, d, mias).estado === 'abierta').length)

/** guarda una opción, un texto libre o los dos (respuestas.py, por POST /flota/respuesta); true si se guardó */
async function responder(archivo: string, id: string, respuesta: string, texto: string, setMias: (f: (m: Mias) => Mias) => void) {
  const key = `${archivo}#${id}`
  texto = texto.trim()
  setMias((m) => ({ ...m, [key]: { respuesta, texto, guardando: true } }))
  try {
    const r = await fetch('/flota/respuesta', { method: 'POST', headers: { 'content-type': 'application/json', 'x-flota': '1' }, body: JSON.stringify({ archivo, id, respuesta, texto }) })
    const b = await r.json().catch(() => ({}))
    setMias((m) => ({ ...m, [key]: r.ok ? { respuesta, texto, at: typeof b.at === 'number' ? b.at : Date.now() / 1000 } : { respuesta, texto, error: b.error || `no se guardó (${r.status})` } }))
    return r.ok
  } catch {
    setMias((m) => ({ ...m, [key]: { respuesta, texto, error: 'no se guardó: /flota no responde en este Mac' } }))
    return false
  }
}

/** lo respondido aquí tapa la foto solo hasta que llega una leída después de guardarlo (que ya lo trae, y quizá lo que
 * se respondió después en el escritorio): entonces manda la foto */
function useMiasVigentes(foto: Foto | null | 'error', setMias: (f: (m: Mias) => Mias) => void) {
  const at = foto && foto !== 'error' ? foto.at : 0
  useEffect(() => {
    if (at) setMias((m) => {
      const quedan = Object.entries(m).filter(([, x]) => x.guardando || x.error || !(x.at && x.at < at))
      return quedan.length === Object.keys(m).length ? m : Object.fromEntries(quedan)
    })
  }, [at, setMias])
}

/** las decisiones de un producto: abiertas primero (borde rojo si frenan algo); tocar una opción la guarda, y debajo se
 * puede escribir con sus palabras (solo o junto a la opción). Se cambia mientras el TPM no la cierre */
function Decisiones({ p, mias, setMias }: { p: Producto; mias: Mias; setMias: (f: (m: Mias) => Mias) => void }) {
  const [borrador, setBorrador] = useState<Record<string, string>>({})
  // guardado, el borrador se suelta (el campo muestra lo guardado, y lo que llegue después desde el escritorio), salvo
  // que Juan siguiera escribiendo mientras se guardaba: eso no se toca
  const guardar = (id: string, respuesta: string, texto: string) => responder(p.archivo, id, respuesta, texto, setMias).then((ok) => {
    if (ok) setBorrador((b) => (b[id] === undefined || b[id] === texto ? Object.fromEntries(Object.entries(b).filter(([k]) => k !== id)) : b))
  })
  const decs = (p.decisiones ?? []).map((d) => conMia(p, d, mias))
  if (!decs.length) return <p className="px-2 py-1 text-[0.875rem] text-fg3">Sin decisiones abiertas.</p>
  return (
    <div className="flex flex-col gap-2 px-2">
      <p className="text-[0.8125rem] text-fg2">{cuantas(abiertasDe(p, mias))} · el TPM recoge las respondidas en su siguiente tick</p>
      {decs.map((d) => {
        const m = mias[`${p.archivo}#${d.id}`], abierta = d.estado === 'abierta', cerrada = d.estado === 'cerrada'
        const sub = [d.de && `pregunta ${d.de}`, d.tarea, d.contexto].filter(Boolean).join(' · ')
        return (
          <article key={d.id} className={clsx('rounded-xl border bg-bg p-3', abierta && d.frena ? 'border-need' : 'border-line', cerrada && 'opacity-60')}>
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 font-mono text-[0.75rem] font-semibold text-merged">{d.id}</span>
              <h4 className="min-w-0 flex-1 text-[0.9375rem] leading-snug font-semibold phone:text-[1rem]">{d.pregunta}</h4>
              <span className={clsx('shrink-0 text-[0.75rem] phone:text-[0.8125rem]', abierta ? (d.frena ? 'text-need-fg' : 'text-fg3') : 'text-ready-fg')}>
                {abierta ? (d.frena ? 'frena' : 'abierta') : d.estado}
              </span>
            </div>
            {sub ? <p className="mt-1 text-[0.8125rem] text-fg3 phone:text-[0.875rem]">{sub}</p> : null}
            {d.opciones.length && !cerrada ? (
              <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label={`Respuesta a ${d.id}`}>
                {d.opciones.map((o) => {
                  const on = o === d.respuesta
                  return (
                    <button
                      key={o}
                      type="button"
                      aria-pressed={on}
                      disabled={m?.guardando}
                      onClick={() => !on && guardar(d.id, o, borrador[d.id] ?? d.texto)}
                      className={clsx('press min-h-11 rounded-lg border px-3.5 text-[0.9375rem] disabled:opacity-60', on ? 'border-fg bg-fg text-bg' : 'border-line2 text-fg hover:bg-hover')}
                    >
                      {o}{o === d.recomendada ? ' ★' : ''}
                    </button>
                  )
                })}
              </div>
            ) : (
              cerrada ? <p className="mt-2 text-[0.875rem] text-fg2">Respuesta: {dicha(d) || '—'}</p> : null
            )}
            {!cerrada ? (
              <div className="mt-2.5 flex flex-col gap-2">
                <textarea
                  aria-label={`Tu respuesta a ${d.id}, con tus palabras`}
                  placeholder="Escribe tu respuesta o un matiz (opcional)"
                  value={borrador[d.id] ?? d.texto}
                  onChange={(e) => setBorrador((b) => ({ ...b, [d.id]: e.target.value }))}
                  maxLength={1000}
                  rows={2}
                  className="w-full resize-y rounded-lg border border-line2 bg-bg px-3 py-2 text-[1rem] text-fg placeholder:text-fg3"
                />
                <button
                  type="button"
                  // sin texto vale si queda una opción: así se quita un matiz
                  disabled={m?.guardando || (!(borrador[d.id] ?? d.texto).trim() && !d.respuesta)}
                  onClick={() => guardar(d.id, d.respuesta, borrador[d.id] ?? d.texto)}
                  className="press min-h-11 self-start rounded-lg bg-fg px-4 text-[0.9375rem] text-bg disabled:opacity-40"
                >
                  {d.estado === 'respondida' ? 'Cambiar respuesta' : 'Enviar'}
                </button>
              </div>
            ) : null}
            {m?.error ? <p className="mt-2 text-[0.8125rem] text-need-fg">{m.error}</p> : null}
            {d.estado === 'respondida' && !m?.error ? (
              <p className="mt-2 text-[0.8125rem] text-ready-fg">{m?.guardando ? 'Guardando…' : `Tu respuesta: ${dicha(d)} · el TPM la recoge en su siguiente tick`}</p>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

function Panel({ foto, onClose, mias, setMias }: { foto: Foto | null | 'error'; onClose: () => void; mias: Mias; setMias: (f: (m: Mias) => Mias) => void }) {
  const [abierta, setAbierta] = useState<string | null>(null) // "<archivo>#<id de la épica>": sigue a la foto nueva aunque cambie el orden
  const [vista, setVista] = useState<Vista>('iniciativas')
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (abierta ? setAbierta(null) : onClose())
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [abierta, onClose])
  const now = Date.now() / 1000
  const ok = foto && foto !== 'error' ? foto : null
  const pendientes = ok ? ok.productos.reduce((n, p) => n + abiertasDe(p, mias), 0) : 0
  const sel = ok?.productos.flatMap((p) => (p.error ? [] : p.epicas.map((e, i) => [`${p.archivo}#${e.id || i}`, e] as const))).find(([k]) => k === abierta)?.[1]
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Iniciativas"
        onClick={(ev) => ev.stopPropagation()}
        className="relative flex h-[88dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-2xl bg-bg text-fg shadow-sheet sm:h-[80dvh] sm:rounded-2xl"
      >
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <Tabs label="Vista" className="flex w-full">
              {VISTAS.map(([k, l]) => (
                <Tab key={k} fill on={vista === k} onClick={() => { setVista(k); setAbierta(null) }}>
                  {l}
                  {k === 'decisiones' && pendientes ? <span className="ml-1 inline-grid h-4 min-w-4 place-items-center rounded-full bg-need px-1 align-[0.0625rem] text-[0.6875rem] font-semibold text-bg tabular-nums">{pendientes}</span> : null}
                </Tab>
              ))}
            </Tabs>
          </div>
          {/* en el teléfono no cabe junto a las cuatro pestañas; cada producto dice cuándo escribió el TPM */}
          {ok ? <span className="text-[0.75rem] text-fg3 tabular-nums max-sm:hidden">{hace(ok.at, now)}</span> : null}
          <Cerrar onClick={onClose} label="Cerrar" />
        </div>
        <div key={vista} className="min-h-0 flex-1 overflow-y-auto px-2 pb-[max(env(safe-area-inset-bottom),--spacing(4))]">
          {foto === 'error' ? <p className="px-2 py-2 text-[0.875rem] text-fg2">Sin datos: /flota no responde en este Mac.</p> : null}
          {foto === null ? <p className="px-2 py-2 text-[0.875rem] text-fg3">Leyendo…</p> : null}
          {ok && now - ok.at > 120 ? <p className="mx-2 mb-2 rounded-lg bg-well px-3 py-2 text-[0.8125rem] text-work-fg">Dato de {hace(ok.at, now)}: el panel del escritorio no está abierto.</p> : null}
          {ok && !ok.total ? <p className="px-2 py-2 text-[0.875rem] text-fg2">{SIN_ARCHIVO}</p> : null}
          {ok && ok.total && !ok.productos.length ? <p className="px-2 py-2 text-[0.875rem] text-fg2">{SIN_INICIATIVAS}</p> : null}
          {ok?.productos.map((p) =>
            p.error ? (
              <p key={p.archivo} className="px-2 py-2 text-[0.875rem] text-need-fg">{p.error}</p>
            ) : (
              <section key={p.archivo} className="pb-3">
                <h3 className="px-2 pt-2 pb-1 text-[0.6875rem] tracking-wide text-fg3 uppercase phone:text-[0.75rem]">
                  {p.producto} <span className="normal-case tracking-normal">· el TPM lo escribió {hace(p.at, now)}</span>
                </h3>
                {p.aviso ? <p className="px-2 pb-1 text-[0.8125rem] text-need-fg">{p.aviso}</p> : null}
                {vista === 'tablero' ? <Tablero p={p} /> : null}
                {vista === 'gantt' ? <Gantt p={p} medidas={ok.medidas ?? []} at={ok.at} mias={mias} setMias={setMias} /> : null}
                {vista === 'decisiones' ? <Decisiones p={p} mias={mias} setMias={setMias} /> : null}
                {vista === 'iniciativas' ? <>
                {p.epicas.map((e, i) => {
                  const a = avance(e)
                  return (
                    <button key={e.id || i} type="button" onClick={() => setAbierta(`${p.archivo}#${e.id || i}`)} aria-haspopup="dialog" className="press flex min-h-14 w-full items-center gap-3 rounded-row border-b border-line px-2 text-left hover:bg-hover">
                      <svg viewBox="0 0 24 24" className="size-[18px] shrink-0 text-fg2" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="m3 13 9 5 9-5" /></svg>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[0.875rem] font-semibold phone:text-[0.9375rem]">{e.titulo}</span>
                        <span className="truncate text-[0.75rem] text-fg3 phone:text-[0.8125rem]">
                          Épica · {a.total} tareas{e.estado ? <span className={e.estado === 'en riesgo' ? 'text-work-fg' : ''}> · {e.estado}</span> : null}
                          {esperan(a) ? <span className="text-need-fg"> · {esperan(a)}</span> : null}
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
                </> : null}
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
// La foto con solo los productos del espacio abierto. Home (Shepherdr lo marca por su carpeta: `home`, o «~» en
// `where`) ve todos. Sigue a ui.place: al cambiar de espacio cambia en el acto, sin esperar la siguiente lectura.
function useDelEspacio(foto: Foto | null | 'error'): Foto | null | 'error' {
  const place = useUI((u) => u.place)
  const snap = useSnap()
  if (!foto || foto === 'error') return foto
  const p = snap ? placeOf(snap, place) : null
  const espacio = p ? { id: p.id, home: Boolean(p.home) || (p.where !== undefined && esHome(p.where)) } : null
  return { ...foto, productos: delEspacio(foto.productos, espacio), total: foto.productos.length }
}

function Abridor() {
  const [open, setOpen] = useState(false)
  const [mias, setMias] = useState<Mias>({})
  const foto = useDelEspacio(useFoto())
  useMiasVigentes(foto, setMias)
  const pendientes = foto && foto !== 'error' ? foto.productos.reduce((n, p) => n + abiertasDe(p, mias), 0) : 0
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
        {pendientes ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-need px-1.5 text-[0.75rem] font-semibold text-bg tabular-nums" aria-label={`${pendientes} decisiones te esperan`}>{pendientes}</span> : null}
        {bloqueadas && !pendientes ? <span className="size-2 rounded-full bg-need" aria-label="hay tareas bloqueadas" /> : null}
      </button>
      {open ? <Panel foto={foto} onClose={() => setOpen(false)} mias={mias} setMias={setMias} /> : null}
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
