// bun shell/prueba-chip.mjs: el chip de perfil (web/flota-entorno/perfil.tsx) con React de verdad en Chrome y reloj falso.
// Un pedido a /flota/perfiles.json cada 15 s, no en bucle (HF-17), y el chip cambia cuando cambia el perfil. ~5 s.
// Usa react y playwright-core de ~/Codes/Personal/shepherdr/node_modules.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";

const nm = `${homedir()}/Codes/Personal/shepherdr/node_modules`;
const { chromium } = await import(`${nm}/playwright-core/index.mjs`);
const aqui = new URL("..", import.meta.url).pathname;
const tmp = mkdtempSync(`${tmpdir()}/prueba-chip-`);

// El plugin tal como lo monta Shepherdr: la marca del espacio (su Assistant) y la de una tarea, a la vez.
writeFileSync(`${tmp}/entrada.tsx`, `
import { createRoot } from 'react-dom/client'
import { MarcaEspacio, MarcaTarea } from '${aqui}web/flota-entorno/perfil.tsx'
createRoot(document.getElementById('r')).render(<><MarcaEspacio place={{ id: 'sp1' }} /><MarcaTarea chatKey="HF-1/worker" /></>)
`);
const build = await Bun.build({
  entrypoints: [`${tmp}/entrada.tsx`],
  target: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "shepherdr",
    setup(b) {
      b.onResolve({ filter: /^(react|react-dom|scheduler)(\/|$)/ }, (a) => ({ path: Bun.resolveSync(a.path, nm) }));
      b.onResolve({ filter: /^\.\/calc\.js$/ }, () => ({ path: `${aqui}mods/flota-entorno/calc.js` })); // install.sh lo copia al lado
      b.onResolve({ filter: /^@client\/kernel\.ts$/ }, () => ({ path: "kernel", namespace: "falso" }));
      b.onLoad({ filter: /.*/, namespace: "falso" }, () => ({ contents: "export const useUI = (sel) => sel({ term: null })", loader: "js" }));
    },
  }],
});
assert.ok(build.success, build.logs.join("\n"));
const js = (await build.outputs[0].text()).replaceAll("</script", "<\\/script");
rmSync(tmp, { recursive: true });

const term = (perfil, x) => ({ address: "t1", perfil, dir: "", mcp: {}, assistant: false, ...x });
let perfil = "ccp";
const foto = () => JSON.stringify({ at: 1, terminales: [term(perfil, { assistant: true, space: "sp1" }), term("a secas", { address: "t2", tarea: "HF-1" })] });

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  let pedidos = 0;
  await page.route("http://flota.test/flota/perfiles.json", (r) => { pedidos++; r.fulfill({ contentType: "application/json", body: foto() }); });
  await page.route("http://flota.test/", (r) => r.fulfill({ contentType: "text/html", body: `<div id="r"></div><script>${js}</script>` }));
  await page.clock.install();
  await page.goto("http://flota.test/");
  const chips = () => page.locator("button").allTextContents();
  await page.waitForFunction(() => document.querySelectorAll("button").length === 2);
  await page.waitForTimeout(1000); // tiempo real: el bucle de HF-17 hace cientos de pedidos aquí
  assert.equal(pedidos, 1, `al abrir: ${pedidos} pedidos (esperaba 1)`);
  assert.deepEqual(await chips(), ["Claudeccp", "Claudea secas"]);

  perfil = "ccw";
  for (let s = 15; s <= 60; s += 15) { await page.clock.runFor(15_000); await page.waitForTimeout(200); }
  assert.equal(pedidos, 5, `en 60 s: ${pedidos} pedidos (esperaba 5: al abrir y uno cada 15 s)`);
  assert.deepEqual(await chips(), ["Claudeccw", "Claudea secas"]);
  console.log(`ok: ${pedidos} pedidos en 60 s simulados, y el chip pasó de ccp a ccw`);
} finally {
  await browser.close();
}
