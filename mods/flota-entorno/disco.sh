#!/bin/sh
# Mide lo que ocupa la flota en disco y lo deja en ~/.herdr/flota/disco.txt para el panel Entorno.
# Tarda ~1 min de du (exec de los mods corta a los 30 s), por eso el panel lo lanza aparte.
# Los .venv no cuentan en worktrees: son clones del caché de uv y comparten bloques con él.
# Docker es el de OrbStack (no hay máquinas Linux aparte).
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.orbstack/bin:$HOME/.local/bin"
f="$HOME/.herdr/flota/disco.txt"
mkdir -p "${f%/*}"
{
  echo "at $(date +%s)"
  echo "wt $(nice -n 19 du -sk -I .venv "$HOME/.herdr/worktrees" 2>/dev/null | cut -f1)"
  echo "uv $(nice -n 19 du -sk "$(uv cache dir 2>/dev/null || echo "$HOME/.cache/uv")" 2>/dev/null | cut -f1)"
  docker system df --format '{{.Size}}' 2>/dev/null | sed 's/^/docker /'
} > "$f.$$" && mv "$f.$$" "$f"
