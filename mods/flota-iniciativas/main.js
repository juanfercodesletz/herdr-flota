// Iniciativas: las épicas y tareas sueltas de cada producto, del archivo que escribe el TPM en cada tick
// (~/.herdr/flota/<producto>.json, formato en el README). Clic en una épica → hoja inferior con sus
// tareas; clic en una tarea → su página de ClickUp. Si un archivo falta o está mal, una línea lo dice.
// Vive en el panel de la derecha (el de Tasks y Files); con props {boton: true} es el botón de la barra
// de arriba que lo abre y lo cierra, como los de Tasks y Files.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, theme, layout, run, props } from "herdr";
import { leer, avance, tono, hace, SIN_ARCHIVO } from "./iniciativas.js";

// Cada <producto>.json de ~/.herdr/flota con su hora, en una sola llamada. presupuesto.json es de Entorno.
const LISTAR = `
import glob, json, os
out = []
for f in sorted(glob.glob(os.path.expanduser("~/.herdr/flota/*.json"))):
    n = os.path.basename(f)
    if n == "presupuesto.json": continue
    try: t = open(f, encoding="utf-8").read()
    except Exception: t = None
    out.append({"archivo": n, "at": int(os.path.getmtime(f)), "texto": t})
print(json.dumps(out))
`;

