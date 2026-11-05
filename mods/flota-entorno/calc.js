// Entorno: lo que se muestra, calculado de una foto de los datos. Lo usan el panel del escritorio
// (main.js) y el de la web de Shepherdr (web/flota-entorno/client.tsx): mismas filas, mismos colores.
// Sin imports: corre igual en Herdr y en el navegador.

// Techos por defecto; ~/.herdr/flota/presupuesto.json los cambia. El del disco no está aquí: es el
// start_disk de Shepherdr (main.js lo lee de ~/.herdr/shepherdr.json y lo deja en cap.start_disk).
export const DEFAULTS = { ccw: 90, ccp: 90, codex: 100, cpu: 85, ram: 90, sesiones: 100 };
export const SEATS = ["ccw", "ccp", "codex"];

// Solo se colorea lo que está cerca (10 puntos) o encima del techo.
export const level = (n, c) => (n == null ? "none" : n >= c ? "over" : n >= c - 10 ? "near" : "ok");

// La foto: { cap, seats: {ccw, ccp, codex}, mac, disk, agents } (lo que lee main.js).
// Devuelve el titular, las filas { k, pct, c, val, right, note, warn } (pct null = sin dato; warn: aviso en rojo)
// y macNote, la antigüedad del dato del Mac cuando no es de ahora; mac null = aún sin ninguna muestra.
export function entorno(s, now = Date.now() / 1000) {
  const cap = s.cap, m = s.mac;

  // Cupo: la ventana semanal manda (es la del techo para lanzar); la de 5h va de nota.
  const seats = SEATS.map((k) => {
    const x = s.seats[k], c = cap[k];
    const live = (y) => (y && (!y.reset || y.reset > now) ? y : null);
    const w = live(x?.["7d"]), h = live(x?.["5h"]);
    const notes = [];
    if (h) notes.push(`5 h: ${Math.round(h.pct)}% · reinicia ${resetAt(h.reset)}`);
    if (x?.["7d"] && !w) notes.push("ya reinició; falta un dato nuevo");
    if (!x?.at) notes.push("sin datos");
    else if (now - x.at > 1800) notes.push(`dato de ${ago(x.at, now)}`);
    return { k, pct: w?.pct, c, val: w ? `${Math.round(w.pct)}%` : "—", right: w ? resetAt(w.reset) : "", note: notes.join(" · ") };
  });

  const sessions = (m ? m.tui : 0) + s.agents;

  // Dónde estamos: cuántas sesiones caben y en qué asientos se puede lanzar.
  let head = "Midiendo…", sub = "";
  if (m && m.ramUsedGb != null) {
    const perSession = sessions ? m.ramUsedGb / sessions : 1.2;
    const ramRoom = Math.floor((m.ramGb * cap.ram / 100 - m.ramUsedGb) / Math.max(perSession, 0.3));
    const room = Math.max(0, Math.min(ramRoom, cap.sesiones - sessions));
    head = room ? `Caben ${room} sesiones` : "Sin espacio para más sesiones";
    sub = `Limita ${ramRoom <= cap.sesiones - sessions ? "la RAM" : "el máximo de sesiones"}`;
    const open = SEATS.filter((k) => s.seats[k]?.["7d"] && s.seats[k]["7d"].pct < cap[k]);
    sub += open.length ? ` · lanzar en ${open.join(", ")}` : " · ningún asiento bajo su techo";
  }

  const mac = m && [
    { k: "CPU", pct: m.cpu, c: cap.cpu, val: m.cpu == null ? "—" : `${m.cpu}%`, right: `${cap.cpu}%` },
    { k: "RAM", pct: m.ramUsedGb == null ? null : Math.round(m.ramUsedGb / m.ramGb * 100), c: cap.ram, val: m.ramUsedGb == null ? "—" : `${m.ramUsedGb.toFixed(0)} GB`, right: `${Math.round(m.ramGb * cap.ram / 100)} GB` },
    disco(m, s.disk, cap.start_disk, now),
    { k: "Sesiones", pct: Math.round(sessions / cap.sesiones * 100), c: 100, val: `${sessions}`, right: `${cap.sesiones}` },
  ];
  // Si las últimas muestras del Mac fallaron, se ve la última buena con su antigüedad (main.js la conserva).
  const macNote = m?.at && now - m.at > 90 ? `dato de ${ago(m.at, now)}` : "";
  return { head, sub, seats, mac, macNote };
}

export const clamp = (n) => Math.max(0, Math.min(100, Math.round(n || 0)));

