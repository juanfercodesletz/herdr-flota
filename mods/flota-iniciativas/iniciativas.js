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
    // Opcionales, solo para el Gantt (README, «Gantt»).
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
    let estado = ESTADOS[x.estado] !== undefined ? x.estado : "abierta", respuesta = str(x.respuesta);
    const mia = mias[id]?.respuesta;
    // Lo de Herdr manda mientras el TPM no la cierre: Juan puede cambiar de opinión antes del tick.
    if (estado !== "cerrada" && typeof mia === "string" && opciones.includes(mia)) { estado = "respondida"; respuesta = mia; }
    return { id, pregunta: x.pregunta, opciones, recomendada: str(x.recomendada), contexto: str(x.contexto),
      de: str(x.de), tarea: str(x.tarea), frena: Boolean(x.frena), estado, respuesta };
  }).sort(porClave((x) => [ESTADOS[x.estado], x.frena ? 0 : 1]));
}
// Las que esperan a Juan (el número de la pestaña).
export const abiertas = (p) => (p.error ? 0 : p.decisiones.filter((x) => x.estado === "abierta").length);
export const cuantas = (n) => `${n} abierta${n === 1 ? "" : "s"}`;

const ordenTareas = (ts) => ts.sort(porClave((t) => [rango(t.estado), 0]));
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

// Gantt del día (skill gantt-flota): filas agrupadas por salida a producción, barra de `desde` a `hasta` sobre
// las 06:00–21:00 de Bogotá. Solo entran las tareas con `salida`; sin ninguna, el panel muestra SIN_PLAN.
export const H0 = 6, H1 = 21, SALIDAS = [7, 12, 19];
export const SIN_PLAN = "Sin plan del día: el TPM aún no puso «salida», «desde» y «hasta» en las tareas";
const hora = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] + m[2] / 60 : null; };
// Posición en % del eje, recortada a sus bordes.
export const pos = (h) => Math.min(100, Math.max(0, ((h - H0) / (H1 - H0)) * 100));
// La hora actual en Bogotá (UTC−5, sin horario de verano), en horas; null fuera del eje.
export function ahora(now = Date.now() / 1000) {
  const h = (((now - 5 * 3600) % 86400) + 86400) % 86400 / 3600;
  return h >= H0 && h <= H1 ? h : null;
}
// El chip de una palabra: el `ritmo` si lo hay; si no, «listo» lo mergeado y el estado lo demás. Y su tono.
const RITMOS = { "listo": "hecha", "a tiempo": "curso", "en riesgo": "riesgo", "atrasado": "bloqueada", "te espera": "espera" };
export const chip = (t) => t.ritmo || (t.estado === "merged" ? "listo" : t.estado);
export const tonoChip = (t) => RITMOS[chip(t)] || tono(t.estado);

export function gantt(p) {
  const grupos = new Map();
  for (const t of tareas(p)) {
    if (!t.salida) continue;
    const a = hora(t.desde), b = hora(t.hasta);
    const barra = a != null && b != null && b > a ? { x: pos(a), w: pos(b) - pos(a) } : null;
    if (!grupos.has(t.salida)) grupos.set(t.salida, []);
    grupos.get(t.salida).push({ ...t, barra, hecha: t.estado === "merged" });
  }
  // Primero las salidas de hoy por hora; después «mañana» y las demás, en el orden del archivo.
  const orden = (s) => hora(s) ?? 99;
  return [...grupos].sort(([x], [y]) => orden(x) - orden(y)).map(([salida, filas]) => ({
    salida,
    titulo: hora(salida) != null ? `Sale a las ${salida}` : salida === "mañana" ? "Mañana o después" : `Sale ${salida}`,
    filas,
  }));
}
