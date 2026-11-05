# Prueba del lector de perfiles (mods/flota-entorno/perfiles.py): python3 shell/prueba-perfil.py
# Tres procesos de verdad, uno por perfil: ccp, ccw (con / al final) y a secas. Todos llevan un argumento que dice
# CLAUDE_CONFIG_DIR=, que no debe contar: el perfil sale del entorno del proceso. Y una config con secretos en env y
# cabeceras, de la que solo deben salir los nombres de los MCP.
import json, os, subprocess, sys, tempfile, time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "mods", "flota-entorno"))
sys.dont_write_bytecode = True  # nada de __pycache__ en la carpeta del mod
import perfiles as P

H = P.H
fallos = 0


def igual(que, got, want):
    global fallos
    ok = got == want
    fallos += not ok
    print(("ok   " if ok else "MAL  ") + f"{que}: {got!r}" + ("" if ok else f" (esperaba {want!r})"))


for want, d in {"ccp": H + "/.claude", "ccw": H + "/.claude-work/", "a secas": None}.items():
    env = {k: v for k, v in os.environ.items() if k != "CLAUDE_CONFIG_DIR"}
    if d:
        env["CLAUDE_CONFIG_DIR"] = d
    # python y no sh: macOS no deja ver el entorno de los binarios del sistema (/bin/sh)
    p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)", "CLAUDE_CONFIG_DIR=/engano"], env=env)
    try:
        for _ in range(200):  # hasta que el hijo haya hecho exec (antes es una copia de este proceso)
            if "/engano" in P.sh("ps", "-ww", "-o", "command=", "-p", str(p.pid)):
                break
            time.sleep(0.02)
        igual(f"perfil del proceso ({d or 'sin CLAUDE_CONFIG_DIR'})", P.perfil(P.config_dir(p.pid)), want)
    finally:
        p.kill()

# Tras un reinicio Herdr relanza con `claude --resume <id>`, sin perfil: claude() de flota.zsh lo saca del registro de
# perfil-hook.sh, y el lector ve ese perfil en el proceso. Un claude falso (python) para no gastar una sesión.
repo = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
with tempfile.TemporaryDirectory() as t:
    os.makedirs(t + "/bin"); os.makedirs(t + "/perfil")
    with open(t + "/bin/claude", "w") as f:
        f.write(f"#!{sys.executable}\nimport time; time.sleep(30)\n")
    os.chmod(t + "/bin/claude", 0o755)
    for want, d in {"ccw": H + "/.claude-work", "a secas": ""}.items():
        open(f"{t}/perfil/s-{want}", "w").write(d)
        env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE")}
        env.update(PATH=t + "/bin:" + env["PATH"], FLOTA_PERFIL_DIR=t + "/perfil")
        z = subprocess.Popen(["zsh", "-f", "-c", f"source {repo}/shell/flota.zsh; claude --resume s-{want}"], env=env)
        try:
            pid = ""
            for _ in range(200):  # el claude falso: hijo de zsh, o zsh mismo si hizo exec
                pid = next((p for p in [str(z.pid), *P.sh("pgrep", "-P", str(z.pid)).split()]
                            if "/bin/claude --resume" in P.sh("ps", "-ww", "-o", "command=", "-p", p)), "")
                if pid:
                    break
                time.sleep(0.05)
            igual(f"reanudado con registro {d or '(vacío)'}", P.perfil(P.config_dir(pid)), want)
        finally:
            subprocess.run(["pkill", "-P", str(z.pid)]); z.kill()

with tempfile.TemporaryDirectory() as t:
    d, cwd = t + "/perfil", t + "/repo"
    os.makedirs(d + "/plugins/p1/.claude-plugin")
    os.makedirs(cwd)
    secreto = {"command": "x", "env": {"TOKEN": "s3cr3t"}, "headers": {"Authorization": "Bearer s3cr3t"}}
    json.dump({"mcpServers": {"uno": secreto}, "oauthAccount": {"emailAddress": "a@b.co"},
               "projects": {cwd: {"mcpServers": {"dos": secreto, "apagado": secreto}, "disabledMcpServers": ["apagado"]}}},
              open(d + "/.claude.json", "w"))
    json.dump({"enabledPlugins": {"p1@m": True, "p2@m": False}}, open(d + "/settings.json", "w"))
    json.dump({"plugins": {"p1@m": [{"installPath": d + "/plugins/p1"}], "p2@m": [{"installPath": d + "/plugins/p1"}]}},
              open(d + "/plugins/installed_plugins.json", "w"))
    json.dump({"mcpServers": {"tres": secreto}}, open(d + "/plugins/p1/.mcp.json", "w"))
    json.dump({"mcpServers": {"cuatro": secreto}}, open(cwd + "/.mcp.json", "w"))
    m = P.mcp(d, cwd)
    igual("MCP por origen", m, {"usuario": ["uno"], "local": ["dos"], "proyecto": ["cuatro"], "plugins": ["tres"]})
    igual("sin valores de env ni cabeceras", "s3cr3t" in json.dumps(m), False)
    igual("cuenta", P.cuenta(d), "a@b.co")

sys.exit(1 if fallos else 0)
