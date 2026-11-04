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
json.dump(d, open(f"{app}/layouts/flota.json", "w"), indent=2, ensure_ascii=False)
print("  layout  flota")
EOF

# Entorno en la web de Shepherdr: el plugin va a ~/.shepherdr/plugins (Shepherdr lo copia en cada build de su web),
# con el mismo cálculo que el mod. Los datos son la foto que escribe el mod en ~/.herdr/flota/web/entorno.json;
# un servidor local la sirve y Tailscale la publica en /flota del mismo tailnet (la app de Tailscale en macOS no
# puede servir una carpeta). `shepherdr update` reconstruye la web solo si el plugin cambió.
plug="${SHEPHERDR_HOME:-$HOME/.shepherdr}/plugins/flota-entorno"
mkdir -p "$plug" && rsync -a --delete --exclude calc.js "$here/web/flota-entorno/" "$plug/" && rsync -a "$here/mods/flota-entorno/calc.js" "$plug/"
echo "  web     flota-entorno"
if [ "$(uname)" = Darwin ]; then
  mkdir -p "$HOME/.herdr/flota/web"
  plist="$HOME/Library/LaunchAgents/dev.herdr-flota.web.plist"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.herdr-flota.web</string>
  <key>ProgramArguments</key><array>
    <string>$(command -v python3)</string><string>-m</string><string>http.server</string><string>7790</string>
    <string>--bind</string><string>127.0.0.1</string><string>--directory</string><string>$HOME/.herdr/flota/web</string>
  </array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)/dev.herdr-flota.web" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "  servicio dev.herdr-flota.web (127.0.0.1:7790)"
fi
command -v tailscale >/dev/null && tailscale serve --bg --set-path /flota http://127.0.0.1:7790 >/dev/null && echo "  tailnet /flota"
command -v shepherdr >/dev/null && shepherdr update --yes --keys keep | grep -i "web app" || true

echo "Listo. En Herdr: Ctrl+Shift+L hasta el layout flota. En la web: Entorno, al pie de la barra lateral."
