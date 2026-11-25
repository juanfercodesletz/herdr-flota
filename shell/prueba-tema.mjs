// Prueba del tema de la web (web/flota-tema): cada variante define todas las variables que el ds.css de Shepherdr pone
// en :root (claro y oscuros), en sus tres bloques (claro, oscuro del sistema y oscuro elegido). Falla cuando una
// actualización de Shepherdr agrega una que el tema no tiene. Uso: node shell/prueba-tema.mjs [ruta de ds.css]
// ponytail: a propósito simple y estricta. Exige todas las variables de :root, sean color o no (hoy son solo colores;
// si Shepherdr agrega ahí un tamaño, avisa de más), y solo lee las formas exactas de :root: un selector con :root y
// variables que no sea una de ellas hace fallar la prueba con su nombre, en vez de adivinar qué cubre.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const ds = readFileSync(process.argv[2] || `${homedir()}/Codes/Personal/shepherdr/web/src/ds.css`, 'utf8')
const tema = readFileSync(new URL('../web/flota-tema/tema.css', import.meta.url), 'utf8')
const cliente = readFileSync(new URL('../web/flota-tema/client.tsx', import.meta.url), 'utf8')

let fallas = 0
const falla = (s) => { fallas++; console.log(`FALLA ${s}`) }
const MODOS = { '': 'claro', ':not([data-theme="light"])': 'oscuro del sistema', '[data-theme="dark"]': 'oscuro elegido' }

/** cada regla sin llaves dentro (también la de dentro de un @media) que declara variables y nombra :root:
 *  [selector sin espacios, [variables]] */
const raices = (css) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, sel, cuerpo]) => [sel.replace(/\s+/g, ''), [...cuerpo.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])])
    .filter(([sel, vars]) => sel.includes(':root') && vars.length)

const variables = new Set()
for (const [sel, vars] of raices(ds)) {
  if (sel.startsWith(':root') && sel.slice(5) in MODOS) vars.forEach((v) => variables.add(v))
  else falla(`ds.css: no sé leer el selector ${sel}`)
}
if (variables.size < 15) falla(`ds.css: solo ${variables.size} variables en :root`)

const tiene = {}
for (const [sel, vars] of raices(tema)) {
  const m = sel.match(/^:root\[data-flota-tema="(\w+)"\](.*)$/)
  if (m && m[2] in MODOS) vars.forEach((v) => ((tiene[m[1]] ??= {})[m[2]] ??= new Set()).add(v))
  else falla(`tema.css: no sé leer el selector ${sel}`)
}

const variantes = Object.keys(tiene)
const declaradas = JSON.parse(cliente.match(/const VARIANTES = (\[[^\]]*\])/)[1].replaceAll("'", '"'))
if (variantes.join() !== declaradas.join()) falla(`client.tsx dice ${declaradas.join(', ')} y tema.css trae ${variantes.join(', ')}`)
for (const v of variantes) for (const [m, cual] of Object.entries(MODOS)) {
  const faltan = [...variables].filter((n) => !tiene[v][m]?.has(n))
  if (faltan.length) falla(`${v} (${cual}): le falta ${faltan.join(' ')}`)
}
console.log(fallas ? `${fallas} fallas` : `ok: ${variantes.join(', ')} definen las ${variables.size} variables de :root de Shepherdr en claro y oscuro`)
process.exit(fallas ? 1 : 0)
