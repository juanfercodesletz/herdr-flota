# Prueba de bin/flota-doctor: python3 shell/prueba-doctor.py
# Un HOME falso en /tmp con la flota instalada desde `main` (mods, plugins, plists), un hc, un herdr-app y un launchctl
# falsos en el PATH, y tres claude de mentira (procesos reales con su CLAUDE_CONFIG_DIR). Primero sano: todo ok y
# sale 0. Luego se rompe cada una de las 5 cosas y el doctor debe ver cada una y salir 1. No toca nada de verdad.
import http.server, json, os, shutil, socket, subprocess, sys, tempfile, threading, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCTOR = os.path.join(REPO, "bin", "flota-doctor")
# Los servicios sanos apuntan al repo principal, no a este worktree.
PRINCIPAL = os.path.dirname(subprocess.run(["git", "-C", REPO, "rev-parse", "--path-format=absolute", "--git-common-dir"],
                                           capture_output=True, text=True).stdout.strip())
fallos = 0


def igual(que, ok):
    global fallos
    fallos += not ok
    print(("ok   " if ok else "MAL  ") + que)


def escribe(p, d):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        f.write(d if isinstance(d, str) else json.dumps(d))


def falso(nombre, cuerpo):
    escribe(f"{BIN}/{nombre}", "#!/usr/bin/env python3\nimport json, os, sys\nF = os.environ['DOCTOR_FALSO']\n" + cuerpo)
    os.chmod(f"{BIN}/{nombre}", 0o755)