export default class Iniciativas extends View {
  init(_props, cx) {
    this.boton = Boolean(props()?.boton);
    if (this.boton) return;
    this.productos = null; // null: leyendo; [] : ningún archivo
    this.abierta = null; // "<archivo>#<n>" de la épica en la hoja
    this.ancho = 800;
    cx.timer.every(15000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      try {
        const files = JSON.parse((await exec("python3", ["-c", LISTAR])).stdout || "[]");
        this.productos = files.map((f) => ({ ...leer(f.archivo, f.texto), at: f.at }));
      } catch { this.productos = [{ archivo: "", error: "No se pudo leer ~/.herdr/flota" }]; }
      // La web de Shepherdr dibuja lo mismo desde esta foto (web/flota-iniciativas, servida en /flota).
      const foto = JSON.stringify({ at: Math.floor(Date.now() / 1000), productos: this.productos });
      exec("sh", ["-c", 'mkdir -p "${1%/*}" && printf %s "$2" > "$1.$$" && mv "$1.$$" "$1"', "sh", home() + "/.herdr/flota/web/iniciativas.json", foto]).catch(() => {});
      cx.notify();
    });
  }

  render() {
    const t = theme();
    if (this.boton) return boton(t);
    const color = { hecha: t.ansi2, curso: t.muted, pr: t.done, bloqueada: t.blocked, cola: t.idle };
    const ancho = this.ancho >= 620; // con espacio: barra de avance y sesión en su columna
    const punto = (estado) => div().size(6).rounded(3).bg(color[tono(estado)]);
    const barra = (a, w) => h_flex().w(w).h(5).rounded(3).overflow_hidden().bg(t.border)
      .children(["hecha", "pr", "curso", "bloqueada"].filter((k) => a[k]).map((k) => div().h_full().w(`${(a[k] / a.total) * 100}%`).bg(color[k])));
    const textoEstado = (estado) => div().w(ancho ? 96 : 76).flex_none().text_size(12).text_color(tono(estado) === "bloqueada" ? t.blocked : t.muted).truncate().child(estado);
    const sesion = (s) => div().w(150).flex_none().text_size(11).text_color(t.muted).truncate().child(s || "—");
    const fila = (id, el) => h_flex().id(id).h(52).px(10).gap(12).items_center().rounded(6).border_b(1).border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover)).child(el);
    const titulo = (a, b, bold) => v_flex().flex_1().min_w(0)
      .child(div().text_size(12.5).when(bold, (e) => e.font_semibold()).text_color(t.foreground).truncate().child(a))
      .child(div().text_size(11).text_color(t.dim).truncate().child(b));

    const lista = [];
    let sel = null;
    for (const p of this.productos || []) {
      if (p.error) { lista.push(div().py(8).text_size(12).text_color(t.blocked).child(p.error)); continue; }
      lista.push(h_flex().pt(10).pb(4).gap(8).items_baseline()
        .child(div().text_size(10.5).text_color(t.dim).child(p.producto.toUpperCase()))
        .child(div().text_size(10.5).text_color(t.dim).child(`el TPM lo escribió ${hace(p.at)}`)));
      p.epicas.forEach((e, n) => {
        const key = `${p.archivo}#${n}`, a = avance(e);
        if (key === this.abierta) sel = { e, a };
        lista.push(fila(`epica-${key}`, h_flex().flex_1().min_w(0).gap(12).items_center()
          .child(div().w(18).flex_none().text_size(14).text_color(t.muted).child("◇"))
          // Angosto: el estado de la épica va en la segunda línea, para dejarle ancho al título.
          .child(titulo(e.titulo, `Épica · ${a.total} tareas${e.estado && !ancho ? ` · ${e.estado}` : ""}`, true))
          .when(ancho, (el) => el.child(barra(a, 160)))
          .child(div().w(36).flex_none().text_size(12).text_color(t.muted).child(`${a.hecha}/${a.total}`))
          .when(ancho, (el) => el.child(div().w(96).flex_none().text_size(12).text_color(e.estado === "en riesgo" ? t.working : t.muted).truncate().child(e.estado || ""))
            .child(sesion(a.sesiones ? `${a.sesiones} sesiones` : ""))))
          .bg(key === this.abierta ? t.selected : t.background)
          .on_click((_e, cx) => { this.abierta = key; cx.notify(); }));
      });
      p.sueltas.forEach((s, n) => {
        lista.push(fila(`suelta-${p.archivo}#${n}`, h_flex().flex_1().min_w(0).gap(12).items_center()
          .child(div().w(18).flex_none().flex().justify_center().child(punto(s.estado)))
          .child(titulo(s.titulo, `Tarea suelta · ${!ancho && s.sesion ? s.sesion : `ClickUp ${s.id}`}`, false))
          .when(ancho, (el) => el.child(div().w(160 + 36 + 12).flex_none()))
          .child(textoEstado(s.estado))
          .when(ancho, (el) => el.child(sesion(s.sesion))))
          .when(/^https?:\/\//.test(s.link), (el) => el.on_click((_e, cx) => cx.open_url(s.link))));
      });
    }

    const root = div().id("root").relative().size_full().rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground)
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.ancho) > 1) { this.ancho = size.width; cx.notify(); } })
      .child(v_flex().size_full().px(14).pt(12).pb(8)
        .child(div().font_semibold().pb(4).child("Iniciativas"))
        .child(v_flex().id("lista").flex_1().min_h(0).overflow_y_scroll()
          .when(this.productos === null, (el) => el.child(div().py(8).text_size(12).text_color(t.dim).child("Leyendo…")))
          .when(this.productos?.length === 0, (el) => el.child(div().py(8).text_size(12).text_color(t.dim).child(SIN_ARCHIVO)))
          .children(lista))
        .child(div().pt(8).text_size(10.5).text_color(t.dim).child("Épicas y tareas de ClickUp · el TPM las iguala en cada tick")));

    if (!sel) return root;
    // Hoja inferior: las tareas de la épica. Se cierra con ✕ o con un clic fuera.
    const { e, a } = sel;
    const cerrar = (_e, cx) => { this.abierta = null; cx.notify(); };
    return root
      .child(div().id("velo").absolute().inset_0().bg("#000000").opacity(0.45).on_click(cerrar))
      .child(v_flex().id("hoja").absolute().left(0).right(0).bottom(0).h("64%").bg(t.background).border_t(1).border_color(t.border).rounded_t(14)
        .on_click((_e, cx) => cx.stop_propagation())
        .child(h_flex().justify_center().pt(8).child(div().w(36).h(4).rounded(2).bg(t.border)))
        .child(h_flex().px(18).pt(10).pb(12).gap(14).items_center()
          .child(v_flex().flex_1().min_w(0)
            .child(div().text_size(15).font_semibold().truncate().child(e.titulo))
            .child(h_flex().gap(6).text_size(11.5).text_color(t.dim)
              .child(div().id("hoja-link").text_color(t.accent).cursor_pointer().child(`ClickUp ${e.id}`)
                .when(/^https?:\/\//.test(e.link), (el) => el.on_click((_e, cx) => cx.open_url(e.link))))
              .when(Boolean(e.estado), (el) => el.child(`· ${e.estado}`))))
          .when(ancho, (el) => el.child(barra(a, 180)))
          .child(div().text_size(12).text_color(t.muted).child(`${a.hecha}/${a.total}`))
          .child(div().id("hoja-cerrar").size(28).flex().items_center().justify_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).text_color(t.muted).on_click(cerrar).child("✕")))
        .child(v_flex().id("hoja-tareas").flex_1().min_h(0).overflow_y_scroll().px(8)
          .children(e.tareas.map((x, n) => h_flex().id(`tarea-${n}`).h(ancho || !x.sesion ? 40 : 48).px(10).gap(12).items_center().rounded(6).border_b(1).border_color(t.border)
            .cursor_pointer().hover((s) => s.bg(t.hover))
            .when(/^https?:\/\//.test(x.link), (el) => el.on_click((_e, cx) => cx.open_url(x.link)))
            .child(div().w(18).flex_none().flex().justify_center().child(punto(x.estado)))
            .child(v_flex().flex_1().min_w(0)
              .child(div().text_size(12.5).text_color(tono(x.estado) === "hecha" ? t.muted : t.foreground).truncate().child(x.titulo))
              .when(!ancho && Boolean(x.sesion), (el) => el.child(div().text_size(11).text_color(t.dim).truncate().child(x.sesion))))
            .child(textoEstado(x.estado))
            .when(ancho, (el) => el.child(sesion(x.sesion)))))));
  }
}

// El botón de la barra de arriba, con la misma forma que los de Tasks y Files (mods/tabs-tasks).
const find = (n, id) => (n?.id === id ? n : (n?.children || []).map((c) => find(c, id)).find(Boolean));
function boton(t) {
  const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
  const on = Boolean(panel && !panel.hidden && body?.active === "iniciativas");
  return h_flex().size_full().pr(10).items_center().bg(t.chrome).border_b(1).border_color(t.border)
    .child(h_flex().id("boton").h(24).pl(5).pr(8).gap(5).items_center().rounded(6).text_size(12)
      .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
      .cursor_pointer().hover((s) => s.bg(on ? t.selected : t.hover).text_color(t.foreground))
      .on_click(() => {
        if (on) run("layout.hide", { id: "panel" });
        else { run("layout.select", { stack: "panel-body", child: "iniciativas" }); run("layout.show", { id: "panel" }); }
      })
      .child(svg("mods/flota-iniciativas/iniciativas.svg").size(14).flex_none())
      .child("Iniciativas"));
}
