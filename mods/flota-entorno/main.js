// Entorno: lo que comparte toda la flota. Cupo de cada suscripción (5h y 7d) y los
// recursos de este Mac, cada uno contra su presupuesto. Solo se colorea lo que está
// cerca (10 puntos) o encima del techo.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, readTextFile, home, agents, theme } from "herdr";

// Techos por defecto; ~/.herdr/flota/presupuesto.json los cambia.
const DEFAULTS = { ccw: 90, ccp: 90, codex: 100, cpu: 85, ram: 90, disco_min_gb: 150, sesiones: 100 };
const SEATS = ["ccw", "ccp", "codex"];

// Codex no tiene barra de estado: su cupo sale del último log de sesión.
const CODEX = `
import glob, json, os, sys
fs = sorted(glob.glob(os.path.expanduser("~/.codex/sessions/*/*/*/rollout-*.jsonl")), key=os.path.getmtime)
if not fs: sys.exit()
f = fs[-1]
def find(o):
    if isinstance(o, dict):
        if isinstance(o.get("rate_limits"), dict): return o["rate_limits"]
        for v in o.values():
            r = find(v)
            if r: return r
for line in reversed(open(f).read().splitlines()[-400:]):
    try: rl = find(json.loads(line))
    except Exception: continue
    if rl:
        out = {"at": int(os.path.getmtime(f))}
        for k in ("primary", "secondary"):
            w = rl.get(k)
            if w: out["7d" if w.get("window_minutes", 0) > 300 else "5h"] = {"pct": w.get("used_percent"), "reset": w.get("resets_at")}
        print(json.dumps(out)); break
`;

// Los números del Mac en una sola llamada.
const MAC = `sysctl -n hw.ncpu vm.loadavg hw.memsize; vm_stat; df -k "$HOME" | tail -1; herdr agent list 2>/dev/null | python3 -c "import json,sys;print('TUI', len(json.load(sys.stdin)['result']['agents']))" 2>/dev/null`;

export default class Entorno extends View {
  init(_props, cx) {
    this.cap = DEFAULTS;
    this.seats = {};
    this.mac = null;
    cx.timer.every(15000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      const flota = home() + "/.herdr/flota";
      try { this.cap = { ...DEFAULTS, ...JSON.parse((await readTextFile(flota + "/presupuesto.json")) || "{}") }; } catch { this.cap = DEFAULTS; }
      for (const p of ["ccw", "ccp"]) {
        try {
          const d = JSON.parse((await readTextFile(`${flota}/cupos/${p}.json`)) || "null");
          const rl = d?.rate_limits || {};
          this.seats[p] = {
            at: d?.at,
            "5h": rl.five_hour && { pct: rl.five_hour.used_percentage, reset: rl.five_hour.resets_at },
            "7d": rl.seven_day && { pct: rl.seven_day.used_percentage, reset: rl.seven_day.resets_at },
          };
        } catch { this.seats[p] = null; }
      }
      try { this.seats.codex = JSON.parse((await exec("python3", ["-c", CODEX])).stdout || "null"); } catch { this.seats.codex = null; }
      try { this.mac = parseMac((await exec("sh", ["-c", MAC])).stdout); } catch { this.mac = null; }
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const cap = this.cap;
    const tone = (n, c) => (n == null ? t.dim : n >= c ? t.blocked : n >= c - 10 ? t.working : t.muted);
    const bar = (n, c) => div().relative().w_full().h(3).rounded(2).bg(t.border)
      .child(div().h(3).rounded(2).w(`${clamp(n)}%`).bg(tone(n, c)))
      .when(c < 100, (el) => el.child(div().absolute().top(-2).left(`${c}%`).w(1).h(7).bg(t.foreground).opacity(0.5)));
    const lbl = (s) => div().text_size(10.5).text_color(t.dim).child(s.toUpperCase());
    const head2 = (left, right) => h_flex().child(div().flex_1().child(lbl(left))).child(div().w(70).flex().justify_end().child(lbl(right)));

    // Una sola forma de fila para todo el panel: nombre, valor, dato gris a la derecha, barra
    // a todo el ancho y, si hace falta, una nota chica debajo.
    const row = (k, pct, c, val, right, note) => v_flex().gap(4)
      .child(h_flex().items_baseline()
        .child(div().flex_1().text_size(12.5).text_color(t.foreground).child(k))
        .child(div().text_size(12).text_color(tone(pct, c)).child(val))
        .child(div().w(70).flex().justify_end().text_size(11).text_color(t.dim).child(right)))
      .child(bar(pct ?? 0, c))
      .when(Boolean(note), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(note)));

    // Cupo: la ventana semanal manda (es la del techo para lanzar); la de 5h va de nota.
    const seatRow = (k) => {
      const s = this.seats[k], c = cap[k], w = s?.["7d"], h = s?.["5h"];
      const notes = [];
      if (h) notes.push(`5 h: ${Math.round(h.pct)}% · reinicia ${resetAt(h.reset)}`);
      if (!s?.at) notes.push("sin datos");
      else if (Date.now() / 1000 - s.at > 1800) notes.push(`dato de ${ago(s.at)}`);
      return row(k, w?.pct, c, w ? `${Math.round(w.pct)}%` : "—", w ? resetAt(w.reset) : "", notes.join(" · "));
    };

    // Este Mac
    const m = this.mac;
    const sessions = (m ? m.tui : 0) + agents().length;

    // Dónde estamos: cuántas sesiones caben y en qué asientos se puede lanzar.
    let head = "Midiendo…", sub = "";
    if (m) {
      const perSession = sessions ? m.ramUsedGb / sessions : 1.2;
      const ramRoom = Math.floor((m.ramGb * cap.ram / 100 - m.ramUsedGb) / Math.max(perSession, 0.3));
      const room = Math.max(0, Math.min(ramRoom, cap.sesiones - sessions));
      head = room ? `Caben ${room} sesiones` : "Sin espacio para más sesiones";
      sub = `Limita ${ramRoom <= cap.sesiones - sessions ? "la RAM" : "el máximo de sesiones"}`;
      const open = SEATS.filter((k) => this.seats[k]?.["7d"] && this.seats[k]["7d"].pct < cap[k]);
      sub += open.length ? ` · lanzar en ${open.join(", ")}` : " · ningún asiento bajo su techo";
    }

    return v_flex().id("root").size_full().bg(t.chrome).text_color(t.foreground).px(16).pt(12).pb(12).gap(18)
      .child(h_flex().items_center().child(div().flex_1().font_semibold().child("Entorno")))
      .child(v_flex().gap(2)
        .child(div().text_size(15).font_semibold().child(head))
        .child(div().text_size(11.5).text_color(t.muted).child(sub)))
      .child(v_flex().gap(14)
        .child(head2("Cupo semanal", "Reinicia"))
        .children(SEATS.map(seatRow)))
      .child(v_flex().gap(14)
        .child(head2("Este Mac", "Presupuesto"))
        .when(Boolean(m), (el) => el.children([
          row("CPU", m.cpu, cap.cpu, `${m.cpu}%`, `${cap.cpu}%`),
          row("RAM", Math.round(m.ramUsedGb / m.ramGb * 100), cap.ram, `${m.ramUsedGb.toFixed(0)} GB`, `${Math.round(m.ramGb * cap.ram / 100)} GB`),
          row("Disco libre", diskPct(m, cap), 100, `${m.diskFreeGb} GB`, `${cap.disco_min_gb} GB mín`),
          row("Sesiones", Math.round(sessions / cap.sesiones * 100), 100, `${sessions}`, `${cap.sesiones}`),
        ])))
      .child(div().flex_1())
      .child(div().text_size(10.5).text_color(t.dim).child("La raya marca el techo. Solo se colorea lo que está cerca o encima."));
  }
}

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n || 0)));

