#!/bin/zsh -f
# Prueba de flota.zsh y perfil-hook.sh sin lanzar claude: perfiles y registros falsos.
# Uso: zsh shell/prueba.zsh
set -e; zmodload zsh/datetime  # EPOCHSECONDS
tmp=${$(mktemp -d):A}; trap 'rm -rf $tmp' EXIT
mkdir -p $tmp/p/projects/x $tmp/w/projects/y $tmp/reg
touch $tmp/p/projects/x/{id-p,id-reg-vacio,id-reg-p}.jsonl $tmp/w/projects/y/{id-w,id-reg-w}.jsonl
unset CLAUDE_CONFIG_DIR
export FLOTA_PERFIL_DIR=$tmp/reg
FLOTA_CLAUDE_PERFILES=($tmp/w)
typeset -A FLOTA_PERFILES=(ccp $tmp/p ccw $tmp/w)
export FLOTA_HOME=$tmp/flota FLOTA_ASIENTOS=$tmp/asientos
unset HERDR_BROWSER_TASK
hook=${0:a:h}/perfil-hook.sh

# El hook anota el perfil (vacío = a secas) y no falla con entrada rara.
echo '{"session_id":"id-reg-vacio"}' | sh $hook
echo '{"session_id":"id-reg-p"}' | CLAUDE_CONFIG_DIR=$tmp/p sh $hook
echo '{"session_id":"id-reg-w"}' | CLAUDE_CONFIG_DIR=$tmp/w sh $hook
echo 'basura' | sh $hook; echo '{}' | sh $hook
[[ -f $tmp/reg/id-reg-vacio && -z $(<$tmp/reg/id-reg-vacio) ]] || { print "FALLA: hook a secas"; exit 1; }
[[ $(<$tmp/reg/id-reg-p) == $tmp/p && $(<$tmp/reg/id-reg-w) == $tmp/w ]] || { print "FALLA: hook con perfil"; exit 1; }
[[ $(ls $tmp/reg | wc -l) -eq 3 ]] || { print "FALLA: el hook anotó entradas sin id"; exit 1; }

source ${0:a:h}/flota.zsh
command() { [[ $1 == claude ]] && { print -r -- "${CLAUDE_CONFIG_DIR:-ninguno}"; return; }; builtin command "$@"; }
check() { local got=$(claude "${@:2}"); [[ $got == $1 ]] || { print "FALLA: claude ${@:2} -> $got (esperaba $1) en ${funcfiletrace[-1]}"; exit 1; }; }

check ninguno --resume id-reg-vacio   # registrada a secas: sigue a secas
check $tmp/p --resume id-reg-p        # registrada ccp: vuelve como ccp
check $tmp/w --resume id-reg-w        # registrada ccw
check $tmp/w -r id-reg-w
check $tmp/w --resume=id-reg-w
check $tmp/w --resume id-w            # sin registro, en perfil aparte: ese perfil
check ninguno --resume id-p           # sin registro, en el normal: a secas, como antes
check ninguno --resume no-existe
check ninguno -p hola
check ninguno --resume                # sin id: el selector de siempre
CLAUDE_CONFIG_DIR=$tmp/p check $tmp/p --resume id-reg-w   # perfil ya puesto: no se toca

