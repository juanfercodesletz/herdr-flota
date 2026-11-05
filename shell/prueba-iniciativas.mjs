// node shell/prueba-iniciativas.mjs: el lector de ~/.herdr/flota/<producto>.json con el ejemplo y con archivos malos.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leer, avance, tono, tablero, gantt, ahora, chip, tonoChip, ordenar, esperan, abiertas, cuantas } from "../mods/flota-iniciativas/iniciativas.js";

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
assert.deepEqual(leer("x.json", '{"producto":"P"}'), { archivo: "x.json", producto: "P", epicas: [], sueltas: [], decisiones: [] });

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

// Gantt: grupos por salida (horas de hoy primero), barra en % del eje 06–21, chip del ritmo o del estado.
const g = gantt(ej);
assert.deepEqual(g.map((x) => [x.titulo, x.filas.length]), [["Sale a las 12:00", 1], ["Sale a las 19:00", 4], ["Mañana o después", 2]]);
assert.equal(g[0].filas[0].barra.x, 10);
assert.equal(g[0].filas[0].barra.w.toFixed(2), "26.67");
assert.equal(g[0].filas[0].hecha, true);
assert.equal(chip(g[0].filas[0]), "listo");
assert.equal(tonoChip(g[1].filas[0]), "espera"); // dentro del bloque, también por urgencia
assert.equal(chip(g[1].filas[2]), "auditoría");
// Sin los campos opcionales no hay grupos (el panel lo dice en una línea); horas malas, sin barra.
assert.deepEqual(gantt(leer("x.json", '{"producto":"P","sueltas":[{"titulo":"a"}]}')), []);
assert.equal(gantt(leer("x.json", '{"producto":"P","sueltas":[{"titulo":"a","salida":"7 nov","desde":"9","hasta":"25:00"}]}'))[0].filas[0].barra, null);
assert.equal(gantt(leer("x.json", '{"producto":"P","sueltas":[{"titulo":"a","salida":"7 nov"}]}'))[0].titulo, "Sale 7 nov");
// Hora de Bogotá: 2026-11-04 19:30 UTC son las 14:30 allá; a las 03:00 queda fuera del eje.
assert.equal(ahora(Date.UTC(2026, 10, 4, 19, 30) / 1000), 14.5);
assert.equal(ahora(Date.UTC(2026, 10, 4, 8, 0) / 1000), null);

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
assert.deepEqual(D([{ id: 3, pregunta: "¿?", estado: "raro" }]).decisiones[0], { id: "3", pregunta: "¿?", opciones: [], recomendada: "", contexto: "", de: "", tarea: "", frena: false, estado: "abierta", respuesta: "" });
// Una cerrada no cambia con lo de Herdr.
assert.equal(leer("x.json", JSON.stringify({ producto: "P", decisiones: [{ id: "a", pregunta: "¿?", opciones: ["Sí", "No"], estado: "cerrada", respuesta: "No" }] }),
  JSON.stringify({ a: { respuesta: "Sí" } })).decisiones[0].respuesta, "No");
console.log("ok");
