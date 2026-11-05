// Iniciativas: las épicas y tareas sueltas de cada producto, del archivo que escribe el TPM en cada tick
// (~/.herdr/flota/<producto>.json, formato en el README). Clic en una épica → hoja inferior con sus
// tareas; clic en una tarea → su página de ClickUp. Si un archivo falta o está mal, una línea lo dice.
// Pestañas Tablero (una columna por estado, tarjetas del mismo alto) y Gantt (el plan del día por salida a
// producción, skill gantt-flota) con los mismos archivos. Pestaña Decisiones: las preguntas que el TPM copia de la base
// del Gantt; un clic en una opción la guarda en ~/.herdr/flota/respuestas/<archivo> (respuestas.py), y el TPM la recoge.
// Vive en el panel de la derecha (el de Tasks y Files); con props {boton: true} es el botón de la barra
// de arriba que lo abre y lo cierra, como los de Tasks y Files.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, appHome, theme, layout, run, props } from "herdr";
import { leer, avance, esperan, ordenar, tono, hace, SIN_ARCHIVO, tablero, gantt, chip, tonoChip, pos, ahora, SALIDAS, SIN_PLAN, abiertas } from "./iniciativas.js";

const VISTAS = [["iniciativas", "Iniciativas"], ["tablero", "Tablero"], ["gantt", "Gantt"], ["decisiones", "Decisiones"]];

// Cada <producto>.json de ~/.herdr/flota con su hora y sus respuestas dadas en Herdr, en una sola llamada.
// presupuesto.json es de Entorno.
const LISTAR = `
import glob, json, os
out = []
for f in sorted(glob.glob(os.path.expanduser("~/.herdr/flota/*.json"))):
    n = os.path.basename(f)
    if n == "presupuesto.json": continue
    try: t = open(f, encoding="utf-8").read()
    except Exception: t = None
    try: r = open(os.path.join(os.path.dirname(f), "respuestas", n), encoding="utf-8").read()
    except Exception: r = None
    out.append({"archivo": n, "at": int(os.path.getmtime(f)), "texto": t, "respuestas": r})
print(json.dumps(out))
`;

export default class Iniciativas extends View {
  init(_props, cx) {
    this.boton = Boolean(props()?.boton);
    if (this.boton) return;
    this.productos = null; // null: leyendo; [] : ningún archivo
    this.abierta = null; // "<archivo>#<n>" de la épica en la hoja
    this.vista = "iniciativas";
    this.aviso = ""; // por qué no se guardó la última respuesta
    this.ancho = 800;
    cx.timer.every(15000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) { cx.spawn((cx) => this.leerTodo(cx)); }

  async leerTodo(cx) {
    try {
      const files = JSON.parse((await exec("python3", ["-c", LISTAR])).stdout || "[]");
      this.productos = ordenar(files.map((f) => ({ ...leer(f.archivo, f.texto, f.respuestas), at: f.at })));
    } catch { this.productos = [{ archivo: "", error: "No se pudo leer ~/.herdr/flota" }]; }
    // La web de Shepherdr dibuja lo mismo desde esta foto (web/flota-iniciativas, servida en /flota).
    const foto = JSON.stringify({ at: Math.floor(Date.now() / 1000), productos: this.productos });
    exec("sh", ["-c", 'mkdir -p "${1%/*}" && printf %s "$2" > "$1.$$" && mv "$1.$$" "$1"', "sh", home() + "/.herdr/flota/web/iniciativas.json", foto]).catch(() => {});
    cx.notify();
  }

  render() {
    const t = theme();
    if (this.boton) return boton(t);
    const color = { hecha: t.ansi2, curso: t.muted, pr: t.done, bloqueada: t.blocked, cola: t.idle, riesgo: t.working, espera: t.ansi5 };
    const ancho = this.ancho >= 620; // con espacio: barra de avance y sesión en su columna
    const punto = (estado) => div().size(6).rounded(3).bg(color[tono(estado)]);
    const barra = (a, w) => h_flex().w(w).h(5).rounded(3).overflow_hidden().bg(t.border)
      .children(["hecha", "pr", "curso", "bloqueada"].filter((k) => a[k]).map((k) => div().h_full().w(`${(a[k] / a.total) * 100}%`).bg(color[k])));
    const textoEstado = (estado) => div().w(ancho ? 96 : 76).flex_none().text_size(12).text_color(tono(estado) === "bloqueada" ? t.blocked : t.muted).truncate().child(estado);
    const sesion = (s) => div().w(150).flex_none().text_size(11).text_color(t.muted).truncate().child(s || "—");
    const fila = (id, el) => h_flex().id(id).h(52).px(10).gap(12).items_center().rounded(6).border_b(1).border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover)).child(el);
    const titulo = (a, b, bold, alerta = "") => v_flex().flex_1().min_w(0)
      .child(div().text_size(12.5).when(bold, (e) => e.font_semibold()).text_color(t.foreground).truncate().child(a))
      .child(h_flex().min_w(0).gap(4).text_size(11)
        .child(div().flex_none().text_color(t.dim).child(b))
        .when(Boolean(alerta), (el) => el.child(div().min_w(0).text_color(t.blocked).truncate().child(`· ${alerta}`))));

