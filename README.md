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
- **También desde el iPhone:** Juan maneja la flota por la web de Shepherdr sobre Tailscale. Todo lo
  que se vea o se use tiene que leerse bien a 390 × 844, sin scroll horizontal, con áreas táctiles
  cómodas y sin depender de teclas que el teléfono no tiene. Se comprueba con Playwright a ese tamaño.

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

0. Repo y plan. ✓
1. Shepherdr instalado como base. ✓
2. La flota corre en herdr-core (`hc`), con etiquetas `flota.producto`, `flota.rol`,
   `flota.padre`, `flota.tarea` y `flota.asiento` en cada terminal. En curso: lanzador ✓.
3. Árbol de productos.
4. Entorno. ✓ (primero, por ser independiente del resto)
5. Iniciativas, desde el archivo que escribe el TPM. ✓
6. Decisiones, con el puente del TPM.
7. Tablero y Gantt.

Cada paso se prueba en la app antes de seguir (`herdr-app check`, `herdr-app shot`).

## Instalar

1. Instala Shepherdr (`./install.sh` en su repo) y corre `shepherdr doctor`.
2. En este repo: `./install.sh`. Copia los mods y genera el layout `flota` desde el de Shepherdr.
   Vuelve a correrlo después de cada `shepherdr update`.
3. Para que Entorno vea el cupo de Claude Code, agrega esta línea a tu script de barra de estado,
   después de leer `rate_limits` (cambia `ccp` por el nombre del perfil):

   ```sh
   [ -n "$rl_5h$rl_7d" ] && { c="$HOME/.herdr/flota/cupos"; mkdir -p "$c"; echo "$input" | jq -c '{at: (now|floor), rate_limits}' > "$c/ccp.json.$$" && mv "$c/ccp.json.$$" "$c/ccp.json"; }
   ```

   Codex no necesita nada: Entorno lee su cupo del último log en `~/.codex/sessions`.
4. Los techos se cambian en `~/.herdr/flota/presupuesto.json`, por ejemplo
   `{"ccw": 90, "ccp": 90, "codex": 100, "cpu": 85, "ram": 90, "sesiones": 100}`.
   El disco tiene un solo límite, el de Shepherdr: el `start_disk` de `~/.herdr/shepherdr.json`
   (`everywhere.machine.start_disk`, 90 si no está). Entorno mide el % lleno como Shepherdr (el más lleno
   entre home y /tmp) y, al pasarlo, se pone rojo y dice que Shepherdr no arranca tareas nuevas. Lo que
   ocupa la flota (worktrees sin `.venv`, caché de uv, Docker de OrbStack, medido cada 30 min) va de dato
   debajo. Prueba: `zsh shell/prueba-disco.zsh` (Entorno y Shepherdr paran en el mismo punto).
