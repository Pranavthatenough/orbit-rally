# Prompts

These are the prompts I gave my AI agent (Claude), in the order I gave them.

## 1. Read the brief and pick a game

> So us task is to read the entire pdf properly and understand the whole projects, there are 4 section and im giving u to work on section B as there are 3 project with the difficulty level so u have to make auto rally projects and make sure u have to make it good coz i have to upload this to the official website. If u need any help the pdf provides hints also so go through that, but before doing the auto rally i want u to give alternative of this games or any other good game cuz it sounds and looks so trash. I want something more interesting so yeah please suggest some games first before start implementing. Once i decide the game rest u have to do the procedure as i mentioned in the prompt.

*Result:* the agent suggested four racing ideas that still meet every Project 8 requirement:
- Orbit Rally (space)
- Monsoon Drift
- Neon Highway
- Galli Kart

## 2. Build it

> alright do the orbit rally from scratch

*What the agent did, following the PDF's plan → build → test steps:*
1. **Planned** the track first. It checked that no two parts of the loop come close enough to cut across, and that the planet and moons don't overlap the track.
2. **Built** the game in one project folder:
   - an HTML canvas game,
   - fonts kept locally,
   - a service worker and manifest so it installs and works offline.
3. **Tested** with automated scripts:
   - an autopilot drove a full 3-lap race;
   - the best time survived a page reload;
   - phone layouts were checked in landscape and portrait;
   - a reload with the network off still worked.
4. **Improved** what the tests showed. The track's edge lines folded into spikes on tight corners. The agent switched to layered strokes so the edges are always clean.

## 3. Make it a real phone app

> cant u just provide the app

*What the agent did:*
1. **Wrapped the game** in a small Android app: a full-screen `WebView` with the game files inside the APK.
2. **Built without Android Studio.** It compiled with javac and dx, packaged with apktool, aligned the zip, and signed it with apksigner (v2 and v3).
3. **Checked the APK:**
   - package name, minimum Android version, icon and launch screen;
   - no permissions requested;
   - the code inside;
   - the packaged game: back button, pausing when the app is left, and saved data.

<!-- Add your next prompts below as you keep improving the game, e.g.
## 3. <what you asked>
> your prompt here
-->
