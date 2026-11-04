#!/bin/zsh -f
# Prueba de flota.zsh y perfil-hook.sh sin lanzar claude: perfiles y registros falsos.
# Uso: zsh shell/prueba.zsh
set -e
tmp=$(mktemp -d); trap 'rm -rf $tmp' EXIT
mkdir -p $tmp/p/projects/x $tmp/w/projects/y $tmp/reg
touch $tmp/p/projects/x/{id-p,id-reg-vacio,id-reg-p}.jsonl $tmp/w/projects/y/{id-w,id-reg-w}.jsonl
unset CLAUDE_CONFIG_DIR
export FLOTA_PERFIL_DIR=$tmp/reg
FLOTA_CLAUDE_PERFILES=($tmp/w)
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
check() { local got=$(claude "${@:2}"); [[ $got == $1 ]] || { print "FALLA: claude ${@:2} -> $got (esperaba $1)"; exit 1; }; }

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
print "ok: 11 casos + hook"
