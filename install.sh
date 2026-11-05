#!/bin/sh
# Instala herdr-flota sobre Shepherdr: copia los mods de este repo en la app Herdr y genera
# el layout `flota` = el de Shepherdr + nuestras piezas. Se corre otra vez después de cada
# `shepherdr update`, porque el layout se regenera desde el suyo. No toca nada de Shepherdr.
set -e
here=$(cd "$(dirname "$0")" && pwd -P)
app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
[ -f "$app/layouts/shepherdr.json" ] || { echo "Falta Shepherdr: instálalo primero (github.com/eliasstravik/shepherdr)." >&2; exit 1; }

for m in "$here"/mods/*/; do
  name=$(basename "$m")
  # ponytail: copia, no symlink: Herdr no recarga mods enlazados. Correr de nuevo tras cada cambio.
  [ -L "$app/mods/$name" ] && rm "$app/mods/$name"
  mkdir -p "$app/mods/$name" && rsync -a --delete "$m" "$app/mods/$name/"
  echo "  mod     $name"
done

python3 - "$app" <<'EOF'
import json, sys
app = sys.argv[1]
d = json.load(open(f"{app}/layouts/shepherdr.json"))
d.pop("preview", None)
d["children"] = [c for c in d["children"] if c.get("id") != "entorno"]
# Entorno: columna fija a la derecha, compartida por todos los espacios.
d["children"].append({"id": "entorno", "type": "block", "size": {"px": 260}, "min": 220, "max": 380,
                      "content": {"mod": "flota-entorno"}})
# Iniciativas: en el panel de la derecha, donde abren Tasks y Files, con su botón al final de la barra de arriba.
def find(n, id):
    if n.get("id") == id: return n
    return next((r for c in n.get("children", []) if (r := find(c, id))), None)
find(d, "panel-body")["children"].append({"id": "iniciativas", "type": "block", "content": {"mod": "flota-iniciativas"}})
work = find(d, "work")
i, bar = next((i, c) for i, c in enumerate(work["children"]) if c.get("id") == "tabs")
work["children"][i] = {"id": "tabs-row", "type": "row", "size": bar.pop("size"), "resizable": False, "children": [
    bar, {"id": "iniciativas-boton", "type": "block", "size": {"px": 104}, "content": {"mod": "flota-iniciativas", "props": {"boton": True}}}]}
json.dump(d, open(f"{app}/layouts/flota.json", "w"), indent=2, ensure_ascii=False)
print("  layout  flota")
EOF

# Hook de credenciales: PreToolUse en los dos perfiles de Claude y en Codex. Idempotente: si ya está igual no toca
# el archivo; si apunta a otra carpeta (otro worktree) lo cambia en su sitio. Copia el archivo antes de escribirlo.
python3 - "$here/shell/hooks/credenciales.py" <<'EOF'
import json, os, shutil, sys
cmd = f"python3 -I -S '{sys.argv[1]}'"
H = os.path.expanduser("~")
claude = "Read|Edit|MultiEdit|Write|NotebookEdit|Grep|Glob|Bash"
for f, matcher in ((f"{H}/.claude/settings.json", claude), (f"{H}/.claude-work/settings.json", claude),
                   (f"{H}/.codex/hooks.json", "Bash|apply_patch")):
    if not os.path.isdir(os.path.dirname(f)):
        continue
    try:
        d = json.load(open(f)) if os.path.exists(f) else {}
    except ValueError:
        print(f"  hook    credenciales: {f} no es JSON válido; no lo toco", file=sys.stderr)
        continue
    pre = d.setdefault("hooks", {}).setdefault("PreToolUse", [])
    nuevo = {"matcher": matcher, "hooks": [{"type": "command", "command": cmd, "timeout": 10}]}
    mios = [i for i, e in enumerate(pre) if any("shell/hooks/credenciales.py" in (h.get("command") or "") for h in e.get("hooks", []))]
    if [pre[i] for i in mios] == [nuevo]:
        print(f"  hook    credenciales ya está en {f}")
        continue
    if mios:
        pre[mios[0]] = nuevo
        for i in reversed(mios[1:]):
            del pre[i]
    else:
        pre.append(nuevo)
    if os.path.exists(f):
        shutil.copy2(f, f + ".bak-credenciales")
    tmp = f"{f}.{os.getpid()}"
    with open(tmp, "w") as o:
        json.dump(d, o, indent=2, ensure_ascii=False)
        o.write("\n")
    if os.path.exists(f):
        shutil.copymode(f, tmp)
    os.replace(tmp, f)
    print(f"  hook    credenciales en {f}" + ("  (en Codex: confíalo una vez con /hooks)" if "codex" in f else ""))
EOF

# Entorno en la web de Shepherdr: el plugin va a ~/.shepherdr/plugins (Shepherdr lo copia en cada build de su web),
# con el mismo cálculo que el mod. Los datos son la foto que escribe el mod en ~/.herdr/flota/web/entorno.json;
# un servidor local la sirve y Tailscale la publica en /flota del mismo tailnet (la app de Tailscale en macOS no
# puede servir una carpeta). `shepherdr update` reconstruye la web solo si el plugin cambió.
# Iniciativas igual, con iniciativas.js y la foto iniciativas.json. El mismo servidor (respuestas.py) recibe las
# respuestas a las Decisiones que se tocan en la web (POST /flota/respuesta).
for p in flota-entorno:calc.js flota-iniciativas:iniciativas.js; do
  name=${p%%:*} js=${p#*:} plug="${SHEPHERDR_HOME:-$HOME/.shepherdr}/plugins/$name"
  mkdir -p "$plug" && rsync -a --delete --exclude "*.js" "$here/web/$name/" "$plug/" && rsync -a "$here/mods/$name/$js" "$plug/"
  echo "  web     $name"
done
if [ "$(uname)" = Darwin ]; then
  mkdir -p "$HOME/.herdr/flota/web"
  plist="$HOME/Library/LaunchAgents/dev.herdr-flota.web.plist"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.herdr-flota.web</string>
  <key>ProgramArguments</key><array>
    <string>$(command -v python3)</string><string>$app/mods/flota-iniciativas/respuestas.py</string><string>servir</string>
    <string>7790</string><string>$HOME/.herdr/flota/web</string>
  </array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)/dev.herdr-flota.web" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "  servicio dev.herdr-flota.web (127.0.0.1:7790)"
  # El vigía del disco: cada 10 min, sin tokens; pasado start_disk - margen lanza el agente de limpieza.
  mkdir -p "$HOME/.herdr/flota/vigia"
  plist="$HOME/Library/LaunchAgents/dev.herdr-flota.vigia.plist"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.herdr-flota.vigia</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>-f</string><string>$here/bin/flota-vigia</string></array>
  <key>StartInterval</key><integer>600</integer><key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>$HOME/.herdr/flota/vigia/err</string>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)/dev.herdr-flota.vigia" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "  servicio dev.herdr-flota.vigia (cada 10 min; log en ~/.herdr/flota/vigia/log)"

  # Vigía de reinicios: reanuda cada tarea de Shepherdr cuyo agente hc recuperó como una shell vacía.
  # SHELL: herdr-task arranca los agentes dentro de la shell de la persona (sin él, /bin/sh).
  plist="$HOME/Library/LaunchAgents/dev.herdr-flota.reanudar.plist"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.herdr-flota.reanudar</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>-f</string><string>$here/bin/flota-reanudar</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH</string><key>SHELL</key><string>${SHELL:-/bin/zsh}</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$HOME/.herdr/flota/reanudar.log</string>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)/dev.herdr-flota.reanudar" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "  servicio dev.herdr-flota.reanudar (log en ~/.herdr/flota/reanudar.log)"
fi
command -v tailscale >/dev/null && tailscale serve --bg --set-path /flota http://127.0.0.1:7790 >/dev/null && echo "  tailnet /flota"
command -v shepherdr >/dev/null && shepherdr update --yes --keys keep | grep -i "web app" || true

echo "Listo. En Herdr: Ctrl+Shift+L hasta el layout flota. En la web: Iniciativas arriba de los espacios y Entorno al pie."
