// Iniciativas: lee el archivo que escribe el TPM (~/.herdr/flota/<producto>.json) y lo deja listo para
// dibujar. Lo usan el panel del escritorio (main.js) y el de la web de Shepherdr (web/flota-iniciativas).
// Sin imports: corre igual en Herdr y en el navegador. Formato: README, sección «Iniciativas».

// Cómo se pinta cada estado de tarea. Un estado que no esté aquí se muestra tal cual, como «en curso».
const TONOS = { "en cola": "cola", "en curso": "curso", "auditoría": "curso", "PR abierto": "pr", "bloqueada": "bloqueada", "merged": "hecha" };
export const tono = (estado) => TONOS[estado] || "curso";

// archivo: el nombre (veta.json); texto: su contenido, o null si no se pudo leer.
// Devuelve { archivo, producto, epicas, sueltas } o { archivo, error } con el aviso en una línea.
export function leer(archivo, texto) {
  if (texto == null) return { archivo, error: `${archivo}: no se pudo leer` };
  let d;
  try { d = JSON.parse(texto); } catch { return { archivo, error: `${archivo}: no es JSON válido` }; }
  if (!d || typeof d !== "object" || typeof d.producto !== "string" || !d.producto) return { archivo, error: `${archivo}: falta "producto"` };
  const epicas = d.epicas ?? [], sueltas = d.sueltas ?? [];
  if (!Array.isArray(epicas) || !Array.isArray(sueltas)) return { archivo, error: `${archivo}: "epicas" y "sueltas" van como listas` };
  for (const e of epicas) if (!Array.isArray(e?.tareas ?? [])) return { archivo, error: `${archivo}: las "tareas" de una épica van como lista` };
  const malo = [...epicas, ...epicas.flatMap((e) => e?.tareas ?? []), ...sueltas].find((x) => !x || typeof x.titulo !== "string" || !x.titulo);
  if (malo !== undefined) return { archivo, error: `${archivo}: hay una épica o tarea sin "titulo"${malo?.id ? ` (${malo.id})` : ""}` };
  const tarea = (t) => ({
    id: str(t.id), titulo: t.titulo, estado: str(t.estado) || "en cola", link: str(t.link), sesion: str(t.sesion),
    // Opcionales, solo para el Gantt (README, «Gantt»).
    salida: str(t.salida), desde: str(t.desde), hasta: str(t.hasta), estimada: Boolean(t.estimada),
    ritmo: str(t.ritmo), nota: str(t.nota), equipo: str(t.equipo),
  });
  return {
    archivo,
    producto: d.producto,
    epicas: epicas.map((e) => ({ id: str(e.id), titulo: e.titulo, estado: str(e.estado), link: str(e.link), tareas: (e.tareas ?? []).map(tarea) })),
    sueltas: sueltas.map(tarea),
  };
}

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

// Avance de una épica: cuántas tareas hay en cada tono, para la barra y el «3/10».
export function avance(epica) {
  const n = { hecha: 0, curso: 0, pr: 0, bloqueada: 0, cola: 0 };
  for (const t of epica.tareas) n[tono(t.estado)]++;
  const sesiones = epica.tareas.filter((t) => t.sesion && tono(t.estado) !== "hecha").length;
  return { ...n, total: epica.tareas.length, sesiones };
}

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
