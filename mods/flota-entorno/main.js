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

    // Cupo
    const cell = (w, c) => v_flex().w(64).gap(3)
      .child(div().text_size(11.5).text_color(w ? tone(w.pct, c) : t.dim).child(w ? `${Math.round(w.pct)}%` : "—"))
      .child(bar(w?.pct ?? 0, c));
    const seatRow = (k) => {
      const s = this.seats[k];
      const c = cap[k];
      return h_flex().items_center().gap(10)
        .child(v_flex().flex_1().min_w(0)
          .child(div().text_size(12.5).text_color(t.foreground).child(k))
          .child(div().text_size(10.5).text_color(t.dim).child(s?.at ? ago(s.at) : "sin datos")))
        .child(cell(s?.["5h"], c)).child(cell(s?.["7d"], c));
    };

    // Este Mac
    const m = this.mac;
    const sessions = (m ? m.tui : 0) + agents().length;
    const macRow = (k, pct, c, val, capT) => v_flex().gap(3)
      .child(h_flex().items_center().text_size(11.5)
        .child(div().flex_1().text_size(12.5).text_color(t.foreground).child(k))
        .child(div().text_color(tone(pct, c)).child(val))
        .child(div().text_color(t.dim).child(`  │ ${capT}`)))
      .child(bar(pct, c));

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
      .child(v_flex().gap(10)
        .child(h_flex().gap(10).child(div().flex_1().child(lbl("Cupo"))).child(div().w(64).child(lbl("5h"))).child(div().w(64).child(lbl("7d"))))
        .children(SEATS.map(seatRow)))
      .child(v_flex().gap(10)
        .child(lbl("Este Mac"))
        .when(Boolean(m), (el) => el.children([
          macRow("CPU", m.cpu, cap.cpu, `${m.cpu}%`, `${cap.cpu}%`),
          macRow("RAM", Math.round(m.ramUsedGb / m.ramGb * 100), cap.ram, `${m.ramUsedGb.toFixed(0)} GB`, `${Math.round(m.ramGb * cap.ram / 100)} GB`),
          macRow("Disco libre", diskPct(m, cap), 100, `${m.diskFreeGb} GB`, `${cap.disco_min_gb} mín`),
          macRow("Sesiones", Math.round(sessions / cap.sesiones * 100), 100, `${sessions}`, `${cap.sesiones}`),
        ])))
      .child(div().flex_1())
      .child(div().text_size(10.5).text_color(t.dim).child("Raya = presupuesto. Solo se colorea lo que está cerca o encima."));
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