T = tempfile.mkdtemp(prefix="prueba-doctor.")
HOME, BIN, F = T + "/home", T + "/bin", T + "/falso"
APP, PLUG, AG = HOME + "/.config/herdr-app/mods", HOME + "/.shepherdr/plugins", HOME + "/Library/LaunchAgents"
procs, srv = [], None
try:
    # Lo instalado, como lo copia install.sh, desde main.
    src = T + "/main"
    os.makedirs(src)
    subprocess.run(f"git -C {REPO} archive main mods web | tar -x -C {src}", shell=True, check=True)
    for m in os.listdir(src + "/mods"):
        shutil.copytree(f"{src}/mods/{m}", f"{APP}/{m}")
    for p, js in (("flota-entorno", "calc.js"), ("flota-iniciativas", "iniciativas.js")):
        shutil.copytree(f"{src}/web/{p}", f"{PLUG}/{p}")
        shutil.copy(f"{src}/mods/{p}/{js}", f"{PLUG}/{p}/")

    # /flota: un servidor de verdad en un puerto libre, el que dice el plist.
    s = socket.socket(); s.bind(("127.0.0.1", 0)); puerto = s.getsockname()[1]; s.close()
    class Mudo(http.server.SimpleHTTPRequestHandler):
        log_message = lambda *a: None
    srv = http.server.HTTPServer(("127.0.0.1", puerto), Mudo)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    def plist(label, args):
        a = "".join(f"<string>{x}</string>" for x in args)
        escribe(f"{AG}/dev.herdr-flota.{label}.plist", f'<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>'
                f"<key>Label</key><string>dev.herdr-flota.{label}</string><key>ProgramArguments</key><array>{a}</array></dict></plist>")

    plist("web", [sys.executable, f"{APP}/flota-iniciativas/respuestas.py", "servir", str(puerto), HOME])
    plist("vigia", ["/bin/zsh", "-f", f"{PRINCIPAL}/bin/flota-vigia"])
    plist("reanudar", ["/bin/zsh", "-f", f"{PRINCIPAL}/bin/flota-reanudar"])
    falso("launchctl", "label = sys.argv[2].split('/')[-1]\nsys.exit(0 if label in json.load(open(F + '/cargados.json')) else 1)\n")
    escribe(F + "/cargados.json", ["dev.herdr-flota.web", "dev.herdr-flota.vigia", "dev.herdr-flota.reanudar"])

    # Espacios, carpetas y tres claude de mentira: el Assistant de un espacio Letz (ccw) y dos tareas (ccw y ccp).
    SP_L, SP_P = "sp" + "a" * 32, "sp" + "b" * 32
    letz, pers = HOME + "/Codes/Letz/app", HOME + "/Codes/Personal/otro"
    for d in (letz, pers):
        os.makedirs(d)
    escribe(F + "/espacios.json", {"spaces": [{"id": SP_L, "name": "App", "folder": letz}, {"id": SP_P, "name": "Otro", "folder": pers}]})
    falso("herdr-app", "print(open(F + '/espacios.json').read()) if sys.argv[1:2] == ['ls'] else sys.exit(2)\n")
    falso("hc", "d = json.load(open(F + '/hc.json'))\n"
                "print(json.dumps({'terminals': [{'address': a, 'state': 'live'} for a in d]}) if sys.argv[1] == 'ls' else json.dumps(d[sys.argv[2]]))\n")

    def claude(cfg):
        env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE")}
        env["HOME"] = HOME
        if cfg:
            env["CLAUDE_CONFIG_DIR"] = HOME + "/" + cfg
        p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)", "prueba-doctor"], env=env)
        procs.append(p)
        for _ in range(200):  # hasta que haya hecho exec
            if "prueba-doctor" in subprocess.run(["ps", "-ww", "-o", "command=", "-p", str(p.pid)], capture_output=True, text=True).stdout:
                break
            time.sleep(0.02)
        return p.pid

    def terminal(pid, cwd, labels):
        return {"labels": labels, "cwd": cwd, "foreground": {"pid": pid, "argv": ["claude"], "cwd": cwd}}

    def terminales(asistente, tarea_l, tarea_p):
        escribe(F + "/hc.json", {
            "t1": terminal(asistente, letz, {"herdr.role": "coordinator", "herdr.coordinator.space": SP_L}),
            "t2": terminal(tarea_l, letz, {"herdr.task": "Codes-Letz-app#1", "herdr.task.space": SP_L}),
            "t3": terminal(tarea_p, pers, {"herdr.task": "Codes-Personal-otro#1", "herdr.task.space": SP_P}),
        })

    ccw, ccw2, ccp = claude(".claude-work"), claude(".claude-work"), claude(".claude")
    terminales(ccw, ccw2, ccp)
    tarea = lambda n, sp, st: {"id": n, "title": f"t{n}", "state": st, "space": sp}
    escribe(HOME + "/.herdr/tasks/Codes-Letz-app.json", {"folder": letz, "prefix": "AP", "tasks": [tarea(1, SP_L, "running")]})
    escribe(HOME + "/.herdr/tasks/Codes-Personal-otro.json", {"folder": pers, "prefix": "OT", "tasks": [tarea(1, SP_P, "running")]})
    escribe(HOME + "/.herdr/flota/app.json", {"producto": "App", "espacios": [{"id": SP_L, "nombre": "App"}]})
    escribe(HOME + "/.herdr/flota/presupuesto.json", {"cpu": 85})  # no es un producto: no cuenta

    env = {k: v for k, v in os.environ.items() if not k.startswith(("CLAUDE", "HERDR_", "SHEPHERDR_", "FLOTA_", "HC_"))}
    env.update(HOME=HOME, PATH=f"{BIN}:{os.environ['PATH']}", DOCTOR_FALSO=F)

    def doctor():
        p = subprocess.run([sys.executable, DOCTOR, "--json"], env=env, capture_output=True, text=True, timeout=60)
        try:
            return p.returncode, json.loads(p.stdout)["chequeos"]
        except Exception:
            print(p.stdout, p.stderr)
            return p.returncode, []

    def ve(chs, chequeo, estado, texto):
        return any(c["chequeo"] == chequeo and c["estado"] == estado and texto in c["que"] and c.get("arreglo") for c in chs)

    # Sano.
    rc, chs = doctor()
    malos = [c for c in chs if c["estado"] != "ok"]
    igual(f"sano: todo ok ({len(chs)} chequeos){'' if not malos else ' — ' + json.dumps(malos, ensure_ascii=False)}", not malos and len(chs) >= 12)
    igual("sano: sale 0", rc == 0)

    # 1. Lo instalado no es main: un archivo cambiado, un plugin con un archivo de más y el Árbol, que ya no está.
    with open(f"{APP}/flota-entorno/main.js", "a") as f:
        f.write("// a mano\n")
    escribe(f"{PLUG}/flota-iniciativas/viejo.tsx", "")
    escribe(f"{APP}/flota-arbol/main.js", "")
    escribe(f"{PLUG}/flota-arbol/client.tsx", "")
    # 2. El vigía apunta a un worktree y /flota no responde.
    plist("vigia", ["/bin/zsh", "-f", f"{HOME}/.herdr/worktrees/herdr-flota/task-9/bin/flota-vigia"])
    srv.shutdown(); srv.server_close(); srv = None
    # 3. El Assistant y una tarea a secas.
    terminales(claude(None), claude(None), ccp)
    # 4. Un archivo de Iniciativas con nombres en vez de ids y otro roto.
    escribe(HOME + "/.herdr/flota/app.json", {"producto": "App", "espacios": ["AP - Backend & Web"]})
    escribe(HOME + "/.herdr/flota/roto.json", "{ roto")
    escribe(HOME + "/.herdr/flota/muerto.json", {"producto": "Muerto", "espacios": ["sp" + "8" * 32]})
    # 5. Una tarea en un espacio que ya no existe.
    escribe(HOME + "/.herdr/tasks/Codes-Personal-otro.json", {"folder": pers, "prefix": "OT", "tasks": [tarea(1, "sp" + "9" * 32, "running")]})

    rc, chs = doctor()
    igual("roto: sale 1", rc == 1)
    igual("1. mod distinto de main", ve(chs, "mods", "falla", "flota-entorno: distinto de main (main.js)"))
    igual("1. plugin con un archivo de más", ve(chs, "web", "falla", "flota-iniciativas: distinto de main (viejo.tsx)"))
    igual("1. mod que ya no está en main", ve(chs, "mods", "falla", "flota-arbol: instalado pero ya no está"))
    igual("1. plugin que ya no está en main", ve(chs, "web", "falla", "flota-arbol: instalado pero ya no está"))
    igual("2. servicio que apunta a un worktree", ve(chs, "servicios", "falla", "vigia: apunta a un worktree"))
    igual("2. /flota no responde", ve(chs, "servicios", "falla", f"no responde en 127.0.0.1:{puerto}"))
    igual("3. Assistant a secas (aviso)", ve(chs, "perfiles", "aviso", "Assistant t1: corre a secas, el mapa dice ccw"))
    igual("3. tarea a secas (falla)", ve(chs, "perfiles", "falla", "tarea AP-1: corre a secas, el mapa dice ccw"))
    igual("3. la tarea sana sigue ok", ve(chs, "perfiles", "ok", "tarea OT-1: ccp") or any(c["que"] == "tarea OT-1: ccp" for c in chs))
    igual("4. Iniciativas con nombres", ve(chs, "iniciativas", "falla", "no nombres: «AP - Backend & Web»"))
    igual("4. Iniciativas con un espacio que ya no existe", ve(chs, "iniciativas", "falla", "muerto.json: espacios que ya no existen: sp888"))
    igual("4. Iniciativas que no es JSON", ve(chs, "iniciativas", "falla", "roto.json: no es JSON válido"))
    igual("5. tarea en un espacio que no existe", ve(chs, "tareas", "falla", "OT-1 (running) apunta al espacio sp999"))
    igual("5. y su arreglo lleva el espacio de su carpeta", any(SP_P in c.get("arreglo", "") for c in chs if c["chequeo"] == "tareas"))
    # 2 bis. Un servicio sin cargar.
    escribe(F + "/cargados.json", ["dev.herdr-flota.web", "dev.herdr-flota.vigia"])
    rc, chs = doctor()
    igual("2. servicio sin cargar", ve(chs, "servicios", "falla", "reanudar: no está cargado"))
finally:
    for p in procs:
        p.kill()
    if srv:
        srv.shutdown()
    shutil.rmtree(T, ignore_errors=True)

print("todo bien" if not fallos else f"{fallos} mal")
sys.exit(1 if fallos else 0)
