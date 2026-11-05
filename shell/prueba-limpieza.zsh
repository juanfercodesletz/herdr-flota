#!/bin/zsh -f
# Prueba de bin/flota-limpiar con worktrees desechables en una carpeta temporal: en seco no borra nada; de
# verdad borra solo el mergeado y limpio, y no toca el que tiene cambios, el que tiene commits sin pushear,
# el que tiene un proceso dentro ni el recién usado. Solo la parte de worktrees: no toca uv ni Docker.
# Uso: zsh shell/prueba-limpieza.zsh   (unos segundos)
limpiar=${0:a:h:h}/bin/flota-limpiar
tmp=${$(mktemp -d /tmp/flota-limpieza.XXXXXX):A}
trap 'kill $pid 2>/dev/null; rm -rf $tmp' EXIT INT TERM
fallas=0
falla() { print -- "FALLA: $*"; (( fallas++ )) }
g() { git -C $1 -c user.name=prueba -c user.email=prueba@local -c commit.gpgsign=false "${@:2}" }

git init -q --bare -b main $tmp/remoto.git
git clone -q $tmp/remoto.git $tmp/repo 2>/dev/null
g $tmp/repo commit -q --allow-empty -m base && g $tmp/repo push -q origin main
wt=$tmp/wt/repo; mkdir -p $wt
for n in hecho sucio sin-push ocupado reciente; do
  g $tmp/repo worktree add -q -b t/$n $wt/$n main
  echo $n > $wt/$n/$n.txt && g $wt/$n add $n.txt && g $wt/$n commit -q -m $n
  [[ $n == sin-push ]] && continue
  g $wt/$n push -q origin t/$n
  g $tmp/repo merge -q --no-edit t/$n && g $tmp/repo push -q origin main
done
echo a medias > $wt/sucio/nota.txt                       # sin commitear
(cd $wt/ocupado && exec sleep 60) & pid=$!                # alguien trabajando dentro
touch -t $(date -v-2d +%Y%m%d%H%M) $tmp/repo/.git/worktrees/*/{index,HEAD,logs/HEAD}(N)
touch $tmp/repo/.git/worktrees/reciente/index             # usado hace un rato

correr() { FLOTA_WORKTREES=$tmp/wt $limpiar "$@" worktrees }

seco=$(correr --en-seco)
for n in hecho sucio sin-push ocupado reciente; do [[ -d $wt/$n ]] || falla "en seco borró $n"; done
[[ $seco == *"Borraría (mergeados y limpios): 1"*"repo/hecho"* ]] || falla "en seco no dice que borraría hecho"
for n in "sucio — 1 sin commitear (nota.txt)" "sin-push — 1 commits sin pushear" "ocupado — hay un proceso" "reciente — usado hace menos de 24 h"; do
  [[ $seco == *"repo/$n"* ]] || falla "en seco no lista «$n»"
done

real=$(correr)
[[ -d $wt/hecho ]] && falla "no borró hecho"
g $tmp/repo worktree list | grep -q "/hecho " && falla "hecho sigue en git worktree list"
[[ $real == *"Borré (mergeados y limpios): 1"* ]] || falla "no dice que borró hecho"
for n in sucio sin-push ocupado reciente; do [[ -d $wt/$n ]] || falla "borró $n"; done
[[ $(<$wt/sucio/nota.txt) == "a medias" ]] || falla "tocó el cambio sin commitear de sucio"

if (( fallas )); then print -r -- "$seco"; print -r -- "$real"; print "$fallas fallas"; exit 1; fi
print "ok: en seco no borra; de verdad borra solo el mergeado y limpio (4 se quedan)"