5. Entorno en la web de Shepherdr (el iPhone): `install.sh` deja el plugin en `~/.shepherdr/plugins/flota-entorno`
   (`web/flota-entorno` + el `calc.js` del mod), levanta el servicio launchd `dev.herdr-flota.web` (sirve
   `~/.herdr/flota/web` en 127.0.0.1:7790), publica `/flota` con `tailscale serve` y corre `shepherdr update` para
   reconstruir la web. Necesita que Shepherdr cargue plugins de `~/.shepherdr/plugins` (commit local 07859b09 en
   la copia de Shepherdr, «Web: load the human's own plugins»). Los datos son la foto que escribe el panel del
   escritorio cada 15 s: con Herdr cerrado o sin el layout `flota`, la web avisa que el dato es viejo.
   En el teléfono: cajón de espacios → **Entorno**, al pie. Se quita con
   `launchctl bootout gui/$(id -u)/dev.herdr-flota.web` y `tailscale serve --set-path /flota off`.
6. El vigía del disco: `install.sh` levanta el servicio launchd `dev.herdr-flota.vigia`, que cada 10 min corre
   `bin/flota-vigia` (sin tokens). Si el disco pasa `start_disk − disco_margen` (3 por defecto, en
   `presupuesto.json`), lanza **un** agente de limpieza en hc con `flota-lanzar` (ccp, Sonnet), fuera de la cola
   de herdr-task, que se traba justo con el disco lleno. Nunca dos a la vez: no relanza mientras el anterior
   trabaja, ni más de una vez por hora. Log: `~/.herdr/flota/vigia/log`.
   El agente sigue `encargos/limpieza.md`: corre `bin/flota-limpiar`, que borra **solo** lo seguro (`uv cache
   prune` sin `--force`, imágenes colgadas y caché de builds de Docker, y worktrees de `~/.herdr/worktrees`
   mergeados, limpios, sin nadie dentro y quietos 24 h, con `git worktree remove`), lista lo demás con su
   tamaño y avisa a Juan con `herdr-task alert`. Informe en `~/.herdr/flota/vigia/informe.md`.
   `bin/flota-limpiar --en-seco` mide e informa sin borrar; `FLOTA_VIGIA_UMBRAL=0 bin/flota-vigia` prueba el
   vigía con un umbral falso (y siempre en seco). Pruebas: `zsh shell/prueba-limpieza.zsh` (worktrees
   desechables) y `zsh shell/prueba-vigia.zsh` (un agente real en seco, ~5 min).
   Se quita con `launchctl bootout gui/$(id -u)/dev.herdr-flota.vigia`.
7. Para que cada sesión de Claude vuelva con su perfil tras un reinicio (Herdr las relanza con
   `claude --resume <id>`, sin perfil), carga la función en `~/.zshrc`:

   ```sh
   [ -f ~/Codes/Personal/herdr-flota/shell/flota.zsh ] && source ~/Codes/Personal/herdr-flota/shell/flota.zsh
   ```

   y agrega el hook que anota el perfil de cada sesión al arrancar, en el `settings.json` de
   **cada** perfil (`~/.claude`, `~/.claude-work`), dentro de `hooks.SessionStart`:

   ```json
   {"hooks": [{"type": "command", "command": "sh '/Users/juanfer/Codes/Personal/herdr-flota/shell/perfil-hook.sh'", "timeout": 5}]}
   ```

   Los registros quedan en `~/.herdr/flota/perfil/<session_id>`. Prueba: `zsh shell/prueba.zsh`.

## Iniciativas

El TPM de cada producto escribe en cada tick `~/.herdr/flota/<producto>.json` (de ClickUp, que Herdr no lee).
Ejemplo completo: `ejemplos/veta.json`.

```json
{
  "producto": "Veta",
  "epicas": [
    { "id": "86e3yj2qg", "titulo": "Órdenes de compra en causaciones", "estado": "a tiempo",
      "link": "https://app.clickup.com/t/86e3yj2qg",
      "tareas": [{ "id": "86e3yk0t6", "titulo": "Traer OC al detalle", "estado": "en curso",
                   "link": "https://app.clickup.com/t/86e3yk0t6", "sesion": "autor-86e3yk0t6" }] }
  ],
  "sueltas": [{ "id": "86e3z0aln", "titulo": "Reintento de envío a Alanube", "estado": "en cola",
                "link": "https://app.clickup.com/t/86e3z0aln" }]
}
```

- `producto` y `titulo` son obligatorios; lo demás puede faltar. Títulos en lenguaje de producto.
- `id`: el de ClickUp. Es el que va en `flota-lanzar --tarea`, así la sesión lleva `flota.tarea=<id>`.
- `sesion`: el nombre del terminal en hc que la trabaja, solo mientras la hay.
- Estado de tarea: `en cola`, `en curso`, `auditoría`, `PR abierto`, `bloqueada` o `merged` (cada uno con su color
  y su parte en la barra de la épica); otro texto se muestra tal cual, como en curso. El de la épica es libre
  (`a tiempo`, `en riesgo` en ámbar).
- Escríbelo atómico (a `<archivo>.$$` y `mv`). `presupuesto.json` es de Entorno y no cuenta como producto.

En la app: botón **Iniciativas** al final de la barra de arriba; abre en el panel de la derecha, donde Tasks y
Files. Clic en una épica → hoja inferior con sus tareas; clic en una tarea → ClickUp. En la web (el iPhone):
fila **Iniciativas** arriba de los espacios del cajón. Un archivo que falta o está mal se dice en una línea.
Como Entorno, la web dibuja la foto que deja el panel del escritorio (`~/.herdr/flota/web/iniciativas.json`).
Prueba del lector: `node shell/prueba-iniciativas.mjs`.

## Lanzar un asiento

`bin/flota-lanzar` abre una sesión de agente en herdr-core (solo `hc`, nunca la Herdr de terminal):

```sh
bin/flota-lanzar --asiento ccw --producto english-learning --rol autor --tarea ELR-01.3.6 \
  --padre capitan-elr --cwd ~/Codes/Letz/english-learning-renew --encargo-archivo ENCARGO.md
```

- **Asiento:** `ccp` y `ccw` lanzan `claude --dangerously-skip-permissions` con su `CLAUDE_CONFIG_DIR`
  (`~/.claude`, `~/.claude-work`); `codex` lanza `codex --no-daemon --no-alt-screen` (en línea, para que la respuesta se lea en el teléfono) con `--sandbox workspace-write
  --ask-for-approval never`.
- **Modelo y esfuerzo:** `--modelo` y `--esfuerzo`. Por defecto `opus high` en Claude y
  `gpt-6.1-sol high` en Codex. Un modelo de Codex que no esté en `~/.codex/models_cache.json` se rechaza
  antes de lanzar (los nombres cortos no existen; hoy el barato es `gpt-6-luna`, no hay `gpt-6.1-luna`).
- **Etiquetas:** `flota.producto`, `flota.rol`, `flota.asiento`, `flota.padre` (por defecto, el terminal
  que lo lanza) y `flota.tarea`. Si el padre es un terminal vivo, hc le avisa cuando el hijo se bloquea.
- **Nombre:** `<rol>-<tarea>` en minúsculas, 24 caracteres como mucho, para que se lea en el teléfono
  (`autor-elr-01-3-6`); `--nombre` lo cambia. La sesión sobrevive a quien la lanzó.
- **Arranque:** lee la pantalla con `hc read` y espera con `hc wait`. Acepta la confianza de carpeta;
  los hooks nuevos de Codex los salta sin aprobarlos (eso lo decide Juan, abriendo `codex` y pulsando `t`).
- **Encargo:** `--encargo "<texto>"` (se guarda en `~/.herdr/flota/encargos/<nombre>.md`) o
  `--encargo-archivo <ruta>`. Se manda un puntero al archivo cuando el agente está libre, y se comprueba
  que el turno arrancó.
- **Espacio:** `--espacio <nombre|id>` lo pone como pestaña de ese espacio de la app, con su nombre corto,
  y así se ve y se maneja desde la web del iPhone. Por defecto va al espacio de quien lo lanza, si tiene uno;
  si no, queda oculto (solo en `hc ls`).
- Imprime la dirección del terminal (`t7`): `hc get t7`, `hc read t7`, `hc attach t7`.

Prueba: `zsh shell/prueba-lanzador.zsh` lanza un ccp y un ccw en Haiku y un codex en `gpt-6-luna low`,
cada uno en una carpeta temporal, comprueba etiquetas, perfil y que respondió su palabra, y borra todo
lo suyo al terminar (terminales, carpetas, transcripciones y registros de perfil). Tarda ~30 s.
