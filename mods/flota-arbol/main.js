// Árbol de productos, en la columna izquierda bajo los espacios: cada espacio de Shepherdr es un producto,
// con su TPM (el Assistant del espacio) y sus sesiones vivas: las tareas (herdr-task) que trabajan, esperan a
// Juan o están listas, y los agentes de sus pestañas. Si el producto tiene ~/.herdr/flota/<espacio>.json, sus
// sesiones van bajo la épica de su tarea. Clic en una sesión → su terminal en peek; en el TPM → su espacio;
// en un producto → se pliega. Lo en cola y lo hecho no sale: eso es de Tasks.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, readTextFile, appHome, home, spaces, terminals, theme, run } from "herdr";
import { estado, PALABRA, VIVA, ordenar, resumen, agrupar } from "./arbol.js";
import { leer, avance } from "./iniciativas.js";

export default class Arbol extends View {
  init(_props, cx) {
    this.listas = null; // herdr-task list --all: [{ folder, tasks }]; null: leyendo
    this.iniciativas = {}; // nombre del espacio → leer() de su archivo, o null
    this.plegados = new Set();
    cx.timer.every(15000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    if (this.leyendo) return; // herdr-task list --all tarda unos 5 s
    this.leyendo = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(`${appHome()}/mods/tasks/bin/herdr-task`, ["list", "--json", "--all"]);
        this.listas = JSON.parse(r.stdout || "[]");
      } catch { this.listas = this.listas ?? []; }
      for (const s of spaces()) {
        const texto = await readTextFile(`${home()}/.herdr/flota/${s.name}.json`).catch(() => null);
        this.iniciativas[s.name] = texto == null ? null : leer(`${s.name}.json`, texto);
      }
      this.leyendo = false;
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const color = { need: t.blocked, ready: t.done, merging: t.done, work: t.working, done: t.ansi2, idle: t.idle };
    const terms = terminals();
    const porNombre = new Map(terms.map((k) => [k.address, k]));
    const listas = new Map((this.listas ?? []).map((l) => [l.folder, l]));

    const fila = (id, nivel, h) => h_flex().id(id).h(h).pl(6 + nivel * 12).pr(8).gap(7).items_center().rounded(6).flex_none()
      .cursor_pointer().hover((s) => s.bg(t.hover));
    const nombre = (texto, c, bold) => div().flex_1().min_w(0).text_size(12.5).text_color(c).when(bold, (e) => e.font_semibold()).truncate().child(texto);
    const meta = (texto, c) => div().flex_none().text_size(10.5).text_color(c).child(texto);
    const etiqueta = (texto) => div().flex_none().px(4).rounded(3).bg("#d97757").text_color("#111111").text_size(9.5).font_semibold().child(texto);

    const filas = [];
    for (const s of spaces()) {
      // El TPM: el terminal del Assistant del espacio (hc: herdr.role=coordinator); con agente, el que lo tenga.
      const coord = terms.filter((k) => k.state === "live" && k.labels?.["herdr.role"] === "coordinator" && k.labels?.["herdr.coordinator.space"] === s.id);
      const c = coord.find((k) => k.status) ?? coord[0];
      const tpm = c ? { estado: estado(c.status), tab: c.labels["herdr.coordinator.tab"] } : null;

      const tareas = (listas.get(s.folder)?.tasks ?? []).filter((x) => VIVA(x.status)).map((x) => {
        const terminal = x.live?.[0]?.address ?? "";
        return { clave: `tarea-${s.id}-${x.id}`, ref: x.ref ?? "", titulo: x.title, estado: estado(x.status), alias: porNombre.get(terminal)?.name ?? "", terminal };
      });
      // Los agentes de las pestañas del espacio que no son su Assistant ni una tarea.
      const tabs = new Map(s.tabs.map((tb) => [tb.id, tb]));
      const pestanas = terms.filter((k) => k.state === "live" && k.status && k.labels?.["herdr.space"] === s.id && tabs.has(k.labels["herdr.tab"])
        && k.labels["herdr.role"] !== "coordinator" && !k.labels["herdr.task"])
        .map((k) => ({ clave: `term-${k.address}`, ref: "", titulo: k.title || k.name || `Pestaña ${tabs.get(k.labels["herdr.tab"]).name}`, estado: estado(k.status), alias: k.name ?? "", terminal: k.address }));
      const sesiones = ordenar([...tareas, ...pestanas]);

      const plegado = this.plegados.has(s.id);
      const r = resumen(sesiones, tpm);
      filas.push(fila(`p-${s.id}`, 0, 30).mt(filas.length ? 6 : 0)
        .on_click((_e, cx) => { this.plegados.has(s.id) ? this.plegados.delete(s.id) : this.plegados.add(s.id); cx.notify(); })
        .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child(plegado ? "▸" : "▾"))
        .child(nombre(s.name, t.foreground, true))
        .child(meta(r.texto, r.estado === "idle" ? t.muted : color[r.estado])));
      if (plegado) continue;

      filas.push(fila(`tpm-${s.id}`, 1, 26)
        .on_click(() => { run("space.select", { id: s.id }); if (tpm?.tab) run("tab.select", { id: tpm.tab }); })
        .child(div().w(10).flex_none())
        .child(etiqueta("TPM"))
        .child(nombre("Assistant", t.foreground, false))
        .child(meta(tpm ? PALABRA[tpm.estado] : "—", tpm && tpm.estado !== "idle" ? color[tpm.estado] : t.muted)));

      for (const g of agrupar(sesiones, this.iniciativas[s.name]?.error ? null : this.iniciativas[s.name])) {
        const nivel = g.epica ? 3 : 2;
        if (g.epica) {
          const a = avance(g.epica);
          filas.push(h_flex().h(24).pl(6 + 2 * 12).pr(8).gap(7).items_center().flex_none()
            .child(div().w(10).flex_none())
            .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.muted).truncate().child(g.epica.titulo))
            .child(meta(`${a.hecha}/${a.total}`, t.dim)));
        }
        for (const x of g.sesiones) {
          filas.push(fila(x.clave, nivel, 26)
            // Sin terminal vivo (una tarea Ready cuyo agente ya cerró): abre Tasks, donde está su tarjeta.
            .on_click(() => x.terminal ? run("terminal.peek", { terminal: x.terminal })
              : (run("layout.select", { stack: "panel-body", child: "tasks" }), run("layout.show", { id: "panel" })))
            .child(div().w(10).flex_none().flex().justify_center().child(div().size(7).rounded(4).bg(color[x.estado])))
            .when(Boolean(x.ref), (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(x.ref)))
            .child(nombre(x.titulo, t.foreground, false))
            .child(meta(PALABRA[x.estado], x.estado === "idle" ? t.muted : color[x.estado])));
        }
      }
    }

    return v_flex().size_full().bg(t.chrome).text_color(t.foreground).border_t(1).border_color(t.border)
      .child(h_flex().px(14).pt(10).pb(6).items_center()
        .child(div().flex_1().text_size(11).text_color(t.muted).child("PRODUCTOS"))
        .when(this.listas === null, (e) => e.child(div().text_size(11).text_color(t.dim).child("leyendo tareas…"))))
      .child(v_flex().id("arbol").flex_1().min_h(0).px(8).pb(8).gap(1).overflow_y_scroll()
        .when(filas.length === 0, (e) => e.child(div().px(6).py(8).text_size(12).text_color(t.dim).child("Sin espacios")))
        .children(filas));
  }
}
