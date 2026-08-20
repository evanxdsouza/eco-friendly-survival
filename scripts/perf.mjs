// ---------------------------------------------------------------------------
// PERFORMANCE / FIDELITY HARNESS
// ---------------------------------------------------------------------------
// Boots the app in headless Chromium and reports, per scenario:
//   - frame time percentiles (p50 / p95)
//   - draw calls, triangles, and renderer.render() invocations per frame
//   - a deterministic screenshot for pixel comparison
//
// Frame times here run on SwiftShader unless a real GPU is present, so treat
// them as a relative signal. The render-call and draw-call counts are exact
// and hardware-independent — they are the honest measure of structural wins.
//
//   node scripts/perf.mjs --tag before
//   node scripts/perf.mjs --tag after --compare before
// ---------------------------------------------------------------------------
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.perf');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const TAG = argOf('tag', 'run');
const COMPARE = argOf('compare', null);
const QUALITY = argOf('quality', 'high');
const FRAMES = Number(argOf('frames', '6'));
const WARMUP = Number(argOf('warmup', '4'));
const SHOTS = args.includes('--shots');
const PORT = Number(argOf('port', '5199'));
// Run a single scenario per process. On memory-constrained machines the whole
// suite in one browser session gets OOM-killed; one scenario per invocation
// keeps each run short and lets the OS reclaim between them.
const ONLY = argOf('only', null);
const MERGE = args.includes('--merge');

// A fixed camera + time-of-day per scenario, so every run frames the identical
// composition. `act` runs once before measuring.
const SCENARIOS = [
  {
    name: 'overview-idle',
    view: [[47, 33, 52], [0, 6, 0]],
    hour: 10.5,
  },
  {
    name: 'street-level',
    view: [[12, 2.6, 16], [0, 3, 0]],
    hour: 10.5,
  },
  {
    name: 'night-lamps',
    view: [[30, 12, 34], [0, 5, 0]],
    hour: 21.5,
  },
  {
    name: 'sims-running',
    view: [[38, 20, 42], [0, 6, 0]],
    hour: 10.5,
    act: async (page) => {
      await page.evaluate(() => {
        window.__eco.triggerBuilding('earthquake');
        window.__eco.triggerBuilding('acidRain');
        window.__eco.triggerBuilding('flood');
        window.__eco.triggerBuilding('farm');
      });
    },
  },
];

