// Iniciativas en la web de Shepherdr (3.2): un panel de la derecha (en el teléfono, la pantalla entera) con su botón
// en la cabecera del chat y en la barra de abajo del teléfono. Lista de épicas y tareas sueltas; tocar una épica abre
// sus tareas en un diálogo (hoja en el teléfono). Los datos son la foto que escribe el panel del escritorio
// (~/.herdr/flota/web/iniciativas.json, servida en /flota del tailnet), ya leída con iniciativas.js (copiado de
// mods/flota-iniciativas por install.sh). Pestañas Tablero (una columna por estado) y Gantt (el plan del día por
// salida a producción) con la misma foto. Pestaña Decisiones: las preguntas que el TPM copia de la base del Gantt;
// tocar una opción la manda a /flota/respuesta (mods/flota-iniciativas/respuestas.py), que la guarda en
// ~/.herdr/flota/respuestas/<archivo> para el TPM. Muestra los productos del espacio abierto según su id en el campo
// `espacios`; Everything y los espacios de la carpeta personal, todos. Se viste con el sistema de diseño de la web
// (ds.css) e iniciativas.css; la web 3.2 no trae Tailwind.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { placeOf } from '@shared/view.ts'
import type { Snapshot } from '@shared/types.ts'
import { PaneFrame } from '@client/App.tsx'
import { definePlugin, togglePane, useSnap, useUI } from '@client/kernel.ts'
import { openDialog } from '@client/overlay.tsx'
import { Btn, cx, Hd, IB } from '@client/ui.tsx'
import { ahora, avance, chip, cuantas, dicha, eje, esperan, explicacion, gantt, hace, hhmm, LEYENDA, pie, pos, SALIDAS, SIN_ARCHIVO, SIN_INICIATIVAS, SIN_PLAN, delEspacio, esHome, tablero, textosFila, tono, tonoChip } from './iniciativas.js'
import './iniciativas.css'

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
/** lo que Juan tocó en esta página, por "<archivo>#<id>", hasta que la foto del escritorio lo traiga.
 * at: cuándo lo guardó respuestas.py (reloj del Mac); una foto leída después ya lo trae y manda ella */
type Mias = Record<string, { respuesta: string; texto: string; at?: number; error?: string; guardando?: boolean }>
/** total: cuántos productos hay en todos los espacios (los de `productos` son los del espacio abierto); medidas: las horas
 * de las tareas de herdr-task, para el Gantt */
interface Foto { at: number; productos: Producto[]; total?: number; medidas?: unknown[] }

// Los tonos del escritorio (iniciativas.css): verde lo mergeado, azul con PR, rojo lo bloqueado, gris lo demás; el
// equipo pinta el chip (fi-q-…) y la barra del Gantt (fi-e-…) si la tarea lo dice.
const T = (t: string) => `fi-t-${t}`
const EQUIPOS = ['AI', 'Backend', 'Frontend', 'Acciones', 'DevOps']
const VISTAS = [['iniciativas', 'Iniciativas'], ['tablero', 'Tablero'], ['gantt', 'Gantt'], ['decisiones', 'Decisiones']] as const
type Vista = (typeof VISTAS)[number][0]
const BAR = ['hecha', 'pr', 'curso', 'bloqueada'] as const

/* ---------- la foto y lo respondido aquí: una sola lectura cada 15 s para el botón, la barra, el panel y la hoja ---------- */

interface Estado { foto: Foto | null | 'error'; mias: Mias }
let estado: Estado = { foto: null, mias: {} }
let timer = 0
const subs = new Set<() => void>()
const poner = (e: Partial<Estado>) => { estado = { ...estado, ...e }; subs.forEach((s) => s()) }
/** lo respondido aquí tapa la foto solo hasta que llega una leída después de guardarlo (que ya lo trae, y quizá lo que
 * se respondió después en el escritorio): entonces manda la foto */
