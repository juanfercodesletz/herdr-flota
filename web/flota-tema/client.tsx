// Tema de la flota para la web de Shepherdr (3.2): otro aspecto sin tocar Shepherdr, así que se sigue aplicando tras
// cada `shepherdr update`. Pone `data-flota-tema=<variante>` en <html> y tema.css hace el resto: sus colores (claro
// y oscuro, los que elige Ajustes › Tema), tipografía, tamaños y radios. Sin variante, la web queda como viene.
// `?tema=<variante>` en la URL la muestra (`?tema=original`, la de Shepherdr). shell/prueba-tema.mjs avisa si
// Shepherdr agrega un color que alguna variante no define.
import { definePlugin } from '@client/kernel.ts'
import './tema.css'

const VARIANTES = ['tinta', 'atom', 'nitida']
/** la variante de siempre; '' deja la de Shepherdr */
const DEFECTO = ''

/** la barra del navegador y la del teléfono, del fondo de la variante: Shepherdr (prefs.ts) las pone a su blanco o
 *  negro al abrir y en cada cambio de tema, y aquí se corrigen detrás */
function barras() {
  const fondo = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name=theme-color]')) if (fondo && m.content !== fondo) m.content = fondo
}

export default definePlugin({
  name: 'flota-tema',
  setup() {
    const pedida = new URLSearchParams(location.search).get('tema')
    const tema = pedida === null ? DEFECTO : VARIANTES.includes(pedida) ? pedida : ''
    if (!tema) return
    document.documentElement.dataset.flotaTema = tema
    barras()
    const ojo = new MutationObserver(barras)
    ojo.observe(document.head, { subtree: true, attributeFilter: ['content'] })
    ojo.observe(document.documentElement, { attributeFilter: ['data-theme'] })
  },
})
