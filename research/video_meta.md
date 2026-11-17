# Video metadata: cqdASxFADaE

- **Title:** teardown: One Claude Skill Built Me a Jet Engine You Can Take Apart
- **Channel:** Heroic steps 
- **Channel URL:** https://www.youtube.com/channel/UCuDKwlnr1qHhQFP_UY_i3ew
- **Upload date:** 2026-11-01
- **Duration:** 4:56 (296 s)
- **View count:** 923
- **Like count:** 4
- **Categories:** Science & Technology
- **Language:** en-US
- **URL:** https://www.youtube.com/watch?v=cqdASxFADaE

## Tags

teardown skill, Claude Code skill, Claude skills, 3D simulator, interactive 3D explainer, three.js machine, AI 3D model, jet engine simulator, GE90 turbofan, V8 engine simulator, AI agent coding, machine teardown, exploded view, claude-motion

## Chapters

- [00:00] A page that drives itself
- [00:30] Install it
- [01:09] The shipped V8
- [01:45] Build me a jet engine
- [03:37] The catch
- [04:24] Verdict

## Full description (verbatim)

```text
teardown is a free, MIT-licensed Claude Code skill that builds an interactive 3D simulator of any machine as a single offline HTML page: live gauges driven by the same math that moves the parts, a button for every subsystem, cutaway and x-ray views, and an auto tour that hands you control the moment you click. I installed it, timed every step, and then asked it to build a machine it has no example for.

My test (1 Nov 2026, M4 Mac, Claude Code as the agent):
- Install: one command, 9.7 s — the installer even runs three security scans (Gen / Socket / Snyk) on the skill before it lands
- One-time setup: 93 s, ~570 MB (npm deps plus its own Chromium, used only so the agent can look at its own frames)
- Shipped V8 example: builds in 0.107 s to one 806 KB HTML file; I grepped it — zero network calls, fully offline
- The real test: "build me a high-bypass turbofan I can take apart." 30 min 37 s later: a GE90-class engine, 785 KB, offline
- It wrote the physics first and tested it like code — its own log mid-run: "The working line goes NaN past λ=1." It found and fixed its own bug
- It read contact sheets of its own frames, caught a missing spinner texture, and worked around headless Chromium silently falling back to a software GPU
- The page: 22-blade 3.25 m fan, 9-stage HP compressor, 24 fuel nozzles, N1/N2/EPR/EGT/fuel-flow dials, a draggable thrust lever with a FADEC chasing it (512 kN, EPR 1.45, OPR 42, idle-to-95%-thrust in 6.6 s), stage isolation, cutaway, x-ray, explode, and the self-running tour
- Cost of the build: $7.29 in model usage, 55 tool calls
- What it missed: in the exploded view the nacelle lip goes white-on-white — breaking the skill's own rule #5. A human eye catches it in two seconds

The catch:
- Real-time 3D: the skill's own rulebook warns a 60 fps desktop page can drop to ~15 fps on an integrated GPU (it ships quality tiers for that)
- Setup is ~570 MB and wants Node 20+, ffmpeg and Python 3 for the full kit
- The repo is young: created 30 Oct 2026, 343 stars, 64 forks when I tested; built on the older claude-motion kit (MIT, 752 stars)
- The 3.79M views number for a V8 like this is the builder's own claim from his X post — the one number here I didn't verify

Footage: everything on screen is the skill's own output or my screen recordings of it. No AI-generated imagery.

Chapters
0:00 A page that drives itself
0:30 Install it
1:09 The shipped V8
1:45 Build me a jet engine
3:37 The catch
4:24 Verdict

Sources (checked 1 Nov 2026)
- https://github.com/elvarofficial/teardown (MIT; commit a91262a) and its SKILL.md
- https://github.com/whaleyxbt/claude-motion (the kit it credits)
- The builder's X launch post (view-count claims are his)
- My own run logs; costs and timings as reported by Claude Code

#ClaudeCode #AISkills #3DSimulation #threejs #AITools #Turbofan #DevTools
```

## URLs in description (deduplicated)

- https://github.com/elvarofficial/teardown
- https://github.com/whaleyxbt/claude-motion
