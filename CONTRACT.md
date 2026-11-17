# CONTRACT: how to build a machine

Read this plus `PLAN.md` and `src/machines/pwr/` (the worked example). You never need to read kit source.
Machine ids: `sfr`, `msr`, `tokamak` (tabs plutonium, thorium, fusion). Work only inside `src/machines/<id>/` and `test/<id>.test.mjs`.

## 1. Commands
```
export PATH="$HOME/.nvm/versions/node/v20.18.1/bin:$PATH"
npm install                                   # once
node --test test/<id>.test.mjs                # physics tests (write these FIRST)
node build.mjs --only <id> --out dist/dev-<id>.html
node tools/shot.mjs --file dist/dev-<id>.html --route '#plutonium' --out shots/<id> --cols 3 \
   --states 'name=solid,mode=solid; name=cut,mode=cutaway; name=xray,mode=xray; name=ex05,explode=0.5; name=ex10,explode=1; name=p1,iso=<partId>'
node tools/shot.mjs --file dist/dev-<id>.html --route '#plutonium' --list      # prints part ids
node tools/shot.mjs ... --size 390x844 --dpr 2 --states 'name=ph,pane=controls'   # phone layout
node tools/shot.mjs ... --tourat 12000        # a frame mid-tour;  --perf 4000 prints frame times
```
State tokens: `name mode iso explode cut cam=az:el[:dist] preset ctl.<id>=<v> press=<id> accel adv=<sim s> reset=1 wait=<ms> keep=1 q=<tier> pane`.
It prints the WebGL renderer (must say Apple/Metal, not SwiftShader), console errors, and any network requests. READ the PNGs.
The route hash is the tab: `#uranium #plutonium #thorium #fusion`.

## 2. Files and registration
`src/machines/<id>/index.js` default-exports the machine definition. build.mjs auto-registers any folder with an `index.js`; no other edit needed.
Suggested split (as pwr): `spec.js model.js geometry files atom.js tour.js index.js`. Import three as `import * as THREE from 'three'` (do NOT import three examples; do not pass THREE around).
```js
export default {
  id, tab, title, short,        // 'sfr','plutonium','Sodium-cooled fast breeder','SFR'
  spec,                         // spec.js export (3)
  createModel,                  // () => model (4)
  controls, gauges, charts,     // descriptor arrays (5)
  build(ctx),                   // (6)
  atom,                         // (7)
  tour,                         // (8)
  sources: ['text line', ...],  // shown in About drawer (plain text, no fetches)
  sourceLabels: { key: 'full source text' },   // resolves spec item `src` keys on part cards
};
```

## 3. spec.js
```js
export const spec = {
  id, name, reference,          // reference = "BN-800 (Beloyarsk 4)"
  items: { key: { label, v, unit, src, approx } },   // EVERY number shown anywhere: geometry sizes, ops point, nuclear data
  compare: { fuel, spectrum, coolant, tin, tout, pressure, thermal, electric, betaEff, lambda, note, eff? },
};
```
`compare` values: a string, or `{k:'itemKey'}` (rendered with unit and "≈" when approx). Missing numbers: use a string like `'none (makes no electricity)'`. `eff` is derived from items.thermal/electric when both numeric. Mark anything you cannot stand behind `approx:true`. Cards and gauges must read `spec.items`; never retype a number.

## 4. Model (`createModel()`)
Returns an object with exactly:
```js
{ id, state, controls, setControl(key,v), press(id), scram?(reason), resetTrip?(), advance(simSeconds), reset(), params }
```
- `state`: flat plain object, **mutated in place** by `advance` (same object identity forever). Required keys used by the shell: `time` (sim s), `status` ('RUNNING'|'TRIPPED'|'SHUTDOWN'), `scrammed` (bool), `tripReason` (string). Everything else is yours (gauges/geometry/atom read it). Derive display quantities inside the model, not in geometry.
- `controls`: plain object of current control targets (e.g. `rods`, `flow`, `load`). The model may change them itself (SCRAM sets rods to 0); sliders re-sync from it.
- `advance(simDt)`: the ONLY thing that advances time; sub-step internally; must be stable for simDt up to ~20 s (x1000 at 60 fps) and never produce NaN/Infinity. `reset()` restores nominal.
- Fission machines: build on `kit/kinetics.js` (section 9). Tests (`test/<id>.test.mjs`, `node --test`): nominal controls hold the reference operating point within 2 % for 10 sim minutes; each control moves the right way; SCRAM / drain / disruption behaves; trips report a reason; fuzz 10,000 random control changes at random accelerations (1,10,100,1000) finite and bounded; print a reference-vs-model table. See `test/pwr.test.mjs`.

