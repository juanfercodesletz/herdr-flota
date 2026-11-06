// Iniciativas: lee el archivo que escribe el TPM (~/.herdr/flota/<producto>.json) y lo deja listo para
// dibujar. Lo usan el panel del escritorio (main.js) y el de la web de Shepherdr (web/flota-iniciativas).
// Sin imports: corre igual en Herdr y en el navegador. Formato: README, sección «Iniciativas».

// Cómo se pinta cada estado de tarea. Un estado que no esté aquí se muestra tal cual, como «en curso».
const TONOS = { "en cola": "cola", "en curso": "curso", "auditoría": "curso", "PR abierto": "pr", "bloqueada": "bloqueada", "merged": "hecha" };
export const tono = (estado) => TONOS[estado] || "curso";

// Orden por lo que pide acción: bloqueada → PR abierto → auditoría → en curso (y lo desconocido) → en cola → merged.
const RANGOS = { "bloqueada": 0, "PR abierto": 1, "auditoría": 2, "en cola": 4, "merged": 5 };
export const rango = (estado) => RANGOS[estado] ?? 3;
// Épicas: por su tarea más urgente (sin tareas, al final); a igualdad, atrasada y en riesgo antes que a tiempo.
const EPICAS = { "atrasada": 0, "en riesgo": 1 };
const clave = (e) => [Math.min(6, ...e.tareas.map((t) => rango(t.estado))), EPICAS[e.estado] ?? 2];
const porClave = (k) => (a, b) => { const x = k(a), y = k(b); return x[0] - y[0] || x[1] - y[1]; }; // sort es estable
// Productos: primero los que tienen algo bloqueado o en PR. Lo usa quien junta los archivos (el panel del escritorio).
const urgente = (p) => !p.error && [...p.epicas.flatMap((e) => e.tareas), ...p.sueltas].some((t) => rango(t.estado) <= 1);
export const ordenar = (productos) => [...productos].sort(porClave((p) => [urgente(p) ? 0 : 1, 0]));

// Por espacio: cada producto dice en `espacios` los ids de los espacios de Shepherdr donde se ve (el `sp…` de
// `herdr-app ls`, que no cambia al renombrar ni al reiniciar). Nunca el nombre. Home ve todos; un producto sin
// `espacios` solo se ve en Home. espacio: { id, home } del espacio abierto; null: todos.
export function delEspacio(productos, espacio) {
  if (!espacio || espacio.home) return productos;
  return productos.filter((p) => p.espacios?.includes(espacio.id));
}
export const esId = (v) => typeof v === "string" && /^sp[0-9a-f]{16,}$/.test(v);
// Home, como lo distingue Shepherdr: el espacio en la carpeta de inicio de su máquina, no su nombre. Vale la carpeta
// del escritorio ("" = la de su máquina, /Users/<u>, /home/<u>, /root) y la de la web ("~").
export const esHome = (carpeta) => !carpeta || carpeta === "~" || /^\/(home\/[^/]+|Users\/[^/]+|root)\/?$/.test(carpeta);
export const SIN_INICIATIVAS = "Este espacio no tiene iniciativas";

