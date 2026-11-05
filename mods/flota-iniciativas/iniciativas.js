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
  const tarea = (t) => ({ id: str(t.id), titulo: t.titulo, estado: str(t.estado) || "en cola", link: str(t.link), sesion: str(t.sesion) });
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
