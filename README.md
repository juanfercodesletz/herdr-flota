# herdr-flota

Layout y mods de la app Herdr para operar una flota de agentes guiada por un TPM:
productos → TPM → capitanes → sesiones en worktrees, con iniciativas de ClickUp,
decisiones por lotes y la salud del entorno.

Diseño (canvas): https://claude.ai/artifact/5rVDW3BgbwVmEpvcSkQ9Lj — ronda 3 es la vigente.

## Cómo se ve

- **Izquierda:** los espacios de Shepherdr, tal cual.
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
`~/.herdr/flota/<producto>.json` (con las decisiones abiertas) y recoge las respuestas que se den en Herdr, que
quedan aparte en `~/.herdr/flota/respuestas/<producto>.json` (ver «Decisiones»).

## Plan, paso a paso

0. Repo y plan. ✓
1. Shepherdr instalado como base. ✓
2. La flota corre en herdr-core (`hc`), con etiquetas `flota.producto`, `flota.rol`,
   `flota.padre`, `flota.tarea` y `flota.asiento` en cada terminal. En curso: lanzador ✓, reanudar ✓ (para las tareas de Shepherdr).
3. Árbol de productos: se probó y se quitó (no escalaba con muchas sesiones). El diseño queda en `b69f10a`.
4. Entorno. ✓ (primero, por ser independiente del resto)
5. Iniciativas, desde el archivo que escribe el TPM. ✓
6. Decisiones, con el puente del TPM. ✓
7. Tablero y Gantt. ✓

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

   **Reparto de las tareas de Shepherdr:** cada `claude` que arranca una tarea toma el perfil de su carpeta
   según `shell/asientos` (Letz y sus worktrees → ccw, lo demás → ccp); si ese está en o sobre su techo de
   5 h o 7 d y el otro no, usa el otro. Con los dos agotados arranca en el de la carpeta y, cuando Claude se
   detiene por cuota, el Backup agent de Shepherdr pasa la tarea a Codex. Reanudar nunca cambia de perfil.
   Para que Shepherdr vea una tarea en ccw (chat, reanudar, Backup) hace falta su rama `hf-7/perfiles-claude`
   (busca sesiones también en `~/.claude-*`) y sus hooks de chat (`session-note.sh` y `ask-hook.sh`, los
   de `~/.claude/settings.json`) también en `~/.claude-work/settings.json`.

## Iniciativas

El TPM de cada producto escribe en cada tick `~/.herdr/flota/<producto>.json` (de ClickUp, que Herdr no lee).
Ejemplo completo: `ejemplos/veta.json`.