    const lista = [];
    let sel = null;
    for (const p of this.productos || []) {
      if (p.error) { lista.push(div().py(8).text_size(12).text_color(t.blocked).child(p.error)); continue; }
      lista.push(h_flex().pt(10).pb(4).gap(8).items_baseline()
        .child(div().text_size(10.5).text_color(t.dim).child(p.producto.toUpperCase()))
        .child(div().text_size(10.5).text_color(t.dim).child(`el TPM lo escribió ${hace(p.at)}`)));
      if (this.vista === "tablero") { lista.push(this.tablero(p, t, color, punto)); continue; }
      if (this.vista === "gantt") { lista.push(...this.gantt(p, t, color)); continue; }
      if (this.vista === "decisiones") { lista.push(...this.decisiones(p, t)); continue; }
      p.epicas.forEach((e, n) => {
        const key = `${p.archivo}#${e.id || n}`, a = avance(e);
        if (key === this.abierta) sel = { e, a };
        lista.push(fila(`epica-${key}`, h_flex().flex_1().min_w(0).gap(12).items_center()
          .child(div().w(18).flex_none().text_size(14).text_color(t.muted).child("◇"))
          // Angosto: el estado de la épica va en la segunda línea, para dejarle ancho al título.
          .child(titulo(e.titulo, `Épica · ${a.total} tareas${e.estado && !ancho ? ` · ${e.estado}` : ""}`, true, esperan(a)))
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
        .child(h_flex().pb(4).gap(2).items_center().children(VISTAS.map(([k, label]) => {
          const on = this.vista === k, n = k === "decisiones" ? (this.productos || []).reduce((s, p) => s + abiertas(p), 0) : 0;
          return div().id(`vista-${k}`).h(26).px(10).gap(6).flex().items_center().rounded(6).text_size(12.5)
            .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted).when(on, (e) => e.font_semibold())
            .cursor_pointer().hover((s) => s.bg(on ? t.selected : t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { this.vista = k; this.abierta = null; this.aviso = ""; cx.notify(); })
            .child(label)
            .when(n > 0, (e) => e.child(div().px(5).h(16).flex().items_center().rounded(8).bg(t.blocked).text_color(t.background).text_size(10.5).font_semibold().child(String(n))));
        })))
        .child(v_flex().id("lista").flex_1().min_h(0).overflow_y_scroll()
          .when(this.productos === null, (el) => el.child(div().py(8).text_size(12).text_color(t.dim).child("Leyendo…")))
          .when(this.productos?.length === 0, (el) => el.child(div().py(8).text_size(12).text_color(t.dim).child(SIN_ARCHIVO)))
          .children(lista))
        .child(div().pt(8).text_size(10.5).text_color(t.dim).child(this.vista === "decisiones"
          ? "Las mismas decisiones del Gantt: respóndelas aquí o desde el celular · ★ recomendada"
          : "Épicas y tareas de ClickUp · el TPM las iguala en cada tick")));

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

  // Tablero: con espacio, las columnas lado a lado como en el diseño; angosto, una columna debajo de otra con las
  // tarjetas en una rejilla. Todas las tarjetas del mismo alto. Lo mergeado solo se cuenta, al final.
  tablero(p, t, color, punto) {
    const { columnas, merged } = tablero(p);
    const lado = this.ancho >= 860;
    const disp = this.ancho - 44, n = Math.max(1, Math.floor((disp + 8) / 168)), w = lado ? null : (disp - 8 * (n - 1)) / n;
    const tarjeta = (x, k) => v_flex().id(`tarjeta-${p.archivo}-${k}`).h(112).flex_none().when(w != null, (e) => e.w(w)).p(10).gap(2)
      .rounded(8).bg(t.background).border_1().border_color(tono(x.estado) === "bloqueada" ? t.blocked : t.border)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .when(/^https?:\/\//.test(x.link), (el) => el.on_click((_e, cx) => cx.open_url(x.link)))
      .child(h_flex().gap(6).items_center().child(punto(x.estado))
        .child(div().flex_1().min_w(0).text_size(10.5).text_color(t.dim).truncate().child(x.id || "")))
      .child(div().h(34).flex_none().overflow_hidden().text_size(12.5).line_height("17px").text_color(t.foreground).child(x.titulo))
      .child(div().flex_1())
      .child(div().text_size(11).text_color(t.dim).truncate().child(x.de))
      .child(div().text_size(11).text_color(t.muted).truncate().child(x.sesion));
    const cabeza = (texto, num, c) => h_flex().h(22).gap(7).items_center()
      .child(div().size(6).rounded(3).bg(c)).child(div().text_size(12.5).font_semibold().child(texto)).child(div().text_size(11).text_color(t.dim).child(String(num)));
    const nombre = (estado) => estado[0].toUpperCase() + estado.slice(1);
    const hechas = div().text_size(11.5).text_color(t.dim).child(`Merged · ${merged}`);
    if (lado) return h_flex().items_start().gap(10).pt(4).pb(8)
      .children(columnas.map((c, i) => v_flex().flex_1().min_w(0).gap(8)
        .child(cabeza(nombre(c.estado), c.tareas.length, color[tono(c.estado)]))
        .children(c.tareas.map((x, j) => tarjeta(x, `${i}-${j}`)))))
      .child(v_flex().w(76).flex_none().pl(8).border_l(1).border_color(t.border).child(hechas));
    return v_flex().gap(10).pt(4).pb(8)
      .children(columnas.map((c, i) => v_flex().gap(6)
        .child(cabeza(nombre(c.estado), c.tareas.length, color[tono(c.estado)]))
        .when(c.tareas.length > 0, (el) => el.child(h_flex().flex_wrap().gap(8).children(c.tareas.map((x, j) => tarjeta(x, `${i}-${j}`)))))))
      .child(hechas);
  }

  // Decisiones: una tarjeta por pregunta, las abiertas primero (con borde rojo si frenan algo). Un clic en una opción
  // la guarda; se puede cambiar mientras el TPM no la cierre. Sin opciones, se responde en el Gantt.
  decisiones(p, t) {
    if (!p.decisiones.length) return [div().py(6).text_size(12).text_color(t.dim).child("Sin decisiones abiertas.")];
    const out = [div().pb(4).text_size(11.5).text_color(t.muted).child(`${abiertas(p)} abiertas · el TPM recoge las respondidas en su siguiente tick`)];
    if (this.aviso) out.push(div().pb(4).text_size(12).text_color(t.blocked).child(this.aviso));
    p.decisiones.forEach((d, i) => {
      const cerrada = d.estado === "cerrada", abierta = d.estado === "abierta";
      const sub = [d.de && `pregunta ${d.de}`, d.tarea, d.contexto].filter(Boolean).join(" · ");
      out.push(v_flex().id(`decision-${p.archivo}-${i}`).mb(8).p(12).gap(8).rounded(9).bg(t.background).border_1()
        .border_color(abierta && d.frena ? t.blocked : t.border).when(cerrada, (e) => e.opacity(0.6))
        .child(h_flex().gap(8).items_start()
          .child(div().flex_none().text_size(11).font_semibold().text_color(t.ansi5).child(d.id))
          .child(div().flex_1().min_w(0).text_size(13).font_semibold().text_color(t.foreground).child(d.pregunta))
          .child(div().flex_none().text_size(11).text_color(abierta ? (d.frena ? t.blocked : t.muted) : t.ansi2)
            .child(abierta ? (d.frena ? "frena" : "abierta") : d.estado)))
        .when(Boolean(sub), (e) => e.child(div().text_size(11.5).text_color(t.dim).child(sub)))
        .child(d.opciones.length && !cerrada
          ? h_flex().flex_wrap().gap(6).children(d.opciones.map((o, j) => {
            const on = o === d.respuesta;
            return div().id(`opcion-${p.archivo}-${i}-${j}`).h(30).px(12).flex().items_center().rounded(7).text_size(12.5)
              .bg(on ? t.foreground : t.background).text_color(on ? t.background : t.foreground).border_1().border_color(on ? t.foreground : t.border)
              .cursor_pointer().hover((s) => s.bg(on ? t.foreground : t.hover))
              .on_click((_e, cx) => this.responder(p.archivo, d.id, o, cx))
              .child(o === d.recomendada ? `${o} ★` : o);
          }))
          : div().text_size(12).text_color(t.muted).child(cerrada ? `Respuesta: ${d.respuesta || "—"}` : "Sin opciones: respóndela en el Gantt"))
        .when(d.estado === "respondida", (e) => e.child(div().text_size(11.5).text_color(t.ansi2).child(`Tu respuesta: ${d.respuesta} · el TPM la recoge en su siguiente tick`))));
    });
    return out;
  }

  responder(archivo, id, respuesta, cx) {
    cx.spawn(async (cx) => {
      const r = await exec("python3", [`${appHome()}/mods/flota-iniciativas/respuestas.py`, "guardar", archivo, id, respuesta, "app"]).catch((e) => ({ code: 1, stderr: String(e) }));
      this.aviso = r.code ? (r.stderr || "No se guardó la respuesta").trim().split("\n").pop() : "";
      await this.leerTodo(cx);
    });
  }

  // Gantt: un bloque por salida a producción. Con espacio, el nombre a la izquierda y la barra a la derecha; angosto,
  // la barra va debajo del nombre a todo el ancho, así se lee sin desplazarse. Rayas: salidas de 07, 12 y 19;
  // naranja: ahora (Bogotá). Las salidas van en línea fina (gpui no pinta bordes punteados verticales). Barra sólida = en marcha, contorno = estimada, tenue = ya hecha.
  gantt(p, t, color) {
    const grupos = gantt(p);
    if (!grupos.length) return [div().py(6).text_size(12).text_color(t.dim).child(SIN_PLAN)];
    const ancho = this.ancho >= 620, ya = ahora(), NARANJA = "#f97316";
    const EQUIPO = { AI: t.ansi6, Backend: t.ansi3, Frontend: t.ansi2, Acciones: t.ansi5, DevOps: t.ansi4 };
    const pista = (f) => div().relative().h(ancho ? 40 : 14).when(ancho, (e) => e.flex_1()).min_w(0)
      .children(SALIDAS.map((h) => div().absolute().left(`${pos(h)}%`).top(0).bottom(0).w(1).bg(t.border)))
      .when(ya != null, (el) => el.child(div().absolute().left(`${pos(ya)}%`).top(0).bottom(0).w(2).bg(NARANJA)))
      .when(Boolean(f?.barra), (el) => {
        const c = color[tonoChip(f)], b = div().absolute().left(`${f.barra.x}%`).w(`${f.barra.w}%`).top(ancho ? 15 : 2).h(10).rounded(3);
        return el.child(f.estimada && !f.hecha ? b.border_1().border_dashed().border_color(c) : b.bg(c).opacity(f.hecha ? 0.45 : 0.9));
      });
    const eje = h_flex().h(16).when(ancho, (e) => e.child(div().w(300).flex_none()))
      .child(div().relative().flex_1().h_full().children([7, 10, 12, 15, 19].map((h) =>
        div().absolute().left(`${pos(h)}%`).ml(-15).w(30).text_size(10).text_color(SALIDAS.includes(h) ? t.muted : t.dim).child(`${String(h).padStart(2, "0")}:00`))));
    const nombre = (f) => h_flex().gap(8).items_center().min_w(0)
      .child(div().flex_none().px(6).rounded(8).border_1().border_color(color[tonoChip(f)]).text_size(10.5).text_color(color[tonoChip(f)]).child(chip(f)))
      .child(div().flex_1().min_w(0).text_size(12.5).text_color(f.hecha ? t.muted : t.foreground).truncate().child(f.titulo));
    const sub = (f) => h_flex().gap(6).min_w(0).text_size(11).text_color(t.dim)
      .when(Boolean(f.equipo), (e) => e.child(div().flex_none().text_color(EQUIPO[f.equipo] || t.muted).child(f.equipo)))
      .child(div().flex_1().min_w(0).truncate().child(f.nota || f.de));
    const out = [eje];
    grupos.forEach((g, i) => {
      out.push(div().pt(8).pb(2).text_size(10.5).font_semibold().text_color(t.muted).child(g.titulo.toUpperCase()));
      g.filas.forEach((f, j) => {
        const fila = (ancho
          ? h_flex().h(44).items_center().child(v_flex().w(300).flex_none().pr(12).gap(1).child(nombre(f)).child(sub(f))).child(pista(f))
          : v_flex().py(6).gap(3).child(nombre(f)).child(sub(f)).child(pista(f)))
          .id(`fila-${p.archivo}-${i}-${j}`).border_t(1).border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover));
        out.push(/^https?:\/\//.test(f.link) ? fila.on_click((_e, cx) => cx.open_url(f.link)) : fila);
      });
    });
    return out;
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
