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
echo "Listo. En Herdr: Ctrl+Shift+L hasta el layout flota."