# Tareas de Shepherdr: perfil por carpeta y por cuota, con cupos falsos (techo 90 de calc.js).
mkdir -p $tmp/flota/cupos $tmp/Letz/repo $tmp/Personal/otro $tmp/suelta
g() { command git -c user.name=p -c user.email=p@p "$@" >/dev/null 2>&1 }
for r in $tmp/Letz/repo $tmp/Personal/otro; do g -C $r init -q && g -C $r commit -q --allow-empty -m x; done
g -C $tmp/Letz/repo worktree add -q $tmp/wt/repo/task-1    # worktree de un repo de Letz, fuera de Letz
mkdir -p $tmp/Letz/repo/sub
print -l '# comentario' '~/Letz ccw' '~/Letz/** ccw' '* ccp' > $tmp/asientos
# cupo <perfil> <% 5 h> <% 7 d> [reinicio de la de 5 h, en segundos desde ahora]
cupo() { print -r -- "{\"at\":$EPOCHSECONDS,\"rate_limits\":{\"five_hour\":{\"used_percentage\":$2,\"resets_at\":$((EPOCHSECONDS + ${4:-3600}))},\"seven_day\":{\"used_percentage\":$3,\"resets_at\":$((EPOCHSECONDS + 86400))}}}" > $tmp/flota/cupos/$1.json }
en() { local d=$1; shift; (cd $d && HOME=$tmp HERDR_BROWSER_TASK=x#1 check "$@") }

cupo ccp 10 20; cupo ccw 10 20
en $tmp/Letz/repo $tmp/w -p hola             # Letz, los dos con espacio: ccw
en $tmp/Letz/repo/sub $tmp/w -p hola         # una subcarpeta del repo
en $tmp/wt/repo/task-1 $tmp/w -p hola        # worktree de Letz: cuenta su repo principal
en $tmp/Personal/otro $tmp/p -p hola         # lo demás: ccp
en $tmp/suelta $tmp/p -p hola                # carpeta sin git
(cd $tmp/Letz/repo && HOME=$tmp check ninguno -p hola)   # fuera de una tarea: como siempre
cupo ccw 10 90; en $tmp/Letz/repo $tmp/p -p hola         # ccw en su techo de 7 d: ccp
cupo ccw 95 20; en $tmp/wt/repo/task-1 $tmp/p -p hola    # ccw sobre su techo de 5 h: ccp
cupo ccw 95 20 -60; en $tmp/Letz/repo $tmp/w -p hola     # esa ventana ya reinició: ccw
cupo ccp 100 50; cupo ccw 10 20
en $tmp/Personal/otro $tmp/w -p hola         # ccp agotado y ccw con espacio: ccw
cupo ccw 99 95; en $tmp/Personal/otro $tmp/p -p hola     # los dos agotados: el preferido (y el Backup pasa a Codex)
en $tmp/Letz/repo $tmp/w -p hola
cupo ccp 10 20; cupo ccw 92 20
print '{"ccw": 95}' > $tmp/flota/presupuesto.json
en $tmp/Letz/repo $tmp/w -p hola             # presupuesto.json sube el techo de ccw: sigue en ccw
rm $tmp/flota/presupuesto.json $tmp/flota/cupos/ccw.json; cupo ccp 100 20
en $tmp/Personal/otro $tmp/w -p hola         # ccw sin dato: cuenta con espacio
cupo ccw 100 100; cupo ccp 10 10
en $tmp/Letz/repo $tmp/w --resume id-reg-w   # reanudar nunca cambia de perfil, aunque esté agotado
en $tmp/Letz/repo ninguno --continue
en $tmp/Personal/otro $tmp/w --resume id-reg-w
(cd $tmp/Personal/otro && CLAUDE_CONFIG_DIR=$tmp/w HOME=$tmp HERDR_BROWSER_TASK=x#1 check $tmp/w -p hola)  # perfil ya puesto
FLOTA_ASIENTOS=$tmp/no-existe en $tmp/Letz/repo ninguno -p hola   # sin mapa: como siempre

# Los dos agotados: el Backup agent de Shepherdr toma la tarea con Codex cuando Claude se detiene.
# Se le pasa la línea que Claude Code escribe al quedarse sin cuota (copiada de un log real).
sh=${SHEPHERDR:-$HOME/Codes/Personal/shepherdr}/mods/tasks/bin
if [[ -d $sh/herdr_task ]]; then
  print -r -- '{"type":"assistant","isApiErrorMessage":true,"error":"rate_limit","apiErrorStatus":429,"uuid":"u1","message":{"content":[{"type":"text","text":"You'"'"'ve hit your weekly limit · resets 11pm (America/Bogota)"}]}}' > $tmp/limite.jsonl
  [[ $(cd $sh && python3 -c 'import sys; from herdr_task.takeover import cant_go_on; print(cant_go_on(sys.argv[1]))' $tmp/limite.jsonl) == True ]] \
    || { print "FALLA: el Backup de Shepherdr no reconoce el fin de cuota de Claude"; exit 1; }
  backup="+ Backup"
else
  backup="(Backup sin probar: no encontré Shepherdr)"
fi
print "ok: 11 casos de reanudar + hook + 19 de tarea por cuota $backup"