const vigentes = (m: Mias, at: number): Mias => {
  const quedan = Object.entries(m).filter(([, x]) => x.guardando || x.error || !(x.at && x.at < at))
  return quedan.length === Object.keys(m).length ? m : Object.fromEntries(quedan)
}
const leer = () =>
  fetch('/flota/iniciativas.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject())).then((f: Foto) => poner({ foto: f, mias: vigentes(estado.mias, f.at) }), () => poner({ foto: 'error' }))
const suscribir = (cb: () => void) => {
  subs.add(cb)
  if (!timer) { void leer(); timer = window.setInterval(leer, 15_000) }
  return () => { subs.delete(cb); if (!subs.size) { clearInterval(timer); timer = 0 } }
}
const leerEstado = () => estado
const setMias = (f: (m: Mias) => Mias) => poner({ mias: f(estado.mias) })

/** la foto con solo los productos de un espacio. Los de la carpeta personal (Everything entre ellos; Shepherdr los
 * marca `home`, o «~» en `where`) ven todos */
function delLugar(foto: Foto | null | 'error', snap: Snapshot | null, lugar: string): Foto | null | 'error' {
  if (!foto || foto === 'error') return foto
  const p = snap ? placeOf(snap, lugar) : null
  const espacio = p ? { id: p.id, home: Boolean(p.home) || (p.where !== undefined && esHome(p.where)) } : null
  return { ...foto, productos: delEspacio(foto.productos, espacio), total: foto.productos.length }
}
/** la del espacio abierto: sigue a ui.at, así que cambia en el acto al cambiar de espacio */
function useFlota() {
  const e = useSyncExternalStore(suscribir, leerEstado)
  const at = useUI((u) => u.at)
  const snap = useSnap()
  return { foto: delLugar(e.foto, snap, at), mias: e.mias }
}

const isLink = (s: string) => /^https?:\/\//.test(s)

/** una decisión con lo que se tocó aquí encima (mientras el TPM no la cierre) */
function conMia(p: Producto, d: Decision, mias: Mias): Decision {
  const m = mias[`${p.archivo}#${d.id}`]
  // una foto escrita por un panel anterior a HF-19 no trae `texto`
  return m && !m.error && d.estado !== 'cerrada' ? { ...d, estado: 'respondida', respuesta: m.respuesta, texto: m.texto } : { ...d, texto: d.texto ?? '' }
}
const abiertasDe = (p: Producto, mias: Mias) => (p.error ? 0 : (p.decisiones ?? []).filter((d) => conMia(p, d, mias).estado === 'abierta').length)
const pendientesDe = (foto: Foto | null | 'error', mias: Mias) => (foto && foto !== 'error' ? foto.productos.reduce((n, p) => n + abiertasDe(p, mias), 0) : 0)

/** guarda una opción, un texto libre o los dos (respuestas.py, por POST /flota/respuesta); true si se guardó */
async function responder(archivo: string, id: string, respuesta: string, texto: string) {
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

/* ---------- Iniciativas: épicas y tareas ---------- */

function Barra({ e }: { e: Epica }) {
  const a = avance(e)
  return <span className="fi-bar">{BAR.map((k) => (a[k] ? <span key={k} className={T(k)} style={{ width: `${(a[k] / a.total) * 100}%` }} /> : null))}</span>
}

/** una tarea: punto, título, sesión debajo y su estado; con link abre ClickUp */
function FilaTarea({ t, sub }: { t: Tarea; sub: string }) {
  const body = (
    <>
      <span className={cx('fi-dot', T(tono(t.estado)))} />
      <span className="fi-n">
        <span className={cx('l1', tono(t.estado) === 'hecha' && 'fi-sub')}>{t.titulo}</span>
        <span className="l2">{sub}</span>
      </span>
      <span className={cx('fi-est', tono(t.estado) === 'bloqueada' && 'fi-red')}>{t.estado}</span>
    </>
  )
  return isLink(t.link) ? <a href={t.link} target="_blank" rel="noreferrer" className="fi-row">{body}</a> : <div className="fi-row">{body}</div>
}

/** las tareas de una épica, en un diálogo: sigue a la foto nueva aunque cambie el orden (`clave`: "<archivo>#<id>") */
function HojaEpica({ clave, close }: { clave: string; close: () => void }) {
  const { foto } = useFlota()
  const e = (foto && foto !== 'error' ? foto.productos : []).flatMap((p) => (p.error ? [] : p.epicas.map((x, i) => [`${p.archivo}#${x.id || i}`, x] as const))).find(([k]) => k === clave)?.[1]
  if (!e) return <div className="fi-hd"><h2>Esa épica ya no está.</h2><IB icon="x" label="Cerrar" onClick={close} /></div>
  const a = avance(e)
  return (
    <div className="fi-ep">
      <div className="fi-hd">
        <div className="fi-n">
          <h2>{e.titulo}</h2>
          <div className="hint">
            {isLink(e.link) ? <a href={e.link} target="_blank" rel="noreferrer" className="fi-lk">ClickUp {e.id}</a> : `ClickUp ${e.id}`}
            {e.estado ? <span className={e.estado === 'en riesgo' ? 'fi-amber' : undefined}> · {e.estado}</span> : null} · {a.hecha}/{a.total} merged
          </div>
          <Barra e={e} />
        </div>
        <IB icon="x" label="Cerrar tareas" onClick={close} />
      </div>
      <div>
        {e.tareas.map((t, i) => <FilaTarea key={t.id || i} t={t} sub={t.sesion || (t.id ? `ClickUp ${t.id}` : '')} />)}
        {e.tareas.length === 0 ? <p className="hint">Esta épica no tiene tareas.</p> : null}
      </div>
    </div>
  )
}

function Lista({ p }: { p: Producto }) {
  return (
    <>
      {p.epicas.map((e, i) => {
        const a = avance(e)
        const clave = `${p.archivo}#${e.id || i}`
        return (
          <button key={e.id || i} type="button" className="fi-row" aria-haspopup="dialog" onClick={() => openDialog((close) => <HojaEpica clave={clave} close={close} />, { label: e.titulo, wide: true })}>
            <svg className="i s20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="m3 13 9 5 9-5" /></svg>
            <span className="fi-n">
              <b className="l1">{e.titulo}</b>
              <span className="l2">
                Épica · {a.total} tareas{e.estado ? <span className={e.estado === 'en riesgo' ? 'fi-amber' : undefined}> · {e.estado}</span> : null}
                {esperan(a) ? <span className="fi-red"> · {esperan(a)}</span> : null}
              </span>
            </span>
            <span className="fi-av">{a.hecha}/{a.total}<Barra e={e} /></span>
          </button>
        )
      })}
      {p.sueltas.map((t, i) => <FilaTarea key={t.id || i} t={t} sub={`Tarea suelta${t.sesion ? ` · ${t.sesion}` : ''}`} />)}
    </>
  )
}

/* ---------- Tablero ---------- */

/** una tarjeta del tablero: todas del mismo alto; con link abre ClickUp */
function Tarjeta({ t }: { t: Tarea & { de: string } }) {
  const body = (
    <>
      <span className="id"><span className={cx('fi-dot s', T(tono(t.estado)))} />{t.id}</span>
      <span className="t">{t.titulo}</span>
      <span className="l2 de">{t.de}</span>
      <span className="l2 se">{t.sesion}</span>
    </>
  )
  const cls = cx('fi-card', tono(t.estado) === 'bloqueada' && 'red')
  return isLink(t.link) ? <a href={t.link} target="_blank" rel="noreferrer" className={cls}>{body}</a> : <div className={cls}>{body}</div>
}

function Tablero({ p }: { p: Producto }) {
  const { columnas, merged } = tablero(p) as { columnas: { estado: string; tareas: (Tarea & { de: string })[] }[]; merged: number }
  return (
    <div className="fi-tab">
      {columnas.map((c) => (
        <div key={c.estado}>
          <h4 className="fi-h">
            <span className={cx('fi-dot', T(tono(c.estado)))} />
            {c.estado[0].toUpperCase() + c.estado.slice(1)}
            <span>{c.tareas.length}</span>
          </h4>
          {c.tareas.length ? <div className="fi-cards">{c.tareas.map((t, i) => <Tarjeta key={t.id || i} t={t} />)}</div> : null}
        </div>
      ))}
      <p className="hint">Merged · {merged}</p>
    </div>
  )
}

/* ---------- Gantt ---------- */

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
    <div className="fi-regla" aria-hidden="true">
      {(eje(g, w, 6.6) as Rotulo[]).map((r) => <span key={r.texto} className={cx(r.ancla, r.tipo)} style={{ left: `${r.x}%`, width: r.w }}>{r.texto}</span>)}
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
    <span className="fi-pista">
      {g.marcas.map((h) => <span key={h} className="m" style={{ left: P(h) }} />)}
      {SALIDAS.filter((h) => h > g.h0 && h < g.h1).map((h) => <span key={h} className="m s" style={{ left: P(h) }} />)}
      {barras.map((b, i) => (
        <span key={i} title={b.texto} className={cx('fi-b', b.hecha ? 'hecha' : b.estimada && 'est')} style={{ left: `${b.x}%`, width: `${b.w}%` }}>
          {/* tenue o rayada, la opacidad va en el fondo y no en el texto, que se lee entero */}
          <i className={b.tono ? T(b.tono) : EQUIPOS.includes(f.equipo) ? `fi-e-${f.equipo}` : T(tonoChip(f))} />
          {/* el relleno va en el texto: la barra mide sus horas aunque sea de un minuto */}
          {b.dentro ? <span>{b.texto}</span> : null}
        </span>
      ))}
      {fuera ? (
        <span className={cx('fi-fuera', fuera.ancla)} style={fuera.ancla === 'izq' ? { left: `${fuera.x}%`, width: `${fuera.w}%` } : { right: `${100 - fuera.x}%`, width: `${fuera.w}%` }}>
          <span>{fuera.texto}</span>
        </span>
      ) : null}
      {g.ya != null ? <span className="fi-ya" style={{ left: P(g.ya) }} /> : null}
    </span>
  )
}

