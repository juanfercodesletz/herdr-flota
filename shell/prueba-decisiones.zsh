#!/bin/zsh
# zsh shell/prueba-decisiones.zsh: respuestas.py guarda la respuesta aparte del archivo del TPM, solo si es una de las
# opciones de una decisión abierta, y su servidor solo acepta escrituras con la cabecera, el origen y el dueño correctos.
# Todo en un HOME temporal y un puerto propio; no toca ~/.herdr ni el servicio real.
set -eu
here=${0:A:h:h}
py=$here/mods/flota-iniciativas/respuestas.py
tmp=$(mktemp -d)
export HOME=$tmp
port=$((17790 + RANDOM % 1000))
trap '[[ -n ${srv:-} ]] && kill $srv 2>/dev/null; rm -rf $tmp' EXIT
falla() { print -u2 "FALLA: $*"; exit 1; }

mkdir -p $tmp/.herdr/flota/web
cp $here/ejemplos/veta.json $tmp/.herdr/flota/veta.json
antes=$(shasum $tmp/.herdr/flota/veta.json)

# La app: guardar por línea de comandos.
python3 $py guardar veta.json D7 Mañana app >/dev/null
python3 $py guardar veta.json D7 Hoy app >/dev/null # cambiar de opinión pisa la anterior
[[ $(jq -r .D7.respuesta $tmp/.herdr/flota/respuestas/veta.json) == Hoy ]] || falla "no guardó D7"
[[ $(jq -r .D7.desde $tmp/.herdr/flota/respuestas/veta.json) == app ]] || falla "desde"
for malo in "veta.json D7 Quizás" "veta.json D99 Hoy" "../veta.json D7 Hoy" "presupuesto.json D7 Hoy" "nada.json D7 Hoy"; do
  python3 $py guardar ${=malo} app 2>/dev/null && falla "aceptó: $malo"
done
# Texto libre: con la opción, o solo; vacío o de más de 1000 caracteres, no.
python3 $py guardar veta.json D7 Hoy app "pero antes de las 12" >/dev/null
[[ $(jq -r '.D7.respuesta + "|" + .D7.texto' $tmp/.herdr/flota/respuestas/veta.json) == "Hoy|pero antes de las 12" ]] || falla "opción con texto"
python3 $py guardar veta.json D9 "" app "ninguna de las dos" >/dev/null
[[ $(jq -r '.D9.respuesta + "|" + .D9.texto' $tmp/.herdr/flota/respuestas/veta.json) == "|ninguna de las dos" ]] || falla "solo texto"
python3 $py guardar veta.json D9 "" app "   " 2>/dev/null && falla "aceptó vacío"
python3 $py guardar veta.json D9 "" app "$(printf 'x%.0s' {1..1001})" 2>/dev/null && falla "aceptó 1001 caracteres"
# Una cerrada ya no se responde.
jq '.decisiones[0].estado = "cerrada"' $here/ejemplos/veta.json > $tmp/.herdr/flota/cerrada.json
python3 $py guardar cerrada.json D7 Hoy app 2>/dev/null && falla "respondió una cerrada"

# La web: el servidor.
# Con el PATH pelado de launchd, como el servicio dev.herdr-flota.web.
env PATH=/usr/bin:/bin:/usr/sbin:/sbin ${commands[python3]} $py servir $port $tmp/.herdr/flota/web & srv=$!
for i in {1..50}; do curl -s -o /dev/null http://127.0.0.1:$port/ && break; sleep 0.1; done
echo '{"at":1}' > $tmp/.herdr/flota/web/iniciativas.json
[[ $(curl -s http://127.0.0.1:$port/iniciativas.json) == '{"at":1}' ]] || falla "no sirve la foto"
post() { curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:$port/respuesta -H 'Content-Type: application/json' "$@"; }
cuerpo='{"archivo":"veta.json","id":"D9","respuesta":"Parchear"}'
[[ $(post -d $cuerpo) == 403 ]] || falla "sin X-Flota"
[[ $(post -H 'X-Flota: 1' -H 'Origin: https://malo.example' -d $cuerpo) == 403 ]] || falla "con Origin desde 127.0.0.1"
[[ $(post -H 'X-Flota: 1' -H 'Sec-Fetch-Site: cross-site' -d $cuerpo) == 403 ]] || falla "cross-site"
host=bici.tail0.ts.net
[[ $(post -H 'X-Flota: 1' -H "Host: $host" -H 'Tailscale-User-Login: otro@example.com' -H "Origin: https://$host" -d $cuerpo) == 403 ]] || falla "otro login"
[[ $(post -H 'X-Flota: 1' -H "Host: $host" -d $cuerpo) == 403 ]] || falla "host del tailnet sin login"
[[ $(post -H 'X-Flota: 1' -d '{"archivo":"veta.json","id":"D9","respuesta":"Otra"}') == 400 ]] || falla "opción inventada"
[[ $(post -H 'X-Flota: 1' -d $cuerpo) == 200 ]] || falla "local, con X-Flota"
[[ $(jq -r '.D9.respuesta + " " + .D9.desde + " " + .D7.respuesta' $tmp/.herdr/flota/respuestas/veta.json) == "Parchear web Hoy" ]] || falla "web no guardó D9"
[[ $(post -H 'X-Flota: 1' -d '{"archivo":"veta.json","id":"D9","respuesta":"","texto":"lo hablamos"}') == 200 ]] || falla "web, solo texto"
[[ $(jq -r '.D9.texto' $tmp/.herdr/flota/respuestas/veta.json) == "lo hablamos" ]] || falla "web no guardó el texto"
[[ $(post -H 'X-Flota: 1' -d '{"archivo":"veta.json","id":"D9","respuesta":""}') == 400 ]] || falla "web, nada"
# Por el tailnet: el dueño de este Mac, con el origen de la página.
duenio=$(tailscale status --json 2>/dev/null | jq -r '.User[(.Self.UserID|tostring)].LoginName' 2>/dev/null || true)
if [[ -n $duenio && $duenio != null ]]; then
  [[ $(post -H 'X-Flota: 1' -H "Host: $host" -H "Tailscale-User-Login: $duenio" -H "Origin: https://$host" -d $cuerpo) == 200 ]] || falla "dueño por el tailnet"
  [[ $(post -H 'X-Flota: 1' -H "Host: $host" -H "Tailscale-User-Login: $duenio" -H "Origin: https://otro.ts.net" -d $cuerpo) == 403 ]] || falla "dueño, otro origen"
else print "  (sin tailscale: no pruebo el dueño)"; fi

[[ $(shasum $tmp/.herdr/flota/veta.json) == $antes ]] || falla "tocó el archivo del TPM"
print ok
