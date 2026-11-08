# Orbit Rally

**Week 2 · Project 8 (Section B: Phone apps and games)**
A three-lap space racer around planet Vyom. It is built as a browser game (HTML canvas + Web Audio) that installs on a phone like an app and runs with no internet.

Orbit Rally is my take on the "Auto Rally" brief. It keeps every required feature of the brief but swaps the auto-rickshaw for a rover-ship on an orbital track.

## How to play

| | Keyboard | Phone |
|---|---|---|
| Thrust | ↑ or W | Automatic |
| Steer | ← → or A D | Left thumb buttons |
| Brake | ↓ or S | Brake button |
| Boost | Space | Boost button |
| Pause / mute | P / M | Buttons at the top right |

On the track:
- **Fuel cells** (green): 5 cells fill one boost bar. You start with one bar.
- **Asteroids**: they knock you back and slow you down.
- **Crates (?)**: give either a shield, which smashes asteroids, or a warp, which is a big speed burst.
- **Moon rings** (Tara and Chandra): fly through the dashed ring to get pulled in and slingshot out faster.
- **Ghost**: after your first finish, a blue ghost replays your best run so you can race it.

## Requirements from the brief

| What to build | Where it is |
|---|---|
| Driveable vehicle on a looping road | Rover-ship on a closed spline track around a planet |
| Keyboard and touch controls | Arrow/WASD keys; on-screen buttons with multi-touch |
| Coins, obstacles, power-up | Fuel cells; drifting asteroids; shield and warp crates; moon slingshots |
| 3 laps with a timer | Race clock, lap clock, lap splits on the results screen |
| Best time that stays saved | Saved in `localStorage` (best time, best lap, ghost) |
| Sound with a mute button | Synthesised sounds (no audio files); mute button and the M key, also saved |

## Done when (my checklist)

- [ ] A full race plays on a real phone in flight mode
- [ ] A friend finishes a race with no instructions from me
- [ ] Crashes and lap counts feel fair
- [ ] The best time survives a restart

Why these should pass:
- **Flight mode:** `sw.js` caches every file, including the fonts, on the first visit.
- **No instructions:** chevrons on the track show the direction, and a hint appears at "Go". A "Wrong way" warning shows if you turn around.
- **Fair crashes:** after a hit you get 1.1 s of protection, so one rock can't hit you twice.
- **Fair laps:** laps are counted from distance travelled along the track, so you can't cheat by reversing over the line. A fence at the edge stops you cutting corners.

## Install on an Android phone (APK)

1. Copy `orbit-rally.apk` to your phone, using WhatsApp-to-self, Google Drive or a USB cable.
2. Tap it. If Android asks, allow **Install unknown apps** for the app you opened it from (Files, Chrome, etc.).
3. Tap **Install**, then **Open**. Play Protect may say it doesn't recognise the developer. Choose **Install anyway**, because the app isn't from the Play Store.

The app asks for **no permissions**, not even internet. The whole game is stored inside the APK, so it works in flight mode from the first launch.
- **Back button:** pauses a race, closes menus, and only leaves the app from the main menu.
- **Leaving the app:** switching away pauses the race and stops the sound.

Details: package `com.bserc.orbitrally`, version 1.0, Android 7.0 or newer, signed with APK Signature Scheme v2 and v3.

To rebuild the APK after changing the game, run `android/build_apk.sh`. The script lists the 4 tool files it needs, and it doesn't need Android Studio. It is a small Java `WebView` wrapper, `android/src/.../MainActivity.java`, around the same HTML game.

**Keystore:** `android/orbit-rally.keystore` signs every build, with the password `orbitrally`. Keep it: Android only accepts an update if it is signed with the same key.

## Install as a web app (any phone, including iPhone)

1. Upload the whole folder to a website served over HTTPS. GitHub Pages, Netlify or the course site all work.
2. Open the link once in Chrome on Android, or Safari on iPhone.
3. Use **Add to Home screen**, or **Install app** in Chrome's menu.
4. Turn on flight mode and open it from the home screen.

To test on a laptop, run this inside the folder and open http://localhost:8000:

```
python3 -m http.server 8000
```

Opening `index.html` directly as a file also plays the game, but the offline install only works over http(s).

## Files

```
index.html             page structure: canvas, HUD, menus, touch buttons
style.css              look and layout (fonts stored locally in fonts/)
game.js                the whole game: track, physics, items, sound, saving
sw.js                  service worker that caches everything for offline play
manifest.webmanifest   app name and icons for "Add to Home screen"
icons/                 app icons
fonts/                 Chakra Petch and JetBrains Mono (Open Font License)
tests/                 automated checks (Python + Playwright)
android/               Android app wrapper, icons and APK build script
orbit-rally.apk        ready-to-install Android app
prompts.md             every prompt used to build this, in order
```

## How the game works (short version)

- **Track:** 19 control points are joined into a smooth closed curve (a Catmull-Rom spline), then sampled every 10 units. Each sample stores its position, its direction and its sideways direction.
- **Where am I:** each frame the game finds the nearest sample. That gives:
  - the distance along the lap, which drives lap counting;
  - the distance from the centre line, which decides whether you are on the track, in the dust, or at the fence.
- **Physics:** the ship's speed is split into "forward" and "sideways".
  - Sideways speed is damped strongly, so the ship grips. Braking while steering damps it less, so you drift.
  - A speed cap changes with your state: normal, boost, warp, slingshot or dust.
  - Physics runs at a fixed 120 steps per second, so the game feels the same on slow and fast phones.
- **Ghost:** your position is recorded 20 times a second, and the best run is saved and replayed.

## Tests

```
pip install playwright
python3 tests/race_test.py     # autopilot drives a full 3-lap race and checks results + saving
python3 tests/phone_test.py    # phone layouts, touch buttons, and an offline reload
```
