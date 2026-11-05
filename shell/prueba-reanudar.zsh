#!/bin/zsh -f
# Prueba de bin/flota-reanudar con tareas de Shepherdr de verdad, en un herdr-core AISLADO: su propio
# socket y estado en /tmp (HC_SOCKET, que el guardia de herdr-task acepta cuando es el del terminal) y su
# propio almacén de tareas (HERDR_TASK_STORE), que el planificador real no ve; herdr-app es uno falso,
# para no tocar la ventana real. El core de verdad no se toca.
# Tres tareas desechables (Claude y Codex en worktrees, Claude en una carpeta con espacio, modelos
# baratos), cada una recuerda una palabra. Reinicia ese core 3 veces: parada limpia, apagón (SIGKILL al
# core y todo lo suyo) y apagón con 2 en medio de un `sleep 120`. Tras cada uno comprueba que las 3
# volvieron solas con su misma conversación (repiten su palabra) y en su carpeta, sin compuertas, una
# reanudación por tarea, y sin la shell vacía de antes. Al final borra todo lo suyo.
# Uso: zsh shell/prueba-reanudar.zsh   (unos 6 min; gasta unos pocos miles de tokens por tarea)
setopt pipefail
raiz=${0:a:h:h}
base=/tmp/hfr.$$  # corto: el socket de hc no admite rutas largas
mkdir -p $base/{estado,tareas,bin} && : > $base/inicio  # inicio: lo de Codex más nuevo que esto es de la prueba
export XDG_STATE_HOME=$base/estado HC_SOCKET=$base/c.sock HC_TERMINAL_SOCKET=$base/c.sock HERDR_TASK_STORE=$base/tareas
unset HC_SESSION HC_TERMINAL_ID HC_SCOPE HERDR_BROWSER_TASK
# Que el core aislado no herede la sesión de Claude o Codex que corre la prueba (Claude no guardaría nada).
for v in ${(k)parameters[(I)(CLAUDE*|CODEX_*|ANTHROPIC*)]}; do unset $v; done
cat > $base/bin/herdr-app <<'EOF'
#!/bin/sh
# herdr-app falso de la prueba: herdr-task no llega a la ventana real.
case "$1" in ls) echo '{"spaces":[]}' ;; *) echo '{}' ;; esac
EOF
chmod +x $base/bin/herdr-app; export PATH=$base/bin:$PATH
perfiles=${FLOTA_PERFIL_DIR:-$HOME/.herdr/flota/perfil}
typeset -A palabra=(cl girasol cx cometa esp ballena) ref folder sesion term
fallas=0
falla() { print -- "FALLA: $*"; (( fallas++ )) }
slug() { print -r -- ${1//[^A-Za-z0-9]/-} }
core() { hc server status --json | jq -r .pid }
tarea() { herdr-task list --all --json | jq -c --arg r $1 '.[].tasks[] | select(.ref == $r)' }

# Solo se mata un core que tenga abierto el estado de esta prueba.
aislado() { local p=$(core); [[ -n $p ]] && lsof -p $p 2>/dev/null | grep -q -- $base || { print "ABORTO: el core $p no es el aislado"; exit 2 } }
apagon() {
  aislado
  arbol() { local c; for c in $(pgrep -P $1); do arbol $c; done; print $1 }
  kill -9 $(arbol $(core))
}

limpiar() {
  local a f d p
  [[ -n $vigia ]] && kill $vigia 2>/dev/null
  if aislado 2>/dev/null; then
    for a in $(hc ls --all --json | jq -r '.terminals[].address'); do hc kill $a >/dev/null 2>&1; hc rm $a >/dev/null 2>&1; done
    hc server stop >/dev/null 2>&1
  fi
  for p in $(pgrep -f "herdr-task _track"); do ps -E -p $p -o command= | grep -q "HERDR_TASK_STORE=$base/" && kill $p; done
  # Claude guarda su memoria en la raíz del repo, además de cada carpeta de trabajo.
  for d in ${(v)folder} ${repo:A}; do
    for a in $HOME/.claude $HOME/.claude-work; do
      for f in $a/projects/$(slug $d)/*.jsonl(N); do rm -f $perfiles/${f:t:r}; done
      rm -rf $a/projects/$(slug $d)
    done
    # Codex 0.166 guarda casi todo en sqlite (eso queda); sus rollout-*.jsonl de esta prueba se borran.
    for f in $(find ${CODEX_HOME:-$HOME/.codex}/sessions -name 'rollout-*.jsonl' -newer $base/inicio 2>/dev/null); do
      head -1 $f | grep -qF -- "\"cwd\":\"$d\"" && rm -f $f
    done
    [[ $d == $HOME/.herdr/worktrees/flota-reanudar-$$/* ]] && rm -rf $d
  done
  rmdir $HOME/.herdr/worktrees/flota-reanudar-$$ 2>/dev/null
  # La confianza que Codex anotó para el repo de la prueba (solo esa sección).
  python3 - ${CODEX_HOME:-$HOME/.codex}/config.toml ${repo:A} <<'PY'
import re, sys
p, d = sys.argv[1], sys.argv[2]
s = open(p).read()
t = re.sub(r'\n\[projects\."%s"\]\ntrust_level = "trusted"\n' % re.escape(d), "\n", s)
if t != s: open(p, "w").write(t)
PY
  rm -rf $base ${TMPDIR:-/tmp}/flota-reanudar.*flota-reanudar-$$*.lock(N) ${TMPDIR:-/tmp}/flota-reanudar.*hfr-$$*.lock(N)
}
trap limpiar EXIT
trap 'exit 1' INT TERM

aislado 2>/dev/null; hc server status >/dev/null; aislado
$raiz/bin/flota-reanudar 2>$base/vigia.log & vigia=$!

# Dos carpetas: un repo con worktrees (Claude y Codex) y una con espacio, sin worktree (Claude).
repo=$base/flota-reanudar-$$ esp="$base/carpeta con espacio"
for d in $repo $esp; do mkdir -p $d && git -C $d init -q && git -C $d commit -q --allow-empty -m inicio; done
nueva() {  # $1 clave, $2 carpeta, resto: opciones de add
  local k=$1 d=$2; shift 2
  ref[$k]=$(herdr-task add "Prueba reanudar $k" --folder $d "$@" --set review=off --set proof=off --json \
    --prompt "Recuerda esta palabra: $palabra[$k]. Responde solo: ok. No corras ningun comando, tampoco herdr-task." | jq -r .ref)
  herdr-task start $ref[$k] --folder $d --space spprueba --now >/dev/null || falla "$k no arrancó"
}
nueva cl $repo --agent claude --model haiku --effort low
nueva cx $repo --agent codex --model gpt-6-luna --effort low
nueva esp $esp --here --agent claude --model haiku --effort low

# Primer arranque en carpetas nuevas: se aceptan sus compuertas (tras un reinicio ya no deben salir).
for k in cl cx esp; do
  fin=$(( SECONDS + 120 ))
  while (( SECONDS < fin )); do
    t=$(tarea $ref[$k] | jq -r '.agents[-1].address // empty')
    [[ -n $t ]] || { sleep 1; continue }
    case $(hc read $t --lines 0 2>/dev/null) in
      *"Yes, I trust this folder"*) hc keys $t down enter >/dev/null; sleep 1; continue ;;
      *"trust the contents of this directory"*|*"Trust and continue"*) hc keys $t enter >/dev/null; sleep 1; continue ;;
      *"Hooks need review"*) hc keys $t esc >/dev/null; sleep 1; continue ;;
    esac
    [[ $(tarea $ref[$k] | jq -r '.agents[-1].session // empty') != "" && $(hc get $t --json | jq -r .status.state) == (idle|done) ]] && break
    hc wait $t --timeout 3 >/dev/null 2>&1 || sleep 1
  done
  info=$(tarea $ref[$k])
  term[$k]=$(jq -r '.agents[-1].address' <<<$info) sesion[$k]=$(jq -r '.agents[-1].session // empty' <<<$info)
  folder[$k]=$(jq -r '.worktree // .folder' <<<$info)
  [[ -n $sesion[$k] ]] || { falla "$k ($ref[$k]) no quedó listo"; hc read $term[$k] --lines 0 | grep -v '^\s*$' | tail -12; exit 1 }
done
print "ok: 3 tareas (${(kv)ref}) en ${(kv)term}"

comprobar() {  # $1: número de vuelta
  local n=$1 k t info fin pantalla viejo
  hc ls >/dev/null  # arranca el core, como lo haría la app
  for k in cl cx esp; do
    viejo=$term[$k] fin=$(( SECONDS + 150 ))
    while (( SECONDS < fin )); do
      t=$(tarea $ref[$k] | jq -r '.agents[-1].address // empty')
      # Codex pregunta por sus hooks sin aprobar en cada arranque (en el Mac de Juan ya están aprobados).
      [[ $t != $viejo && $(hc read $t --lines 0 2>/dev/null) == *"Hooks need review"* ]] && hc keys $t esc >/dev/null
      [[ $t != $viejo ]] && info=$(hc get $t --json 2>/dev/null) &&
        [[ $(jq -r --argjson d $desde '.state + " " + (if (.status_ms // 0) >= $d then .status.state // "" else "" end)' <<<$info) == "live idle" ]] && break
      sleep 2
    done
    [[ -n $t && $t != $viejo ]] || { falla "vuelta $n, $k: no volvió (sigue en $viejo)"; continue }
    term[$k]=$t
    pantalla=$(hc read $t --lines 0 2>/dev/null)
    [[ $pantalla == *(trust this folder|trust the contents|Trust and continue|Yes, I accept)* ]] && { falla "vuelta $n, $k: quedó en una compuerta"; continue }
    [[ $(jq -r '.foreground.name // "" | split("/")[-1]' <<<$info) != (|zsh|sh|bash) ]] || falla "vuelta $n, $k: corre una shell, no su agente"
    [[ $(jq -r .foreground.cwd <<<$info) == $folder[$k] ]] || falla "vuelta $n, $k: carpeta $(jq -r .foreground.cwd <<<$info) (esperaba $folder[$k])"
    [[ $(tarea $ref[$k] | jq -r '.agents[-1].session') == $sesion[$k] ]] || falla "vuelta $n, $k: cambió de conversación"
    hc get $viejo >/dev/null 2>&1 && falla "vuelta $n, $k: quedó la shell vacía $viejo"
    # Su conversación: la palabra solo la sabe la conversación de antes. Formato distinto por vuelta.
    hc send $t --wait --timeout 90 "Responde en una sola linea: V$n=<la palabra que te pedi recordar, en mayusculas>. No corras ningun comando." >/dev/null 2>&1
    pantalla=$(hc read $t --lines 30)
    [[ $pantalla == *V$n=${(U)palabra[$k]}* ]] || { falla "vuelta $n, $k: no repitió su palabra"; print -r -- $pantalla | grep -v '^\s*$' | tail -12 }
  done
  local veces=$(grep -c "retomó su sesión" $base/vigia.log)
  (( veces == 3 * n )) || falla "vuelta $n: $veces reanudaciones en total (esperaba $(( 3 * n )), una por tarea)"
  grep -E "traspaso|no pude" $base/vigia.log && falla "vuelta $n: el vigía no retomó alguna sesión"
  (( fallas )) && { print "vuelta $n: $fallas fallas"; tail -20 $base/vigia.log; exit 1 }
  print "ok: vuelta $n, las 3 volvieron con su conversación y en su carpeta"
}

en_marcha() {
  local k; for k in cl cx esp; do
    [[ $(tarea $ref[$k] | jq -r .state) == running ]] || { falla "$k quedó en $(tarea $ref[$k] | jq -r .state) antes de reiniciar (el vigía solo reanuda running)"; exit 1 }
  done
}
# 1. Parada limpia del core aislado.
en_marcha; desde=$(( $(date +%s) * 1000 )); aislado; hc server stop >/dev/null; comprobar 1
# 2. Apagón.
en_marcha; desde=$(( $(date +%s) * 1000 )); apagon; sleep 1; comprobar 2
# 3. Apagón con dos en medio de un comando largo.
for k in cl cx; do hc send $term[$k] "Ahora si corre un comando: ejecuta en la terminal sleep 120 y espera a que termine. Nada mas." >/dev/null; done
# Cortar cuando los dos sleep corren dentro del core aislado.
arbol() { local c; for c in $(pgrep -P $1); do arbol $c; done; print $1 }
fin=$(( SECONDS + 90 ))
until (( $(ps -o command= -p ${(j:,:)$(arbol $(core))} | grep -c '^sleep 120') >= 2 )) || (( SECONDS > fin )); do sleep 2; done
(( $(ps -o command= -p ${(j:,:)$(arbol $(core))} | grep -c '^sleep 120') >= 2 )) || falla "los dos sleep 120 no corrían al cortar"
en_marcha; desde=$(( $(date +%s) * 1000 )); apagon; sleep 1; comprobar 3

(( fallas == 0 )) && print "ok: 3 reinicios" || { print "$fallas fallas"; exit 1 }
