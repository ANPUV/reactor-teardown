# Reactor Teardown — build plan

Target: `https://reactor.ezai.technology` (static site served from fabbox).
Source technique: the "teardown" skill shown in the video (`research/video_meta.md`, `research/transcript.txt`): one offline HTML page per machine, live gauges driven by the same model that moves the parts, a button for every subsystem, cutaway / x-ray / explode, and an auto tour that hands control to the visitor on first input. We apply the technique with our own small kit. We do **not** install the third-party skill (570 MB, two-week-old repo); its rulebook was read as reference only.

## 1. What the visitor gets

One page, four machines, switched by tabs (hash routes `#uranium`, `#plutonium`, `#thorium`, `#fusion`):

| Tab | Machine | Reference design (real numbers come from here) |
|---|---|---|
| Uranium | Pressurised water reactor, thermal neutrons, low-enriched UO₂ | Westinghouse 4-loop PWR |
| Plutonium | Sodium-cooled fast breeder, MOX fuel, U-238 → Pu-239 | BN-800 (Beloyarsk 4) |
| Thorium | Molten-salt breeder, Th-232 → U-233, liquid fuel | ORNL MSBR design (ORNL-4541), MSRE heritage |
| Fusion | Tokamak, D-T plasma | ITER |

For every machine the visitor can:

- **Run it.** Controls move a real model; the 3D parts and every gauge read the same state object.
- **Take it apart.** A button per subsystem. Pressing one isolates it (everything else turns to glass), flies the camera in and opens a card with what it does and its real numbers.
- **Change the view.** Solid / Cutaway (clip plane, draggable angle) / X-ray / Explode (0–1 slider), plus orbit, zoom and camera presets.
- **See the atoms.** A small 2D "atom view" shows the nuclear reaction for that fuel, with event rate and outcome probabilities taken from the live model.
- **Watch the tour.** With no input the page tours itself with a visible cursor. Any click, drag, wheel or key hands control over; 25 s of quiet hands it back.
- **Compare.** A drawer with a table of the four machines (fuel, spectrum, coolant, temperatures, pressure, efficiency, delayed-neutron fraction), built from the same spec objects.

## 2. Rules (adapted from the skill's rulebook — these decide whether it works)

