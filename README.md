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

0. Repo y plan. ✓
1. Shepherdr instalado como base. ✓
2. La flota corre en herdr-core (`hc`), con etiquetas `flota.producto`, `flota.rol`,
   `flota.padre`, `flota.tarea` en cada terminal.
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
   `{"ccw": 90, "ccp": 90, "codex": 100, "cpu": 85, "ram": 90, "disco_min_gb": 150, "sesiones": 100}`.
5. Para que cada sesión de Claude vuelva con su perfil tras un reinicio (Herdr las relanza con
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
