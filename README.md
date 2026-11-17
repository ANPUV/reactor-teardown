# Reactor Teardown

Interactive 3D explainer of four reactors as ONE offline HTML file (see PLAN.md, CONTRACT.md).

```
export PATH="$HOME/.nvm/versions/node/v20.18.1/bin:$PATH"
npm install
npm test                                   # node --test test/   (kinetics + pwr, +machines as they land)
node build.mjs                             # dist/index.html (all machines found in src/machines/*)
node build.mjs --only pwr --out dist/dev-pwr.html
node tools/shot.mjs --file dist/index.html --out shots/pwr --states 'name=a,mode=cutaway; name=b,iso=core'
```
Open `dist/index.html` from file://. URL options: `?q=high|mid|low` (lock quality), `?tour=0` (no auto tour). Hash routes `#uranium #plutonium #thorium #fusion`.

## Decisions where PLAN.md was silent
- Rod worth S-curve nominal position x0 = 0.88 (a gentle top-of-curve slope so a full withdrawal adds ~80 pcm rather than tripping on a prompt jump).
- Heat sink: steam-generator removal Q = load * Pnom * (1 + kappa*(Tavg-Tavg0)/dT0) and Tin follows with a 25 s lag. Energy-consistent: steady state forces P = Q.
- Decay heat is a six-exponential fit to Way-Wigner (state-based, works for any power history) rather than the closed form.
- A small neutron source term (1e-7) keeps a shut-down core from reading exactly zero so it can restart.
- SCRAM trips the turbine (electric output goes to 0, steam dump load 5 %). "Reset trip" re-arms; rods stay in until withdrawn.
- Cutaway is a plane through the vertical axis; default cut angle equals the default camera azimuth so the cut face faces the camera. Parts on the removed side disappear (the PWR default view is chosen so the turbine hall is kept).
- Fuel drill-down (assembly, rod, pellet) are magnified copies parked above the plant, shown only when isolated, ignoring the cut.
- Part cards open in a floating panel and the 3D view is re-fitted into the remaining free area (rails, deck and card are insets).
- Fonts: Barlow Condensed 600/700, Inter 400/500/600, JetBrains Mono 400/500, latin subset woff2, base64-inlined.
- Quality: `high` pr<=2 + 2048 shadows; `mid` pr<=1.5 + 1024; `low` pr 1, no shadows. Auto-drop one tier after 2 s above 28 ms.

## Strategik, i18n
The shell follows the Strategik design system (design-system/project): black app bar, mono labels, Space Grotesk reading text, square corners, no shadows, one orange used as a mark. Fonts are the system's own woff2 files (latin, latin-ext, vietnamese) copied to `src/fonts/` and inlined. Vietnamese is the default language; `?lang=en` or the EN switch gives English. `node tools/i18n-check.mjs [id]` lists strings missing from a dictionary. See CONTRACT.md sections 12 to 15.

## Tour and time
The page loads frozen (x0) with the tour off. The "Tour" button starts the simulation and the tour together; the same button ("Pause") pauses both. The Time selector (x0 to x1000) and Space run or freeze the simulation without the tour. URL: `?run=1` starts unfrozen, `?tour=1` starts simulation and tour. See CONTRACT.md section 17.