// archivo: el nombre (veta.json); texto: su contenido, o null si no se pudo leer; respuestas: el texto de
// ~/.herdr/flota/respuestas/<archivo> (lo que Juan respondió en Herdr), o null.
// Devuelve { archivo, producto, espacios, aviso?, epicas, sueltas, decisiones } o { archivo, espacios?, error } con el aviso en una línea.
export function leer(archivo, texto, respuestas = null) {
  if (texto == null) return { archivo, error: `${archivo}: no se pudo leer` };
  let d;
  try { d = JSON.parse(texto); } catch { return { archivo, error: `${archivo}: no es JSON válido` }; }
  // Un archivo que se lee pero está mal sigue en sus espacios; uno que ni se lee, solo en Home.
  // Cada uno, "sp…" o { "id": "sp…", "nombre": "…" } (el nombre es solo para leer a ojo). Un nombre suelto no se
  // adivina: queda fuera y el producto lleva un `aviso` de una línea (se ve en Home y en los espacios que sí van por id).
  const lista = Array.isArray(d?.espacios) ? d.espacios : [];
  const espacios = lista.map((e) => (typeof e === "string" ? e : e?.id)).filter(esId);
  const nombres = lista.filter((e) => !esId(typeof e === "string" ? e : e?.id)).map((e) => (typeof e === "string" ? e : str(e?.nombre) || "?"));
  const mal = (m) => ({ archivo, espacios, error: `${archivo}: ${m}` });
  if (!d || typeof d !== "object" || typeof d.producto !== "string" || !d.producto) return mal(`falta "producto"`);
  if (d.espacios != null && !Array.isArray(d.espacios)) return mal('"espacios" va como lista de ids de espacio (sp…)');
  const epicas = d.epicas ?? [], sueltas = d.sueltas ?? [];
  if (!Array.isArray(epicas) || !Array.isArray(sueltas)) return mal(`"epicas" y "sueltas" van como listas`);
  for (const e of epicas) if (!Array.isArray(e?.tareas ?? [])) return mal(`las "tareas" de una épica van como lista`);
  const malo = [...epicas, ...epicas.flatMap((e) => e?.tareas ?? []), ...sueltas].find((x) => !x || typeof x.titulo !== "string" || !x.titulo);
  if (malo !== undefined) return mal(`hay una épica o tarea sin "titulo"${malo?.id ? ` (${malo.id})` : ""}`);
  const decs = d.decisiones ?? [];
  if (!Array.isArray(decs)) return mal(`"decisiones" va como lista`);
  const mala = decs.find((x) => !x || !str(x.id) || typeof x.pregunta !== "string" || !x.pregunta);
  if (mala !== undefined) return mal(`hay una decisión sin "id" o sin "pregunta"${mala?.id ? ` (${mala.id})` : ""}`);
  const tarea = (t) => ({
    id: str(t.id), titulo: t.titulo, estado: str(t.estado) || "en cola", link: str(t.link), sesion: str(t.sesion),
    // Opcionales, solo para el Gantt (README, «Tablero y Gantt»).
    salida: str(t.salida), desde: str(t.desde), hasta: str(t.hasta), estimada: Boolean(t.estimada),
    ritmo: str(t.ritmo), nota: str(t.nota), equipo: str(t.equipo),
  });
  return {
    archivo,
    producto: d.producto,
    espacios,
    ...(nombres.length ? { aviso: `${archivo}: "espacios" lleva ids de espacio (sp…, en herdr-app ls), no nombres: ${nombres.map((n) => `«${n}»`).join(", ")}` } : {}),
    epicas: epicas.map((e) => ({ id: str(e.id), titulo: e.titulo, estado: str(e.estado), link: str(e.link), tareas: ordenTareas((e.tareas ?? []).map(tarea)) }))
      .sort(porClave(clave)),
    sueltas: ordenTareas(sueltas.map(tarea)),
    decisiones: decisiones(decs, respuestas),
    // Opcionales, para el pie del Gantt: una frase por cosa.
    produccion: textos(d.produccion), riesgos: textos(d.riesgos),
  };
}

