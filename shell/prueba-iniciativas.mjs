// node shell/prueba-iniciativas.mjs: el lector de ~/.herdr/flota/<producto>.json con el ejemplo y con archivos malos.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leer, avance, tono, tablero, gantt, pie, pos, hhmm, LEYENDA, eje, textosFila, dicha, explicacion, ahora, chip, tonoChip, ordenar, esperan, abiertas, cuantas, delEspacio, esHome, SIN_INICIATIVAS } from "../mods/flota-iniciativas/iniciativas.js";

const ej = leer("veta.json", readFileSync(new URL("../ejemplos/veta.json", import.meta.url), "utf8"));
assert.equal(ej.error, undefined);
assert.equal(ej.producto, "Veta");
assert.equal(ej.epicas.length, 3);
assert.equal(ej.sueltas.length, 4);
assert.deepEqual(avance(ej.epicas[0]), { hecha: 3, curso: 2, pr: 1, bloqueada: 2, cola: 2, total: 10, sesiones: 5, esperan: 3 });
assert.equal(esperan(avance(ej.epicas[0])), "3 te esperan");
assert.equal(esperan(avance(ej.epicas[1])), "");
assert.equal(tono("algo nuevo"), "curso");

assert.equal(leer("x.json", "{ roto").error, "x.json: no es JSON válido");
assert.equal(leer("x.json", null).error, "x.json: no se pudo leer");
assert.equal(leer("x.json", "{}").error, 'x.json: falta "producto"');
assert.match(leer("x.json", '{"producto":"P","epicas":{}}').error, /listas/);
assert.match(leer("x.json", '{"producto":"P","sueltas":[{"id":"a1"}]}').error, /sin "titulo" \(a1\)/);
assert.deepEqual(leer("x.json", '{"producto":"P"}'), { archivo: "x.json", producto: "P", espacios: [], epicas: [], sueltas: [], decisiones: [], produccion: [], riesgos: [] });

// Orden por lo que pide acción: tareas bloqueada → PR → auditoría → en curso (y lo raro) → en cola → merged, estable.
assert.deepEqual(ej.epicas[0].tareas.map((t) => t.id.slice(-2)), ["t5", "t9", "ta", "t4", "t6", "tb", "tc", "t1", "t2", "t3"]);
assert.deepEqual(ej.sueltas.map((t) => t.estado), ["bloqueada", "PR abierto", "en curso", "en cola"]);
const T = (estado, n = "") => ({ titulo: `t${n}`, estado });
const E = (titulo, estado, ...tareas) => ({ titulo, estado, tareas });
const ord = leer("o.json", JSON.stringify({ producto: "O", sueltas: [T("merged"), T("raro", 1), T("en cola"), T("en curso", 2), T("auditoría")], epicas: [
  E("hecha", "atrasada", T("merged")), E("vacía", "a tiempo"), E("cola", "a tiempo", T("en cola")),
  E("pr a tiempo", "a tiempo", T("en cola"), T("PR abierto")), E("pr en riesgo", "en riesgo", T("PR abierto")), E("pr atrasada", "atrasada", T("PR abierto")),
  E("bloqueada", "a tiempo", T("merged"), T("bloqueada")) ] }));
assert.deepEqual(ord.sueltas.map((t) => t.titulo), ["t", "t1", "t2", "t", "t"]);
assert.deepEqual(ord.sueltas.map((t) => t.estado), ["auditoría", "raro", "en curso", "en cola", "merged"]);
assert.deepEqual(ord.epicas.map((e) => e.titulo), ["bloqueada", "pr atrasada", "pr en riesgo", "pr a tiempo", "cola", "hecha", "vacía"]);
// Productos: primero el que tiene algo bloqueado o en PR; si no, el orden de los archivos.
const P = (producto, estado) => leer(`${producto}.json`, JSON.stringify({ producto, sueltas: [T(estado)] }));
assert.deepEqual(ordenar([P("a", "en curso"), { archivo: "x", error: "x" }, P("b", "PR abierto"), P("c", "en cola"), P("d", "bloqueada")]).map((p) => p.producto || p.archivo),
  ["b", "d", "a", "x", "c"]);

