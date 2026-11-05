#!/bin/zsh -f
# Entorno y Shepherdr dicen lo mismo del disco: el mismo % lleno, el mismo start_disk y el rojo en el mismo
# punto en que Shepherdr deja de arrancar tareas (moviendo el límite, no llenando el disco). Solo lee.
# Uso: zsh shell/prueba-disco.zsh
calc=${0:a:h:h}/mods/flota-entorno/calc.js
bin=${SHEPHERDR_TASKS_BIN:-$HOME/.config/herdr-app/mods/tasks/bin}
h0=$(PYTHONPATH=$bin python3 -c "from herdr_task.machine import sample; print(sample()['disk'])")
node --input-type=module - $calc =(cat ~/.herdr/shepherdr.json 2>/dev/null || echo '{}') <<'EOF' > ${TMPDIR:-/tmp}/entorno-$$.json || exit 1
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const { DISCO, discoStat, startDisk, disco, level } = await import("file://" + process.argv[2]);
const m = discoStat(execFileSync("python3", ["-c", DISCO], { encoding: "utf8" })), lim = startDisk(JSON.parse(readFileSync(process.argv[3], "utf8")));
// Rojo de Entorno para cada % y cada límite.
const red = {};
for (let p = 80; p <= 100; p++) for (let l = 85; l <= 98; l++) { const r = disco({ diskPct: p, diskFreeGb: 1 }, null, l); red[`${p}/${l}`] = [level(r.pct, r.c) === "over", Boolean(r.warn)]; }
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
