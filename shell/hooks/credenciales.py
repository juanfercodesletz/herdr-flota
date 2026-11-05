#!/usr/bin/env python3
# herdr-flota: hook PreToolUse (Claude Code y Codex) que niega leer o copiar credenciales con una herramienta del
# agente: Read, Edit, Write, Grep, Glob, Bash y apply_patch. Los agentes corren sin permisos, así que esta es la
# barrera. ssh, git push, gh, docker y herdr-secret siguen igual: usan las credenciales por dentro, no las nombran.
# No es un sandbox: un comando que arma la ruta en variables (F=~/.ssh; cat $F/x) pasa. Es un cinturón contra
# leerlas por descuido, como herdr-secret («keeps values out of chats, it doesn't stop hostile code»).
# Prueba: zsh shell/prueba-credenciales.zsh
import fnmatch, glob, json, os, re, shlex, sys

H = os.path.expanduser("~")
VAULT = os.environ.get("HERDR_SECRET_VAULT") or f"{H}/.herdr/vault.json"
ARCHIVOS = {VAULT, *(f"{H}/{p}" for p in (
    ".aws/credentials", ".netrc", ".git-credentials", ".config/gh/hosts.yml", ".docker/config.json", ".kube/config",
    ".codex/auth.json", ".supabase/access-token", "Library/Application Support/com.vercel.cli/auth.json"))}
CARPETAS = [f"{H}/{p}" for p in (".herdr/secret-drop", ".config/gcloud", ".gnupg")]
# ~/.ssh entero es secreto (hay llaves sin nombre estándar, como id_coolify), menos lo que no lo es: lo que ssh
# publica (*.pub, authorized_keys) y lo que un agente lee para saber a qué host va (config, known_hosts).
SSH_LIBRES = {"config", "known_hosts", "known_hosts.old", "authorized_keys"}
ENV_LIBRES = ("example", "sample", "template")  # .env.example, .env.sample.bak…
LLAVES = (".pem", ".key", ".p12", ".pfx", ".ppk")
# Comandos que usan una llave sin mostrarla, o solo miran el nombre del archivo.
SEGUROS = {"ssh", "ssh-add", "ssh-keygen", "ssh-copy-id", "ls", "echo", "printf", "test", "[", "chmod", "stat"}
# Opciones cuyo valor la herramienta usa sin mostrarlo (o que no es una ruta): no se miran.
SALTAR = {"git": {"-m", "--message"}, "scp": {"-i"}, "sftp": {"-i"}, "rsync": {"-e", "--rsh"}}
SALTAR_TODOS = {"--env-file"}
ENVOLTORIOS = {"sudo", "env", "command", "exec", "time", "nohup", "nice"}
SHELLS = {"sh", "bash", "zsh", "dash"}
INTERPRETES = {"python", "python3", "node", "ruby", "perl", "osascript", "deno", "bun"}
SEP = {";", "&&", "||", "|", "&", "(", ")", "|&", ";;", "$", "\n"}
REDIR = {"<", ">", ">>", "<<<", ">&", "&>", "<>", ">|"}
GLOB = re.compile(r"[*?\[]")


def nombre_secreto(b):
    if not re.fullmatch(r"[\w.@+ -]+", b):  # un patrón de grep (id_rsa\|x) no es un nombre de archivo
        return False
    if b == ".env" or b == ".envrc" or (b.startswith(".env.") and not any(w in b for w in ENV_LIBRES)):
        return True
    if b.endswith(".pub"):  # una llave pública no es secreta (se pega en GitHub)
        return False
    return b.endswith(LLAVES) or b.startswith(("id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"))


def secreta(p):
    """Si la ruta absoluta p (o adonde apunta) guarda credenciales."""
    for q in {p, os.path.realpath(p)}:
        if nombre_secreto(os.path.basename(q)) or q in ARCHIVOS:
            return True
        if q == f"{H}/.ssh" or (q.startswith(f"{H}/.ssh/") and q[len(H) + 6:] not in SSH_LIBRES and not q.endswith(".pub")):
            return True
        if any(q == c or q.startswith(c + "/") for c in CARPETAS) or re.fullmatch(re.escape(H) + r"/\.claude[^/]*/\.credentials\.json", q):
            return True
    return False


