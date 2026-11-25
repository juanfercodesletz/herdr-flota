// Prueba del tema de la web (web/flota-tema): cada variante define todas las variables de color que el ds.css de
// Shepherdr pone en :root (claro u oscuro), en sus tres bloques (claro, oscuro del sistema y oscuro elegido). Falla
// cuando una actualización de Shepherdr agrega una que el tema no tiene. Uso: node shell/prueba-tema.mjs [ruta de ds.css]
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const ds = readFileSync(process.argv[2] || `${homedir()}/Codes/Personal/shepherdr/web/src/ds.css`, 'utf8')
const tema = readFileSync(new URL('../web/flota-tema/tema.css', import.meta.url), 'utf8')
const cliente = readFileSync(new URL('../web/flota-tema/client.tsx', import.meta.url), 'utf8')

/** cada regla sin llaves dentro (la de dentro de un @media también), un selector agrupado por cada uno de los suyos:
 *  {selector sin espacios: [[variable, valor]…]} */
function reglas(css) {
  const r = {}
  for (const [, sels, cuerpo] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g))
    for (const sel of sels.split(',')) {
      const k = sel.replace(/\s+/g, '')
      for (const [, v, val] of cuerpo.matchAll(/(--[\w-]+)\s*:([^;]*)/g)) (r[k] ??= []).push([v, val.trim()])
    }
  return r
}
// ponytail: color es todo lo que no sea un tamaño, un número o un tiempo (nombres, var(), hex, rgb()…): mejor un
// aviso de más que dejar pasar un color nuevo
const esColor = (val) => !/^(-?[\d.]+(px|rem|em|%|ms|s|vh|vw|dvh|fr|deg)?|calc\(.*\))$/i.test(val)
const MODOS = [['claro', ''], ['oscuro del sistema', ':not([data-theme="light"])'], ['oscuro elegido', '[data-theme="dark"]']]

const de = reglas(ds)
const colores = [...new Set(MODOS.flatMap(([, m]) => (de[`:root${m}`] ?? []).filter(([, val]) => esColor(val)).map(([v]) => v)))]
if (colores.length < 15) throw new Error(`ds.css: solo ${colores.length} variables de color en :root`)

const t = reglas(tema)
const variantes = [...new Set(Object.keys(t).map((k) => k.match(/^:root\[data-flota-tema="(\w+)"\]$/)?.[1]).filter(Boolean))]
const declaradas = JSON.parse(cliente.match(/const VARIANTES = (\[[^\]]*\])/)[1].replaceAll("'", '"'))
let fallas = 0
const falla = (s) => { fallas++; console.log(`FALLA ${s}`) }
if (variantes.join() !== declaradas.join()) falla(`client.tsx dice ${declaradas.join(', ')} y tema.css trae ${variantes.join(', ')}`)

for (const v of variantes) for (const [cual, m] of MODOS) {
  const tiene = new Set((t[`:root[data-flota-tema="${v}"]${m}`] ?? []).map(([n]) => n))
  if (!tiene.size) { falla(`${v}: no tiene su bloque ${cual}`); continue }
  const faltan = colores.filter((c) => !tiene.has(c))
  if (faltan.length) falla(`${v} (${cual}): le falta ${faltan.join(' ')}`)
}
console.log(fallas ? `${fallas} fallas` : `ok: ${variantes.join(', ')} definen las ${colores.length} variables de color de Shepherdr en claro y oscuro`)
process.exit(fallas ? 1 : 0)
