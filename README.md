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
5. Iniciativas, desde el archivo que escribe el TPM.
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
   `{"ccw": 90, "ccp": 90, "codex": 100, "cpu": 85, "ram": 90, "disco_flota_gb": 100, "disco_min_gb": 20, "sesiones": 100}`.
   El disco cuenta lo que ocupa la flota (worktrees sin `.venv`, caché de uv, Docker de OrbStack),
   medido cada 30 min; `disco_min_gb` es el libre bajo el cual la fila se pone roja igual.
5. Entorno en la web de Shepherdr (el iPhone): `install.sh` deja el plugin en `~/.shepherdr/plugins/flota-entorno`
   (`web/flota-entorno` + el `calc.js` del mod), levanta el servicio launchd `dev.herdr-flota.web` (sirve
   `~/.herdr/flota/web` en 127.0.0.1:7790), publica `/flota` con `tailscale serve` y corre `shepherdr update` para
   reconstruir la web. Necesita que Shepherdr cargue plugins de `~/.shepherdr/plugins` (commit local 07859b09 en
   la copia de Shepherdr, «Web: load the human's own plugins»). Los datos son la foto que escribe el panel del
   escritorio cada 15 s: con Herdr cerrado o sin el layout `flota`, la web avisa que el dato es viejo.
   En el teléfono: cajón de espacios → **Entorno**, al pie. Se quita con
   `launchctl bootout gui/$(id -u)/dev.herdr-flota.web` y `tailscale serve --set-path /flota off`.
6. Para que cada sesión de Claude vuelva con su perfil tras un reinicio (Herdr las relanza con
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
