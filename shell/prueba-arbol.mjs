// node shell/prueba-arbol.mjs: estados, orden, resumen y agrupado por épica del árbol de productos.
import assert from "node:assert/strict";
import { estado, VIVA, ordenar, resumen, agrupar } from "../mods/flota-arbol/arbol.js";
import { leer } from "../mods/flota-iniciativas/iniciativas.js";

assert.equal(estado("needs"), "need"); // herdr-task
assert.equal(estado("blocked"), "need"); // hc
assert.equal(estado("work"), "work"); // la web
assert.equal(estado(null), "idle");
assert.deepEqual(["needs", "ready", "merging", "working", "queued", "todo", "done"].filter(VIVA), ["needs", "ready", "merging", "working"]);

const s = (ref, e, alias = "") => ({ clave: ref, ref, titulo: ref, estado: e, alias });
const ses = [s("A-1", "work"), s("A-2", "need"), s("", "idle", "pestaña"), s("A-3", "ready")];
assert.deepEqual(ordenar(ses).map((x) => x.estado), ["need", "ready", "work", "idle"]);
assert.deepEqual(resumen(ses, { estado: "work" }), { texto: "1 needs you", estado: "need" });
assert.deepEqual(resumen([s("A-1", "work")], { estado: "work" }), { texto: "2 working", estado: "work" });
assert.deepEqual(resumen([], null), { texto: "", estado: "idle" });

const p = leer("a.json", JSON.stringify({ producto: "a", epicas: [
  { titulo: "Vacía", tareas: [{ id: "A-9", titulo: "x" }] },
  { titulo: "Buscador", tareas: [{ id: "A-1", titulo: "x" }, { id: "otra", titulo: "y", sesion: "s22b" }] },
] }));
const g = agrupar([s("A-1", "work"), s("", "need", "s22b"), s("A-5", "ready")], p);
assert.deepEqual(g.map((x) => [x.epica?.titulo ?? null, x.sesiones.map((y) => y.ref || y.alias)]), [["Buscador", ["A-1", "s22b"]], [null, ["A-5"]]]);
assert.deepEqual(agrupar([s("A-1", "work")], null).map((x) => x.epica), [null]);
assert.deepEqual(agrupar([], p), []);
console.log("ok");