function ago(at) {
  const s = Math.max(0, Date.now() / 1000 - at);
  if (s < 90) return "ahora";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

// Reset: la hora si es en menos de 24 h, si no el día y la hora.
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
function resetAt(at) {
  if (!at) return "";
  const d = new Date(at * 1000);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return at - Date.now() / 1000 < 86400 ? hm : `${DIAS[d.getDay()]} ${hm}`;
}

// Disco: 100% de la barra = llegar al mínimo libre. Se pinta lo consumido del margen.
function diskPct(m, cap) {
  const margin = m.diskTotalGb - cap.disco_min_gb;
  return clamp(((m.diskTotalGb - m.diskFreeGb) / Math.max(margin, 1)) * 100);
}

function parseMac(out) {
  const lines = out.split("\n");
  const ncpu = Number(lines[0]);
  const load1 = Number((lines[1] || "").replace(/[{}]/g, "").trim().split(/\s+/)[0]);
  const memBytes = Number(lines[2]);
  const pageSize = Number((out.match(/page size of (\d+)/) || [])[1] || 16384);
  const pages = (name) => Number((out.match(new RegExp(name + ":\\s+(\\d+)")) || [])[1] || 0);
  // ponytail: "memoria usada" como Monitor de Actividad (app + wired + comprimida), aproximada desde vm_stat
  const used = (pages("Anonymous pages") - pages("Pages purgeable") + pages("Pages wired down") + pages("Pages occupied by compressor")) * pageSize;
  const df = (lines.find((l) => l.startsWith("/")) || "").split(/\s+/);
  const tui = Number((out.match(/^TUI (\d+)$/m) || [])[1] || 0);
  return {
    // ponytail: CPU = load de 1 min sobre núcleos; leer top -l 2 si hace falta el % exacto
    cpu: clamp((load1 / ncpu) * 100),
    ramGb: memBytes / 2 ** 30,
    ramUsedGb: used / 2 ** 30,
    diskTotalGb: Math.round(Number(df[1]) / 2 ** 20),
    diskFreeGb: Math.round(Number(df[3]) / 2 ** 20),
    tui,
  };
}