def expandir(t, cwd):
    t = re.sub(r"^(\$HOME|\$\{HOME\})(?=/|$)", H, t.strip("`'\""))
    t = os.path.expanduser(t)
    return os.path.normpath(t if os.path.isabs(t) else os.path.join(cwd, t))


def ruta(t, cwd, en_disco=True):
    """La ruta secreta que nombra t (una ruta o un patrón glob), o None."""
    if not t or "\n" in t or len(t) > 4096:
        return None
    t = t.strip("`'\"")
    # Un texto con espacios es una ruta solo si empieza como una («~/Library/Application Support/…»), no un título.
    if re.search(r"\s", t) and not t.startswith(("/", "~", "$HOME", "${HOME}", "./")):
        return None
    p = expandir(t, cwd)
    # En Bash, un nombre suelto (grep id_rsa src) cuenta solo si ese archivo está ahí (cat .env).
    if en_disco and "/" not in t and not t.startswith(("~", "$")) and not GLOB.search(t) and not os.path.lexists(p):
        return None
    if secreta(p):
        return p
    if GLOB.search(p):
        d, b = os.path.split(p)
        # ponytail: un patrón con algo fijo (.env*, *.pem, id_*) se prueba contra nombres de muestra; uno sin nada
        # fijo (*) solo contra el disco, como lo expandiría el shell (que no mete .ocultos en *).
        if len(GLOB.sub("", b).replace("]", "")) >= 2:
            for m in (".env", ".env.local", ".envrc", "id_rsa", "id_ed25519", "x.pem", "x.key", "credentials", "hosts.yml"):
                if fnmatch.fnmatch(m, b) and (b.startswith(".") or not m.startswith(".")) and secreta(f"{d}/{m}"):
                    return f"{d}/{b}"
        if en_disco:
            return next((q for q in glob.glob(p, recursive=True)[:500] if secreta(q)), None)
    return None


def tokens(cmd):
    s = shlex.shlex(cmd.replace("\n", " ; "), posix=True, punctuation_chars=True)
    s.whitespace_split, s.commenters = True, ""
    try:
        return list(s)
    except ValueError:  # comillas sin cerrar (un heredoc con apóstrofes): basta con partir por espacios
        return [t.strip("'\"") for t in re.split(r"\s+|(?=[;|&<>])", cmd) if t]


def en_bash(cmd, cwd, hondo=0):
    if hondo > 4:
        return None
    # $(…) y `…` dentro de comillas son otro comando.
    for sub in re.findall(r"\$\(([^()]*)\)|`([^`]*)`", cmd):
        if r := en_bash(sub[0] or sub[1], cwd, hondo + 1):
            return r
    seg, todos = [], tokens(cmd)
    for t in todos + [";"]:
        if t not in SEP:
            seg.append(t)
            continue
        r = en_comando(seg, cwd, hondo)
        if r:
            return r
        if seg[:1] == ["cd"] and len(seg) > 1:
            cwd = expandir(seg[1], cwd)
        seg = []
    return None


