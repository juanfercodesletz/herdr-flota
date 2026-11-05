# Mover un producto de la Herdr de terminal a Shepherdr

Receta corta, sacada de mover English Learning (HF-3, 4-nov-2026). Lo viejo no se toca: el workspace de la
Herdr de terminal, sus worktrees y sus cambios sin commitear quedan como están hasta que Juan decida.

## 1. El espacio

```sh
herdr-app do space.new --name "<Nombre>" --folder <repo>
```

- La app le pone sola su pestaña **Assistant** (como el diálogo New space). `space.new` deja además una pestaña
  de shell vacía: ciérrala con `herdr-app do tab.close --id <tab> --confirmed true` (el `tab` que imprimió).
- El Assistant arranca con el primer mensaje que se le escribe en su chat, en la carpeta del repo, con el ajuste
  `coordinator` de `~/.herdr/shepherdr.json` (hoy Claude `opus[1m]` high).
- Comprueba: `herdr-app ls` lo lista con su carpeta.

## 2. La sección de la barra lateral

Las secciones viven en el documento compartido `spaces-chat` (Herdr escribe `~/.config/herdr-app/shared.json`;
no lo edites a mano). Créala desde la barra: **+** de Spaces → **New section** (en la app o en la web), y
arrastra el espacio dentro. En la web el menú del espacio no tiene «Mover a sección»: solo se arrastra.

## 3. Las instrucciones del TPM

- Shepherdr no tiene notas propias para el Assistant de un espacio: sus ajustes por espacio son el agente
  (`coordinator`) y las notas de inicio y fin de las **tareas** (las leen los workers, no el Assistant).
- La plantilla global (`~/.config/herdr-core/templates/assistant.md`) ya trae la sección «You are also this
  product's TPM»: el Assistant es TPM del producto cuyo `~/.herdr/flota/<producto>.json` lo nombra primero en
  `espacios` (por nombre del espacio). Crear ese archivo basta para que se sepa TPM; lo demás, la skill
  `iniciativas-flota`.
- Lo propio del producto (cómo se orquesta, dónde están las tarjetas) va fuera del repo, como la skill
  `orquestacion-elr`. No lo pongas en el AGENTS.md o CLAUDE.md del repo del producto.

## 4. Tareas sobre worktrees que ya existen (no se hizo en HF-3)

`herdr-task add/start` no tiene opción para usar un worktree y una rama existentes: crea uno nuevo en
`~/.herdr/worktrees/<repo>/task-…`, y si la rama ya existe falla porque git no deja sacar una rama en dos
worktrees. Lo que sí hace: si el registro de la tarea ya trae `worktree` (una carpeta que existe) y `branch`,
la usa tal cual (`folder_for` en `herdr_task/launch.py`). Enganchar una tarea así es escribir su registro
(`worktree`, `branch`, `base`, y `start` = `git merge-base <base> <rama>`) con el candado de herdr-task: es un
rodeo, así que antes se le pregunta a Juan. Ojo: al quedar `done` herdr-task borra worktree y rama si están
limpios.

Modelo y esfuerzo salen de la cabecera de routing de cada tarjeta: `herdr-task add --agent codex --model
gpt-5.6-sol --effort max` (o `high`). Comprueba que el modelo esté en `~/.codex/models_cache.json`.

## Falla en el iPhone

Visto en la web de Shepherdr a 390 × 844 (Playwright con el Chrome de Juan), sin parchear Shepherdr:

- **El chat del Assistant nuevo no se ve.** Al abrir el espacio, Chat dice «Can't find this conversation»
  aunque el Assistant está vivo (t45) y Shepherdr encuentra su sesión con su propia búsqueda
  (`~/.claude/sessions/<pid>.json` → `a7c11d6e…jsonl`). El de Backend & Web sí se ve. Parece que la web se
  quedó con el «no encontrado» de cuando la sesión aún no existía. Para hablar con el TPM desde el teléfono
  queda **Open terminal**.
- **El cajón no muestra el nombre del espacio de repo.** Se lee la carpeta y la rama («english-learning-renew ·
  develop»), no «English Platform V2»; igual con «Backend & Web» (sale «veta-backend-fastapi · …»). El nombre
  sí sale arriba, al abrir el espacio, y en la app de escritorio.
- **Mover un espacio a una sección** solo se hace arrastrando; no hay opción en el menú del espacio.
