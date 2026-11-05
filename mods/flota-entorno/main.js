// Entorno: lo que comparte toda la flota. Cupo de cada suscripción (5h y 7d) y los
// recursos de este Mac, cada uno contra su presupuesto. Solo se colorea lo que está
// cerca (10 puntos) o encima del techo.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, readTextFile, home, appHome, agents, theme, spaces, layout, run, shared, setShared } from "herdr";
import { DEFAULTS, entorno, level, clamp, DISCO, discoStat, startDisk, mcpLineas } from "./calc.js";

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
const MAC = `sysctl -n hw.ncpu hw.memsize kern.memorystatus_level; top -l 2 -n 0 -s 1 | grep 'CPU usage' | tail -1; python3 -c "$1"; herdr agent list 2>/dev/null | python3 -c "import json,sys;print('TUI', len(json.load(sys.stdin)['result']['agents']))" 2>/dev/null`;

// Plegado como la barra de espacios de Shepherdr (workspace-chrome): va por el ancho del bloque `entorno`,
// así que arrastrar el borde también lo pliega. Herdr guarda el ancho en layouts/.state: sobrevive reinicios.
const find = (n, id) => n?.id === id ? n : (n?.children ?? []).reduce((r, c) => r || find(c, id), null);
const width = () => find(layout(), "entorno")?.size?.px;
const narrow = () => (width() ?? Infinity) < 160;
function toggle() {
  if (!narrow()) setShared("entorno.width", width());
  run("layout.resize", { id: "entorno", px: narrow() ? (shared("entorno.width") ?? 260) : 44 });
}
const RANK = { none: 0, ok: 1, near: 2, over: 3 };

