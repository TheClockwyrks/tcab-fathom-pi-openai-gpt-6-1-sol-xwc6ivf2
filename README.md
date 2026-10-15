# Fathom

**Hunt in the dark.** A browser-only bioluminescent maze chase, set below the reach of sunlight.

Graze every plankton mote to descend. Eating makes your light grow, revealing more of the trench—and attracting hunters. The Lanternjaw follows light under a harmless-looking amber disguise. The eyeless Gloamfin follows sound, including your own sonar. The Flarefish lights the abyss to find you.

This is the **Kindle** dive: terrain is remembered, but even explored passages disappear beyond your circular window. Sonar maps corridors around corners; ink breaks a light hunter’s fix. Three lives are held in reserve, in addition to your current attempt.

## Run

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. No backend, credentials, downloaded fonts, or external services are used.

## Build and deploy

```sh
npm run build
npm run preview
```

The complete static site is in `dist/`, with `index.html` at its root. Serve that directory unchanged, either at a server root or beneath a sub-path. All art is included and loaded relative to the page.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Swim while held; choose a buffered turn |
| Space | Sonar pulse—reveals paths, but can alert the Gloamfin |
| Shift | Ink cloud—blinds the light-seeking hunters |
| P / Escape | Pause / resume |
| M | Toggle sound |
| Up / Down | Select a menu item |
| Enter / Space | Confirm |
| Escape | Back |

Menus also support mouse, pen, and touch. On a touchscreen the engine supplies a direction pad, sonar and ink buttons, and menu controls. Sound unlocks with the first gesture; the full game is playable muted.

## Checks

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

The tests run the real Simple 2D engine over an in-process canvas and scripted clocks. They cover maze topology, fixed-step movement, menus and pointer edges, fog and sensing, predators, lives and descent, and the immutable debug poses.

## Source map

- `src/game.ts` — engine registrations, frame input, fixed-step accumulator.
- `src/types.ts` — state, snapshot, and debug contracts (re-exported by `game.ts`).
- `src/world.ts` — maze, grid travel, pathfinding, and state construction.
- `src/simulation.ts` — render-free 120 Hz simulation and sensing.
- `src/debug.ts` — validated, immutable scenario poses and pure readings.
- `src/render.ts` — pixel-art maze, fog masking, effects, menus, and HUD.
- `showcase/` — player-facing description, screenshots, and a recorded live dive.

The engine owns the canvas fit, input, audio, asset loading, frame loop, and backtick debug overlay. Its `engine.debug` surface can pose scenarios through `engine.apply`; no debugging globals are installed on the page. The full state stays in the engine, and rendering never advances it. See `specs/` for the game contract and `engine/` for runtime documentation.
