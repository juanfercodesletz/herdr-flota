// Prueba del tema de la web (web/flota-tema): cada variante define todas las variables de color de :root del ds.css
// de Shepherdr en sus tres bloques (claro, oscuro del sistema y oscuro elegido). Falla cuando una actualización de
// Shepherdr agrega una que el tema no tiene. Uso: node shell/prueba-tema.mjs [ruta de ds.css]
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const ds = readFileSync(process.argv[2] || `${homedir()}/Codes/Personal/shepherdr/web/src/ds.css`, 'utf8')
const tema = readFileSync(new URL('../web/flota-tema/tema.css', import.meta.url), 'utf8')
const cliente = readFileSync(new URL('../web/flota-tema/client.tsx', import.meta.url), 'utf8')

const nombres = (bloque) => new Set([...bloque.matchAll(/(--[\w-]+):/g)].map((m) => m[1]))
const raiz = ds.match(/^:root\{([^}]*)\}/m)
if (!raiz) throw new Error('ds.css sin su bloque :root{…}')
const colores = [...nombres(raiz[1])]
if (colores.length < 15) throw new Error(`ds.css: solo ${colores.length} variables en :root`)

const variantes = [...new Set([...tema.matchAll(/data-flota-tema="(\w+)"\]\{color-scheme:light/g)].map((m) => m[1]))]
const declaradas = JSON.parse(cliente.match(/const VARIANTES = (\[[^\]]*\])/)[1].replaceAll("'", '"'))
let fallas = 0
const falla = (s) => { fallas++; console.log(`FALLA ${s}`) }
if (variantes.join() !== declaradas.join()) falla(`client.tsx dice ${declaradas.join(', ')} y tema.css trae ${variantes.join(', ')}`)

for (const v of variantes) {
  const sel = `:root[data-flota-tema="${v}"]`
  for (const [cual, abre] of [['claro', `${sel}{`], ['oscuro del sistema', `${sel}:not([data-theme="light"]){`], ['oscuro elegido', `${sel}[data-theme="dark"]{`]]) {
    const i = tema.indexOf(abre)
    if (i < 0) { falla(`${v}: no tiene su bloque ${cual}`); continue }
    const tiene = nombres(tema.slice(i + abre.length, tema.indexOf('}', i)))
    const faltan = colores.filter((c) => !tiene.has(c))
    if (faltan.length) falla(`${v} (${cual}): le falta ${faltan.join(' ')}`)
  }
}
console.log(fallas ? `${fallas} fallas` : `ok: ${variantes.join(', ')} definen las ${colores.length} variables de color de Shepherdr en claro y oscuro`)
process.exit(fallas ? 1 : 0)
