// node shell/prueba-gantt-app.mjs: el Gantt del panel del escritorio (mods/flota-iniciativas/main.js) con herdr y gpui de
// mentira. Arriba la explicación y la leyenda; al pie las decisiones, que se responden con una opción, con texto o con
// los dos por respuestas.py guardar; un campo que Juan no tocó toma el texto leído (dado en el teléfono) y uno que está
// escribiendo no se pisa (HF-19, revisión de codex). ~1 s.
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

const EL = `const mk = () => { const o = { kids: [] }; const p = new Proxy(o, { get: (o, k) => k in o ? o[k] : (...a) => {
  if (k === "child") o.kids.push(a[0]); else if (k === "children") o.kids.push(...a[0]); else if (k === "when" && a[0]) a[1](p);
  else if (k === "on_click") o.click = a[0]; else if (k === "id") o.idv = a[0]; else if (k === "flex_none") o.none = true;
  return p; } }); return p; };`;
const MODS = {
  "gpui-kit": EL + "export class View {}; export const div = () => mk(); export const svg = () => mk();",
  "gpui-base": EL + `export const h_flex = () => mk(); export const v_flex = () => mk(); export const Input = { new: () => mk() };
    export const InputState = { new: (o) => ({ v: o.value || "", value() { return this.v; }, on() {}, set_value(x) { this.v = x; } }) };`,
  herdr: `export const theme = () => new Proxy({}, { get: (_, k) => "#" + String(k) });
    export const spaces = () => []; export const props = () => ({}); export const layout = () => ({}); export const run = () => {};
    export const exec = async (...a) => { globalThis.LLAMADAS.push(a[1]); return { stdout: "{}", code: 0 }; };
    export const home = () => "/x"; export const appHome = () => "/app";`,
};
register("data:text/javascript," + encodeURIComponent(`const MODS = ${JSON.stringify(MODS)};
export const resolve = (s, c, next) => s in MODS ? { url: "data:text/javascript," + encodeURIComponent(MODS[s]), shortCircuit: true } : next(s, c);`));

globalThis.LLAMADAS = [];
const { default: Iniciativas } = await import("../mods/flota-iniciativas/main.js");
const { leer } = await import("../mods/flota-iniciativas/iniciativas.js");
const texto = readFileSync(new URL("../ejemplos/veta.json", import.meta.url), "utf8");
const producto = (respuestas) => ({ ...leer("veta.json", texto, respuestas && JSON.stringify(respuestas)), at: 1 });
const v = Object.assign(new Iniciativas(), { boton: false, medidas: [], leido: 1793934000, vista: "gantt", ancho: 800, aviso: "", abierta: null });
const leerDe = (p) => { v.productos = [p]; v.entradasDe(v.productos); };
const find = (e, id) => e?.idv === id ? e : (e?.kids || []).reduce((r, k) => r || find(k, id), null);
const textos = (e) => typeof e === "string" ? [e] : (e?.kids || []).flatMap(textos);
// Un clic: guarda (respuestas.py) y vuelve a leer, que aquí deja la lista vacía; la reponemos con la foto que toque.
const clic = async (id, despues) => {
  find(v.render(), id).click(null, { spawn: (fn) => fn({ notify() {} }), notify() {} });
  await new Promise((ok) => setTimeout(ok, 20));
  leerDe(despues);
  return LLAMADAS.filter((a) => a[0]?.endsWith("respuestas.py")).at(-1).slice(1);
};

leerDe(producto());
const t = textos(v.render());
// La explicación corta y la leyenda, al pie (antes de las decisiones), no arriba; y nada de la lista se encoge (HF-20:
// sin flex_none, gpui encogía las filas y el pie dentro de la lista con desplazamiento, y su texto se pisaba).
const ex = t.findIndex((x) => /^Cada barra va de cuando arrancó su agente/.test(x));
assert.ok(ex > t.indexOf("Riesgos") && ex < t.indexOf("Decisiones que esperan por ti"), "la explicación al pie");
assert.ok(["listo", "te espera", "necesita tu visto bueno"].every((x) => t.includes(x)), "leyenda de los chips");
const lista = find(v.render(), "lista");
assert.ok(lista.kids.length > 3 && lista.kids.every((k) => k.none), "ningún hijo de la lista se encoge");
// D7: sus opciones, Hoy y Mañana (las decisiones que frenan van antes en la lista).
const D7 = v.productos[0].decisiones.findIndex((d) => d.id === "D7"), op = (j) => `opcion-veta.json-${D7}-${j}`;
assert.deepEqual(await clic(op(0), producto()), ["guardar", "veta.json", "D7", "Hoy", "app", ""]);

// Juan escribió en el teléfono: el campo, que no tocó, toma ese texto, y cambiar de opción en la app lo conserva.
leerDe(producto({ D7: { respuesta: "Hoy", texto: "solo para La Despensa" } }));
assert.equal(v.entradas["veta.json#D7"].value(), "solo para La Despensa");
assert.deepEqual(await clic(op(1), producto({ D7: { respuesta: "Mañana", texto: "solo para La Despensa" } })), ["guardar", "veta.json", "D7", "Mañana", "app", "solo para La Despensa"]);

// Lo que está escribiendo no se pisa con una lectura nueva; Enviar lo guarda con la opción que ya tiene.
v.entradas["veta.json#D7"].set_value("mejor el lunes");
leerDe(producto({ D7: { respuesta: "Mañana", texto: "otra cosa" } }));
assert.equal(v.entradas["veta.json#D7"].value(), "mejor el lunes");
assert.deepEqual(await clic(`enviar-veta.json-${D7}`, producto()), ["guardar", "veta.json", "D7", "Mañana", "app", "mejor el lunes"]);
// Ya guardado desde la app, lo que llegue después desde el teléfono también se pone en el campo (ronda 3 de codex):
// elegir otra opción en la app lo conserva, no vuelve a mandar lo de la app.
leerDe(producto({ D7: { respuesta: "Mañana", texto: "mejor el lunes" } }));
leerDe(producto({ D7: { respuesta: "Mañana", texto: "desde el teléfono" } }));
assert.equal(v.entradas["veta.json#D7"].value(), "desde el teléfono");
assert.deepEqual(await clic(op(0), producto()), ["guardar", "veta.json", "D7", "Hoy", "app", "desde el teléfono"]);
console.log("ok");
