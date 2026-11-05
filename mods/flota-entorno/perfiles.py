#!/usr/bin/env python3
"""Perfil de Claude de cada terminal de hc y los MCP que ese perfil tiene por config.

El perfil sale del proceso que corre (su CLAUDE_CONFIG_DIR), no del mapa shell/asientos: ccp (~/.claude),
ccw (~/.claude-work) o «a secas» (sin la variable: config global en ~/.claude.json). De los MCP solo los
nombres, nunca su env ni sus cabeceras; de
los conectores de claude.ai, la cuenta. Imprime un JSON; Entorno lo dibuja y lo deja en /flota/perfiles.json.
"""
import json, os, re, subprocess, sys, time

H = os.path.expanduser("~")
NOMBRES = {H + "/.claude": "ccp", H + "/.claude-work": "ccw"}
TAREAS = os.environ.get("HERDR_TASK_STORE") or H + "/.herdr/tasks"


def sh(*argv):
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return ""


def read(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def config_dir(pid):
    """El CLAUDE_CONFIG_DIR del proceso: '' si no lo tiene, None si su entorno no se puede leer.
    `ps eww` da el argv y luego el entorno; se quita el argv para que un argumento que diga
    CLAUDE_CONFIG_DIR= no cuente."""
    cmd = sh("ps", "-ww", "-o", "command=", "-p", str(pid)).rstrip("\n")
    full = sh("ps", "eww", "-o", "command=", "-p", str(pid)).rstrip("\n")
    if not cmd or not full.startswith(cmd):
        return None
    env = " " + full[len(cmd):]
    if " HOME=" not in env:  # sin entorno a la vista (otro usuario): no se sabe
        return None
    # ponytail: una ruta con espacios se corta en el primero; ningún perfil de la casa los tiene.
    m = re.search(r" CLAUDE_CONFIG_DIR=(\S*)", env)
    return m.group(1).rstrip("/") if m else ""


def perfil(d):
    if d is None:
        return "?"
    if d == "":
        return "a secas"
    d = os.path.expanduser(d)
    return NOMBRES.get(d, os.path.basename(d))


def nombres(servers):
    return sorted(servers) if isinstance(servers, dict) else []


def mcp(d, cwd):
    """Los MCP que la config de ese perfil le da en esa carpeta, por de dónde salen."""
    cfg = read((d or H) + "/.claude.json")
    sdir = d or H + "/.claude"  # a secas: config global en ~/.claude.json, ajustes y plugins en ~/.claude
    ajustes = read(sdir + "/settings.json")
    proj = (cfg.get("projects") or {}).get(cwd) or {}
    off = set(proj.get("disabledMcpServers") or [])
    off_json = set(proj.get("disabledMcpjsonServers") or []) | set(ajustes.get("disabledMcpjsonServers") or [])
    g = {"usuario": nombres(cfg.get("mcpServers")), "local": nombres(proj.get("mcpServers"))}
    # De proyecto: el .mcp.json de la carpeta o de las de arriba.
    proyecto, p = [], cwd
    while p and p != "/":
        j = read(p + "/.mcp.json")
        proyecto += [n for n in nombres(j.get("mcpServers")) if n not in off_json]
        p = os.path.dirname(p)
    g["proyecto"] = sorted(set(proyecto))
    instalados = read(sdir + "/plugins/installed_plugins.json").get("plugins") or {}
    plug = []
    for clave, on in (ajustes.get("enabledPlugins") or {}).items():
        raiz = ((instalados.get(clave) or [{}])[0] or {}).get("installPath")
        if not on or not raiz:
            continue
        m = read(raiz + "/.mcp.json")
        servers = m.get("mcpServers", m)
        spec = read(raiz + "/.claude-plugin/plugin.json").get("mcpServers")
        if isinstance(spec, str):
            spec = read(os.path.join(raiz, spec))
            spec = spec.get("mcpServers", spec)
        plug += nombres(servers) + nombres(spec)
    g["plugins"] = sorted(set(plug))
    g = {k: [n for n in v if n not in off] for k, v in g.items()}
    return {k: v for k, v in g.items() if v}


def cuenta(d):
    """La cuenta de claude.ai del perfil: sus conectores (Gmail, Notion…) son de ella, no de la config, que solo
    guarda los que se conectaron alguna vez (no calza con los que la sesión carga)."""
    return (read((d or H) + "/.claude.json").get("oauthAccount") or {}).get("emailAddress")


def tarea(label, cache={}):
    """'Codes-Personal-herdr-flota#13' → ('HF-13', su título), como la llama la web."""
    slug, _, n = (label or "").rpartition("#")
    if not slug:
        return None, None
    if slug not in cache:
        cache[slug] = read(f"{TAREAS}/{slug}.json")
    s = cache[slug]
    titulo = next((t.get("title") for t in s.get("tasks") or [] if str(t.get("id")) == n), None)
    return (f"{s['prefix']}-{n}" if s.get("prefix") else None), titulo


def terminales():
    try:
        ls = json.loads(sh("hc", "ls") or "{}").get("terminals") or []
    except Exception:
        return []
    out = []
    for t in ls:
        if t.get("state") != "live":
            continue
        try:
            g = json.loads(sh("hc", "get", t["address"]))
        except Exception:
            continue
        fg = g.get("foreground") or {}
        # ponytail: solo el claude en primer plano del terminal; uno escondido bajo otro programa no se ve.
        if os.path.basename((fg.get("argv") or [""])[0]) != "claude":
            continue
        lb = g.get("labels") or {}
        d = config_dir(fg.get("pid"))
        cwd = fg.get("cwd") or g.get("cwd") or ""
        ref, titulo = tarea(lb.get("herdr.task"))
        out.append({
            "address": t["address"], "name": g.get("name"), "where": lb.get("where"),
            "space": lb.get("herdr.space") or lb.get("herdr.task.space") or lb.get("herdr.coordinator.space"),
            "assistant": lb.get("herdr.role") == "coordinator", "tarea": ref, "titulo": titulo, "cwd": cwd,
            "perfil": perfil(d), "dir": d, "mcp": mcp(d, cwd) if d is not None else {},
            "cuenta": cuenta(d) if d is not None else None,
        })
    return out


if __name__ == "__main__":
    json.dump({"at": int(time.time()), "terminales": terminales()}, sys.stdout, ensure_ascii=False)
