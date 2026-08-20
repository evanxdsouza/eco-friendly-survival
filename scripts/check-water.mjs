// Verifies the water reflection policy: the reflection must refresh on every
// frame while the flood is moving the surface (otherwise the reflected image
// strobes, because it is computed from the mirror plane's position), and fall
// back to alternate frames once the surface settles.
//
//   node scripts/check-water.mjs
import { chromium } from 'playwright';

const PORT = Number(process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : 5199);

/** Counts reflection renders per frame over `frames` frames. */
const COUNT = (frames) =>
  new Promise((resolve) => {
    const { renderer, terrain } = window.__eco;
    const water = terrain.water.mesh;

    // Reflection renders are scene renders issued from inside the water's
    // onBeforeRender, so wrap that to tag them.
    if (!window.__waterProbe) {
      const inner = water.onBeforeRender;
      window.__waterProbe = { hits: 0, level: 0 };
      water.onBeforeRender = function (...a) {
        const before = window.__waterProbe.reflections || 0;
        window.__waterProbe.mark = true;
        const r = inner.apply(this, a);
        window.__waterProbe.mark = false;
        return r;
      };
      const origRender = renderer.render.bind(renderer);
      renderer.render = (...a) => {
        if (window.__waterProbe.mark) window.__waterProbe.hits++;
        return origRender(...a);
      };
    }

    window.__waterProbe.hits = 0;
    let n = 0;
    const tick = () => {
      n++;
      if (n < frames) requestAnimationFrame(tick);
      else resolve({ hits: window.__waterProbe.hits, frames });
    };
    requestAnimationFrame(tick);
  });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.error('[page]', e.message));

try {
  await page.goto(`http://localhost:${PORT}/?quality=high`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__eco, null, { timeout: 180_000 });

  // frame the pond so the water is on-screen and its onBeforeRender fires
  await page.evaluate(() => window.__eco.setView([-11, 8, 14], [-11, 0, 9]));
  await page.waitForTimeout(3000);

  const idle = await page.evaluate(COUNT, 12);
  console.log(
    `idle      ${idle.hits}/${idle.frames} frames reflected  ` +
      `(${(idle.hits / idle.frames).toFixed(2)}/frame)`
  );

  await page.evaluate(() => window.__eco.triggerBuilding('flood'));
  await page.waitForTimeout(1200); // let the level start rising
  const flooding = await page.evaluate(COUNT, 12);
  console.log(
    `flooding  ${flooding.hits}/${flooding.frames} frames reflected  ` +
      `(${(flooding.hits / flooding.frames).toFixed(2)}/frame)`
  );

  const idleOk = idle.hits / idle.frames <= 0.6;
  const floodOk = flooding.hits / flooding.frames >= 0.95;
  console.log(`\nidle halves the reflection : ${idleOk ? 'PASS' : 'FAIL'}`);
  console.log(`flood reflects every frame : ${floodOk ? 'PASS' : 'FAIL'}`);
  process.exitCode = idleOk && floodOk ? 0 : 1;
} finally {
  await browser.close();
}