export function ago(at, now = Date.now() / 1000) {
  const s = Math.max(0, now - at);
  if (s < 90) return "ahora";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

// Reset: "hoy 16:20", "mañana 11:11" o "sáb 23:00".
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
export function resetAt(at) {
  if (!at) return "";
  const d = new Date(at * 1000), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
  return `${days === 0 ? "hoy" : days === 1 ? "mañana" : DIAS[d.getDay()]} ${hm}`;
}

// El start_disk de Shepherdr como él lo resuelve (settings.py machine_limits): el de "everywhere", luego el
// de esta máquina; sin ninguno, 90. null: sin límite.
export function startDisk(d) {
  const set = [d.everywhere?.machine, d.machines?.[d.here || "local"]?.machine].filter((x) => x && "start_disk" in x);
  return set.length ? set[set.length - 1].start_disk : 90;
}

// El disco como lo mide Shepherdr (machine.py _disks): statvfs de home y /tmp, usado = bloques - libres
// (no el «Used» de df, que en APFS cuenta solo este volumen) sobre usado + libre para un usuario.
// DISCO es el python que lo imprime; discoStat lo lee → { diskPct, diskFreeGb, diskTotalGb } del más lleno.
export const DISCO = `import os
for p in (os.path.expanduser("~"), "/tmp"):
    s = os.statvfs(p); print("statvfs", (s.f_blocks - s.f_bfree) * s.f_frsize, s.f_bavail * s.f_frsize)`;
export function discoStat(out) {
  const d = [...out.matchAll(/^statvfs (\d+) (\d+)$/gm)].map(([, u, a]) => [Number(u), Number(a)]).filter(([u, a]) => u + a > 0)
    .map(([u, a]) => ({ diskPct: Math.round((u * 100) / (u + a)), diskFreeGb: Math.round(a / 2 ** 30), diskTotalGb: (u + a) / 2 ** 30 }))
    .sort((a, b) => b.diskPct - a.diskPct)[0];
  return d || { diskPct: null, diskFreeGb: null, diskTotalGb: null };
}

// Disco en la escala de lo que la flota puede usar: usable = lo que ocupa la flota + lo libre. La barra es la
// flota sobre lo usable y la raya, el punto donde Shepherdr frena (lo libre baja a libresLim). El rojo no cambia:
// sale cuando Shepherdr deja de arrancar tareas, con el % lleno del disco entero (redondeado) sobre su start_disk.
// start_disk null: Shepherdr no tiene límite de disco (sin raya). Flota aún midiendo: sin barra, el rojo igual.
export function disco(m, d, lim = 90, now = Date.now() / 1000) {
  const over = lim != null && m.diskPct > lim;
  // Shepherdr redondea el %: para cuando lo lleno llega al lim + 0.5 %, o sea con lo libre bajo esto.
  const libresLim = lim != null && m.diskTotalGb != null ? m.diskTotalGb * (100 - lim - 0.5) / 100 : null;
  const falta = libresLim != null && m.diskFreeGb != null ? m.diskFreeGb - libresLim : null;
  const usable = d && m.diskFreeGb != null ? d.total + m.diskFreeGb : null;
  const raw = usable ? (d.total / usable) * 100 : null;
  const c = lim == null || libresLim == null || !usable ? 101 : Math.max(0, ((usable - libresLim) / usable) * 100);
  // ponytail: level() pinta rojo con pct >= c; se ajusta pct (menos de un punto, por el redondeo) para que eso
  // pase justo cuando Shepherdr para. Midiendo y pasado: pct 101 (barra llena, roja).
  const pct = over ? Math.max(raw ?? 101, c) : raw != null && raw >= c ? c - 0.01 : raw;
  const flota = d ? [["worktrees", d.wt], ["uv", d.uv], ["Docker", d.docker]].filter(([, v]) => v != null).map(([k, v]) => `${k} ${Math.round(v)}`) : [];
  const note = [];
  if (falta != null && !over) note.push(`faltan ${Math.max(0, Math.round(falta))} GB para el límite`);
  note.push(d ? `flota ${Math.round(d.total)} de ${Math.round(usable)} GB usables (${flota.join(" · ")})` : "flota: midiendo…", `libres ${m.diskFreeGb} GB`);
  if (d && now - d.at > 3600) note.push(`medido ${ago(d.at, now)}`);
  const pasado = falta != null && -falta >= 0.5 ? `Pasado ${Math.round(-falta)} GB del límite` : "En el límite";
  return {
    k: "Disco", pct, c, val: raw == null ? "—" : `${Math.round(raw)}%`,
    right: lim == null ? "sin límite" : c <= 100 ? `${Math.round(c)}%` : "—", note: note.join(" · "),
    warn: over ? `${pasado}: Shepherdr no arranca tareas nuevas` : "",
  };
}

// Perfiles de Claude (perfiles.py): las líneas de MCP de un terminal, iguales en el escritorio y en la web.
const MCP_DE = { usuario: "Del perfil", local: "De esta carpeta", proyecto: "Del proyecto", plugins: "De plugins" };
export function mcpLineas(x) {
  const l = Object.entries(x.mcp || {}).map(([k, v]) => `${MCP_DE[k] || k}: ${v.join(", ")}`);
  if (!l.length) l.push(x.perfil === "?" ? "No se pudo leer su entorno" : "Ningún MCP en su config");
  if (x.cuenta) l.push(`Conectores de claude.ai: los de ${x.cuenta}`);
  return l;
}
