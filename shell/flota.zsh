# herdr-flota: `claude --resume <id>` sin perfil relanza la sesión con el perfil con que arrancó.
# Herdr (y Shepherdr) relanzan las sesiones tras un reinicio con `claude --resume <id>`, sin
# CLAUDE_CONFIG_DIR. `claude` a secas (~/.claude.json) y ccp (~/.claude/.claude.json) guardan
# sus conversaciones en el mismo sitio pero tienen config global distinta (MCP, carpetas de
# confianza), y ccw vive en ~/.claude-work.
# 1. perfil-hook.sh anota el perfil de cada sesión al arrancar: si hay registro, manda él.
# 2. Sin registro (sesiones de antes del hook): si la conversación está en un perfil aparte,
#    se usa ese; si no, va a secas, como antes.
(( ${+FLOTA_CLAUDE_PERFILES} )) || FLOTA_CLAUDE_PERFILES=($HOME/.claude-work)  # perfiles aparte del normal

claude() {
  if [[ -z "$CLAUDE_CONFIG_DIR" ]]; then
    local id="" prev="" a dir f
    local -a hits
    for a in "$@"; do
      [[ "$prev" == (--resume|-r) ]] && id="$a"
      [[ "$a" == --resume=* ]] && id="${a#--resume=}"
      prev="$a"
    done
    if [[ -n "$id" ]]; then
      f="${FLOTA_PERFIL_DIR:-$HOME/.herdr/flota/perfil}/$id"
      if [[ -f "$f" ]]; then
        dir=$(<"$f")
        if [[ -n "$dir" ]]; then CLAUDE_CONFIG_DIR="$dir" command claude "$@"; else command claude "$@"; fi
        return
      fi
      for dir in $FLOTA_CLAUDE_PERFILES; do
        hits=($dir/projects/*/$id.jsonl(N))
        if (( $#hits )); then
          CLAUDE_CONFIG_DIR="$dir" command claude "$@"
          return
        fi
      done
    fi
  fi
  command claude "$@"
}