// Tablero: una columna por estado, lo mergeado solo contado; un estado desconocido cae en «en curso».
const tb = tablero(ej);
assert.deepEqual(tb.columnas.map((c) => [c.estado, c.tareas.length]), [["en cola", 6], ["en curso", 3], ["auditoría", 1], ["PR abierto", 2], ["bloqueada", 3]]);
assert.equal(tb.merged, 4);
assert.equal(tb.columnas[4].tareas[0].de, "Órdenes de compra en causaciones");
assert.equal(tablero(leer("x.json", '{"producto":"P","sueltas":[{"titulo":"a","estado":"raro"}]}')).columnas[1].tareas[0].de, "Tarea suelta");

// Gantt con horas escritas: grupos por salida (horas de hoy primero), barra en % del eje (de las 07:00, la primera hora con
// algo, a las 21:00, la última), chip del ritmo o del estado.
const B = (h, m = 0) => Date.UTC(2026, 10, 5, h + 5, m); // 5-nov-2026 a las h:m de Bogotá, en ms
const g = gantt(ej, [], B(17) / 1000);
assert.deepEqual(g.grupos.map((x) => [x.titulo, x.filas.length]), [["Sale a las 12:00", 1], ["Sale a las 19:00", 4], ["Mañana o después", 2]]);
assert.deepEqual([g.h0, g.h1, g.ya, g.marcas], [7, 21, 17, [8, 10, 12, 14, 16, 18, 20]]);
assert.equal(g.grupos[0].filas[0].barras[0].x.toFixed(2), "3.57");
assert.equal(g.grupos[0].filas[0].barras[0].w.toFixed(2), "28.57");
assert.equal(g.grupos[0].filas[0].barras[0].texto, "07:30–11:30");
assert.equal(g.grupos[0].filas[0].hecha, true);
assert.equal(g.grupos[0].filas[0].enlace, "ClickUp");
assert.equal(chip(g.grupos[0].filas[0]), "listo");
assert.equal(tonoChip(g.grupos[1].filas[0]), "espera"); // dentro del bloque, también por urgencia
assert.equal(chip(g.grupos[1].filas[2]), "auditoría");
// Lo que no entra: sin horas medidas ni escritas (aunque traiga salida), u horas mal escritas. Sin nada, SIN_PLAN.
assert.deepEqual(gantt(leer("x.json", '{"producto":"P","sueltas":[{"titulo":"a"},{"titulo":"b","salida":"7 nov"}]}')).grupos, []);
assert.deepEqual(gantt(leer("x.json", '{"producto":"P","sueltas":[{"titulo":"a","salida":"7 nov","desde":"9","hasta":"25:00"}]}')).grupos, []);
assert.equal(gantt(leer("x.json", '{"producto":"P","sueltas":[{"titulo":"a","salida":"7 nov","desde":"09:00","hasta":"10:00"}]}')).grupos[0].titulo, "Sale 7 nov");