/** cómo se lee, al pie como el subtítulo del artefacto: los chips y las barras */
function Leyenda() {
  return (
    <div className="fi-ley">
      <div>{(LEYENDA as [string, string, string][]).map(([c, t, dice]) => <span key={c}><span className={cx('fi-chip', T(t))}>{c}</span>{dice}</span>)}</div>
      <p>{explicacion('rayada')}</p>
    </div>
  )
}

/** el Gantt del día (skill gantt-flota): una tarjeta por salida («Hoy» sin salidas) con su eje, como en el artefacto;
 * cada fila con su equipo, su chip, su enlace, su nombre (hasta dos líneas; entero al tocarla) y su nota, y las barras
 * debajo a todo el ancho, así se lee a 390 px sin desplazarse. Al pie, lo listo hoy o ya en producción, los riesgos,
 * cómo se lee, y las decisiones que esperan, que se responden aquí mismo con las tarjetas de la pestaña Decisiones */
function Gantt({ p, medidas, at, mias }: { p: Producto; medidas: unknown[]; at: number; mias: Mias }) {
  const g = gantt(p, medidas) as G
  const { produccion, riesgos } = pie(p, g) as { produccion: { titulo: string; items: string[] }; riesgos: string[] }
  const [ref, ancho] = useAncho()
  const [enteros, setEnteros] = useState<Record<string, boolean>>({}) // las filas con el título entero (tocadas)
  const w = Math.max(160, ancho - 24) // la pista: la tarjeta menos su relleno (12 + 12)
  const equipos = [...new Set(g.grupos.flatMap((x) => x.filas).map((f) => f.equipo))].filter((e) => EQUIPOS.includes(e))
  const nota = (titulo: string, items: string[], vacio: string) => (
    <div className="fi-note">
      <h4>{titulo}</h4>
      {items.length ? <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="hint">{vacio}</p>}
    </div>
  )
  return (
    <div className="fi-g" ref={ref}>
      <p className="fi-meta">
        <span>Revisado a las {hhmm(ahora(at, 0, 24) ?? 0)}</span>
        {equipos.map((e) => <span key={e}><span className={`fi-sq fi-e-${e}`} />{e}</span>)}
      </p>
      {!g.grupos.length ? <p className="hint">{SIN_PLAN}</p> : g.grupos.map((x) => (
        <section key={x.salida} className="fi-box">
          <h4 className="fi-gh">{x.titulo}<span>{x.filas.length} {x.filas.length === 1 ? 'tarea' : 'tareas'}</span></h4>
          {ancho ? <Regla g={g} w={w} /> : null}
          {x.filas.map((f, i) => {
            const k = `${x.salida}#${f.id || i}`
            const alternar = () => setEnteros((e) => ({ ...e, [k]: !e[k] }))
            // Tocar la fila muestra (o vuelve a cortar) el título y la nota enteros; el enlace va en su palabra.
            return (
              <div
                key={k}
                role="button"
                tabIndex={0}
                aria-expanded={Boolean(enteros[k])}
                title={[f.titulo, f.nota].filter(Boolean).join('\n')}
                onClick={alternar}
                onKeyDown={(ev) => ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), alternar())}
                className={cx('fi-f', enteros[k] && 'entera')}
              >
                <span className="fi-f1">
                  {f.quien ? <span className={cx('fi-quien', EQUIPOS.includes(f.quien) && `fi-q-${f.quien}`)}>{f.quien}</span> : null}
                  <span className={cx('fi-chip', T(tonoChip(f)))}>{chip(f)}</span>
                  {isLink(f.link) ? (
                    <a href={f.link} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="fi-lk">{f.enlace || 'enlace'}</a>
                  ) : <span className="fi-mute">{f.enlace || 'sin enlace'}</span>}
                </span>
                <span className={cx('fi-ft', f.hecha && 'fi-sub')}>{f.titulo}</span>
                <span className="fi-fn">{f.nota}</span>
                {ancho ? <Pista f={f} g={g} w={w} /> : null}
              </div>
            )
          })}
        </section>
      ))}
      <div className="fi-notes">
        {nota(produccion.titulo, produccion.items, produccion.titulo === 'Listo hoy' ? 'Nada terminado hoy todavía.' : '—')}
        {nota('Riesgos', riesgos, 'Sin riesgos a la vista: nada bloqueado, en riesgo ni atrasado.')}
      </div>
      <Leyenda />
      <h4 className="fi-h2">Decisiones que esperan por ti</h4>
      <Decisiones p={p} mias={mias} />
    </div>
  )
}

