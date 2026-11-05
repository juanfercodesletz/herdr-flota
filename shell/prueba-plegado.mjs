// node shell/prueba-plegado.mjs: el plegado de Entorno (mods/flota-entorno/main.js) con herdr y gpui de mentira.
// layout.resize cambia el ancho del bloque como lo haría Herdr; prueba el clic de plegar y de abrir, el ancho que
// recuerda y el punto de color de la tira. Que Herdr guarde ese ancho entre reinicios no se prueba aquí.
import assert from "node:assert/strict";
import { register } from "node:module";

// Un elemento de gpui: guarda id, fondo, hijos y el clic; `when` corre su función si se cumple.
const EL = `
const mk = () => { const o = { kids: [], idv: undefined, bgv: undefined, click: undefined };
  const p = new Proxy(o, { get: (o, k) => k in o ? o[k] : (...a) => {
    if (k === "id") o.idv = a[0]; else if (k === "bg") o.bgv = a[0]; else if (k === "on_click") o.click = a[0];
    else if (k === "child") o.kids.push(a[0]); else if (k === "children") o.kids.push(...a[0]);
    else if (k === "when" && a[0]) a[1](p);
    return p; } });
  return p; };
`;
const MODS = {
  "gpui-kit": EL + "export class View {}; export const div = () => mk(); export const svg = () => mk();",
  "gpui-base": EL + "export const h_flex = () => mk(); export const v_flex = () => mk();",
  herdr: `const g = globalThis.H;
    export const layout = () => ({ id: "root", children: [{ id: "work" }, { id: "entorno", size: { px: g.px } }] });
    export const run = (n, a) => g.runs.push([n, a]) && n === "layout.resize" && (g.px = a.px);
    export const shared = (k) => g.shared[k]; export const setShared = (k, v) => (g.shared[k] = v);
    export const theme = () => ({ blocked: "ROJO", working: "AMBAR", muted: "GRIS", dim: "GRIS", border: "B", foreground: "F", chrome: "C", hover: "H" });
    export const agents = () => []; export const spaces = () => [];
    export const exec = async () => ({ stdout: "" }); export const readTextFile = async () => null;
    export const home = () => "/x"; export const appHome = () => "/x";`,
};
register("data:text/javascript," + encodeURIComponent(`
const MODS = ${JSON.stringify(MODS)};
export const resolve = (s, c, next) => s in MODS ? { url: "data:text/javascript," + encodeURIComponent(MODS[s]), shortCircuit: true } : next(s, c);`));

globalThis.H = { px: 284, runs: [], shared: {} };
const { default: Entorno } = await import("../mods/flota-entorno/main.js");
const v = Object.assign(new Entorno(), { cap: { ccw: 90, ccp: 90, codex: 100, cpu: 85, ram: 90, sesiones: 100, start_disk: 95 }, seats: {}, mac: null, disk: null, perfiles: null });
const find = (e, id) => e?.idv === id ? e : (e?.kids || []).reduce((r, k) => r || find(k, id), null);
const dot = (r) => r.kids.find((k) => k.bgv === "ROJO" || k.bgv === "AMBAR")?.bgv;

// Abierto: el panel entero, con su botón Plegar. Un clic → 44 px y guarda el ancho que tenía.
let r = v.render();
assert.equal(r.idv, "root");
find(r, "plegar").click();
assert.equal(H.px, 44);
assert.equal(H.shared["entorno.width"], 284);

// Plegado: la tira, sin punto si todo está bajo su techo. Un clic → vuelve a 284.
r = v.render();
assert.equal(r.idv, "rail");
assert.equal(dot(r), undefined);
r.click();
assert.equal(H.px, 284);
assert.equal(v.render().idv, "root");

// Plegada con algo encima del techo: punto rojo; cerca (a 10 puntos): ámbar.
H.px = 44;
const mac = (cpu) => ({ cpu, ramGb: 48, ramUsedGb: 20, diskPct: 50, diskFreeGb: 500, diskTotalGb: 1000, tui: 0, at: Date.now() / 1000 });
v.mac = mac(90); assert.equal(dot(v.render()), "ROJO");
v.mac = mac(80); assert.equal(dot(v.render()), "AMBAR");
v.mac = mac(30); assert.equal(dot(v.render()), undefined);

// Arrastrar el borde por debajo de 160 también la pliega; sin ancho guardado abre a 260.
H.px = 120; H.shared = {};
r = v.render();
assert.equal(r.idv, "rail");
r.click();
assert.equal(H.px, 260);
assert.ok(H.runs.every(([n, a]) => n === "layout.resize" && a.id === "entorno"));
console.log("prueba-plegado: ok");