```json
{
  "producto": "Veta",
  "espacios": [{ "id": "spb83c5f1d4731ea1f84df503dfb0f14eb", "nombre": "Backend & Web" }],
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
- `espacios`: los **ids** de los espacios de Shepherdr donde se ve el producto, nunca sus nombres (Juan los renombra).
  Cada uno, `"sp…"` o `{ "id": "sp…", "nombre": "…" }`; el nombre es solo para leerlo a ojo y no se compara. El id sale en
  `herdr-app ls` (`spaces[].id`) o, desde un terminal del espacio, en `hc get $HC_TERMINAL_ID --json` (etiqueta
  `herdr.coordinator.space` en un Assistant, `herdr.space` en una pestaña, `herdr.task.space` en un agente de tarea). No cambia al renombrar el espacio ni al reiniciar la app o
  herdr-core (se guarda en el documento `herdr-app` del core); un espacio cerrado y vuelto a crear sí trae id nuevo.
  Lo pone el TPM. El panel muestra solo los productos del espacio abierto (en el teléfono, el del cajón) y cambia al
  cambiar de espacio; **Home** (el espacio de la carpeta de inicio, `~`) los ve todos. Sin `espacios`, el producto solo
  se ve en Home. Un espacio sin productos dice «Este espacio no tiene iniciativas». Un nombre en `espacios` (archivo
  viejo) no se adivina: el panel lo dice en una línea.
- `id`: el de ClickUp. Es el que va en `flota-lanzar --tarea`, así la sesión lleva `flota.tarea=<id>`.
- `sesion`: el nombre del terminal en hc que la trabaja, solo mientras la hay.
- Estado de tarea: `en cola`, `en curso`, `auditoría`, `PR abierto`, `bloqueada` o `merged` (cada uno con su color
  y su parte en la barra de la épica); otro texto se muestra tal cual, como en curso. El de la épica es libre
  (`a tiempo`, `en riesgo` en ámbar).
- Escríbelo atómico (a `<archivo>.$$` y `mv`). `presupuesto.json` es de Entorno y no cuenta como producto.

**Orden, por lo que pide acción** (lo hace el lector, así escritorio y web salen igual): tareas bloqueada → PR abierto →
auditoría → en curso (y lo desconocido) → en cola → merged, y a igual estado el orden del archivo; épicas por su tarea
más urgente (a igualdad, atrasada y en riesgo antes que a tiempo; las todo merged al final); productos con algo bloqueado
o en PR primero. Cada épica dice cuántas tareas te esperan (bloqueadas o con PR abierto): «2 te esperan».

En la app: botón **Iniciativas** al final de la barra de arriba; abre en el panel de la derecha, donde Tasks y
Files. Clic en una épica → hoja inferior con sus tareas; clic en una tarea → ClickUp. En la web (el iPhone):
fila **Iniciativas** arriba de los espacios del cajón. Un archivo que falta o está mal se dice en una línea.
Como Entorno, la web dibuja la foto que deja el panel del escritorio (`~/.herdr/flota/web/iniciativas.json`).
Prueba del lector: `node shell/prueba-iniciativas.mjs`.

### Tablero y Gantt

Dos pestañas más en el mismo panel, junto a Iniciativas (en la app y en la web), con los mismos archivos:

- **Tablero:** una columna por estado de tarea (`en cola`, `en curso`, `auditoría`, `PR abierto`, `bloqueada`), tarjetas del
  mismo alto; lo `merged` solo se cuenta. Clic en una tarjeta → su link. Angosto (el teléfono), una columna debajo de otra.
- **Gantt:** el plan del día como lo pide la skill `gantt-flota`: un bloque por salida a producción, cada fila con su chip,
  equipo y nota, y una barra sobre las 06:00–21:00 de Bogotá; rayas en las salidas de 07, 12 y 19 y la hora actual en
  naranja. Barra sólida = en marcha, contorno = estimada, tenue = ya hecha. En el teléfono la barra va debajo del nombre.

El Gantt usa campos **opcionales** de cada tarea (épica o suelta). Sin ellos Iniciativas y Tablero no cambian, y el Gantt
de ese producto dice en una línea que no hay plan del día. Solo entran al Gantt las tareas con `salida`.

```json
{ "id": "86e3yk0t5", "titulo": "Refrescar la OC desde Siigo", "estado": "bloqueada",
  "salida": "19:00", "desde": "11:00", "hasta": "17:00", "estimada": false,
  "ritmo": "te espera", "nota": "pregunta la ventana: 60 o 90 días", "equipo": "Backend" }