def en_comando(seg, cwd, hondo):
    args, redir, siguiente = [], [], False
    for t in seg:
        if t in REDIR:
            siguiente = True
        elif siguiente:
            redir.append(t)
            siguiente = False
        else:
            args.append(t)
    for t in redir:  # < y > siempre cuentan, también con echo
        if r := ruta(t, cwd):
            return r
    while args and (re.fullmatch(r"[A-Za-z_]\w*=.*", args[0]) or os.path.basename(args[0]) in ENVOLTORIOS):
        if "=" in args[0]:  # X=ruta, o GIT_SSH_COMMAND='ssh -i …', que es un comando
            v = args[0].split("=", 1)[1]
            if r := (en_bash(v, cwd, hondo + 1) if re.search(r"\s", v) else ruta(v, cwd)):
                return r
        args = args[1:]
    if not args:
        return None
    cmd = os.path.basename(args[0].lstrip("`"))
    if cmd in SEGUROS:
        return None
    if cmd == "herdr-secret":  # herdr-secret env NOMBRE --file .env es el camino bueno; lo de tras -- sí se mira
        return en_comando(args[args.index("--") + 1:], cwd, hondo) if "--" in args else None
    if cmd == "security" and any(a.startswith("find-") or a == "dump-keychain" for a in args) and \
            any(a in ("-w", "-g", "-d") for a in args):
        return "el llavero de macOS (security … -w)"
    if cmd == "gh" and args[1:3] == ["auth", "token"]:
        return "el token de gh (gh auth token)"
    if cmd in SHELLS or cmd == "eval":
        c = next((i for i, a in enumerate(args) if re.fullmatch(r"-[a-z]*c[a-z]*", a)), None)  # -c, -lc (Codex)
        cod = args[c + 1:c + 2] if c is not None else (args[1:] if cmd == "eval" else [])
        if cod and (r := en_bash(" ".join(cod), cwd, hondo + 1)):
            return r
    if cmd in INTERPRETES:  # el código de -c/-e: cada cadena entre comillas y cada cosa con forma de ruta
        for i, a in enumerate(args[:-1]):
            if a in ("-c", "-e", "-p", "--eval", "-E"):
                for t in re.findall(r"'([^']*)'|\"([^\"]*)\"|((?:~|\$HOME|/)[\w./@~-]*)", args[i + 1]):
                    if r := ruta("".join(t), cwd, en_disco=False):
                        return r
    saltar, opciones = False, SALTAR.get(cmd, set()) | SALTAR_TODOS
    for a in args[1:]:
        if saltar or a.split("=", 1)[0] in opciones:
            saltar = a in opciones
            continue
        for t in [a] + ([a.split("=", 1)[1]] if a.startswith("-") and "=" in a else []):
            if r := ruta(t, cwd):
                return r
    return None


def revisar(d):
    tool, i = d.get("tool_name") or "", d.get("tool_input") or {}
    cwd = d.get("cwd") or os.getcwd()
    if tool == "Bash":
        return en_bash(i.get("command") or "", cwd)
    if tool == "apply_patch":  # Codex: las rutas van en las cabeceras del parche
        for p in re.findall(r"^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$", i.get("command") or "", re.M):
            if r := ruta("".join(p).strip(), cwd, en_disco=False):
                return r
        return None
    if tool == "Glob":
        return ruta(os.path.join(i.get("path") or cwd, i.get("pattern") or ""), cwd, en_disco=False)
    if tool == "Grep":
        base = i.get("path") or cwd
        return ruta(base, cwd) or (i.get("glob") and ruta(os.path.join(base, i["glob"]), cwd, en_disco=False))
    for k in ("file_path", "notebook_path", "path"):
        if i.get(k):
            return ruta(i[k], cwd, en_disco=False)
    return None


def main():
    try:
        r = revisar(json.load(sys.stdin))
    except Exception:  # ponytail: falla abierto; un hook roto no puede trabar a toda la flota (lo cuida la prueba)
        return
    if r:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
            "permissionDecisionReason":
                f"Bloqueado por el hook de credenciales de herdr-flota: {r} guarda credenciales, y un agente no las lee, "
                "copia ni edita. Si un comando necesita un secreto, úsalo por su nombre: "
                "`herdr-secret run NOMBRE -- <comando>` (pídelo con `herdr-secret ask NOMBRE --why \"…\"`; "
                "`herdr-secret env NOMBRE --file .env` si una herramienta necesita el archivo). Una llave ssh se usa "
                "con ssh o git, sin abrirla. No intentes otra forma de leerlo."}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
