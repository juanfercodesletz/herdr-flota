// node shell/prueba-iniciativas.mjs: el lector de ~/.herdr/flota/<producto>.json con el ejemplo y con archivos malos.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leer, avance, tono, tablero, gantt, ahora, chip, tonoChip } from "../mods/flota-iniciativas/iniciativas.js";

const ej = leer("veta.json", readFileSync(new URL("../ejemplos/veta.json", import.meta.url), "utf8"));
assert.equal(ej.error, undefined);
assert.equal(ej.producto, "Veta");
assert.equal(ej.epicas.length, 3);
assert.equal(ej.sueltas.length, 4);
assert.deepEqual(avance(ej.epicas[0]), { hecha: 3, curso: 2, pr: 1, bloqueada: 2, cola: 2, total: 10, sesiones: 5 });
assert.equal(tono("algo nuevo"), "curso");

assert.equal(leer("x.json", "{ roto").error, "x.json: no es JSON válido");
assert.equal(leer("x.json", null).error, "x.json: no se pudo leer");
assert.equal(leer("x.json", "{}").error, 'x.json: falta "producto"');
assert.match(leer("x.json", '{"producto":"P","epicas":{}}').error, /listas/);
assert.match(leer("x.json", '{"producto":"P","sueltas":[{"id":"a1"}]}').error, /sin "titulo" \(a1\)/);
assert.deepEqual(leer("x.json", '{"producto":"P"}'), { archivo: "x.json", producto: "P", epicas: [], sueltas: [] });

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
assert.equal(tonoChip(g[1].filas[1]), "espera");
assert.equal(chip(g[1].filas[0]), "auditoría");
// Sin los campos opcionales no hay grupos (el panel lo dice en una línea); horas malas, sin barra.
assert.deepEqual(gantt(leer("x.json", '{"producto":"P","sueltas":[{"titulo":"a"}]}')), []);
assert.equal(gantt(leer("x.json", '{"producto":"P","sueltas":[{"titulo":"a","salida":"7 nov","desde":"9","hasta":"25:00"}]}'))[0].filas[0].barra, null);
assert.equal(gantt(leer("x.json", '{"producto":"P","sueltas":[{"titulo":"a","salida":"7 nov"}]}'))[0].titulo, "Sale 7 nov");
// Hora de Bogotá: 2026-11-04 19:30 UTC son las 14:30 allá; a las 03:00 queda fuera del eje.
assert.equal(ahora(Date.UTC(2026, 10, 4, 19, 30) / 1000), 14.5);
assert.equal(ahora(Date.UTC(2026, 10, 4, 8, 0) / 1000), null);
console.log("ok");