export default class Entorno extends View {
  init(_props, cx) {
    this.cap = DEFAULTS;
    this.seats = {};
    this.mac = null;
    this.disk = null;
    this.perfiles = null;
    this.abierto = null;
    cx.timer.every(15000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      const flota = home() + "/.herdr/flota";
      try { this.cap = { ...DEFAULTS, ...JSON.parse((await readTextFile(flota + "/presupuesto.json")) || "{}") }; } catch { this.cap = DEFAULTS; }
      try { this.cap = { ...this.cap, start_disk: startDisk(JSON.parse((await readTextFile(home() + "/.herdr/shepherdr.json")) || "{}")) }; } catch { this.cap = { ...this.cap, start_disk: 90 }; }
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
      // Una muestra que falla (exec corta a los 30 s con la máquina cargada, o no puede crear el proceso) no borra
      // la última buena: se queda, y el panel dice de cuándo es.
      try {
        const m = parseMac((await exec("sh", ["-c", MAC, "sh", DISCO])).stdout);
        if (m.ramGb > 0) this.mac = { ...m, at: Math.floor(Date.now() / 1000) };
      } catch {}
      // Disco: disco.sh tarda ~1 min, así que corre aparte y deja disco.txt; se relanza cada 30 min.
      try { this.disk = parseDisco((await readTextFile(flota + "/disco.txt")) || ""); } catch { this.disk = null; }
      if ((!this.disk || Date.now() / 1000 - this.disk.at > 1800) && Date.now() - (this.diskLaunched || 0) > 600000) {
        this.diskLaunched = Date.now();
        exec("sh", ["-c", `nohup sh "${appHome()}/mods/flota-entorno/disco.sh" >/dev/null 2>&1 &`]).catch(() => {});
      }
      // El perfil de Claude de cada terminal, del proceso que corre (perfiles.py).
      try { this.perfiles = JSON.parse((await exec("python3", [appHome() + "/mods/flota-entorno/perfiles.py"])).stdout || "null") || this.perfiles; } catch {}
      // La web de Shepherdr dibuja lo mismo desde estas fotos (web/flota-entorno, servidas en /flota).
      const foto = (f, d) => exec("sh", ["-c", 'mkdir -p "${1%/*}" && printf %s "$2" > "$1.$$" && mv "$1.$$" "$1"', "sh", `${flota}/web/${f}`, JSON.stringify(d)]).catch(() => {});
      foto("entorno.json", { at: Math.floor(Date.now() / 1000), cap: this.cap, seats: this.seats, mac: this.mac, disk: this.disk, agents: agents().length });
      if (this.perfiles) foto("perfiles.json", this.perfiles);
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const cap = this.cap;
    const tone = (n, c) => ({ none: t.dim, over: t.blocked, near: t.working, ok: t.muted })[level(n, c)];
    const bar = (n, c) => div().relative().w_full().h(3).rounded(2).bg(t.border)
      .child(div().h(3).rounded(2).w(`${clamp(n)}%`).bg(tone(n, c)))
      .when(c < 100, (el) => el.child(div().absolute().top(-2).left(`${c}%`).w(1).h(7).bg(t.foreground).opacity(0.5)));
    const lbl = (s) => div().text_size(10.5).text_color(t.dim).child(s.toUpperCase());
    const head2 = (left, right) => h_flex().child(div().flex_1().child(lbl(left))).child(div().w(90).flex().justify_end().child(lbl(right))).child(div().w(58));

    // Una sola forma de fila para todo el panel: nombre, dato gris, valor al final, barra
    // a todo el ancho y, si hace falta, una nota chica debajo.
    const row = ({ k, pct, c, val, right, note, warn }) => v_flex().gap(4)
      .child(h_flex().items_baseline()
        .child(div().flex_1().text_size(12.5).text_color(t.foreground).child(k))
        .child(div().w(90).flex().justify_end().text_size(11).text_color(t.dim).child(right))
        .child(div().w(58).flex().justify_end().text_size(12).text_color(tone(pct, c)).child(val)))
      .child(bar(pct ?? 0, c))
      .when(Boolean(warn), (el) => el.child(div().text_size(11.5).font_semibold().text_color(t.blocked).child(warn)))
      .when(Boolean(note), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(note)));

    // Claude en el espacio abierto: el Assistant primero; clic en una fila → sus MCP.
    const sp = spaces().find((s) => s.active);
    const claudes = (this.perfiles?.terminales || []).filter((x) => sp && x.space === sp.id).sort((a, b) => b.assistant - a.assistant);
    const perfil = (x) => {
      const abierto = this.abierto === x.address;
      return v_flex().gap(4)
        .child(h_flex().id(`perfil-${x.address}`).items_baseline().gap(8).cursor_pointer().hover((s) => s.opacity(0.75))
          .on_click((_e, cx) => { this.abierto = abierto ? null : x.address; cx.notify(); })
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground)
            .child(x.assistant ? "Assistant" : x.tarea ? `${x.tarea} ${x.titulo || ""}` : x.name || x.address))
          .child(div().flex_none().text_size(12).font_semibold().text_color(t.foreground).child(x.perfil))
          .child(div().w(10).flex_none().text_size(10.5).text_color(t.dim).child(abierto ? "▾" : "▸")))
        .when(abierto, (el) => el.child(v_flex().gap(3).pl(8)
          .children(mcpLineas(x).map((l) => div().text_size(11).text_color(t.muted).child(l)))));
    };

    const e = entorno({ cap: this.cap, seats: this.seats, mac: this.mac, disk: this.disk, agents: agents().length });
    const glyph = () => div().size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted)
      .child(svg("mods/flota-entorno/panel-right.svg").size(15));

    // Plegado: una tira con el ícono y, si algo está cerca o encima de su techo, un punto de ese color.
    if (narrow()) {
      const worst = [...e.seats, ...(e.mac || [])].map((r) => level(r.pct, r.c)).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "none");
      const dot = { over: t.blocked, near: t.working }[worst];
      return v_flex().id("rail").size_full().bg(t.chrome).items_center().pt(12).gap(10).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .tooltip(worst === "over" ? "Entorno: algo pasó su techo" : worst === "near" ? "Entorno: algo está cerca de su techo" : "Entorno")
        .on_click(() => toggle())
        .child(glyph())
        .when(Boolean(dot), (el) => el.child(div().size(8).rounded_full().bg(dot)));
    }

    return v_flex().id("root").size_full().bg(t.chrome).text_color(t.foreground).px(16).pt(12).pb(12).gap(18)
      .child(h_flex().items_center().child(div().flex_1().font_semibold().child("Entorno")).child(glyph().id("plegar").cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Plegar").on_click(() => toggle())))
      .child(v_flex().gap(2)
        .child(div().text_size(15).font_semibold().child(e.head))
        .child(div().text_size(11.5).text_color(t.muted).child(e.sub)))
      .child(v_flex().gap(10)
        .child(h_flex().child(div().flex_1().child(lbl("Claude en este espacio"))).child(lbl("Perfil")))
        .children(claudes.map(perfil))
        .when(!claudes.length, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(this.perfiles ? "Ningún Claude corre aquí." : "Leyendo…"))))
      .child(v_flex().gap(14)
        .child(head2("Cupo semanal", "Reinicia"))
        .children(e.seats.map(row)))
      .child(v_flex().gap(14)
        .child(head2("Este Mac", "Presupuesto"))
        .when(Boolean(e.mac), (el) => el.children((e.mac || []).map(row)))
        .when(Boolean(e.macNote), (el) => el.child(div().text_size(10.5).text_color(t.working).child(e.macNote)))
        .when(!e.mac, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Midiendo…"))))
      .child(div().flex_1())
      .child(div().text_size(10.5).text_color(t.dim).child("La raya marca el techo. Solo se colorea lo que está cerca o encima."));
  }
}

// disco.txt de disco.sh → GB (2^30) de cada parte; null en la parte que no se pudo medir
// (Docker apagado, carpeta que no existe) y null entero si aún no hay medición.
function parseDisco(out) {
  const at = Number((out.match(/^at (\d+)$/m) || [])[1]);
  if (!at) return null;
  const kb = (k) => { const v = (out.match(new RegExp(`^${k} (\\d+)$`, "m")) || [])[1]; return v == null ? null : Number(v) / 2 ** 20; };
  const U = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
  const dk = [...out.matchAll(/^docker ([\d.]+)\s*([kKMGT]?B)$/gm)];
  const docker = dk.length ? dk.reduce((s, [, n, u]) => s + Number(n) * U[u], 0) / 2 ** 30 : null;
  const wt = kb("wt"), uv = kb("uv");
  return { at, wt, uv, docker, total: (wt ?? 0) + (uv ?? 0) + (docker ?? 0) };
}

function parseMac(out) {
  const lines = out.split("\n");
  const memBytes = Number(lines[1]);
  // RAM: lo que macOS da por disponible (kern.memorystatus_level = "memory free percentage" de
  // memory_pressure). Cuenta como libre el caché y lo que el sistema suelta bajo presión.
  const freePct = /^\d+$/.test(lines[2] || "") ? Number(lines[2]) : null;
  // CPU: uso real (100 - idle) de la segunda muestra de top; la carga cuenta procesos en espera.
  const idle = (out.match(/([\d.]+)% idle/) || [])[1];
  const tui = Number((out.match(/^TUI (\d+)$/m) || [])[1] || 0);
  return {
    cpu: idle == null ? null : clamp(100 - Number(idle)),
    ramGb: memBytes / 2 ** 30,
    ramUsedGb: freePct == null ? null : (memBytes * (100 - freePct)) / 100 / 2 ** 30,
    ...discoStat(out),
    tui,
  };
}