// Gantt con lo medido en herdr-task (la foto trae `medidas`): enlace por ref, sesion, PR o código del título, dentro
// de los espacios del producto; barras del trabajo, lo estimado, la espera a Juan; lo escrito manda; lo de ayer no entra.
const SP = "sp" + "a".repeat(32);
const M = (x) => ({ ref: "", titulo: "", estado: "done", space: SP, agentes: [], asiento: "claude opus", pr: "", fin: null, progreso: null, ready_at: null, done_at: null, ...x });
const medidas = [
  M({ ref: "HF-17", started: B(14, 8), ready_at: B(17, 25), done_at: B(17, 28), pr: "https://github.com/o/r/pull/17" }),
  M({ ref: "HF-18", started: B(14, 27), ready_at: B(15, 13), done_at: B(17, 24) }),
  M({ ref: "HF-19", estado: "running", started: B(15), progreso: { texto: "Pruebas del lector", at: B(16, 30), left: 3600000 } }),
  M({ ref: "HF-21", started: B(10), ready_at: B(12), done_at: B(12) }),
  M({ ref: "HF-9", started: B(9) - 86400000, ready_at: B(10) - 86400000, done_at: B(11) - 86400000 }),
  M({ ref: "V-1", estado: "ready", started: B(9), ready_at: B(12), agentes: ["t5q"] }),
  M({ ref: "V-2", titulo: "E4.1 · Sin popup", estado: "running", started: B(10), fin: B(11) }),
  M({ ref: "V-3", titulo: "E4.2 · Otra", estado: "running", started: B(10), space: "sp" + "b".repeat(32) }),
  M({ ref: "V-4", estado: "done", started: B(8), ready_at: B(9), done_at: B(9, 30), pr: "https://github.com/o/v/pull/4" }),
];
const S = (id, titulo, estado, x = {}) => ({ id, titulo, estado, ...x });
const hf = leer("hf.json", JSON.stringify({ producto: "HF", espacios: [SP], sueltas: [
  S("HF-17", "Chip", "merged"), S("HF-18", "Entorno", "merged", { desde: "14:00" }), S("HF-19", "Gantt", "en curso"),
  S("HF-21", "Escrita", "merged", { desde: "08:00", hasta: "09:00", salida: "12:00" }), S("HF-9", "Ayer", "merged"),
  S("86e1", "Por sesión", "en curso", { sesion: "t5q" }), S("86e2", "E4.1 · Sin popup", "en curso"), S("86e3", "E4.2 · Otra", "en curso"),
  S("86e4", "Por PR", "PR abierto", { link: "https://github.com/o/v/pull/4", equipo: "Backend" }), S("HF-30", "Sin horas", "en cola"),
] }));
const m = gantt(hf, medidas, B(17) / 1000);
const fila = (id) => m.grupos.flatMap((x) => x.filas).find((f) => f.id === id);
const textos = (id) => fila(id).barras.map((b) => `${b.texto}${b.estimada ? " ~" : ""}${b.hecha ? " °" : ""}`);
assert.deepEqual(m.grupos.map((x) => [x.titulo, x.filas.map((f) => f.id)]), [["Sale a las 12:00", ["HF-21"]], ["Hoy", ["86e4", "HF-19", "86e1", "86e2", "HF-17", "HF-18"]]]);
// HF-17: de cuando arrancó su agente a cuando quedó lista, tenue; lo que esperó a Juan (3 min) no se pinta: sería una
// astilla, y la nota dice a qué hora se mergeó (HF-20). Enlace y nota del store.
assert.deepEqual(textos("HF-17"), ["14:08–17:25 °"]);
assert.deepEqual([fila("HF-17").enlace, fila("HF-17").link, fila("HF-17").nota, chip(fila("HF-17")), fila("HF-17").quien],
  ["PR #17", "https://github.com/o/r/pull/17", "PR #17 · mergeada a las 17:28", "listo", ""]); // sin equipo, nada: no el modelo del asiento
assert.deepEqual(textos("HF-18"), ["14:00–15:13 °", "visto bueno °"]); // `desde` escrito manda sobre el inicio medido
assert.deepEqual(textos("HF-21"), ["08:00–09:00 °"]); // `desde` y `hasta` escritos mandan sobre todo lo medido
// En curso: llega hasta la raya de ahora, y lo que le falta va rayado; la nota es su línea de herdr-task status.
assert.deepEqual(textos("HF-19"), ["15:00–17:00", "falta ~30 min ~"]);
assert.ok(Math.abs(fila("HF-19").barras[0].x + fila("HF-19").barras[0].w - pos(m.ya, m.h0, m.h1)) < 1e-9);
assert.deepEqual([fila("HF-19").nota, chip(fila("HF-19"))], ["Pruebas del lector", "en curso"]);
assert.deepEqual([textos("86e1"), chip(fila("86e1")), fila("86e1").nota], [["09:00–12:00", "te espera"], "te espera", "lista a las 12:00 · espera tu visto bueno"]); // por sesion
assert.deepEqual([textos("86e2"), fila("86e2").nota], [["10:00–11:00"], "se detuvo a las 11:00"]); // por código del título; sus agentes ya no corren
assert.deepEqual([textos("86e4"), fila("86e4").quien, fila("86e4").hecha], [["08:00–09:00 °", "visto bueno °"], "Backend", true]); // por PR
assert.equal(fila("86e3"), undefined); // mismo código, otro espacio
assert.equal(fila("HF-9"), undefined); // de ayer
assert.equal(fila("HF-30"), undefined); // sin horas
// Revisión: el ref manda solo (otra tarea por sesion no se suma); lo trabajado hoy de madrugada estira el eje; una barra
// de un minuto termina en la raya de ahora, no después.
const sola = leer("r.json", JSON.stringify({ producto: "R", espacios: [SP], sueltas: [S("HF-1", "Una", "merged", { sesion: "t9" }), S("x", "Madrugada", "merged", { sesion: "t8" }), S("HF-3", "Recién", "en curso")] }));
const otras = [M({ ref: "HF-1", started: B(9), ready_at: B(10), done_at: B(10), pr: "https://github.com/o/r/pull/1" }), M({ ref: "HF-2", estado: "running", started: B(11), agentes: ["t9"] }),
  M({ ref: "HF-7", started: B(2), ready_at: B(3), done_at: B(3), agentes: ["t8"] }), M({ ref: "HF-3", estado: "running", started: B(16, 59) })];
