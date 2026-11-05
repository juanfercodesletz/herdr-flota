#!/bin/zsh -f
# Entorno y Shepherdr dicen lo mismo del disco: el mismo % lleno, el mismo start_disk y el rojo en el mismo
# punto en que Shepherdr deja de arrancar tareas (moviendo el límite, no llenando el disco). Y la barra en la
# escala de lo usable (flota + libres) con la raya donde Shepherdr frena: el caso de hoy y los bordes. Solo lee.
# Uso: zsh shell/prueba-disco.zsh
calc=${0:a:h:h}/mods/flota-entorno/calc.js
bin=${SHEPHERDR_TASKS_BIN:-$HOME/.config/herdr-app/mods/tasks/bin}
h0=$(PYTHONPATH=$bin python3 -c "from herdr_task.machine import sample; print(sample()['disk'])")
node --input-type=module - $calc =(cat ~/.herdr/shepherdr.json 2>/dev/null || echo '{}') <<'EOF' > ${TMPDIR:-/tmp}/entorno-$$.json || exit 1
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const { DISCO, discoStat, startDisk, disco, level } = await import("file://" + process.argv[2]);
const m = discoStat(execFileSync("python3", ["-c", DISCO], { encoding: "utf8" })), lim = startDisk(JSON.parse(readFileSync(process.argv[3], "utf8")));
const now = Date.now() / 1000, flota = { at: now, wt: 22, uv: 14, docker: 18, total: 54 };
const caso = (n, f) => { try { f(); console.error("ok:", n); } catch (e) { console.error("FALLA:", n, "-", e.message); process.exitCode = 1; } };
// El de hoy: disco de 460 GB, flota 54, libres 46, start_disk 95 (Shepherdr frena con 95.5 % lleno: 20.7 GB libres).
const hoy = { diskPct: 90, diskFreeGb: 46, diskTotalGb: 460 };
caso("hoy: 54% de 100 GB usables, raya ≈79%, faltan ≈25 GB", () => {
  const r = disco(hoy, flota, 95, now);
  assert.equal(r.val, "54%"); assert.equal(Math.round(r.c), 79); assert.equal(r.right, "79%"); assert.equal(level(r.pct, r.c), "ok");
  assert.match(r.note, /^faltan 25 GB para el límite · flota 54 de 100 GB usables \(worktrees 22 · uv 14 · Docker 18\) · libres 46 GB$/); assert.equal(r.warn, "");
});
caso("sin start_disk: sin raya ni «faltan», nunca rojo", () => {
  const r = disco({ diskPct: 99, diskFreeGb: 3, diskTotalGb: 460 }, flota, null, now);
  assert.equal(r.right, "sin límite"); assert.ok(r.c > 100); assert.notEqual(level(r.pct, r.c), "over"); assert.equal(r.warn, ""); assert.doesNotMatch(r.note, /faltan/);
});
caso("flota midiendo: sin barra, «faltan» igual", () => {
  const r = disco(hoy, null, 95, now);
  assert.equal(r.val, "—"); assert.equal(level(r.pct, r.c), "none"); assert.match(r.note, /^faltan 25 GB para el límite · flota: midiendo… · libres 46 GB$/);
});
caso("flota midiendo y pasado: rojo con aviso", () => {
  const r = disco({ diskPct: 97, diskFreeGb: 14, diskTotalGb: 460 }, null, 95, now);
  assert.equal(level(r.pct, r.c), "over"); assert.equal(r.warn, "Pasado 7 GB del límite: Shepherdr no arranca tareas nuevas");
});
caso("pasado: «pasado N GB», rojo, sin «faltan»", () => {
  const r = disco({ diskPct: 97, diskFreeGb: 14, diskTotalGb: 460 }, { ...flota, total: 86 }, 95, now);
  assert.equal(level(r.pct, r.c), "over"); assert.equal(r.warn, "Pasado 7 GB del límite: Shepherdr no arranca tareas nuevas"); assert.doesNotMatch(r.note, /faltan/);
});
caso("libres al límite más que lo usable: raya en 0, rojo", () => {
  const r = disco({ diskPct: 98, diskFreeGb: 5, diskTotalGb: 460 }, { ...flota, total: 3 }, 95, now);
  assert.equal(r.c, 0); assert.equal(level(r.pct, r.c), "over"); assert.match(r.warn, /^Pasado 16 GB del límite/);
});
caso("flota vieja: «medido hace…»", () => assert.match(disco(hoy, { ...flota, at: now - 7200 }, 95, now).note, /medido hace 2 h$/));
// Rojo de Entorno para cada % y cada límite, en un disco de 460 GB lleno en décimas (el redondeo a % y a GB
// mueve lo libre dentro de cada %), con la flota medida y midiendo: todas las variantes de un % deben coincidir.
const red = {};
for (let u = 79.5; u < 100.5; u += 0.1) for (let l = 85; l <= 98; l++) for (const d of [{ ...flota, total: 40 }, null]) {
  const x = { diskPct: Math.round(u), diskFreeGb: Math.round(460 * (100 - u) / 100), diskTotalGb: 460 };
  const r = disco(x, d, l, now), k = `${x.diskPct}/${l}`, v = [level(r.pct, r.c) === "over", Boolean(r.warn)];
  red[k] = !(k in red) || String(red[k]) === String(v) ? v : [null, null];
}
console.log(JSON.stringify({ pct: m.diskPct, lim, red }));
EOF

PYTHONPATH=$bin python3 - ${TMPDIR:-/tmp}/entorno-$$.json $h0 <<'EOF'
import json, sys
from herdr_task.machine import sample, hold_reason
from herdr_task.settings import machine_limits
e = json.load(open(sys.argv[1]))
fallas = 0
def falla(s):
    global fallas; fallas += 1; print("FALLA:", s)
h = sample()
# el disco se mueve: vale si coincide con la medida de Shepherdr de antes o de después
if e["pct"] not in (h["disk"], int(sys.argv[2])): falla(f"% lleno: Entorno {e['pct']}, Shepherdr {sys.argv[2]} y {h['disk']}")
lim = machine_limits()["start_disk"]
if e["lim"] != lim: falla(f"start_disk: Entorno {e['lim']}, Shepherdr {lim}")
off = {"start_memory": None, "start_load": None}
for k, (red, warn) in e["red"].items():
    p, l = map(int, k.split("/"))
    stop = bool(hold_reason({**h, "disk": p}, {**off, "start_disk": l}))
    if red != stop or warn != stop:
        falla(f"disco {p}% con límite {l}: Entorno {'rojo' if red else 'sin rojo'} y {'con' if warn else 'sin'} aviso; Shepherdr {'para' if stop else 'arranca'}")
if not fallas: print(f"ok: disco {h['disk']}% y start_disk {lim} iguales; rojo = Shepherdr para en {len(e['red'])} casos")
sys.exit(1 if fallas else 0)
EOF
r=$?; rm -f ${TMPDIR:-/tmp}/entorno-$$.json; exit $r