async function serverAlreadyUp() {
  try {
    const res = await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => reject(new Error('vite did not start in 60s')), 60_000);
    proc.stdout.on('data', (d) => {
      if (new RegExp(`localhost:${PORT}`).test(d.toString())) {
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
    proc.on('exit', (code) => reject(new Error(`vite exited early (${code})`)));
  });
}

/**
 * Wraps renderer.render so we can count *scene* renders (shadow pass, water
 * reflection, GTAO prepass, main colour) separately from the fullscreen quad
 * renders the composer issues. Also switches renderer.info to manual reset so
 * draw calls accumulate over a whole frame instead of only the last pass.
 */
const INSTRUMENT = () => {
  const r = window.__eco.renderer;
  const mainScene = window.__eco.scene;
  r.info.autoReset = false;
  window.__perf = { sceneRenders: 0, passRenders: 0 };
  const orig = r.render.bind(r);
  r.render = (scene, camera) => {
    if (scene === mainScene) window.__perf.sceneRenders++;
    else window.__perf.passRenders++;
    return orig(scene, camera);
  };
};

/**
 * Samples renderer statistics over a fixed number of frames.
 *
 * Frame COUNT, not a time window: on a software rasteriser this scene can take
 * seconds per frame, so a time-boxed sample often captures zero frames. The
 * per-frame counters (scene renders, draw calls, triangles) are exact and
 * hardware-independent — they are the primary signal. Frame time is recorded
 * too but is only meaningful on a real GPU.
 */
const SAMPLE = ([frameCount, warmFrames]) =>
  new Promise((resolve) => {
    const r = window.__eco.renderer;
    const frames = [];
    const renders = [];
    const draws = [];
    const tris = [];
    let last = performance.now();
    let n = 0;

    const tick = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      n++;
      if (n > warmFrames) {
        frames.push(dt);
        renders.push(window.__perf.sceneRenders);
        draws.push(r.info.render.calls);
        tris.push(r.info.render.triangles);
      }
      window.__perf.sceneRenders = 0;
      window.__perf.passRenders = 0;
      r.info.reset();
      if (frames.length < frameCount) requestAnimationFrame(tick);
      else resolve({ frames, renders, draws, tris });
    };
    requestAnimationFrame(tick);
  });

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Prints a before → after table for every scenario present in both runs. */
function report(base, next) {
  console.log(`\n=== ${COMPARE} → ${TAG} ===`);
  const d = (x, y, unit = '') =>
    `${x.toFixed(1)}${unit} → ${y.toFixed(1)}${unit} ` +
    `(${y > x ? '+' : ''}${(((y - x) / x) * 100).toFixed(0)}%)`;
  for (const name of Object.keys(next)) {
    const b = base[name];
    const a = next[name];
    if (!b) continue;
    console.log(`\n${name}`);
    console.log(`  fps      ${d(b.fps, a.fps)}`);
    console.log(`  p50      ${d(b.p50, a.p50, 'ms')}`);
    console.log(`  p95      ${d(b.p95, a.p95, 'ms')}`);
    console.log(`  renders  ${d(b.renders, a.renders)}`);
    console.log(`  draws    ${d(b.draws, a.draws)}`);
    console.log(`  tris     ${d(b.tris, a.tris)}`);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // Merge mode just stitches per-scenario JSON files into one tagged result.
  if (MERGE) {
    const merged = {};
    for (const s of SCENARIOS) {
      const f = join(OUT, `${TAG}.${s.name}.json`);
      if (existsSync(f)) Object.assign(merged, JSON.parse(readFileSync(f, 'utf8')));
    }
    writeFileSync(join(OUT, `${TAG}.json`), JSON.stringify(merged, null, 2));
    console.log(`merged ${Object.keys(merged).length} scenarios into .perf/${TAG}.json`);
    if (COMPARE) report(JSON.parse(readFileSync(join(OUT, `${COMPARE}.json`), 'utf8')), merged);
    return;
  }

  const reuse = await serverAlreadyUp();
  console.log(reuse ? `reusing vite on :${PORT}` : 'starting vite…');
  const server = reuse ? null : await startServer();

  const browser = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-frame-rate-limit',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.error('[page error]', e.message));

  const results = {};
  try {
    await page.goto(`http://localhost:${PORT}/?quality=${QUALITY}`, { waitUntil: 'load' });
    console.log('booting scene (procedural textures take a while)…');
    await page.waitForFunction(() => !!window.__eco, null, { timeout: 180_000 });
    await page.evaluate(INSTRUMENT);

    for (const s of SCENARIOS.filter((x) => !ONLY || x.name === ONLY)) {
      process.stdout.write(`  ${s.name}… `);
      await page.evaluate(
        ([view, hour]) => {
          // Re-baking the IBL is very expensive; only do it if the hour differs.
          if (Math.abs(window.__eco.sky.state.hour - hour) > 1e-3) {
            window.__eco.setTimeOfDay(hour);
          }
          window.__eco.setView(view[0], view[1]);
        },
        [s.view, s.hour]
      );
      if (s.act) await s.act(page);
      // Changing the time of day re-bakes the IBL and currently invalidates
      // every material, so the next few frames are shader compiles. Let them
      // drain before sampling or they dominate the percentiles.
      await page.waitForTimeout(1000);

      const raw = await page.evaluate(SAMPLE, [FRAMES, WARMUP]);
      const r = {
        fps: 1000 / mean(raw.frames),
        p50: pct(raw.frames, 50),
        p95: pct(raw.frames, 95),
        renders: mean(raw.renders),
        draws: mean(raw.draws),
        tris: Math.round(mean(raw.tris)),
      };
      results[s.name] = r;
      console.log(
        `${r.renders.toFixed(2)} scene-renders  ${Math.round(r.draws)} draws  ` +
          `${r.tris.toLocaleString()} tris  (${r.p50.toFixed(0)}ms/frame, software raster)`
      );

      // Deterministic capture: pin every animated clock, then render and read
      // the framebuffer back inside one task. page.screenshot() cannot be used
      // here — it waits for the page to go quiet, and a rAF-driven canvas never
      // does.
      if (SHOTS) {
        await page.evaluate(() => window.__eco.freeze(12));
        await page.waitForTimeout(1500);
        const dataUrl = await page.evaluate(() => window.__eco.snapshot());
        writeFileSync(
          join(OUT, `${TAG}-${s.name}.png`),
          Buffer.from(dataUrl.split(',')[1], 'base64')
        );
        await page.evaluate(() => {
          delete window.__eco.frozen;
        });
      }
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  const outName = ONLY ? `${TAG}.${ONLY}.json` : `${TAG}.json`;
  writeFileSync(join(OUT, outName), JSON.stringify(results, null, 2));
  console.log(`\nwrote .perf/${outName}`);

  if (COMPARE) {
    const path = join(OUT, `${COMPARE}.json`);
    if (!existsSync(path)) {
      console.error(`no baseline .perf/${COMPARE}.json`);
      return;
    }
    report(JSON.parse(readFileSync(path, 'utf8')), results);
    console.log(`\ncompare screenshots: .perf/${COMPARE}-*.png vs .perf/${TAG}-*.png`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