const r = gantt(sola, otras, B(17) / 1000), deR = (id) => r.grupos[0].filas.find((f) => f.id === id);
assert.deepEqual([deR("HF-1").barras.map((b) => b.texto), deR("HF-1").enlace, deR("HF-1").hecha], [["09:00–10:00"], "PR #1", true]);
assert.deepEqual([r.h0, deR("x").barras[0].texto, deR("x").barras[0].x], [2, "02:00–03:00", 0]);
assert.ok(Math.abs(deR("HF-3").barras[0].x + deR("HF-3").barras[0].w - pos(r.ya, r.h0, r.h1)) < 1e-9);
// Segunda revisión: lo que cruza la medianoche se ve desde las 00:00; lo estimado en pausa (espera a Juan) se cuenta desde
// ahora; una barra recién empezada en el borde izquierdo no pasa de la raya de ahora.
const cruza = gantt(sola, [M({ ref: "HF-1", started: B(23) - 86400000, ready_at: B(3), done_at: B(3) })], B(17) / 1000);
assert.deepEqual([cruza.h0, cruza.grupos[0].filas[0].barras[0].x, cruza.grupos[0].filas[0].barras[0].texto], [0, 0, "ayer 23:00–03:00"]);
const pausa = gantt(sola, [M({ ref: "HF-3", estado: "running", started: B(9), progreso: { texto: "", at: B(10), left: 3600000, paused_at: B(10, 5) } })], B(12) / 1000);
assert.deepEqual(pausa.grupos[0].filas[0].barras.map((b) => b.texto), ["09:00–12:00", "falta ~55 min"]);
const borde = gantt(sola, [M({ ref: "HF-3", estado: "running", started: B(6) })], B(6, 1) / 1000), bb = borde.grupos[0].filas[0].barras[0];
assert.ok(bb.x === 0 && Math.abs(bb.w - pos(borde.ya, borde.h0, borde.h1)) < 1e-9);
assert.match(explicacion("rayada"), /rayada: lo que dice que le falta/);
// De noche el eje se estira hasta la hora actual (con un margen) y lo estimado, sin pasar de las 24.
const noche = gantt(hf, medidas, B(22, 13) / 1000);
assert.deepEqual([noche.h0, noche.h1, noche.ya.toFixed(2), noche.marcas], [8, 23, "22.22", [8, 10, 12, 14, 16, 18, 20, 22]]);
assert.equal(gantt(hf, medidas, B(23, 50) / 1000).h1, 24);
// HF-20: el eje cubre solo las horas con algo, al menos 4 h (una tarea de 10 a 11, a las 11:20: de 10 a 14, cada hora).
const corta = gantt(leer("c.json", '{"producto":"P","sueltas":[{"titulo":"a","desde":"10:00","hasta":"11:00"}]}'), [], B(11, 20) / 1000);
assert.deepEqual([corta.h0, corta.h1, corta.marcas], [10, 14, [10, 11, 12, 13, 14]]);
// HF-20: lo de ayer que apenas asoma (su agente paró a las 00:12) no es una astilla en las 00:00 ni estira el eje: la
// fila lo dice en texto. Lo que se trabajó de verdad pasada la medianoche (hasta las 03:00) sí se pinta.
const asoma = gantt(sola, [M({ ref: "HF-1", estado: "running", started: B(17, 40) - 86400000, fin: B(0, 12) }), M({ ref: "HF-3", estado: "running", started: B(9) })], B(11) / 1000);
const [a1, a3] = ["HF-1", "HF-3"].map((id) => asoma.grupos[0].filas.find((f) => f.id === id));
assert.deepEqual([a1.barras, a1.sinBarra, a1.nota, asoma.h0], [[], "sin trabajo hoy (ayer 17:40–00:12)", "se detuvo a las 00:12", 9]);
assert.equal(a3.sinBarra, "");
// Revisión de codex: trabajó ayer, quedó lista a las 23:59 y se mergeó a las 00:05: no tiene tramo hoy, pero entra (y va
// en «Listo hoy») con su texto.
const anoche = gantt(sola, [M({ ref: "HF-1", started: B(22) - 86400000, ready_at: B(23, 59) - 86400000, done_at: B(0, 5) })], B(11) / 1000);
assert.deepEqual([anoche.grupos[0].filas[0].sinBarra, pie(sola, anoche).produccion.items], ["sin trabajo hoy (ayer 22:00–23:59)", ["Una · terminada a las 00:05"]]);
assert.equal(cruza.grupos[0].filas[0].sinBarra, "");
// HF-20: los rótulos del eje no chocan ni se salen de la pista: primero ahora, después las salidas (con nombre), al final
// las horas. A las 22:13 en 520 px caben las dos salidas; en 300 px, la de las 19 no cabe junto a ahora y se van las
// horas que chocan con la de las 12.
const rot = (g, w) => eje(g, w).map((r) => r.texto);
assert.deepEqual(rot(noche, 520), ["08:00", "10:00", "salida 12:00", "14:00", "16:00", "salida 19:00", "ahora 22:13"]);
assert.deepEqual(rot(noche, 300), ["08:00", "salida 12:00", "16:00", "18:00", "ahora 22:13"]);
for (const [g, w] of [[noche, 300], [noche, 140], [m, 520], [corta, 200]]) {
  const rs = eje(g, w), px = (r) => (r.x / 100) * w;
  assert.ok(rs.every((r) => px(r) >= 0 && px(r) + r.w <= w + 1e-9), "dentro de la pista");
  assert.ok(rs.every((r, i) => i === 0 || px(rs[i - 1]) + rs[i - 1].w <= px(r)), "sin chocar");
  assert.ok(g.ya == null || rs.some((r) => r.tipo === "ahora"), "ahora siempre");
}
assert.deepEqual(eje(noche, 300).map((r) => r.ancla), ["izq", "centro", "centro", "centro", "der"]);
// HF-20: el texto de una barra va dentro si cabe; si no, al lado, donde haya sitio; lo de `sinBarra`, desde la izquierda.
const tf = textosFila(fila("HF-17"), 520);
assert.deepEqual([tf.barras.map((b) => b.dentro), tf.fuera], [[true], null]);
const angosta = textosFila(fila("HF-17"), 120);
assert.deepEqual([angosta.barras[0].dentro, angosta.fuera.texto, angosta.fuera.ancla], [false, "14:08–17:25", "der"]); // a la derecha no hay sitio: antes de la barra
// Si solo la primera barra no cabe (el trabajo, antes de una espera larga), su texto va antes de ella, no tras la espera.
const dos = textosFila({ sinBarra: "", barras: [{ x: 25, w: 5, texto: "02:59–03:39" }, { x: 30, w: 54, texto: "visto bueno" }] }, 545);
assert.deepEqual([dos.barras.map((b) => b.dentro), dos.fuera.ancla, dos.fuera.texto], [[false, true], "der", "02:59–03:39"]);
assert.deepEqual(textosFila(a1, 300).fuera, { texto: "sin trabajo hoy (ayer 17:40–00:12)", x: (4 / 300) * 100, w: 100 - (4 / 300) * 100, ancla: "izq" });
// El pie: lo listo hoy (o `produccion` del TPM), los riesgos (o `riesgos`) y las decisiones que esperan.
assert.deepEqual(pie(hf, m), { produccion: { titulo: "Listo hoy", items: ["Escrita · terminada a las 12:00", "Por PR · PR #4 · mergeada a las 09:30", "Chip · PR #17 · mergeada a las 17:28", "Entorno · terminada a las 17:24"] }, riesgos: [], decisiones: 0 });
const conPie = leer("p.json", JSON.stringify({ producto: "P", produccion: ["Release 1.217.0"], riesgos: "R019 atrasado", sueltas: [S("a", "Frenada", "bloqueada", { nota: "espera a Charlie" })] }));
assert.deepEqual(pie(conPie, gantt(conPie)), { produccion: { titulo: "Ya en producción", items: ["Release 1.217.0"] }, riesgos: ["R019 atrasado"], decisiones: 0 });
assert.deepEqual(pie({ ...conPie, riesgos: [] }, gantt(conPie)).riesgos, ["Frenada: espera a Charlie"]);
assert.equal(hhmm(-0.5), "ayer 23:30");
// La leyenda: los cinco chips del artefacto, cada uno con el tono que le da tonoChip.
assert.deepEqual(LEYENDA.map(([c]) => c), ["listo", "a tiempo", "en riesgo", "atrasado", "te espera"]);
assert.ok(LEYENDA.every(([c, t]) => tonoChip({ ritmo: c }) === t));
// Hora de Bogotá: 2026-11-04 19:30 UTC son las 14:30 allá; a las 03:00 queda fuera del eje.
assert.equal(ahora(Date.UTC(2026, 10, 4, 19, 30) / 1000), 14.5);
assert.equal(ahora(Date.UTC(2026, 10, 4, 8, 0) / 1000), null);

