"""Phone check: touch layout in landscape and portrait, a tapped boost,
and a reload with the network switched off (flight mode)."""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else ROOT
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
        for name, vp in [('landscape', {'width': 844, 'height': 390}), ('portrait', {'width': 390, 'height': 844})]:
            ctx = b.new_context(viewport=vp, device_scale_factor=3, has_touch=True, is_mobile=True)
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.goto('http://localhost:8766/index.html'); time.sleep(1.5)
            pg.screenshot(path=os.path.join(OUT, f'phone-{name}-menu.png'))
            pg.tap('#btnStart'); time.sleep(4.2)
            # hold "right" with a real pointer for a moment, then tap boost
            box = pg.locator('[data-key=right]').bounding_box()
            pg.touchscreen.tap(box['x'] + 30, box['y'] + 30)
            bb = pg.locator('[data-key=boost]').bounding_box()
            pg.touchscreen.tap(bb['x'] + 30, bb['y'] + 30)
            time.sleep(0.4)
            st = pg.evaluate("() => ({ touchShown: !document.getElementById('touch').hidden, speed: window.__orbit.ship.speed, boostT: window.__orbit.ship.boostT, meter: window.__orbit.ship.meter })")
            print(name, st)
            time.sleep(1.5)
            pg.screenshot(path=os.path.join(OUT, f'phone-{name}-race.png'))
            if name == 'landscape':
                # flight mode: service worker must serve the game with no network
                pg.goto('http://localhost:8766/index.html'); time.sleep(2)
                ready = pg.evaluate("async () => { const r = await navigator.serviceWorker.ready; return !!r.active; }")
                ctx.set_offline(True)
                pg.reload(); time.sleep(1.5)
                print('offline reload ok:', pg.is_visible('#btnStart'), '| sw active:', ready, '| font loaded:', pg.evaluate("document.fonts.check('700 20px \"Chakra Petch\"')"))
                ctx.set_offline(False)
            ctx.close()
        b.close()
finally:
    srv.terminate()
print('errors', errors)
