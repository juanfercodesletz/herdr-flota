#!/usr/bin/env python3
"""Las respuestas que Juan da en Herdr a las decisiones de un producto (README, «Decisiones»).

Van a ~/.herdr/flota/respuestas/<archivo>, aparte del <producto>.json que escribe el TPM, así nadie pisa a nadie:
este archivo es el único que escribe ahí, y el TPM solo lo lee en su tick. Forma: {"<id>": {"respuesta", "texto", "at", "desde"}}:
`respuesta` es una de las opciones (o "" si Juan solo escribió) y `texto` lo que escribió con sus palabras (o "").

  respuestas.py guardar <archivo> <id> <respuesta> [desde] [texto]   la app del escritorio (una opción, o su texto)
  respuestas.py servir [puerto] [carpeta]                    la web: sirve la foto de /flota y recibe POST /respuesta
"""
import fcntl, json, os, re, shutil, subprocess, sys, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

FLOTA = os.path.expanduser("~/.herdr/flota")
ARCHIVO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.json$")


def guardar(archivo, id, respuesta, desde, texto=""):
    """Guarda la respuesta si la decisión existe y no está cerrada, con una de sus opciones, un texto libre o los dos.
    Error: ValueError."""
    if not ARCHIVO.match(archivo or "") or archivo == "presupuesto.json":
        raise ValueError("archivo de producto inválido")
    try:
        d = json.load(open(os.path.join(FLOTA, archivo), encoding="utf-8"))
    except (OSError, ValueError):
        raise ValueError(f"no se pudo leer {archivo}")
    dec = next((x for x in d.get("decisiones") or [] if isinstance(x, dict) and str(x.get("id", "")) == id), None)
    if not dec:
        raise ValueError("esa decisión ya no está: el TPM la quitó")
    if dec.get("estado") == "cerrada":
        raise ValueError("esa decisión ya está cerrada")
    texto = (texto or "").strip()
    if respuesta and respuesta not in [str(o) for o in dec.get("opciones") or []]:
        raise ValueError("esa respuesta no es una de sus opciones")
    if not respuesta and not texto:
        raise ValueError("falta elegir una opción o escribir algo")
    if len(texto) > 1000:
        raise ValueError("el texto pasa de 1000 caracteres")
    carpeta = os.path.join(FLOTA, "respuestas")
    os.makedirs(carpeta, exist_ok=True)
    ruta = os.path.join(carpeta, archivo)
    # La app y la web pueden responder a la vez: un candado alrededor de leer, cambiar y reemplazar.
    with open(ruta + ".lock", "w") as candado:
        fcntl.flock(candado, fcntl.LOCK_EX)
        try:
            todas = json.load(open(ruta, encoding="utf-8"))
            if not isinstance(todas, dict):
                todas = {}
        except (OSError, ValueError):
            todas = {}
        todas[id] = {"respuesta": respuesta, "texto": texto, "at": int(time.time()), "desde": desde}
        tmp = f"{ruta}.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(todas, f, ensure_ascii=False, indent=1)
        os.replace(tmp, ruta)
    return todas[id]


def dueño():
    """El login de Tailscale de quien es dueño de este Mac (el único que puede responder por el tailnet), o None."""
    try:
        # launchd corre el servicio con PATH=/usr/bin:/bin:…, sin donde se instala tailscale.
        ts = shutil.which("tailscale", path=f"{os.environ.get('PATH', '')}:/usr/local/bin:/opt/homebrew/bin") or "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
        s = json.loads(subprocess.run([ts, "status", "--json"], capture_output=True, text=True, timeout=10).stdout)
        return s["User"][str(s["Self"]["UserID"])]["LoginName"]
    except Exception:
        return None


class Web(SimpleHTTPRequestHandler):
    # Keep-alive: el proxy de tailscale serve reusa la conexión en vez de abrir una por pedido (cada una cerrada deja un
    # socket en TIME_WAIT 30 s; un cliente en bucle agotaba los puertos efímeros del Mac). timeout cierra las ociosas.
    protocol_version = "HTTP/1.1"
    timeout = 30
    servido = {}  # ruta → cuándo se sirvió por última vez

    def do_GET(self):
        # Freno a un cliente en bucle: la misma foto .json otra vez antes de 1 s → 429. Las pestañas se leen cada 15 s;
        # un chip viejo (antes de HF-17) pedía ~360 por segundo y con dos errores seguidos deja de pedir.
        # ponytail: global por ruta; dos pestañas en el mismo segundo → una se queda sin foto hasta su próxima lectura.
        ruta, ahora = self.path.split("?")[0], time.monotonic()
        if ruta.endswith(".json"):
            if ahora - self.servido.get(ruta, -9) < 1:
                return self.responder(429, {"error": "muy seguido"})
            self.servido[ruta] = ahora
        super().do_GET()

    # Escribir pide lo mismo que la web de Shepherdr (service/auth.ts): una cabecera que un formulario o un link no
    # pueden mandar, el origen de la propia página y, por el tailnet, el login del dueño. Leer queda como antes.
    def do_POST(self):
        h = self.headers
        login, host = h.get("Tailscale-User-Login"), (h.get("Host") or "").lower()
        if h.get("Sec-Fetch-Site") == "cross-site" or h.get("X-Flota") != "1":
            return self.responder(403, {"error": "petición no permitida"})
        if login is not None:
            global DUEÑO
            DUEÑO = DUEÑO or dueño()
            if not DUEÑO or login != DUEÑO:
                return self.responder(403, {"error": "solo el dueño de este Mac"})
            if h.get("Origin") != f"https://{host}":
                return self.responder(403, {"error": "origen equivocado"})
        elif host.split(":")[0] not in ("127.0.0.1", "localhost") or h.get("Origin"):
            return self.responder(403, {"error": "solo desde este Mac o el tailnet"})
        if self.path.split("?")[0] != "/respuesta":
            return self.responder(404, {"error": "no existe"})
        try:
            n = int(h.get("Content-Length") or 0)
            if not 0 < n <= 8192:
                raise ValueError("cuerpo vacío o muy grande")
            b = json.loads(self.rfile.read(n))
            if not all(isinstance(b.get(k), str) for k in ("archivo", "id", "respuesta")) or not isinstance(b.get("texto", ""), str):
                raise ValueError("faltan archivo, id o respuesta")
            self.responder(200, guardar(b["archivo"], b["id"], b["respuesta"], "web", b.get("texto", "")))
        except ValueError as e:
            self.responder(400, {"error": str(e)})

    def responder(self, code, cuerpo):
        data = json.dumps(cuerpo, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


DUEÑO = None

if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["guardar"] and len(a) in (4, 5, 6):
        try:
            print(json.dumps(guardar(a[1], a[2], a[3], a[4] if len(a) >= 5 else "app", a[5] if len(a) == 6 else ""), ensure_ascii=False))
        except ValueError as e:
            sys.exit(f"No se guardó: {e}")
    elif a[:1] == ["servir"]:
        puerto = int(a[1]) if len(a) > 1 else 7790
        carpeta = a[2] if len(a) > 2 else os.path.join(FLOTA, "web")
        os.makedirs(carpeta, exist_ok=True)
        # Un hilo por conexión (keep-alive dejaría esperando a las demás); guardar() ya va de a una con flock.
        ThreadingHTTPServer(("127.0.0.1", puerto), lambda *x: Web(*x, directory=carpeta)).serve_forever()
    else:
        sys.exit(__doc__)