## 5. Descriptors (`controls`, `gauges`, `charts`)
Controls (bottom deck):
```js
{ type:'slider', id, label, unit, min, max, step, decimals, key, scale, mark?, hint? }   // value shown = controls[key]*scale; writes model.setControl(key, v/scale)
   // optional get(model)->displayValue, set(model,displayValue) override key/scale; mark = nominal tick
{ type:'button', id, label, kind:'danger'|undefined, hotkey:'x', press(model), disabled?(state), hint }
{ type:'toggle', id, label, get(model)->bool, set(model,bool) }
```
Gauges (right rail; all `get(state)`): `{type:'dial', id,label,unit,min,max,mark?,decimals?,zones:[{from,to,kind:'warn'|'alarm'}],get}`, `{type:'bar',...,min,max,mark?}`, `{type:'readout', id,label,unit,decimals?,format?(v,state),get}` (2 per row; dials 2 per row).
Charts (`charts`, strip charts, `span:2`): `{type:'strip', id,label, series:[{label,color:'ink'|'hot'|'cold'|'steam'|'plasma'|'muted',get}], min?,max?, windowSec, height:52}`; x axis is sim time, window = windowSec x acceleration.
Budget for the right rail at 1440x900: <= 4 dials, <= 6 readouts, 2 charts, or the atom view is pushed below the fold.
Control ids are used by the tour (`control:{id,to}` / `press:'id'`). Include a button with id `scram` (or your machine's equivalent) so tours can press it.

## 6. `build(ctx)` -> instance
`ctx = { mats, spec, model, state, quality:{tier,detail}, tier }`. `detail` is 1 (high) / 0.6 / 0.3: scale radial segments and instance counts by it. Units: choose metres, y up, ground at the lowest y. Return:
```js
{ root: THREE.Group,                 // contains every part object
  parts: [ { id, label, object, explodeOffset:[x,y,z], spread?:[{object,offset}], camera:{az,el,fill?,dist?,target?},
             card:{ title, text, facts:[{label,spec:'itemKey'} | {label,live:(state)=>string}] },
             group?:'Heading', badge?:'x193', parent?:'otherPartId', reveal?:'isolate', noCut?:true, listed?:false, highlight?:false } ],
  update(state, t, dt),              // pure reader: t = real seconds, dt = real seconds (NOT scaled by acceleration)
  cutOrigin:[x,y,z], cutAngle: deg,  // cut plane contains the vertical axis through cutOrigin
  defaultMode:'cutaway'|'solid', defaultView:{az,el}, presets?:{iso,front,side,top: {az,el}},
  setQuality?(tier), dispose?() }
```
Rules for parts:
- `object` is a Group (or mesh) added to `root` at a stable base position. The stage moves `object.position` for explode (base + explodeOffset*e). Never reparent it or change its own position; animate children only.
- `explodeOffset`: world offset at explode = 1. Neighbouring parts must clear each other at 1.0 (stack along y, or push outward). `spread:[{object,offset}]` additionally moves child sub-objects (e.g. each of 4 identical units radially).
- `camera.az/el` (degrees; az 0 = camera on +z axis, az 90 = camera on +x) pick the fly-to angle; distance is auto-fitted to the part's real extents with `fill` (default 0.72). Choose `az ~= cutAngle` so the cut face faces the camera. The cut removes the half-space on the camera side of the plane, so keep anything that must stay visible on the other side or move cutOrigin.
- `reveal:'isolate'` = hidden until isolated (used by the PWR fuel drill-down: magnified copies parked above the plant, `noCut:true` so cutaway is ignored for them). `parent` indents the button under another part.
- At least these parts per PLAN section 5 for your machine, each with a card (title, 1-3 sentence text, facts). Every number in a card = spec item or live state.
- Isolation turns every other part to glass automatically; selected part gets a faint yellow tint. X-ray and ghost are automatic (MeshStandardMaterial rim-alpha variants of your materials). Meshes flagged `mesh.userData.fx = true` (glow, particles, sprites) are hidden while another part is isolated and left alone in x-ray. Set `userData.noVariant = true` on meshes that must never be swapped.
- If you change a material's `color` / `emissive` per frame, change the ORIGINAL material instance; the stage syncs its x-ray/ghost clones every frame. Do not replace `mesh.material` at runtime.
- Cutaway is a global clip plane: use `mats.get(...)`/`mats.make(...)` (DoubleSide) so cut shells show their inner wall. Closed solids look hollow when cut; that is accepted.
- Near-white or glassy things need an ink outline (`outline(mesh)` in util) or a darker colour. Check exploded frames: nothing pale on the pale backdrop.
- Drill-down parts: keep every object visible at a sensible size by magnifying (label the magnification in the card title).

State-driven visuals (everything from `state`, nothing from controls): rod heights, colours via `mats.tempColor`, glow opacity, particle speed, spin rate, fill levels.

## 7. Atom view (`atom`)
```js
atom = { title, species:{ key:{r, color, label?, ring?, labelColor?} },
  rate(state) -> events/s to display (engine clamps 0.25..2.2, 0 when shut down),
  outcomes(state) -> [{ id, label, p, scene:(rand)=>actors[] }],   // p from live model; engine normalises
  stats:[{ label, get(state)->string }] }                         // <= 4, keep labels short
```
Actors (import `A` from `../../kit/atomview.js`): `A.move(sp,[x0,y0],[x1,y1],t0,t1,{trail})`, `A.hold(sp,[x,y],t0,t1)`, `A.path(sp,[[t,x,y,scale,alpha],...])`, `A.text(str,[x,y],t0,t1)`, `A.burst(sp,[x,y],t0,dur,count,dist,rand)`. Coordinates are 0..1 of the canvas. Outcome probabilities must come from the live model (k_eff, cross-section ratios, <sigma v>(T)...). See `pwr/atom.js`; PLAN section 6 lists the four required reactions.

## 8. Tour (`tour`)
Array of steps (kit/tour.js header documents it): `{say, wait}`, `{isolate:'partId'}`, `{clear:true}`, `{mode}`, `{camera:'iso'|{az,el}}`, `{cut:deg}`, `{explode:0..1, ms}`, `{control:{id,to}, ms}` (to in display units), `{press:'id'}`, `{accel:1|10|100|1000}`, `{resetModel:true}`. The cursor visits the real buttons, so the ids must exist. Start with a say; end by restoring state and inviting the visitor. 15-20 steps, ~80 s. The runner resets view+model before starting.

## 9. kit API (signatures)
- `kit/kinetics.js`: `new Reactor(params)`; `makeParams(over)` fields: `Pnom PeNom Tin0 Tout0 Tf0 Lambda betaEff alphaF alphaC (pcm/K) rod:{W,x0} rodSpeed scramTime tauFuel tauCool fuelHeatFraction tauPump sink:{mode:'load'|'fixed',kappa,tau,tripLoad,tauLoad} xenon:{worth,burn}|null source trip:{overpower,period,periodMinN,dTout,enabled} circulating:{tCore,tLoop}|null (liquid fuel: precursors leave with the flow) hooks:{reactivity(state,controls)->dk/k, afterStep(state,h,reactor)}`. Reactor has `controls {rods(target withdrawn 0..1), flow, load, extraRho(pcm)}`, `state` (n, Tf, Tc, Tin, Tout, rho, rodPos, flow, load, power, powerFission, powerDecay, powerElectric, steamPower, keff, period, scrammed, tripReason, xe, I, ...), `advance(dt)`, `scram(reason)`, `resetTrip()`, `reset()`. Also `scaleGroups(betaEff)`, `rodS(x)`, `wayWigner(t,tOp)`, `PCM`. Backward-Euler kinetics: the fast set (Lambda 4.5e-7) is tested stable at all accelerations (see `test/kinetics.test.mjs`). Wrap it in your model.js (see `pwr/model.js`) and add derived plant quantities there. Use `hooks`/`extraRho` for machine specials (freeze-plug drain, graphite coefficient, breeding counter). The tokamak model does not use kinetics (PLAN 4.2).
- `kit/materials.js` (`ctx.mats`): `get(name)` shared, `make(name, overrides)` own copy (animate these), names: steel stainless concrete zircaloy copper graphite sodium salt water glass absorber fuel paint dark; `glow(color, opacity)` additive (set `userData.fx`), `basic(color,opacity)`, `tempColor(T,tMin,tMax,out)`, `ramp(t01,out)`; `COLORS` ink muted accent hot cold steam plasma cherenkov. Accent yellow is reserved for UI; do not use it on parts.
- `kit/util.js`: `clamp lerp smoothstep easeInOut rng(seed) fmt(v,d) fmtSci`, three helpers `outline(mesh,{color,opacity})`, `pipe(points,radius,material,{segments,radial,tension})` (CatmullRom tube; `.userData.curve`), `lathe([[r,y],...],material,segments)`, `cylBetween(a,b,r,material)`, `createFlow(paths,{size,color,opacity})` -> `{object, update(dt, speedMetresPerSec, colorFn(pathIndex,u))}` (particle streams along polylines; flagged fx), `glowTexture()`.
- `kit/atomview.js`: section 7. `kit/hud.js`, `kit/stage.js`, `kit/tour.js` are used by the shell; machines do not call them.
- Debug in page: `window.__rt` (`setMode isolate setExplode setCut setControl press setAccel advance(sim s) settle getState tourOff camera preset resetView resetModel setQuality perf partIds`).

## 10. Performance budget (per machine, high tier, 1440x900 on M1 Max: >= 50 fps; PWR measures 60 fps vsync-bound)
<= 300 draw calls, <= 150k triangles, <= 1 `Points` object per particle system (<= 800 particles each), repeated things (assemblies, coils, blades, bolts, blanket modules, tubes) as `InstancedMesh` or merged `LineSegments`; no per-frame allocation in `update`; update instance colours/matrices only when the value changed (see `pwr/index.js` core.update). Use `ctx.quality.detail` for segment counts. Built file budget: +100-150 KB per machine.

## 11. Checklist (done means all ticked)
- [ ] spec.js: every number has unit + src; approx flagged; compare filled
- [ ] model tests green: reference point, control directions, trips with reasons, fuzz; table printed
- [ ] every part from PLAN section 5 present with card, camera, explodeOffset; ids stable
- [ ] state drives visuals; gauges agree with the pose (rod height, glow, speeds)
- [ ] shots read: solid, cutaway, x-ray, explode 0.5 and 1.0, >= 3 isolated parts, phone 390x844, one frame mid-tour
- [ ] nothing pale lost on the backdrop (esp. exploded), nothing pokes through, parts that should touch do
- [ ] part cards and the camera fill (60-70 % of the free area) leave the part visible
- [ ] no console errors/warnings; no network requests; `node build.mjs --only <id>` works from file://
- [ ] fps measured with `--perf`; draw calls and triangles reported
- [ ] atom view probabilities come from live state; tour runs to the end and each id it uses exists

---
# ADDITIVE NOTES (shell/kit follow-ups; nothing above changed)

## 12. Isolation and cutaway rules
- A part that declares `spread` (several identical units moved separately: steam generators, pumps, legs) is **not clipped by the global cut when isolated**, and in cutaway mode it is drawn as x-ray so the interior still opens up and ALL units agree with the badge. Opt back in with `clipIsolated:true` on the part.
- `noCut:true` still means "never clipped when isolated".
- A part that sits wholly on the kept side of the global plane can carry its own cut: `cutOrigin:[x,y,z]` (world, vertical axis through that point, same angle as the global cut), see the PWR cooling tower.
- `fitPoints:[[x,y,z],...]` on a part adds points to the camera fit (use for things the sampler skips, e.g. a vapour plume).
- Ghosts of big flat parts (footprint > 60 % of the scene radius) fade much further than other ghosts so the isolated part stays the focal point. Ghosts do not cast shadows.
- Everything animated must use the `dt` passed to `update(state, t, dt)`: the shell passes 0 while paused. With `prefers-reduced-motion`, helpers drop decorative drift and pulses (use `reducedMotion()` from util).

## 13. kit/util.js additions
- `createPlume({radius,height,count,color,size,wind}) -> {object, update(dt, intensity01, rise=1)}` water-vapour plume (cooling tower, steam vent). One Points object, soft grey sprites. Place `object.position` at the mouth. Drive `intensity01` from live rejected heat: density and height follow it. Add `fitPoints` to the part so the camera fit includes the plume.
- `reducedMotion()` -> bool.
- Particle streams and pipes: make pipe materials `M.make('steel',{color, transparent:true, opacity:0.55})` so `createFlow` particles are visible inside them in the default cutaway.

## 14. i18n (Vietnamese first, English second)
- `kit/i18n.js`: `t(str)` with the ENGLISH string as the key; missing key falls back to English. The shell passes every machine display string through `t()` at render time (tab/part labels and groups, card title/text/fact labels, control/gauge/chart labels and units, hints, tour `say`, atom title/outcome/stat labels, tripReason, compare strings, sources, spec item labels and units). Machines need NO code change: only a dictionary.
- Dictionary: `src/machines/<id>/vi.js`, `export default { 'English string': 'Chuỗi tiếng Việt', ... }`; build.mjs includes it automatically when the folder has one. The shell dictionary is `src/i18n/vi.js`.
- Keep English (give identity entries or leave them): units, ids, isotope names, status words (RUNNING/TRIPPED/SHUTDOWN), technical codes. Plain Vietnamese, no exclamation marks, no emoji, standard nuclear terms (lò phản ứng, thanh điều khiển, bình sinh hơi, nơtron, phân hạch, ...).
- Strings built at runtime from numbers (`live:` facts) are your responsibility: return numbers and units, or call `t` yourself via `import { t } from '../../kit/i18n.js'`.
- Check your coverage: `node tools/i18n-check.mjs <id>` builds a dev page, opens every part card and both drawers, scans every descriptor/tour/atom string and prints those with no Vietnamese entry (`--json` for a machine-readable list). Exit code 1 when something is missing.
- Language: VI / EN switch in the app bar (default VI, remembered in localStorage, `?lang=en|vi` overrides). `tools/shot.mjs --lang vi` (default `en`, so existing shot commands stay English).

## 15. Look (Strategik)
Parts keep physical material colours; the page ground is white with a 50px tech grid behind a transparent canvas. `COLORS` in kit/materials.js now follow the Strategik data colours (hot = danger red, cold = id-4 blue, plasma = id-1 pink, steam = decor grey, accent = signal orange). The accent is for marks only (selection tint, grid pulses), never a fill on text. Chart series are told apart by dash pattern as well as colour (first series solid). Pale parts need contrast on white: prefer the darker palette entries, or `outline(mesh)`.

## 16. Default fit set and the "Site" preset (additive)
- `build()` may return `defaultFit: ['partId', ...]`. The default camera fit, every re-fit (explode, mode change) and the iso/front/side/top presets then frame only those parts (use it when a huge backdrop such as a cooling tower would otherwise shrink the subject). Omit it to fit every part.
- A preset entry with `fit:'all'` (for example `presets.site = {az, el, fit:'all'}`) fits every part including `fitPoints`; the shell adds a "Site" button (Vietnamese "Toàn cảnh") when `presets.site` exists. Isolating a part always fits that part.
- Place backdrop structures BEHIND the subject as seen from the default camera and make sure the side preset looks from the side where nothing stands in front (the PWR uses side az = -90).
- Optional `tripReasons: ['English string', ...]` on the machine lets `tools/i18n-check.mjs` include trip-reason sentences in its check. Keep numbers inside the key and in the Vietnamese entry.
- `defaultFill` (optional, 0..1) on the build result sets how much of the free area the default fit fills (default 0.66); PWR uses 0.84 because the default fit set is wide.

Example (from `src/machines/pwr/index.js`, the object returned by `build(ctx)`):
```js
return {
  root, parts, update,
  defaultFit: ['containment', 'basemat', 'rpv', 'core', 'turbine', 'grid'],   // section 16: fit the power block only
  defaultFill: 0.84,                                                         // optional, default 0.66
  presets: { iso: {az:-40, el:22}, front: {az:0, el:6}, side: {az:-90, el:8}, top: {az:-40, el:78},
             site: {az:-40, el:24, fit:'all'} },                              // adds the "Site" button / "Toàn cảnh"
};
```
Section 14 also holds: spec values are shown with the precision they were written with (`fmtSpec` in kit/util.js; set `decimals` on a spec item to override). Atom-view texts: one copy of a given text at a time, concurrent events stack one line apart, always inside the canvas.

## 17. Tour button, Time selector and the frozen load state (supersedes any earlier mention of tour auto-start / 25 s hand-back)
- The page loads with the simulation FROZEN at x0 (status chip PAUSED, neutral mark) and the tour not running, drawn in the nominal full-power pose. `update(state, t, dt)` therefore runs with `dt = 0` on the first frames: everything must still be drawn state-true (plume, glow, plasma) from `state` alone and every animation must advance only with `dt`.
- ONE app-bar button, "Tour" / "Pause" (`aria-pressed`): press = sim runs (x1 if it was frozen) AND the tour starts or resumes at the step it was paused on (that step replays from its start); press again = tour pauses in place AND the sim freezes at x0. A visitor's own input on the scene pauses the tour but leaves the sim running. At the end of the script the sim stays at x1 and the button returns to "Tour". Switching machine tab resets the tour. There is no idle hand-back and no auto-start (`?tour=1` starts sim + tour, `?run=1` starts the sim unfrozen).
- Time selector: x0 (frozen), x1, x10, x100, x1000. Space toggles x0 and the previous speed. Operating a control-deck control while at x0 switches to x1 (machine buttons such as START PULSE go through the same control callback, so nothing extra to do). View-only actions never unfreeze.
- Debug/shot API: `__rt.tour('start'|'pause'|'state')`, `__rt.tourOff()`, `__rt.setAccel(0..1000)`. `tools/shot.mjs` runs frames at x1 by default; `fresh=1` in a state reproduces the load state (model reset, x0); `--tourat <ms>` starts sim + tour explicitly.

## 18. More machine-definition fields and shell behaviour (additive)
- `modelNote: 'English sentence'` on the machine definition: what the model actually contains. The About drawer shows it under that machine's reference design (neutral fallback: "Simplified teaching model."). Put the Vietnamese in your `vi.js`.
- `properNames: ['Westinghouse 4-loop PWR', ...]`: strings that stay as written in every language (reference-design names, organisation names). The shell registers them as identity entries so `tools/i18n-check.mjs` does not report them.
- Control deck: sliders sit in a responsive grid (min 150 px, labels may wrap to two lines); buttons and toggles sit in their own wrapping row below, so any contract-legal set (about 6 sliders, 4 buttons, 2 toggles) fits in both languages and the deck grows taller instead of clipping. Hotkey chips sit inside the button and never push it out of the deck, so hotkeys can be used.
- While the sim is frozen (x0) the atom view draws a still of the most probable outcome at a mid-event moment and the legend/stats show nominal values; it needs nothing from the machine.
- Quality tiers: on every tier change the stage changes pixel ratio, shadow-map size and HUD rate for every machine, and calls `inst.setQuality(tier)` if the machine's build result defines it. Geometry is built once from `ctx.quality.detail` at first visit, so triangle counts do not change with the tier unless the machine implements `setQuality` itself (for example by toggling groups).
- Tab switching: the first visit to a tab clears the stage, shows a mono "Loading" label for a frame, then builds; each machine keeps its own model state; the Time selector, language and frozen/running state are global; the tour resets on every tab switch.
