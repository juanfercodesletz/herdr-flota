#!/bin/sh
# herdr-flota: hook SessionStart de Claude. Anota con qué perfil arrancó cada sesión
# (el CLAUDE_CONFIG_DIR que traía, vacío si fue `claude` a secas) para que flota.zsh
# la reanude igual tras un reinicio. Un archivo por sesión: <dir>/<session_id>.
id=$(jq -r '.session_id // empty' 2>/dev/null)
[ -n "$id" ] || exit 0
d="${FLOTA_PERFIL_DIR:-$HOME/.herdr/flota/perfil}"
mkdir -p "$d" && printf '%s' "${CLAUDE_CONFIG_DIR:-}" > "$d/$id"
exit 0
