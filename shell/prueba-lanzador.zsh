#!/bin/zsh -f
# Prueba de bin/flota-lanzar con tres asientos desechables de verdad (ccp, ccw y codex), en el
# modelo más barato. Comprueba etiquetas, perfil y que el encargo entró; al final borra todo lo suyo.
# Uso: zsh shell/prueba-lanzador.zsh   (unos 2 min; gasta unos pocos miles de tokens por asiento)
lanzar=${0:a:h:h}/bin/flota-lanzar
perfiles=${FLOTA_PERFIL_DIR:-$HOME/.herdr/flota/perfil}
encargos=${FLOTA_ENCARGOS:-$HOME/.herdr/flota/encargos}
dia=$HOME/.codex/sessions/${(%):-%D{%Y/%m/%d}}
typeset -A dir term palabra=(ccp girasol ccw tortuga codex cometa)
fallas=0
falla() { print -- "FALLA: $*"; (( fallas++ )) }
slug() { print -r -- ${1//[^A-Za-z0-9]/-} }  # carpeta de proyecto de Claude para un cwd
cfg_de() { [[ $1 == ccp ]] && print $HOME/.claude || print $HOME/.claude-work }

limpiar() {
  local a id f
  for a in ${(k)term}; do hc kill $term[$a] >/dev/null 2>&1; hc rm $term[$a] >/dev/null 2>&1; done
  for a in ccp ccw; do
    [[ -n $dir[$a] ]] || continue
    for f in $(cfg_de $a)/projects/$(slug $dir[$a])/*.jsonl(N); do rm -f $perfiles/${f:t:r}; done
    rm -rf $(cfg_de $a)/projects/$(slug $dir[$a])
  done
  [[ -n $dir[codex] ]] && rm -f $(grep -l -- $dir[codex] $dia/*.jsonl(N) 2>/dev/null)
  rm -f $encargos/prueba-{ccp,ccw}.md $dir[codex]/../encargo-$$.md
  for a in ${(k)dir}; do rm -rf $dir[$a]; done
}
trap limpiar EXIT INT TERM

for a in ccp ccw codex; do dir[$a]=${$(mktemp -d /tmp/flota-prueba-$a.XXXXXX):A}; done
# Claude con el encargo en texto; Codex con el encargo en un archivo.
arch=${dir[codex]:h}/encargo-$$.md
print "Responde solo con esta palabra, sin nada mas: $palabra[codex]" > $arch
for a in ccp ccw codex; do
  if [[ $a == codex ]]; then
    extra=(--modelo gpt-6-luna --esfuerzo low --encargo-archivo $arch)
  else
    extra=(--modelo haiku --esfuerzo low --encargo "Responde solo con esta palabra, sin nada mas: $palabra[$a]")
  fi
  term[$a]=$($lanzar --asiento $a --producto prueba --rol tester --padre tpm-prueba --tarea PRB-$a \
    --nombre prueba-$a --cwd $dir[$a] $extra) || { falla "$a no arrancó"; continue }
done

for a in ${(k)term}; do
  t=$term[$a]
  hc wait $t --timeout 120 >/dev/null
  pantalla=$(hc read $t)

  # Las cinco etiquetas.
  esperado="prueba tester tpm-prueba PRB-$a $a"
  got=$(hc get $t --json | jq -r '.labels | [."flota.producto", ."flota.rol", ."flota.padre", ."flota.tarea", ."flota.asiento"] | join(" ")')
  [[ $got == $esperado ]] || falla "$a etiquetas: $got (esperaba $esperado)"

  # El perfil.
  if [[ $a == codex ]]; then
    [[ ${(L)pantalla} == *"gpt-6-luna low"* ]] || falla "codex: la barra no dice gpt-6-luna low"
  else
    f=($(cfg_de $a)/projects/$(slug $dir[$a])/*.jsonl(N))
    if (( $#f != 1 )); then falla "$a: $#f sesiones en el proyecto (esperaba 1)"
    elif [[ $(<$perfiles/${f[1]:t:r} 2>/dev/null) != $(cfg_de $a) ]]; then falla "$a: el registro de perfil de ${f[1]:t:r} no dice $(cfg_de $a)"
    fi
  fi

  # Respondió con su palabra: el encargo entró (la palabra solo está en el archivo, no en el puntero).
  [[ $pantalla == *$palabra[$a]* ]] || { falla "$a no respondió $palabra[$a]"; print -r -- $pantalla | tail -20 }
  (( fallas )) || print "ok: $a ($t) etiquetas, perfil y encargo"
done

(( $#term == 3 && fallas == 0 )) && print "ok: 3 asientos" || { print "$fallas fallas"; exit 1 }
