// Árbol de productos: lo que comparten el panel del escritorio (main.js) y el de la web de Shepherdr
// (web/flota-arbol). Sin imports: corre igual en Herdr y en el navegador.
//
// Una sesión, ya armada por quien la dibuja: { clave, ref, titulo, estado, alias }. ref: el id de su tarea
// (HF-8) o ""; alias: el nombre de su terminal en hc, o "".

// El estado de una tarea (herdr-task: needs; la web: need), de un terminal (blocked) o de una pestaña, en uno.
const NORMAL = { needs: "need", need: "need", blocked: "need", ready: "ready", merging: "merging", working: "work", work: "work", done: "done", idle: "idle" };
export const estado = (s) => NORMAL[s] || "idle";
// Las palabras de Shepherdr, para que el árbol diga lo mismo que Tasks.
export const PALABRA = { need: "Needs you", ready: "Ready", merging: "Merging", work: "Working", done: "Finished", idle: "Idle" };

// Las tareas que salen en el árbol: las vivas. Lo que está en cola, por hacer o hecho se ve en Tasks.
export const VIVA = (status) => ["need", "ready", "merging", "work"].includes(NORMAL[status]);

// De más urgente a menos.
const RANGO = { need: 0, ready: 1, merging: 2, work: 3, done: 4, idle: 5 };
export const ordenar = (sesiones) => [...sesiones].sort((a, b) => RANGO[a.estado] - RANGO[b.estado]);

// Lo que dice la fila del producto: lo más urgente que hay en él, contando su TPM.
export function resumen(sesiones, tpm) {
  const n = (e) => sesiones.filter((s) => s.estado === e).length + (tpm?.estado === e ? 1 : 0);
  if (n("need")) return { texto: `${n("need")} needs you`, estado: "need" };
  if (n("ready")) return { texto: `${n("ready")} ready`, estado: "ready" };
  if (n("work")) return { texto: `${n("work")} working`, estado: "work" };
  return { texto: sesiones.length ? String(sesiones.length) : "", estado: "idle" };
}

// Las sesiones de un producto bajo la épica de su tarea, si el producto tiene iniciativas (leer() de
// iniciativas.js): la tarea de la épica se reconoce por su id (HF-8) o por su "sesion" (el nombre en hc).
// Devuelve [{ epica | null, sesiones }]: las épicas con sesiones, en su orden, y al final las sin épica.
export function agrupar(sesiones, producto) {
  const grupos = (producto?.epicas ?? []).map((epica) => ({ epica, sesiones: [] }));
  const sin = [];
  for (const s of sesiones) {
    const g = grupos.find(({ epica }) => epica.tareas.some((t) => (t.id && t.id === s.ref) || (t.sesion && t.sesion === s.alias)));
    (g ? g.sesiones : sin).push(s);
  }
  return [...grupos.filter((g) => g.sesiones.length), ...(sin.length ? [{ epica: null, sesiones: sin }] : [])];
}