// Decisiones (README, «Decisiones»): las que el TPM copia de la base del Gantt, con la respuesta que Juan dio en Herdr
// encima. Primero las abiertas (las que frenan algo antes), después las respondidas y al final las cerradas.
const ESTADOS = { "abierta": 0, "respondida": 1, "cerrada": 2 };
function decisiones(decs, respuestas) {
  let mias = {};
  try { mias = (respuestas && JSON.parse(respuestas)) || {}; } catch { /* un archivo de respuestas roto no tapa las decisiones */ }
  return decs.map((x) => {
    const id = str(x.id), opciones = Array.isArray(x.opciones) ? x.opciones.map(str).filter(Boolean) : [];
    let estado = ESTADOS[x.estado] !== undefined ? x.estado : "abierta", respuesta = str(x.respuesta), texto = str(x.texto);
    const mia = mias[id], suya = typeof mia?.respuesta === "string" ? mia.respuesta : null, escrito = str(mia?.texto).trim();
    // Lo de Herdr manda mientras el TPM no la cierre: Juan puede cambiar de opinión antes del tick. Vale una de las
    // opciones, su texto libre, o los dos.
    if (estado !== "cerrada" && suya != null && (opciones.includes(suya) || (suya === "" && escrito))) { estado = "respondida"; respuesta = suya; texto = escrito; }
    return { id, pregunta: x.pregunta, opciones, recomendada: str(x.recomendada), contexto: str(x.contexto),
      de: str(x.de), tarea: str(x.tarea), frena: Boolean(x.frena), estado, respuesta, texto };
  }).sort(porClave((x) => [ESTADOS[x.estado], x.frena ? 0 : 1]));
}
// Lo que respondió, en una línea: «Hoy — pero solo si…».
export const dicha = (d) => [d.respuesta, d.texto].filter(Boolean).join(" — ");
// Las que esperan a Juan (el número de la pestaña).
export const abiertas = (p) => (p.error ? 0 : p.decisiones.filter((x) => x.estado === "abierta").length);
export const cuantas = (n) => `${n} abierta${n === 1 ? "" : "s"}`;

const ordenTareas = (ts) => ts.sort(porClave((t) => [rango(t.estado), 0]));
const textos = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(str).filter(Boolean);
const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

// Avance de una épica: cuántas tareas hay en cada tono, para la barra y el «3/10».
export function avance(epica) {
  const n = { hecha: 0, curso: 0, pr: 0, bloqueada: 0, cola: 0 };
  for (const t of epica.tareas) n[tono(t.estado)]++;
  const sesiones = epica.tareas.filter((t) => t.sesion && tono(t.estado) !== "hecha").length;
  return { ...n, total: epica.tareas.length, sesiones, esperan: n.bloqueada + n.pr };
}
// «2 te esperan»: las tareas bloqueadas o con PR abierto de una épica; "" si no hay.
export const esperan = (a) => (a.esperan ? `${a.esperan} te espera${a.esperan > 1 ? "n" : ""}` : "");

export function hace(at, now = Date.now() / 1000) {
  const s = Math.max(0, now - at);
  return s < 90 ? "ahora" : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
}

// El aviso cuando no hay ningún archivo.
export const SIN_ARCHIVO = "Sin iniciativas: el TPM aún no escribió ~/.herdr/flota/<producto>.json";

// Todas las tareas de un producto, cada una con `de`: el título de su épica o «Tarea suelta».
const tareas = (p) => [...p.epicas.flatMap((e) => e.tareas.map((t) => ({ ...t, de: e.titulo }))), ...p.sueltas.map((t) => ({ ...t, de: "Tarea suelta" }))];

// Tablero: una columna por estado de tarea; lo mergeado solo se cuenta. Un estado desconocido va a «en curso».
export const COLUMNAS = ["en cola", "en curso", "auditoría", "PR abierto", "bloqueada"];
export function tablero(p) {
  const columnas = COLUMNAS.map((estado) => ({ estado, tareas: [] }));
  let merged = 0;
  for (const t of tareas(p)) {
    if (t.estado === "merged") merged++;
    else (columnas.find((c) => c.estado === t.estado) || columnas[1]).tareas.push(t);
  }
  return { columnas, merged };
}