// Texto libre: con una opción, solo (respuesta ""), o vacío (no cuenta); dicha() lo junta en una línea.
const libre = (m) => leer("x.json", JSON.stringify({ producto: "P", decisiones: [{ id: "a", pregunta: "¿?", opciones: ["Sí", "No"] }] }), JSON.stringify({ a: m })).decisiones[0];
assert.deepEqual([libre({ respuesta: "Sí", texto: "pero mañana" }).estado, dicha(libre({ respuesta: "Sí", texto: "pero mañana" }))], ["respondida", "Sí — pero mañana"]);
assert.deepEqual([libre({ respuesta: "", texto: " ninguna " }).estado, dicha(libre({ respuesta: "", texto: " ninguna " }))], ["respondida", "ninguna"]);
assert.equal(libre({ respuesta: "", texto: "  " }).estado, "abierta");
// Decisiones: abiertas primero (las que frenan antes), luego respondidas y cerradas; la respuesta dada en Herdr encima.
assert.deepEqual(ej.decisiones.map((d) => [d.id, d.estado]), [["D9", "abierta"], ["D7", "abierta"], ["D5", "respondida"]]);
assert.equal(abiertas(ej), 2);
const veta = readFileSync(new URL("../ejemplos/veta.json", import.meta.url), "utf8");
const conMia = leer("veta.json", veta, JSON.stringify({ D7: { respuesta: "Hoy", at: 1, desde: "web" }, D9: { respuesta: "otra cosa" } }));
assert.deepEqual(conMia.decisiones.map((d) => [d.id, d.estado, d.respuesta]), [["D9", "abierta", ""], ["D7", "respondida", "Hoy"], ["D5", "respondida", "90 días"]]);
assert.equal(abiertas(conMia), 1);
assert.equal(cuantas(1), "1 abierta"); assert.equal(cuantas(0), "0 abiertas");
assert.equal(leer("veta.json", veta, "{ roto").decisiones.length, 3); // respuestas rotas: se ignoran
const D = (x) => leer("x.json", JSON.stringify({ producto: "P", decisiones: x }));
assert.match(D({}).error, /"decisiones" va como lista/);
assert.match(D([{ id: "D1" }]).error, /sin "id" o sin "pregunta" \(D1\)/);
assert.deepEqual(D([{ id: 3, pregunta: "¿?", estado: "raro" }]).decisiones[0], { id: "3", pregunta: "¿?", opciones: [], recomendada: "", contexto: "", de: "", tarea: "", frena: false, estado: "abierta", respuesta: "", texto: "" });
// Una cerrada no cambia con lo de Herdr.
assert.equal(leer("x.json", JSON.stringify({ producto: "P", decisiones: [{ id: "a", pregunta: "¿?", opciones: ["Sí", "No"], estado: "cerrada", respuesta: "No" }] }),
  JSON.stringify({ a: { respuesta: "Sí" } })).decisiones[0].respuesta, "No");

