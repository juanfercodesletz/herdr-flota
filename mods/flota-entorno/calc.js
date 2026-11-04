// Entorno: lo que se muestra, calculado de una foto de los datos. Lo usan el panel del escritorio
// (main.js) y el de la web de Shepherdr (web/flota-entorno/client.tsx): mismas filas, mismos colores.
// Sin imports: corre igual en Herdr y en el navegador.

// Techos por defecto; ~/.herdr/flota/presupuesto.json los cambia.
// disco_flota_gb: lo que puede ocupar la flota; disco_min_gb: libre bajo el cual el disco va en rojo.
export const DEFAULTS = { ccw: 90, ccp: 90, codex: 100, cpu: 85, ram: 90, disco_flota_gb: 100, disco_min_gb: 20, sesiones: 100 };
export const SEATS = ["ccw", "ccp", "codex"];

// Solo se colorea lo que está cerca (10 puntos) o encima del techo.
export const level = (n, c) => (n == null ? "none" : n >= c ? "over" : n >= c - 10 ? "near" : "ok");

// La foto: { cap, seats: {ccw, ccp, codex}, mac, disk, agents } (lo que lee main.js).
// Devuelve el titular y las filas { k, pct, c, val, right, note }; pct null = sin dato.
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
    { k: "Disco (flota)", pct: diskPct(m, s.disk, cap), c: 100, val: s.disk ? `${Math.round(s.disk.total)} GB` : "—", right: `${cap.disco_flota_gb} GB`, note: diskNote(m, s.disk, now) },
    { k: "Sesiones", pct: Math.round(sessions / cap.sesiones * 100), c: 100, val: `${sessions}`, right: `${cap.sesiones}` },
  ];
  return { head, sub, seats, mac };
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

// Disco: lo que ocupa la flota contra su presupuesto. Si el libre baja del mínimo, rojo igual.
function diskPct(m, d, cap) {
  if (m.diskFreeGb <= cap.disco_min_gb) return 100;
  return d ? clamp((d.total / cap.disco_flota_gb) * 100) : null;
}

function diskNote(m, d, now) {
  const parts = d ? [["worktrees", d.wt], ["uv", d.uv], ["Docker", d.docker]].filter(([, v]) => v != null).map(([k, v]) => `${k} ${Math.round(v)}`) : ["midiendo…"];
  parts.push(`libres ${m.diskFreeGb} GB`);
  if (d && now - d.at > 3600) parts.push(`medido ${ago(d.at, now)}`);
  return parts.join(" · ");
}
