# herdr-flota

Layout y mods de la app Herdr para operar una flota de agentes guiada por un TPM:
productos → TPM → capitanes → sesiones en worktrees, con iniciativas de ClickUp,
decisiones por lotes y la salud del entorno.

Diseño (canvas): https://claude.ai/artifact/5rVDW3BgbwVmEpvcSkQ9Lj — ronda 3 es la vigente.

## Cómo se ve

- **Izquierda:** árbol de productos. Clic en un capitán o sesión → su terminal en peek.
- **Centro:** la terminal del TPM. Solo el humano escribe ahí; los agentes le hablan por canal.
- **Vistas del producto:** Iniciativas (épicas y tareas sueltas; clic en épica → hoja inferior
  con sus tareas), Tablero (tarjetas del mismo alto), Gantt, Decisiones.
- **Derecha:** Entorno, compartido por todo: cupo 5h y 7d por suscripción, CPU, RAM, disco y
  sesiones contra su presupuesto. Solo se colorea lo que está cerca o encima del límite.

## Fuentes de verdad

| Dato | Fuente | Quién escribe |
|---|---|---|
| Épicas, tareas y sus estados | ClickUp | el TPM (único escritor) |
| Estado real de cada sesión | herdr-core | los agentes |
| PRs y CI | GitHub | los agentes |
| Decisiones | base de datos del artefacto del Gantt | agentes (preguntas), Juan (respuestas) |

Herdr no puede leer la base de datos de un artefacto (verificado el 4-nov-2026: `claude -p`
no tiene ArtifactData y no hay API pública). Por eso el TPM es el puente: en cada tick escribe
`~/.herdr/flota/<producto>.json` y recoge las respuestas que se den en Herdr.

## Plan, paso a paso

0. Repo y plan. ← aquí
1. Decidir la base: Shepherdr (github.com/eliasstravik/shepherdr) con add-ons propios, o layout propio.
2. La flota corre en herdr-core (`hc`), con etiquetas `flota.producto`, `flota.rol`,
   `flota.padre`, `flota.tarea` en cada terminal.
3. Árbol de productos.
4. Entorno.
5. Iniciativas, desde el archivo que escribe el TPM.
6. Decisiones, con el puente del TPM.
7. Tablero y Gantt.

Cada paso se prueba en la app antes de seguir (`herdr-app check`, `herdr-app shot`).