```

- `salida`: `"HH:MM"` de hoy (`"12:00"`, `"19:00"`), `"mañana"` (sale «Mañana o después») u otro texto (`"7 nov"`).
- `desde` y `hasta`: `"HH:MM"` de hoy, hora de Bogotá; la barra va de cuándo empezó a cuándo debería quedar lista.
  Sin las dos (o mal escritas), la fila sale sin barra. `estimada: true` la dibuja en contorno.
- `ritmo`: el chip de una palabra, `a tiempo`, `en riesgo`, `atrasado` o `te espera`. Sin él, el chip es el estado
  (`listo` si está `merged`).
- `nota`: una línea corta (número de PR y lo que sigue). `equipo`: `AI`, `Backend`, `Frontend`, `Acciones`, `DevOps`…

### Decisiones

Cuarta pestaña del panel (app y web), con el número de las abiertas. Las decisiones viven en la base del artefacto del
Gantt (colección `decisiones`, skill `gantt-flota`), que Herdr no lee: el TPM copia en cada tick las abiertas al
`<producto>.json`, en el campo opcional `decisiones`:

```json
"decisiones": [
  { "id": "D5", "pregunta": "¿Qué ventana de OC usa «Refrescar»?", "opciones": ["60 días", "90 días", "Sin límite"],
    "recomendada": "90 días", "de": "s22b-refrescar", "tarea": "86e3yk0t6", "contexto": "el buscador mira 60 días",
    "frena": false, "estado": "abierta", "respuesta": "" }
]
```

- `id` (el del documento en la base del Gantt) y `pregunta` (su `titulo`) son obligatorios; lo demás puede faltar.
- `opciones`: los botones; `recomendada` (una de ellas) lleva ★. Sin opciones, la tarjeta dice que se responde en el Gantt.
- `de`: quién pregunta (el terminal o «TPM»); `tarea`: el id de la tarea a la que toca; `contexto`: una frase.
- `frena: true` si para una salida o una tarea: borde rojo y va primero.
- `estado`: `abierta`, `respondida` (Juan respondió en la página del Gantt; `respuesta` dice qué) o `cerrada`.

Juan responde con un toque en una opción, en la app o en el teléfono, y puede cambiarla mientras el TPM no la cierre.
La respuesta **no** va al `<producto>.json` (que es del TPM) sino a `~/.herdr/flota/respuestas/<producto>.json`, cuyo
único escritor es `mods/flota-iniciativas/respuestas.py` (la app lo llama; la web le manda `POST /flota/respuesta`):

```json
{ "D5": { "respuesta": "90 días", "at": 1793840000, "desde": "web" } }
```

Solo guarda una de las `opciones` de una decisión que siga en el `<producto>.json` y no esté cerrada. El mismo
`respuestas.py servir` es el servicio `dev.herdr-flota.web` (sirve la foto de `/flota` como antes); para escribir pide
la cabecera `X-Flota: 1` y, por el tailnet, el origen de la página y el login de Tailscale del dueño del Mac.
En cada tick el TPM lleva esas respuestas a la base del Gantt y sigue como dice `gantt-flota` (skill `iniciativas-flota`,
«Decisiones en el tick»).

Por qué no por las tarjetas «Needs you» de Shepherdr: esas son la pregunta de un agente vivo parado en su hook
(`AskUserQuestion`, un permiso), y la respuesta vuelve a ese agente. Estas decisiones no paran a nadie y las lleva el TPM.
Si quien pregunta es una tarea de Shepherdr que ya está en «Needs you», se responde ahí y el TPM no la copia.

Pruebas: `node shell/prueba-iniciativas.mjs` (lector) y `zsh shell/prueba-decisiones.zsh` (guardar y servidor, en un
HOME temporal).

## Perfil de Claude de cada chat

Cada chat y cada tarea con Claude dice en qué perfil corre: `ccp` (`CLAUDE_CONFIG_DIR=~/.claude`), `ccw`
(`~/.claude-work`) o `a secas` (sin la variable: la config global de `~/.claude.json`, con otros MCP).

- **Escritorio:** en Entorno, «Claude en este espacio»: el Assistant del espacio abierto y sus tareas, cada uno con su
  perfil. Clic en una fila → sus MCP.
- **Web (el iPhone):** un chip «Claude ccp» en la cabecera del Assistant (en el teléfono, al final del subtítulo) y
  otro sobre la caja de mensaje de cada tarea. Tocarlo abre una hoja con sus MCP.
- **De dónde sale:** `mods/flota-entorno/perfiles.py` lee el `CLAUDE_CONFIG_DIR` del proceso `claude` que corre en
  cada terminal de hc (su entorno, con `ps`), no el mapa `shell/asientos`. Tras un reinicio, `claude()` de `flota.zsh`
  relanza cada sesión con su perfil y el lector lo ve igual. Si el entorno no se puede leer, dice `?`.
- **Los MCP:** solo los nombres (nunca env ni cabeceras), por origen: del perfil (`mcpServers` de su `.claude.json`),
  de esta carpeta (su entrada en `projects`), del proyecto (`.mcp.json` de la carpeta y las de arriba) y de los plugins
  activos. Los conectores de claude.ai son de la cuenta: se dice cuál.
- Entorno lo mide cada 15 s y deja la foto en `~/.herdr/flota/web/perfiles.json` (`/flota/perfiles.json`), como el
  resto: con el panel cerrado, la hoja de la web avisa que el dato es viejo.

Los Assistants de los espacios corren **a secas**: Shepherdr los lanza con `sh -c "claude …"`, fuera de zsh, así que ni
`claude()` ni `shell/asientos` los tocan (el mapa rige solo para las tareas).

Prueba: `python3 shell/prueba-perfil.py` (tres procesos reales, ccp, ccw y a secas, con un argumento trampa; un
`claude --resume` reanudado con su registro; y una config con secretos de la que solo salen los nombres).

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
- **Espacio:** `--espacio <id|nombre>` lo pone como pestaña de ese espacio de la app, con su nombre corto,
  y así se ve y se maneja desde la web del iPhone. Por defecto va al espacio de quien lo lanza, si tiene uno;
  si no, queda oculto (solo en `hc ls`).
- Imprime la dirección del terminal (`t7`): `hc get t7`, `hc read t7`, `hc attach t7`.

Prueba: `zsh shell/prueba-lanzador.zsh` lanza un ccp y un ccw en Haiku y un codex en `gpt-6-luna low`,
cada uno en una carpeta temporal, comprueba etiquetas, perfil y que respondió su palabra, y borra todo
lo suyo al terminar (terminales, carpetas, transcripciones y registros de perfil). Tarda ~30 s.

## Reanudar tras un reinicio

La flota corre como tareas de Shepherdr (`herdr-task`). herdr-core no relanza los agentes tras un
reinicio del Mac o del core: Shepherdr los lanza con `--keep`, y hc deja en cada terminal una `zsh -l`
vacía, sin el comando original (medido en un core aislado, hc 0.1.18). Un `hc server restart` no corta
nada: los programas siguen.

- `bin/flota-reanudar` (servicio launchd `dev.herdr-flota.reanudar`, lo deja `install.sh`) sigue
  `hc events`. Por cada terminal de tarea que hc recupera como shell vacía, si su tarea sigue en
  `running` sin ningún agente que corra (`live` vacío en `herdr-task list`), hace
  `herdr-task resume <id> --folder <carpeta> --agent <su agente>` y cierra la shell vacía. Shepherdr
  guarda el argv y la sesión de cada agente en `~/.herdr/tasks/*.json`: vuelve con su conversación y en
  su carpeta, en un terminal nuevo. `--agent` hace que el argv salga de los Settings de ahora
  (`worker_argv`), por si cambiaron los permisos; un argv dado a mano al empezar la tarea se pierde.
- Solo toca lo que el reinicio cortó: una tarea cuyo agente salió antes (queda la shell de Shepherdr,
  no una de recuperación) no se reanuda, y los reviewers tampoco.
- No arranca el core: espera a que lo arranque la app, porque el core les pasa su entorno a todos
  los terminales y el de launchd es pelado.
- Lo que hace queda en `~/.herdr/flota/reanudar.log`; no muestra nada en pantalla. La tarea reanudada
  se ve como siempre en el panel de tareas (también en la web del iPhone).
- Se quita con `launchctl bootout gui/$(id -u)/dev.herdr-flota.reanudar`.

Prueba: `zsh shell/prueba-reanudar.zsh` levanta un herdr-core aislado (`HC_SOCKET` y estado propios en
`/tmp`; el de verdad no se toca), con su propio almacén de tareas (`HERDR_TASK_STORE`) y un `herdr-app`
falso para no tocar la ventana. Crea 3 tareas desechables (Claude y Codex en worktrees, Claude en una
carpeta con espacio, modelos baratos), reinicia ese core 3 veces (parada limpia, apagón y apagón con 2 en
medio de un `ping -c 120`) y tras cada vez comprueba que las 3 volvieron con su conversación y en su
carpeta, sin compuertas y una vez cada una. Borra todo lo suyo al terminar. Tarda ~6 min.
