# AGENTS.md

- Para probar la web de Shepherdr a 390x844 (iPhone): playwright-core está en ~/Codes/Personal/shepherdr/node_modules (`chromium.launch({channel: "chrome"})`); agent-browser no está instalado.
- Prueba del lanzador: `zsh shell/prueba-lanzador.zsh` levanta tres asientos reales y baratos (~30 s) y limpia al final.
- La web de Shepherdr solo muestra los terminales de hc con la etiqueta `herdr.space=<id>`.
- Las iniciativas (panel Iniciativas) viven en `~/.herdr/flota/<producto>.json`; cómo mantenerlas: skill `iniciativas-flota`.
- Para capturar algo que solo abre un clic en un mod de Herdr (herdr-app no tiene clic remoto): copia temporal de un main.js que lo abra desde render() en ~/.config/herdr-app/mods/‹mod›, `herdr-app shot`, y vuelve a copiar el real.
- El vigía del disco se prueba solo con FLOTA_VIGIA_UMBRAL (fuerza --en-seco); sin él, con el disco sobre start_disk-3, lanza una limpieza real. `zsh shell/prueba-vigia.zsh` lo hace bien.
- En pruebas con `zsh -f`, $EPOCHSECONDS necesita `zmodload zsh/datetime`; las direcciones de hc llevan letras (t3m): captúralas con `^t[0-9a-z]+`.
- En los paneles de la web que van en createPortal a document.body, las clases `phone:` de Tailwind no aplican (quedan fuera de [data-device]); usa `max-sm:`.
- Para probar herdr-task en un core aislado: HC_SOCKET=HC_TERMINAL_SOCKET en /tmp (su guardia rechaza HC_SESSION), HERDR_TASK_STORE propio, un herdr-app falso en el PATH y sin variables CLAUDE*; ver `shell/prueba-reanudar.zsh`.
