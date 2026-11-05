# herdr-flota: la función claude() que envuelve cada `claude` de la shell interactiva.
#
# Reanudar: `claude --resume <id>` sin perfil relanza la sesión con el perfil con que arrancó.
# Herdr (y Shepherdr) relanzan las sesiones tras un reinicio con `claude --resume <id>`, sin
# CLAUDE_CONFIG_DIR. `claude` a secas (~/.claude.json) y ccp (~/.claude/.claude.json) guardan
# sus conversaciones en el mismo sitio pero tienen config global distinta (MCP, carpetas de
# confianza), y ccw vive en ~/.claude-work.
# 1. perfil-hook.sh anota el perfil de cada sesión al arrancar: si hay registro, manda él.
# 2. Sin registro (sesiones de antes del hook): si la conversación está en un perfil aparte,
#    se usa ese; si no, va a secas, como antes.
#
# Arrancar una tarea de Shepherdr (HERDR_BROWSER_TASK, que Shepherdr pone solo a sus agentes):
# el perfil sale de la carpeta (shell/asientos), salvo que ese esté en o sobre su techo de 5 h o
# 7 d y el otro no. Los dos agotados: el de la carpeta, y el Backup agent de Shepherdr pasa la
# tarea a Codex cuando Claude se detiene por cuota. El resto de sesiones, como siempre.
(( ${+FLOTA_CLAUDE_PERFILES} )) || FLOTA_CLAUDE_PERFILES=($HOME/.claude-work)  # perfiles aparte del normal
(( ${+FLOTA_PERFILES} )) || typeset -gA FLOTA_PERFILES=(ccp $HOME/.claude ccw $HOME/.claude-work)
FLOTA_REPO=${${(%):-%x}:a:h:h}
: ${FLOTA_ASIENTOS:=$FLOTA_REPO/shell/asientos}

claude() {
  if [[ -z "$CLAUDE_CONFIG_DIR" ]]; then
    local id="" prev="" a dir f reanuda=""
    local -a hits
    for a in "$@"; do
      [[ "$prev" == (--resume|-r) ]] && id="$a"
      [[ "$a" == --resume=* ]] && id="${a#--resume=}"
      [[ "$a" == (-r|--resume|--resume=*|-c|--continue) ]] && reanuda=1
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
    elif [[ -n "$HERDR_BROWSER_TASK" && -z "$reanuda" ]]; then
      dir=$(flota-perfil)
      if [[ -n "$dir" ]]; then CLAUDE_CONFIG_DIR="$dir" command claude "$@"; return; fi
    fi
  fi
  command claude "$@"
}

# El CLAUDE_CONFIG_DIR para una tarea nueva en $PWD (nada si el mapa no da perfil).
flota-perfil() {
  local donde=$PWD pat p pref otro git=$(command git -C "$PWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  local -a agotados
  [[ -n "$git" ]] && donde=${git:h}  # un worktree cuenta como su repo principal
  [[ -r "$FLOTA_ASIENTOS" ]] || return 0
  while read -r pat p; do
    [[ -z "$pat" || "$pat" == \#* ]] && continue
    [[ "$donde" == ${~${pat/#\~/$HOME}} ]] && { pref=$p; break; }
  done < "$FLOTA_ASIENTOS"
  [[ -n "${FLOTA_PERFILES[$pref]}" ]] || return 0
  otro=${${(k)FLOTA_PERFILES:#$pref}[1]}
  agotados=($(flota-agotados $pref $otro))
  (( ${agotados[(I)$pref]} && ! ${agotados[(I)$otro]} )) && pref=$otro
  print -r -- "${FLOTA_PERFILES[$pref]}"
}

# Los perfiles dados que están en o sobre su techo de 5 h o de 7 d, con el techo y el nivel de
# Entorno (calc.js). Una ventana ya reiniciada no cuenta; sin dato, tampoco.
flota-agotados() {
  local h=${FLOTA_HOME:-$HOME/.herdr/flota}
  command node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const [calc, h, ...ps] = process.argv.slice(1);
    const { DEFAULTS, level } = await import(calc);
    const read = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
    const cap = { ...DEFAULTS, ...read(h + "/presupuesto.json") }, now = Date.now() / 1000;
    for (const p of ps) {
      const rl = read(`${h}/cupos/${p}.json`)?.rate_limits || {};
      if ([rl.five_hour, rl.seven_day].some((w) => w && !(w.resets_at <= now) && level(w.used_percentage, cap[p]) === "over")) console.log(p);
    }' "$FLOTA_REPO/mods/flota-entorno/calc.js" "$h" "$@" 2>/dev/null
}