// Gantt del día (skill gantt-flota): una fila por tarea de hoy, con sus barras sobre las horas de hoy en Bogotá. El eje
// cubre solo lo que hay: de la primera hora con algo a la última (o a la hora actual), entre las 00:00 y las 24:00.
// Las horas salen solas de herdr-task (`medidas`: las tareas de ~/.herdr/tasks/*.json, que junta el panel del
// escritorio y viajan en la foto de la web): de cuando arrancó su agente a cuando quedó lista, o hasta ahora si sigue.
// `desde` y `hasta` del TPM mandan sobre lo medido; `salida` agrupa por salida a producción y sin ella la fila va en
// «Hoy». Una tarea sin horas medidas ni escritas no entra; sin ninguna, el panel dice SIN_PLAN. Lo de ayer que apenas
// asoma pasada la medianoche no se pinta (sería una astilla en el borde): la fila lo dice en texto (`sinBarra`).
export const H0 = 6, H1 = 21, SALIDAS = [7, 12, 19], ASOMA = 0.5;
export const SIN_PLAN = "Nada hoy: ninguna tarea arrancó su agente de herdr-task hoy ni trae «desde» y «hasta»";
const hora = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] + m[2] / 60 : null; };
// Posición en % del eje (de h0 a h1), recortada a sus bordes.
export const pos = (h, h0 = H0, h1 = H1) => Math.min(100, Math.max(0, ((h - h0) / (h1 - h0)) * 100));
// Bogotá es UTC−5, sin horario de verano. dia0: su medianoche de hoy, en segundos.
const dia0 = (now) => now - ((((now - 5 * 3600) % 86400) + 86400) % 86400);
// La hora actual en Bogotá, en horas; null fuera del eje.
export function ahora(now = Date.now() / 1000, h0 = H0, h1 = H1) {
  const h = (now - dia0(now)) / 3600;
  return h >= h0 && h <= h1 ? h : null;
}
// «14:08» de una hora del día (las de ayer, «ayer 23:20»).
export function hhmm(h) {
  const m = Math.floor((((h % 24) + 24) % 24) * 60 + 1e-6);
  return `${h < 0 ? "ayer " : ""}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
// El chip de una palabra: el `ritmo` si lo hay; si no, «listo» lo terminado, «te espera» lo que aguarda el visto bueno
// de Juan (lista en herdr-task o con PR abierto) y el estado lo demás. Y su tono.
const RITMOS = { "listo": "hecha", "a tiempo": "curso", "en riesgo": "riesgo", "atrasado": "bloqueada", "te espera": "espera" };
export const chip = (t) => t.ritmo || (t.hecha || t.estado === "merged" ? "listo" : t.espera || t.estado === "PR abierto" ? "te espera" : t.estado);
export const tonoChip = (t) => RITMOS[chip(t)] || tono(t.estado);
// La leyenda de los chips, como en el artefacto: [chip, tono, qué quiere decir].
const DICE = { "listo": "terminada", "en riesgo": "puede correrse", "te espera": "necesita tu visto bueno" };
export const LEYENDA = Object.entries(RITMOS).map(([c, t]) => [c, t, DICE[c] || ""]);

// Qué tarea de herdr-task es esta: su `ref` (HF-17) igual al `id`; si no, dentro de los espacios del producto, el
// terminal de `sesion`, el PR de `link` o el código del título («E4.1 · …», como los nombra el TPM de Letz).
const codigo = (s) => /^(\S+) · /.exec(s || "")?.[1] || "";
function medidasDe(t, medidas, espacios) {
  const aqui = (m) => !espacios.length || espacios.includes(m.space), c = codigo(t.titulo), con = medidas.filter((m) => m.started);
  const suyas = t.id ? con.filter((m) => m.ref === t.id) : [];
  return (suyas.length ? suyas : con.filter((m) => aqui(m) &&
    ((t.sesion && (m.agentes || []).includes(t.sesion)) || (t.link && m.pr === t.link) || (c && codigo(m.titulo) === c))))
    .sort((a, b) => a.started - b.started);
}
// Vivo: corre y tiene algún agente sin terminar (todos terminados = se detuvo, en `fin`).
const vivo = (m) => m.estado === "running" && !m.fin;
const deHoy = (m, d0) => vivo(m) || m.estado === "ready" || [m.started, m.ready_at, m.done_at, m.fin].some((x) => x && x / 1000 >= d0);
// Barras de una tarea medida, [desde, hasta, texto, estimada, hecha, tono] en horas de hoy: el trabajo de su agente;
// si corre, lo que dice que le falta (rayado); si quedó lista, lo que lleva esperando a Juan, o lo que esperó.
function barrasDe(m, now, d0) {
  const h = (ms) => (ms / 1000 - d0) / 3600, ya = (now - d0) / 3600;
  const fin = vivo(m) ? ya : h(m.estado === "running" ? m.fin : m.ready_at || m.done_at || m.fin || now * 1000);
  const out = [[h(m.started), fin, null, false, m.estado === "done"]];
  const p = m.progreso;
  // Mientras espera a Juan, herdr-task para su reloj (paused_at): lo que falta se cuenta desde ahora.
  const vence = p?.paused_at ? now * 1000 + p.left - (p.paused_at - p.at) : p?.at + p?.left;
  if (vivo(m) && p?.at && p.left > 0 && h(vence) > ya) out.push([ya, h(vence), `falta ${dura(vence - now * 1000)}`, true, false]);
  if (m.estado === "ready" && m.ready_at) out.push([h(m.ready_at), ya, "te espera", false, false, "espera"]);
  // Lo que esperó, si fue más que un trámite (un visto bueno de un minuto sería otra astilla; la nota dice a qué hora).
  if (m.estado === "done" && m.ready_at && m.done_at - m.ready_at >= 10 * 60000) out.push([h(m.ready_at), h(m.done_at), "visto bueno", false, true, "espera"]);
  return out;
}
const notaDe = (m) => vivo(m) ? m.progreso?.texto || "en curso"
  : m.estado === "running" ? `se detuvo a las ${hhm(m.fin)}`
  : m.estado === "ready" ? `lista a las ${hhm(m.ready_at)} · espera tu visto bueno`
  : m.estado === "done" ? `${m.pr ? `${enlace(m.pr)} · ` : ""}${m.pr ? "mergeada" : "terminada"} a las ${hhm(m.done_at)}` : "";
const dura = (ms) => (ms < 90 * 60000 ? `~${Math.ceil(ms / 60000)} min` : `~${Math.round(ms / 3600000)} h`);
const hhm = (ms) => hhmm((ms / 1000 - dia0(ms / 1000)) / 3600);
// Lo que dice el enlace de una fila: ClickUp, «PR #17» o «enlace».
export const enlace = (url) => /clickup\.com/.test(url) ? "ClickUp" : /\/pull\/(\d+)/.test(url) ? `PR #${/\/pull\/(\d+)/.exec(url)[1]}` : /^https?:\/\//.test(url) ? "enlace" : "";

// medidas: la lista de la foto (README, «Tablero y Gantt»). now: en segundos.
// Devuelve { h0, h1, ya, marcas, grupos }: el eje en horas, la hora actual (null fuera del eje), las horas que se
// rotulan y los bloques, cada fila con sus `barras` { x, w (en % del eje), texto, estimada, hecha, tono }.
export function gantt(p, medidas = [], now = Date.now() / 1000) {
  const d0 = dia0(now), filas = [];
  for (const t of tareas(p)) {
    const ms = medidasDe(t, medidas, p.espacios || []).filter((m) => deHoy(m, d0));
    const a = hora(t.desde), b = hora(t.hasta);
    const barras = a != null && b != null ? [[a, b, `${t.desde}–${t.hasta}`, t.estimada, t.estado === "merged"]] : ms.flatMap((m) => barrasDe(m, now, d0));
    if (!(a != null && b != null) && barras.length) { // una sola hora escrita: manda sobre el primer tramo medido
      if (a != null) barras[0][0] = a;
      if (b != null) { barras[0][1] = b; barras[0][3] = t.estimada; }
    }
    const hoy = barras.filter(([x, y]) => y > x && y > 0 && x < 24);
    // Sin tramo hoy entra igual si herdr-task la movió hoy (se mergeó a las 00:05 tras trabajar ayer): su fila lo dice.
    if (!hoy.length && !ms.length) continue;
    const visibles = hoy.filter(([x, y]) => x >= 0 || y >= ASOMA);
    const ultima = ms[ms.length - 1], link = t.link || ultima?.pr || "";
    // El equipo (AI, Backend…) lo pone el TPM; sin él, nada: el asiento de herdr-task es un modelo, no un equipo.
    filas.push({ ...t, barras: visibles, link, enlace: enlace(link), quien: t.equipo, nota: t.nota || (ultima ? notaDe(ultima) : "") || t.de,
      sinBarra: visibles.length ? "" : `sin trabajo hoy (${hhmm(barras[0][0])}–${hhmm(((Math.max(...barras.map(([, y]) => y)) % 24) + 24) % 24)})`,
      hecha: t.estado === "merged" || (ms.length > 0 && ms.every((m) => m.estado === "done")), espera: ms.some((m) => m.estado === "ready") });
  }
  // De la primera hora con algo a la última o a la de ahora (con un margen), al menos 4 h; rayas cada 1, 2, 3, 4 o 6 h.
  const yo = (now - d0) / 3600, todas = filas.flatMap((f) => f.barras);
  let h0 = filas.length ? Math.floor(Math.min(yo, ...todas.map(([x]) => Math.max(0, x)))) : H0;
  let h1 = filas.length ? Math.min(24, Math.ceil(Math.max(yo + 0.25, ...todas.map(([, y]) => Math.min(24, y))))) : H1;
  if (h1 - h0 < 4) { h1 = Math.min(24, h0 + 4); h0 = h1 - 4; }
  const paso = [1, 2, 3, 4, 6].find((n) => (h1 - h0) / n <= 8);
  const grupos = new Map();
  for (const f of filas) {
    f.barras = f.barras.map(([x, y, texto, estimada, hecha, tono]) => {
      // Una barra muy corta se ensancha hacia atrás (si cabe): su fin sigue en su hora, la de ahora si corre.
      const r = pos(y, h0, h1), l = Math.max(0, r - Math.max(0.6, r - pos(x, h0, h1)));
      return { x: l, w: r - l, texto: texto ?? `${hhmm(x)}–${hhmm(y)}`, estimada: Boolean(estimada), hecha: Boolean(hecha), tono: tono || "" };
    });
    if (!grupos.has(f.salida)) grupos.set(f.salida, []);
    grupos.get(f.salida).push(f);
  }
  // Primero las salidas de hoy por hora, después «Hoy» (sin salida) y al final «mañana» y las demás, en el orden del archivo.
  const orden = (s) => hora(s) ?? (s ? 99 : 50);
  return {
    h0, h1, ya: ahora(now, h0, h1),
    marcas: Array.from({ length: 25 }, (_, i) => i).filter((h) => h >= h0 && h <= h1 && h % paso === 0),
    grupos: [...grupos].sort(([x], [y]) => orden(x) - orden(y)).map(([salida, filas]) => ({
      salida,
      titulo: !salida ? "Hoy" : hora(salida) != null ? `Sale a las ${salida}` : salida === "mañana" ? "Mañana o después" : `Sale ${salida}`,
      filas,
    })),
  };
}

// Los rótulos del eje sobre `ancho` px de pista, sin chocar entre sí ni salirse: primero el de ahora, después las salidas a
// producción y al final las horas. Cada uno centrado en su raya, o pegado al borde por dentro si se saldría. letra: px
// por carácter (de más, para no quedarse corto). Devuelve [{ h, texto, tipo: ahora|salida|hora, x (% de la izquierda
// del rótulo), w (px) }].
const hh = (h) => `${String(h % 24).padStart(2, "0")}:00`;
export function eje(g, ancho, letra = 5.8) {
  const todos = [
    ...(g.ya != null ? [{ h: g.ya, texto: `ahora ${hhmm(g.ya)}`, tipo: "ahora" }] : []),
    ...SALIDAS.filter((h) => h >= g.h0 && h <= g.h1).map((h) => ({ h, texto: `salida ${hh(h)}`, tipo: "salida" })),
    ...g.marcas.map((h) => ({ h, texto: hh(h), tipo: "hora" })),
  ];
  const puestos = [];
  for (const r of todos) {
    const w = r.texto.length * letra, c = (pos(r.h, g.h0, g.h1) / 100) * ancho, l = Math.max(0, Math.min(ancho - w, c - w / 2));
    if (w > ancho || puestos.some((p) => l < p.l + p.w + 8 && l + w + 8 > p.l)) continue;
    puestos.push({ ...r, l, w });
  }
  return puestos.sort((a, b) => a.l - b.l).map(({ h, texto, tipo, l, w }) =>
    ({ h, texto, tipo, x: (l / ancho) * 100, w, ancla: l <= 0 ? "izq" : l >= ancho - w - 0.01 ? "der" : "centro" }));
}

// Qué texto de cada barra cabe dentro (sobre `ancho` px de pista) y qué va fuera, en una línea junto a la última barra o
// antes de la primera, donde haya más sitio (allí se corta con «…»). Lo de `sinBarra` va fuera, desde la izquierda.
// Devuelve { barras (cada una con `dentro`), fuera: null | { texto, x, w (en %), ancla: izq|der } }.
export function textosFila(f, ancho, letra = 6.2) {
  const barras = f.barras.map((b) => ({ ...b, dentro: (b.w / 100) * ancho >= b.texto.length * letra + 10 }));
  const texto = [f.sinBarra, ...barras.filter((b) => !b.dentro).map((b) => b.texto)].filter(Boolean).join(" · ");
  if (!texto) return { barras, fuera: null };
  const fin = Math.max(0, ...f.barras.map((b) => b.x + b.w)), ini = Math.min(100, ...f.barras.map((b) => b.x)), gap = (4 / ancho) * 100;
  const der = 100 - fin - gap, izq = ini - gap, cabe = ((texto.length * letra) / ancho) * 100;
  if (Math.max(der, izq) < 8) return { barras, fuera: null };
  // Si solo la primera barra no cabe, su texto va antes de ella (si cabe ahí); si no, después de la última.
  const antes = barras.length > 1 && !barras[0].dentro && barras.slice(1).every((b) => b.dentro) && izq >= cabe;
  return { barras, fuera: !antes && (der >= cabe || der >= izq) ? { texto, x: fin + gap, w: der, ancla: "izq" } : { texto, x: ini - gap, w: izq, ancla: "der" } };
}

// Cómo se lee, en una línea al pie (como el subtítulo del artefacto). marca: cómo se ve lo estimado.
export const explicacion = (marca) => `Cada barra va de cuando arrancó su agente a cuando quedó lista, o hasta ahora si sigue; ${marca}: lo que dice que le falta; tenue: ya terminada. Las rayas marcadas son las salidas a producción; la naranja, la hora actual.`;

// El pie del Gantt: lo que ya salió (`produccion` del TPM o, sin ella, lo que quedó listo hoy), los riesgos (`riesgos`
// del TPM o, sin ellos, lo bloqueado, en riesgo o atrasado) y cuántas decisiones esperan a Juan.
export function pie(p, g) {
  const hoy = g.grupos.flatMap((x) => x.filas);
  return {
    produccion: p.produccion?.length ? { titulo: "Ya en producción", items: p.produccion }
      : { titulo: "Listo hoy", items: hoy.filter((f) => f.hecha).map((f) => `${f.titulo} · ${f.nota}`) },
    riesgos: p.riesgos?.length ? p.riesgos
      : tareas(p).filter((t) => t.estado === "bloqueada" || ["en riesgo", "atrasado"].includes(t.ritmo)).map((t) => t.nota ? `${t.titulo}: ${t.nota}` : t.titulo),
    decisiones: abiertas(p),
  };
}
