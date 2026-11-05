// node shell/prueba-iniciativas.mjs: el lector de ~/.herdr/flota/<producto>.json con el ejemplo y con archivos malos.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leer, avance, tono } from "../mods/flota-iniciativas/iniciativas.js";

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
console.log("ok");
