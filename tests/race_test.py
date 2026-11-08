"""Automated check: loads the game, verifies the course layout, and lets an
autopilot drive a full 3-lap race. Run: python3 tests/race_test.py (from the project folder)."""
import subprocess, time, sys, os, json
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else ROOT
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
AUTOPILOT = """
window.__ap = setInterval(() => {
  const o = window.__orbit, s = o.ship, T = o.T;
  const j = (s.idx + 45) % T.N;
  const want = Math.atan2(T.ys[j] - s.y, T.xs[j] - s.x);
  let d = want - s.a; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI;
  o.input.left = d < -0.06; o.input.right = d > 0.06; o.input.up = true;
  o.input.brake = Math.abs(d) > 0.9 && s.speed > 300;
}, 16);
"""
errors = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        pg = b.new_page(viewport={'width': 1280, 'height': 720})
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        pg.goto('http://localhost:8765/index.html'); time.sleep(2)
        pg.screenshot(path=os.path.join(OUT, 'shot-menu.png'))
        layout = pg.evaluate("""() => { const o = window.__orbit, T = o.T; let worst = 1e9;
          for (const m of o.MOONS) for (let i = 0; i < T.N; i++) worst = Math.min(worst, Math.hypot(T.xs[i]-m.x, T.ys[i]-m.y));
          return { L: T.L, moonClearance: worst }; }""")
        print('layout', layout)
        pg.click('#btnStart'); time.sleep(1.5)
        pg.screenshot(path=os.path.join(OUT, 'shot-countdown.png'))
        pg.evaluate(AUTOPILOT)
        t0 = time.time(); shot = False
        while time.time() - t0 < 160:
            st = pg.evaluate("() => ({ mode: window.__orbit.mode, laps: window.__orbit.race.laps.slice(), t: window.__orbit.raceT, P: window.__orbit.ship.P })")
            if not shot and st['t'] > 12:
                pg.screenshot(path=os.path.join(OUT, 'shot-race.png')); shot = True
            if st['mode'] == 'finished' or not pg.is_hidden('#results'):
                break
            time.sleep(1)
        time.sleep(2.5)
        st = pg.evaluate("() => ({ mode: window.__orbit.mode, race: window.__orbit.race })")
        print('result', json.dumps({k: st['race'][k] for k in ('laps','total','cells','hits','slings','isBest')}))
        print('results visible', not pg.is_hidden('#results'))
        pg.screenshot(path=os.path.join(OUT, 'shot-results.png'))
        saved = pg.evaluate("() => JSON.parse(localStorage.getItem('orbitRally.v1'))")
        print('saved best', saved.get('best'), 'ghost frames', len(saved.get('ghost', {}).get('f', [])) // 3)
        pg.reload(); time.sleep(1.5)
        print('menu best after reload:', pg.inner_text('#menuBest'))
        b.close()
finally:
    srv.terminate()
print('errors', errors)