1. **Reference, not imagination.** Each machine is built against its reference design. Dimensions, counts and operating points go in `spec.js` with unit and source. Anything approximate is flagged `approx: true` and shown with "≈".
2. **Real numbers, one source.** Geometry, gauges, cards and the compare table all read `spec.js` and the model state. Nothing on screen is typed twice.
3. **One state drives everything.** `model.step(dt)` is the only thing that advances time. Geometry `update(state)` and HUD `update(state)` are pure readers.
4. **Physics before geometry, tested like code.** Each model ships with `node --test` tests before any mesh exists: steady state reproduces the reference operating point, each control moves the right way, SCRAM/disruption behaves, and a fuzz test sweeps random control inputs for 10⁴ steps asserting no NaN/Infinity and bounded state.
5. **The part doing the work opens up.** Isolate, cut, x-ray. A camera that goes inside beats ten orbits.
6. **Light studio, one accent.** Pale backdrop; the accent marks the selected/working part. Near-white parts get an ink outline or a darker ground (the video's one visible miss was a white part on white in the exploded view — check exploded views specifically).
7. **Fix collisions with a number** in the parameter block, never with the camera.
8. **Look at your own frames.** Nothing is "done" until screenshots of every view mode of every machine have been read against the checklist in §9.

## 3. Stack and layout

- three.js (npm, pinned) + esbuild. `node build.mjs` → `dist/index.html`, one self-contained file (JS, CSS, fonts inlined), zero network calls. Budget ≤ 1.6 MB raw.
- Node 20 (`~/.nvm/versions/node/v20.18.1/bin`). No framework. No post-processing on the low tier.
- Machines are built lazily on first visit to their tab and kept; only the active one renders.
- Quality tiers (`high` / `mid` / `low`): pixel ratio, shadow map size, instance detail, HUD redraw rate. Auto-drop a tier if the frame time stays above 28 ms for 2 s.
- Headless checks use the installed Google Chrome through `playwright-core` (`channel: 'chrome'`) — no browser download. `tools/shot.mjs` writes single shots and contact sheets and prints the GPU string (software renderer = flags did not take).

```
package.json  build.mjs  README.md  CONTRACT.md
src/
  index.html  style.css  main.js        shell: tabs, routing, lifecycle
  kit/stage.js      renderer, studio, lights, tiers, orbit, fly-to, clip, x-ray, isolate, explode
  kit/hud.js        dial, bar, readout, strip chart, part card, control deck widgets
  kit/tour.js       script runner, fake cursor, hand-over / hand-back
  kit/kinetics.js   point kinetics + thermal lumps + decay heat + xenon (pure, no three)
  kit/atomview.js   2D canvas particle engine for reaction cartoons
  kit/materials.js  shared material palette
  machines/<id>/    spec.js  model.js  geometry.js  parts.js  atom.js  tour.js  index.js
test/<id>.test.mjs  test/kinetics.test.mjs
tools/shot.mjs
```

`<id>` ∈ `pwr`, `sfr`, `msr`, `tokamak`.

## 4. Physics models

All four are deliberately small, lumped models: accurate in direction, steady state and order of magnitude, labelled on the page as teaching models.

### 4.1 Fission (shared `kit/kinetics.js`)

State: `n` (power / nominal), six precursor groups `C_i`, fuel temperature `Tf`, coolant mean temperature `Tc`, optional `I`, `Xe`.

- **Point kinetics**, six delayed groups (Keepin U-235 thermal: β_i = 0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273; λ_i = 0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01 s⁻¹). Other fuels scale β_i to their β_eff. Integrate with **backward Euler** (Λ is 4×10⁻⁷ s in the fast reactor — explicit steps blow up):
  `n⁺ = [n + dt Σ λ_i C_i/(1+dt λ_i)] / [1 − dt(ρ−β)/Λ − dt Σ (dt λ_i β_i/Λ)/(1+dt λ_i)]`, then `C_i⁺ = (C_i + dt β_i n⁺/Λ)/(1+dt λ_i)`. Guard the denominator (prompt-critical): sub-step, cap `n`, let feedback and the protection system act.
- **Reactivity** `ρ = W·[S(x) − S(x₀)] + α_f (Tf − Tf₀) + α_c (Tc − Tc₀) + ρ_Xe + ρ_extra`, rod S-curve `S(x) = x − sin(2πx)/(2π)`, `x` = fraction withdrawn.
- **Heat**: `Mf cf dTf/dt = P − UA (Tf − Tc)`; `Mc cc dTc/dt = UA (Tf − Tc) − 2 ṁ cp (Tc − Tin)`; `Tout = 2Tc − Tin`. Constants solved from the reference operating point so nominal controls give nominal temperatures.
- **Heat sink**: `Tin` follows a first-order lag toward the value set by turbine load, so the PWR demonstrates load-following.
- **Decay heat** after shutdown (Way–Wigner): `Pd/P₀ = 0.066 [t^-0.2 − (t + T_op)^-0.2]`.
- **Xenon** (thermal machines only): I-135 / Xe-135 two-ODE model, visible at high time acceleration. The MSR strips most of it via off-gas.
- **Protection**: automatic trip on overpower (> 118 %), short period (< 3 s) or high outlet temperature; the page says which one tripped.
- Time acceleration ×1, ×10, ×100, ×1000 with a fixed max sub-step.

| | PWR | BN-800 | MSBR |
|---|---|---|---|
| Thermal / electric | 3411 MWt / ≈1150 MWe | 2100 MWt / 880 MWe | 2250 MWt / 1000 MWe |
| Coolant in → out | water 292 → 325 °C | sodium 354 → 547 °C | fuel salt 566 → 704 °C |
| Pressure | 15.5 MPa | ≈ atmospheric | ≈ atmospheric |
| β_eff | 0.0065 | ≈ 0.0037 | ≈ 0.0026 (less in-core: precursors leave with the salt) |
| Prompt lifetime Λ | ≈ 2×10⁻⁵ s | ≈ 4.5×10⁻⁷ s | ≈ 3.6×10⁻⁴ s |
| Fuel coeff. | ≈ −2.5 pcm/K (Doppler) | ≈ −0.7 pcm/K | ≈ −3.3 pcm/K (salt expansion + Doppler, prompt) |
| Second coeff. | moderator ≈ −30 pcm/K | expansion ≈ −1 pcm/K | graphite ≈ +2.3 pcm/K (slow) |
| Controls | rods, pump flow, turbine load, SCRAM | rods, pump flow, SCRAM | rods, pump speed, **freeze-plug drain**, SCRAM |
| Special | xenon; load-following | breeding ratio counter (≈ 1.0) | heat made in the fluid itself; Pa-233 → U-233 inventory; drain tank |

### 4.2 Fusion (`machines/tokamak/model.js`)

0-D power balance on plasma thermal energy `W = 3 n T V`:
`dW/dt = P_aux + P_α − W/τ_E − P_brem`

- `P_fus = n_D n_T ⟨σv⟩(T) · 17.59 MeV · V`, `P_α = P_fus/5`. ⟨σv⟩ from the Bosch–Hale D-T fit (check values: ≈ 1.1×10⁻²² m³/s at 10 keV, ≈ 4.3×10⁻²² at 20 keV).
- `τ_E` from IPB98(y,2): `0.0562 H I^0.93 B^0.15 n19^0.41 P^-0.69 R^1.97 ε^0.58 κ^0.78 M^0.19`.
- `P_brem = 5.35×10⁻³⁷ Z_eff n² √T · V`.
- Limits that end the pulse as a disruption: Greenwald density `n_G = I/(π a²)`, Troyon `β_N`, `q95 < 2`.
- Controls: heating power (0–73 MW), fuelling/density, plasma current, toroidal field, D:T mix, **start pulse**, **mitigate** (shattered pellet).
- Pulse phases: breakdown → current ramp → flat-top → burn → ramp-down.
- Readouts: T (keV and million °C), n, τ_E, triple product n·T·τ on a Lawson plot with the live operating point, P_fus, Q = P_fus/P_aux, β_N, q95, Greenwald fraction.
- Reference point must reproduce ITER: 50 MW heating, n ≈ 1×10²⁰ m⁻³, 15 MA, 5.3 T → ≈ 500 MW, Q ≈ 10 (one calibration factor, asserted in tests).

## 5. Teardown parts (a button each)

- **PWR**: containment · reactor pressure vessel · vessel head & rod drives · control rod clusters (53) · core, 193 fuel assemblies (drill-down: assembly 17×17 → fuel rod → pellet) · core barrel & internals · reactor coolant pumps (4) · pressurizer · steam generators (4) · hot/cold legs · turbine-generator · condenser.
- **BN-800**: pool vessel & guard vessel · core (hex assemblies, enrichment zones) · radial breeding blanket · control & safety rods · primary sodium pumps (3) · intermediate heat exchangers · rotating plug & refuelling machine · secondary sodium loop · steam generator · turbine-generator.
- **MSBR**: reactor vessel · graphite moderator core (salt channels) · control rods · fuel-salt pumps (4) · primary heat exchangers (4) · coolant-salt loop · freeze plug · drain tank · off-gas system · chemical processing (Pa-233 decay tank) · steam generator · turbine-generator.
- **ITER**: cryostat · central solenoid (6 modules) · toroidal field coils (18) · poloidal field coils (6) · vacuum vessel (9 sectors) · blanket modules (440) · divertor (54 cassettes) · plasma · heating (neutral beam, ECRH, ICRH) · pellet injector · tritium-breeding blanket & heat extraction (flagged as a power-plant concept: ITER makes no electricity).

What the state drives visually: rod height; Cherenkov glow ∝ power (water only — sodium and salt are opaque, shown through the cutaway instead); coolant particle speed ∝ flow, colour ∝ temperature; steam and turbine speed ∝ electric output; salt level during a drain; plasma brightness/colour ∝ n and T (hot core is nearly invisible, the cool edge glows pink — a real detail); field-line pitch ∝ q; neutron sparks into the blanket ∝ P_fus.

## 6. Atom view

- **Uranium**: slow neutron + U-235 → two fragments + 2–3 fast neutrons (~200 MeV); water slows them; some are lost to rods or U-238. The fraction that goes on to fission follows live k_eff.
- **Plutonium**: fast neutron + Pu-239 → fission (≈ 2.9 n); neutron + U-238 → U-239 → (23.5 min) Np-239 → (2.36 d) Pu-239. Bred-vs-burned counter.
- **Thorium**: neutron + Th-232 → Th-233 → (21.8 min) Pa-233 → (27 d) U-233; neutron + U-233 → fission (≈ 2.5 n).
- **Fusion**: D and T approach; at low temperature the Coulomb barrier turns them back, at high temperature they fuse → He-4 (3.5 MeV) + neutron (14.1 MeV). Success probability follows live ⟨σv⟩(T).

## 7. Look

**Superseded 2026-11-16: the page uses the Strategik design system** (the owner's own system; local copy in `design-system/project/` — `README.md` is the brand book, `tokens.json` the values, `components/*/` the reference components, `fonts/` the font files). Where this section and Strategik disagree, Strategik wins.

- Strategik in one line: a technical instrument panel — black on white, 1px lines instead of shadows, square corners, JetBrains Mono for every label/number/status/button, Space Grotesk for reading text and titles, and one orange (`signal` `#ff4500`) that only ever marks something (a 6–8 px square, a running state, the focus outline). Never an orange fill, never orange text below 24 px (`signal-ink` for an orange word).
- Black app bar (60 px, 56 px on a phone) with the "RT" monogram, the wordmark `REACTOR TEARDOWN`, the four machine tabs as nav items (current one = full-strength with a signal square before it).
- Selected/active states are ink, not colour: ink fill with ground text, or a `well` row with a 2 px ink left rule. State (RUNNING / TRIPPED / SHUTDOWN) is an 8 px square plus its word in a chip.
- 3D viewport: `ground` white with the 50 px tech grid behind the machine; parts keep physical colours; pale parts carry an ink outline; the selected part is marked with `signal`.
- Data colours come from the system: hot = `mark-danger`, cold = `id-4`, plasma = `id-1`, steam = `decor`; chart series are `ink` first then `id-n`, told apart by dash as well as colour. Cherenkov blue stays as a physical glow only.
- Language: Vietnamese first, English second, through an i18n layer with a VI / EN switch. Technical labels, ids and status words stay English in mono.
- Light theme only (this is product UI). No emoji, no exclamation marks.
- Desktop: canvas fills the window; left rail = parts and view modes, right rail = instruments and atom view, bottom deck = controls. Phone (≤ 760 px): canvas on top, tabbed sheet below (Parts · Controls · Gauges · Atoms); nothing scrolls sideways.
- Keyboard: 1–4 tabs, arrows for the focused slider, Space pause, Esc clear isolate. Visible focus rings. `prefers-reduced-motion` stops the tour's auto-start and camera fly-ins.
- Frame 0 already shows the machine running (share thumbnail).

## 8. Who builds what

| Step | Model | Work |
|---|---|---|
| 1 | Haiku | Video metadata, description, links, transcript → `research/` (done) |
| 2 | Fable | This plan |
| 3 | Sonnet ×1 | Kit, shell, build, `kinetics.js` + tests, `tools/shot.mjs`, `CONTRACT.md`, and the PWR as the first complete machine proving the contract |
| 4 | Sonnet ×3 in parallel | `sfr`, `msr`, `tokamak`, each inside its own `src/machines/<id>/` + `test/<id>.test.mjs`, against `CONTRACT.md` |
| 5 | Fable | Integration build, browser check of every machine and view mode, fix list back to Sonnet |
| 6 | Fable | Deploy to fabbox, DNS `reactor.ezai.technology`, verify over HTTPS |

Parallel builders use `node build.mjs --only <id> --out dist/dev-<id>.html` and `shots/<id>/` so they never write the same file.

## 9. Done means

- `npm test` green: steady states within 2 % of the reference points, control directions, SCRAM/decay heat, disruption limits, fuzz with no NaN.
- `dist/index.html` works from `file://` with the network off; no console errors; ≤ 1.6 MB.
- For each machine, screenshots read and passing: solid, cutaway, x-ray, exploded, three isolated parts, the phone layout.
  - Mechanism: parts that should touch do, nothing pokes through, gauges agree with the pose.
  - Composition: one focal point, labels never cover their part, nothing clipped.
  - Contrast: no pale part lost against the backdrop in any mode, including exploded.
- 50+ fps on the M1 at `high`; `low` tier verified to engage.
- Tour runs end to end on each machine and hands over on first input.
- Live at `https://reactor.ezai.technology`, checked from outside the LAN path (through Cloudflare).

## 10. Deploy (fabbox)

fabbox = Tailscale `100.78.73.44`, Caddy on 80/443, several cloudflared tunnels already serve `*.ezai.technology` from it. Steps once SSH works: copy `dist/` to a site directory, add a static-file site (Caddy or a tunnel ingress rule following the pattern the existing sites use), route DNS `reactor.ezai.technology` to the tunnel, verify `200` and the page's SHA-256 over HTTPS.

**Open item:** this Mac's only SSH key is rejected by fabbox, so step 6 needs the key added there first.