/* ---------- Decisiones ---------- */

/** las decisiones de un producto: abiertas primero (borde rojo si frenan algo); tocar una opción la guarda, y debajo se
 * puede escribir con sus palabras (solo o junto a la opción). Se cambia mientras el TPM no la cierre */
function Decisiones({ p, mias }: { p: Producto; mias: Mias }) {
  const [borrador, setBorrador] = useState<Record<string, string>>({})
  // guardado, el borrador se suelta (el campo muestra lo guardado, y lo que llegue después desde el escritorio), salvo
  // que Juan siguiera escribiendo mientras se guardaba: eso no se toca
  const guardar = (id: string, respuesta: string, texto: string) => responder(p.archivo, id, respuesta, texto).then((ok) => {
    if (ok) setBorrador((b) => (b[id] === undefined || b[id] === texto ? Object.fromEntries(Object.entries(b).filter(([k]) => k !== id)) : b))
  })
  const decs = (p.decisiones ?? []).map((d) => conMia(p, d, mias))
  if (!decs.length) return <p className="hint">Sin decisiones abiertas.</p>
  return (
    <div className="fi-decs">
      <p className="hint">{cuantas(abiertasDe(p, mias))} · el TPM recoge las respondidas en su siguiente tick</p>
      {decs.map((d) => {
        const m = mias[`${p.archivo}#${d.id}`], abierta = d.estado === 'abierta', cerrada = d.estado === 'cerrada'
        const sub = [d.de && `pregunta ${d.de}`, d.tarea, d.contexto].filter(Boolean).join(' · ')
        return (
          <article key={d.id} className={cx('fi-dec', abierta && d.frena && 'frena', cerrada && 'cerrada')}>
            {/* el id arriba, en su renglón: los del TPM son largos y apretaban la pregunta */}
            <div className="fi-dh">
              <span className="fi-did">{d.id}</span>
              <span className={cx('hint', abierta ? d.frena && 'fi-red' : 'fi-green')}>{abierta ? (d.frena ? 'frena' : 'abierta') : d.estado}</span>
            </div>
            <h4>{d.pregunta}</h4>
            {sub ? <p className="hint">{sub}</p> : null}
            {d.opciones.length && !cerrada ? (
              <div className="fi-ops" role="group" aria-label={`Respuesta a ${d.id}`}>
                {d.opciones.map((o) => {
                  const on = o === d.respuesta
                  return (
                    <Btn key={o} kind={on ? 'pri' : undefined} aria-pressed={on} disabled={m?.guardando} onClick={() => !on && guardar(d.id, o, borrador[d.id] ?? d.texto)}>
                      {o}{o === d.recomendada ? ' ★' : ''}
                    </Btn>
                  )
                })}
              </div>
            ) : (
              cerrada ? <p className="fi-sub">Respuesta: {dicha(d) || '—'}</p> : null
            )}
            {!cerrada ? (
              <>
                <textarea
                  className="fi-ta"
                  aria-label={`Tu respuesta a ${d.id}, con tus palabras`}
                  placeholder="Escribe tu respuesta o un matiz (opcional)"
                  value={borrador[d.id] ?? d.texto}
                  onChange={(e) => setBorrador((b) => ({ ...b, [d.id]: e.target.value }))}
                  maxLength={1000}
                  rows={2}
                />
                {/* sin texto vale si queda una opción: así se quita un matiz */}
                <Btn kind="str" disabled={m?.guardando || (!(borrador[d.id] ?? d.texto).trim() && !d.respuesta)} onClick={() => guardar(d.id, d.respuesta, borrador[d.id] ?? d.texto)}>
                  {d.estado === 'respondida' ? 'Cambiar respuesta' : 'Enviar'}
                </Btn>
              </>
            ) : null}
            {m?.error ? <p className="hint fi-red">{m.error}</p> : null}
            {d.estado === 'respondida' && !m?.error ? (
              <p className="hint fi-green">{m?.guardando ? 'Guardando…' : `Tu respuesta: ${dicha(d)} · el TPM la recoge en su siguiente tick`}</p>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

/* ---------- el panel, su botón y la barra del teléfono ---------- */

function Panel() {
  const phone = useUI((u) => u.phone)
  const { foto, mias } = useFlota()
  const [vista, setVista] = useState<Vista>('iniciativas')
  const now = Date.now() / 1000
  const ok = foto && foto !== 'error' ? foto : null
  const pendientes = pendientesDe(foto, mias)
  return (
    <PaneFrame
      head={(sc) => (
        <>
          <Hd title="Iniciativas" sub={ok ? `Leído ${hace(ok.at, now)}` : undefined} pad={phone ? 12 : 4} scrolled={sc}>
            {!phone && <IB icon="x" label="Cerrar" onClick={() => togglePane(null)} />}
          </Hd>
          <div className="tabs fi-tabs" role="group" aria-label="Vista">
            {VISTAS.map(([k, l]) => (
              <button key={k} type="button" className="tab" aria-pressed={vista === k} onClick={() => setVista(k)}>
                {l}{k === 'decisiones' && pendientes ? <span className="cnt">{pendientes}</span> : null}
              </button>
            ))}
          </div>
        </>
      )}
    >
      {foto === 'error' ? <p className="fi-msg">Sin datos: /flota no responde en este Mac.</p> : null}
      {foto === null ? <p className="fi-msg">Leyendo…</p> : null}
      {ok && now - ok.at > 120 ? <p className="fi-old">Dato de {hace(ok.at, now)}: el panel del escritorio no está abierto.</p> : null}
      {ok && !ok.total ? <p className="fi-msg">{SIN_ARCHIVO}</p> : null}
      {ok && ok.total && !ok.productos.length ? <p className="fi-msg">{SIN_INICIATIVAS}</p> : null}
      {ok?.productos.map((p) =>
        p.error ? (
          <p key={p.archivo} className="fi-msg fi-red">{p.error}</p>
        ) : (
          <section key={p.archivo} className="fi-prod">
            <h3 className="lab"><b>{p.producto}</b> · el TPM lo escribió {hace(p.at, now)}</h3>
            {p.aviso ? <p className="fi-msg fi-red">{p.aviso}</p> : null}
            {vista === 'iniciativas' ? <Lista p={p} /> : null}
            {vista === 'tablero' ? <Tablero p={p} /> : null}
            {vista === 'gantt' ? <Gantt p={p} medidas={ok.medidas ?? []} at={ok.at} mias={mias} /> : null}
            {vista === 'decisiones' ? <div className="fi-g"><Decisiones p={p} mias={mias} /></div> : null}
          </section>
        ),
      )}
    </PaneFrame>
  )
}

/** el botón de la cabecera: cuántas decisiones esperan, o un punto rojo si hay tareas bloqueadas */
function Boton() {
  const on = useUI((u) => u.pane === 'iniciativas')
  const { foto, mias } = useFlota()
  const pendientes = pendientesDe(foto, mias)
  const bloqueadas = foto && foto !== 'error' && foto.productos.some((p) => !p.error && [...p.epicas.flatMap((e) => e.tareas), ...p.sueltas].some((t) => tono(t.estado) === 'bloqueada'))
  const dice = pendientes ? `Iniciativas: ${cuantas(pendientes)}` : bloqueadas ? 'Iniciativas: hay tareas bloqueadas' : 'Iniciativas'
  return (
    <IB icon="layers" label={dice} pressed={on} onClick={() => togglePane('iniciativas')}>
      {pendientes ? <span className="cnt">{pendientes}</span> : bloqueadas ? <span className="fi-pt" /> : null}
    </IB>
  )
}

export default definePlugin({
  name: 'flota-iniciativas',
  setup(reg) {
    reg.panes.push({ id: 'iniciativas', View: Panel })
    reg.header.push({ order: 45, View: Boton })
    // ponytail: la barra del teléfono no se suscribe a la foto; su cuenta es la de la última lectura (el panel, abierto,
    // la lee cada 15 s) y se pone al día cuando la web redibuja la barra.
    reg.bar.push({ order: 30, pane: 'iniciativas', label: 'Iniciativas', icon: 'layers', count: (snap, place) => pendientesDe(delLugar(estado.foto, snap, place), estado.mias) })
    // la foto se lee desde que la web abre, también en el teléfono, que no dibuja el botón de la cabecera
    suscribir(() => {})
  },
})