// Por espacio: cada espacio ve los productos que nombran su id en `espacios`; Home (por su carpeta, no su nombre) ve
// todos, en el orden por urgencia; sin `espacios`, solo Home. Un archivo mal escrito sigue en sus espacios; uno ilegible, solo en Home.
const FLOTA = "sp65efc7c291fa3ed20d36630bd68c7ef3", VETA = "spb83c5f1d4731ea1f84df503dfb0f14eb", FRONT = "sp0123456789abcdef0123456789abcdef";
const F = (producto, espacios, estado = "en curso") => leer(`${producto}.json`, JSON.stringify({ producto, espacios, sueltas: [T(estado)] }));
const todos = ordenar([F("flota", [FLOTA]), F("veta", [{ id: VETA, nombre: "Backend & Web" }, FRONT], "bloqueada"), F("suelto", undefined),
  leer("roto.json", `{"producto":"R","espacios":["${FLOTA}"],"epicas":{}}`), leer("ilegible.json", "{ roto")]);
const ve = (e) => delEspacio(todos, e).map((p) => p.producto || p.archivo);
assert.deepEqual(ve({ id: "sp8ea65d7f19a5d6aacbbfdd484991b0e3", home: true }), ["veta", "flota", "suelto", "roto.json", "ilegible.json"]);
assert.deepEqual(ve(null), ve({ id: "x", home: true }));
assert.deepEqual(ve({ id: FLOTA, home: false }), ["flota", "roto.json"]);
assert.deepEqual(ve({ id: VETA, home: false }), ["veta"]);
assert.deepEqual(ve({ id: FRONT, home: false }), ["veta"]);
assert.deepEqual(ve({ id: "sp704097cca7bb40b2f92afc705822b649", home: false }), []); // el panel muestra SIN_INICIATIVAS
assert.equal(SIN_INICIATIVAS, "Este espacio no tiene iniciativas");
// Renombrar un espacio no cambia lo que ve: el panel pasa el id del espacio abierto, y el nombre no entra.
const abierto = (s) => ({ id: s.id, home: esHome(s.folder) });
const antes = { id: VETA, name: "veta-backend-fastapi", folder: "/Users/juanfer/Codes/Letz/veta-backend-fastapi" };
assert.deepEqual(ve(abierto({ ...antes, name: "Backend & Web" })), ve(abierto(antes)));
assert.deepEqual(ve(abierto({ ...antes, name: "Backend & Web" })), ["veta"]);
// Un espacio que se llama como otro no ve sus iniciativas.
assert.deepEqual(ve(abierto({ id: "sp704097cca7bb40b2f92afc705822b649", name: "herdr-flota", folder: "/x" })), []);
// Archivos viejos con nombres: un aviso de una línea, sin adivinar; el producto se sigue viendo en Home y en los espacios
// que sí van por id.
const viejo = leer("veta.json", `{"producto":"Veta","espacios":["Backend & Web",{"nombre":"veta-frontend"},"${FLOTA}"]}`);
assert.equal(viejo.error, undefined);
assert.equal(viejo.aviso, 'veta.json: "espacios" lleva ids de espacio (sp…, en herdr-app ls), no nombres: «Backend & Web», «veta-frontend»');
assert.deepEqual(viejo.espacios, [FLOTA]);
assert.deepEqual(delEspacio([viejo], { id: FLOTA, home: false }).length, 1);
assert.deepEqual(delEspacio([leer("v.json", '{"producto":"V","espacios":["Backend & Web"]}')], { id: VETA, home: false }), []);
assert.equal(F("ok", [FLOTA]).aviso, undefined);
assert.match(leer("x.json", `{"producto":"P","espacios":"${FLOTA}"}`).error, /"espacios" va como lista de ids/);
assert.match(leer("x.json", '{"producto":"P","espacios":[3,""]}').aviso, /no nombres: «\?», «»/);
assert.deepEqual(leer("x.json", `{"producto":"P","espacios":["${FLOTA}",{"id":"${VETA}","nombre":"lo que sea"}]}`).espacios, [FLOTA, VETA]);
assert.deepEqual(leer("x.json", '{"producto":"P","espacios":null}').espacios, []);
assert.deepEqual(["/Users/juanfer", "/home/u/", "/root", "", "~"].map(esHome), [true, true, true, true, true]);
assert.deepEqual(["/Users/juanfer/Codes", "~/Codes/x", "/srv/u"].map(esHome), [false, false, false]);
console.log("ok");
