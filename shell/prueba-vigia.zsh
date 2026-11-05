#!/bin/zsh -f
# Prueba de bin/flota-vigia con un umbral falso (que lo deja siempre en seco): bajo el umbral no lanza; sobre
# él lanza UN agente de limpieza real, que mide, informa y avisa sin borrar; no lanza otro mientras ese vive,
# ni otra vez antes de la hora. Gasta una sesión corta de Sonnet (~5 min). Al final borra todo lo suyo.
# Uso: zsh shell/prueba-vigia.zsh
vigia=${0:a:h:h}/bin/flota-vigia
proy=$HOME/.claude/projects/${${0:a:h:h}//[^A-Za-z0-9]/-}
export FLOTA_VIGIA_DIR=${$(mktemp -d /tmp/flota-vigia.XXXXXX):A}
antes=($proy/*.jsonl(N))
fallas=0
falla() { print -- "FALLA: $*"; (( fallas++ )) }
limpiezas() { hc ls ${1:+--all} --json --label flota.rol=limpieza | jq -r '.terminals[] | select(.state == "live" or "'$1'" != "") | .address' }
ultima() { tail -1 $FLOTA_VIGIA_DIR/log }
nuevas() { local f; for f in $proy/*.jsonl(N); do (( ${antes[(Ie)$f]} )) || print -r -- $f; done }
limpiar() {
  local t f
  for t in $(limpiezas todas); do hc kill $t >/dev/null 2>&1; hc rm $t >/dev/null 2>&1; done
  for f in $(nuevas); do rm -rf $f ${f%.jsonl} $HOME/.herdr/flota/perfil/${f:t:r}; done
  rm -rf $FLOTA_VIGIA_DIR $HOME/.herdr/flota/encargos/limpieza-disco.md
}
[[ -z $(limpiezas) ]] || { print "Ya hay una limpieza viva ($(limpiezas)): no pruebo encima."; exit 1 }
trap limpiar EXIT INT TERM

FLOTA_VIGIA_UMBRAL=100 $vigia
[[ $(ultima) == *"(umbral 100): bien" ]] || falla "bajo el umbral: $(ultima)"
[[ -z $(limpiezas) ]] || falla "lanzó bajo el umbral"

FLOTA_VIGIA_UMBRAL=0 $vigia
[[ $(ultima) == *"lancé la limpieza en t"*"(en seco)" ]] || falla "sobre el umbral no lanzó: $(ultima)"
t=$(limpiezas)
[[ $(print -l $t | wc -l) -eq 1 ]] || falla "hay $(print -l $t | wc -l) limpiezas vivas (esperaba 1)"
print "lanzada: $t"

FLOTA_VIGIA_UMBRAL=0 $vigia
[[ $(ultima) == *"la limpieza $t sigue"* ]] || falla "con una viva: $(ultima)"
[[ $(limpiezas) == $t ]] || falla "lanzó otra con una viva: $(limpiezas)"

# Esperar a que termine su turno (mide ~2 min y luego resume).
for _ in {1..90}; do
  st=$(hc get $t --json | jq -r '.status.state // ""')
  [[ $st == idle || $st == done ]] && break
  hc wait $t --timeout 10 >/dev/null 2>&1
done
[[ $st == idle || $st == done ]] || falla "la limpieza no terminó en 15 min ($st)"
aviso=$(hc get $t --json | jq -r '.labels["herdr.alert"] // empty | fromjson | .title + " | " + .body')
[[ $aviso == *seco* ]] || falla "no avisó en seco: ${aviso:-sin aviso}"
[[ -s $FLOTA_VIGIA_DIR/informe.md ]] || falla "no dejó el informe"
# En seco no borró: cada flota-limpiar que corrió fue con --en-seco, y ningún rm, prune ni worktree remove.
cmds=$(for f in $(nuevas); do jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and .name == "Bash") | .input.command' $f; done)
print -r -- $cmds | grep "flota-limpiar" | grep -qv -- "--en-seco" && falla "corrió flota-limpiar sin --en-seco"
print -r -- $cmds | grep -E "(^|[;&| ])(rm|git worktree remove|docker [a-z ]*prune|uv cache (prune|clean))( |$)" && falla "corrió un comando que borra"

FLOTA_VIGIA_UMBRAL=0 $vigia
[[ $(ultima) == *"espero la hora" ]] || falla "terminada, antes de la hora: $(ultima)"
[[ $(limpiezas) == $t ]] || falla "relanzó antes de la hora"

print "aviso: $aviso"
(( fallas )) && { cat $FLOTA_VIGIA_DIR/log; print "$fallas fallas"; exit 1 }
print "ok: no lanza bajo el umbral; lanza una sola en seco, que avisa sin borrar; no relanza con una viva ni antes de la hora"
