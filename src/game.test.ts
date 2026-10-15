/// <reference types="node" />
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import {
  ConstantClock,
  createEngine,
  SequenceClock,
} from "@clockwyrks/simple-2d";
import { game, BACKGROUND } from "./game";
import * as C from "./constants";
import { center, choices, distances, initial, maze, sameTile } from "./world";
import type { Direction, FathomState } from "./types";
import { debug } from "./debug";
import { lighting } from "./simulation";
beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    async (path: string) => new Response(await readFile(String(path))),
  );
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(Buffer.from(await blob.arrayBuffer())),
  );
});
const engines: ReturnType<typeof createEngine<FathomState, typeof debug>>[] =
  [];
afterEach(() => {
  for (const e of engines) e.destroy();
  engines.length = 0;
});
async function setup(dt = 1000 / 120) {
  const events = new EventTarget();
  const canvas = createCanvas(1280, 720);
  const engine = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: 1280,
    height: 720,
    game,
    background: BACKGROUND,
    layout: C.LAYOUT,
    clock: new ConstantClock(dt),
    surface: {
      cssWidth: () => 1280,
      cssHeight: () => 720,
      dpr: () => 1,
      events: () => events,
    },
  });
  engines.push(engine);
  await engine.initialize();
  const key = (code: string, down = true) =>
    events.dispatchEvent(
      Object.assign(new Event(down ? "keydown" : "keyup"), {
        code,
        repeat: false,
      }),
    );
  const press = async (code: string) => {
    key(code);
    await engine.advance(1);
    key(code, false);
  };
  const pose = (f: (s: Parameters<typeof debug.reset>[0]) => FathomState) =>
    engine.apply(f);
  const play = () => {
    pose((s) => debug.setScreen(s, "playing"));
    pose((s) => debug.clearPredators(s));
  };
  const fixture = (
    rows: string[] = Array.from({ length: C.GRID_ROWS }, () =>
      ".".repeat(C.GRID_COLS),
    ),
  ) => pose((s) => debug.setMaze(s, rows));
  return { engine, canvas, events, key, press, pose, play, fixture };
}
describe("laid-out maze", () => {
  it("meets topology, symmetry, den, tunnel and proportion contracts", () => {
    const s = initial(),
      rows = maze();
    let count = 0,
      total = 0;
    const runs: number[] = [];
    const visited = new Set<string>();
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const c = rows[y]![x]!;
        if (!["d", "g"].includes(c) && !["d", "g"].includes(rows[y]![35 - x]!))
          expect(c).toBe(rows[y]![35 - x]);
        if (c !== ".") continue;
        count++;
        const ns = choices(s, { tx: x, ty: y });
        expect(ns.length).toBeGreaterThanOrEqual(2);
        total += ns.length;
        expect(
          rows[y]?.slice(x, x + 2) === ".." &&
            rows[y + 1]?.slice(x, x + 2) === "..",
        ).toBe(false);
        const key = `${x},${y}`;
        if (ns.length === 2 && !visited.has(key)) {
          const q = [{ tx: x, ty: y }];
          visited.add(key);
          for (let i = 0; i < q.length; i++) {
            const b = q[i]!;
            for (const d of choices(s, b)) {
              const [dx, dy] =
                d === "up"
                  ? [0, -1]
                  : d === "down"
                    ? [0, 1]
                    : d === "left"
                      ? [-1, 0]
                      : [1, 0];
              const n = { tx: (b.tx + dx! + 36) % 36, ty: b.ty + dy! };
              const k = `${n.tx},${n.ty}`;
              if (choices(s, n).length === 2 && !visited.has(k)) {
                visited.add(k);
                q.push(n);
              }
            }
          }
          runs.push(q.length);
        }
      }
    expect(count / 544).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    expect(total / count).toBeGreaterThanOrEqual(C.MAZE_OPENNESS_MIN);
    expect(total / count).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(mean).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(mean).toBeLessThanOrEqual(C.MAZE_MAZING_MAX);
    expect(distances(s, 17, 16).filter(Number.isFinite)).toHaveLength(count);
    expect(rows.filter((r) => r[0] === "." && r[35] === ".")).toHaveLength(1);
    expect(rows.join("").match(/d/g)).toHaveLength(12);
    expect(rows.join("").match(/g/g)).toHaveLength(1);
  });
});
describe("engine integration and menus", () => {
  it("initializes assets, diagnostics and a complete serializable snapshot", async () => {
    const { engine } = await setup();
    expect(Object.values(engine.state.art).flat()).toHaveLength(75);
    expect(engine.debug).toBe(debug);
    expect(debug.snapshot(engine.state).screen).toBe("title");
    expect(engine.diagnostics().every((r) => !r.error)).toBe(true);
    expect(
      JSON.parse(JSON.stringify(debug.snapshot(engine.state))).version,
    ).toBe(1);
  });
  it("records drawing with the engine", async () => {
    const { engine } = await setup();
    engine.startRecording();
    await engine.advance(2);
    const r = engine.stopRecording();
    expect(r.frames).toHaveLength(2);
    expect(r.ops.length).toBeGreaterThan(50);
  });
  it("remembers the title selection on returning from instructions", async () => {
    const { engine, press } = await setup();
    await press("ArrowUp");
    expect(engine.state.menuIndex).toBe(1);
    await press("Enter");
    expect(engine.state.screen).toBe("howto");
    await press("Escape");
    expect(engine.state.screen).toBe("title");
    expect(engine.state.menuIndex).toBe(1);
  });
  it("runs countdown, freezes pause and resumes only once per Escape", async () => {
    const { engine, canvas, press, pose } = await setup();
    await press("Enter");
    expect(engine.state.screen).toBe("countdown");
    await engine.advance(220);
    expect(engine.state.screen).toBe("playing");
    pose((s) => debug.spawnDrifter(s, 14, 16));
    await press("Escape");
    expect(engine.state.screen).toBe("paused");
    const before = debug.snapshot(engine.state);
    const frozenPixels = canvas.toBuffer("image/png");
    await engine.advance(12);
    expect(engine.state.forager).toEqual(before.forager);
    expect(canvas.toBuffer("image/png")).toEqual(frozenPixels);
    await press("Escape");
    expect(engine.state.screen).toBe("playing");
  });
  it("toggles mute on every screen", async () => {
    const { engine, press, pose } = await setup();
    for (const screen of [
      "title",
      "howto",
      "countdown",
      "playing",
      "paused",
      "cleared",
      "gameover",
    ] as const) {
      pose((s) => debug.setScreen(s, screen));
      const muted = engine.state.muted;
      await press("KeyM");
      expect(engine.state.muted).toBe(!muted);
    }
  });
  it("confirms pointer items only when both edges land on the same item", async () => {
    const { engine, events } = await setup();
    const send = (type: string, x: number, y: number) =>
      events.dispatchEvent(
        Object.assign(new Event(type), {
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    send("pointerdown", 640, 435);
    send("pointerup", 640, 500);
    await engine.advance(1);
    expect(engine.state.screen).toBe("title");
    send("pointerdown", 640, 500);
    send("pointerup", 640, 500);
    await engine.advance(1);
    expect(engine.state.screen).toBe("howto");
    send("pointerdown", 100, 100);
    send("pointerup", 100, 100);
    await engine.advance(1);
    expect(engine.state.screen).toBe("title");
  });
  it("restarts and quits via pause menu", async () => {
    const { engine, pose, press } = await setup();
    pose((s) => debug.setScore(s, 800));
    pose((s) => debug.setScreen(s, "paused"));
    pose((s) => debug.setMenuIndex(s, 1));
    await press("Enter");
    expect(engine.state.score).toBe(0);
    expect(engine.state.screen).toBe("countdown");
    pose((s) => debug.setScreen(s, "paused"));
    pose((s) => debug.setMenuIndex(s, 2));
    await press("Enter");
    expect(engine.state.screen).toBe("title");
  });
});
describe("fixed steps, movement and food", () => {
  it("is identical across differently partitioned deltas", async () => {
    const a = await setup(1000 / 60),
      b = await setup(1000 / 120);
    a.play();
    b.play();
    a.key("ArrowLeft");
    b.key("ArrowLeft");
    await a.engine.advance(30);
    await b.engine.advance(60);
    expect(debug.snapshot(a.engine.state)).toEqual(
      debug.snapshot(b.engine.state),
    );
  });
  it("carries fractional ticks and accumulates simulation time while frozen", async () => {
    const { engine } = await setup(2);
    await engine.advance(4);
    expect(engine.state.simTime).toBe(0);
    await engine.advance(1);
    expect(engine.state.simTime).toBeCloseTo(C.TICK_DT);
    engine.setClock(new SequenceClock([2, 3, 5]));
    await engine.advance(3);
    expect(engine.state.simTime).toBeCloseTo(2 * C.TICK_DT);
  });
  it("swims at 128/s, eats on tile entry and stops on release", async () => {
    const { engine, play, key, pose } = await setup();
    play();
    const x = engine.state.forager.x;
    key("ArrowLeft");
    await engine.advance(30);
    expect(engine.state.forager.x).toBeCloseTo(x - 32);
    expect(engine.state.score).toBe(20);
    key("ArrowLeft", false);
    await engine.advance(10);
    expect(engine.state.forager.x).toBeCloseTo(x - 32);
    pose((s) => debug.setBrightHold(s, 0));
    pose((s) => debug.setBrightness(s, 1));
    await engine.advance(108);
    expect(engine.state.brightness).toBeCloseTo(0.5);
  });
  it("buffers perpendicular turns to centers and reverses immediately", async () => {
    const { engine, play, fixture, pose, key } = await setup();
    play();
    fixture();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 5, 5));
    key("ArrowRight");
    await engine.advance(10);
    key("ArrowRight", false);
    key("ArrowUp");
    await engine.advance(20);
    expect(engine.state.forager.tx).toBe(6);
    expect(engine.state.forager.dir).toBe("right");
    await engine.advance(1);
    expect(engine.state.forager.dir).toBe("up");
    const y = engine.state.forager.y;
    key("ArrowUp", false);
    key("ArrowDown");
    await engine.advance(1);
    expect(engine.state.forager.y).toBeGreaterThan(y);
  });
  it("wraps continuously through the tunnel", async () => {
    const { engine, play, pose, key } = await setup();
    play();
    pose((s) => debug.setForagerTile(s, 0, 11));
    key("ArrowLeft");
    await engine.advance(30);
    expect(engine.state.forager.x).toBeCloseTo(center(35, 11).x);
  });
  it("does not traverse rock or enter the den", async () => {
    const { engine, play, pose, key } = await setup();
    play();
    pose((s) => debug.setForagerTile(s, 17, 5));
    key("ArrowDown");
    await engine.advance(60);
    expect(engine.state.forager.y).toBe(center(17, 5).y);
  });
  it("empty posed boards do not clear until the last actual meal", async () => {
    const { engine, play, pose } = await setup();
    play();
    pose((s) => debug.clearPlankton(s));
    await engine.advance(2);
    expect(engine.state.screen).toBe("playing");
    pose((s) => debug.setPlankton(s, 17, 16, true));
    await engine.advance(1);
    expect(engine.state.screen).toBe("cleared");
    expect(engine.state.score).toBe(C.SCORE_CLEAR + C.SCORE_PLANKTON);
    await engine.advance(241);
    expect(engine.state.depth).toBe(2);
    expect(engine.state.screen).toBe("countdown");
  });
  it("eats bonus drifters for 200 and admits them only while food remains", async () => {
    const { engine, play, pose } = await setup();
    play();
    pose((s) => debug.spawnDrifter(s, 17, 16));
    pose((s) => debug.setDrifterMind(s, 0, false));
    await engine.advance(1);
    expect(engine.state.score).toBe(210);
    expect(engine.state.drifters).toHaveLength(0);
    pose((s) => debug.setDrifterIn(s, 0));
    await engine.advance(1);
    expect(engine.state.drifters).toHaveLength(1);
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setDrifterIn(s, 0));
    await engine.advance(1);
    expect(engine.state.drifters).toHaveLength(1);
  });
});
describe("sensing and hunters", () => {
  it("has occluded light, persistent fog and brightness-driven radii", async () => {
    const { engine, play, pose } = await setup();
    play();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 9, 11));
    pose((s) => debug.setBrightness(s, 1));
    pose((s) => debug.setBrightHold(s, 1));
    await engine.advance(1);
    expect(engine.state.visionRadius).toBe(160);
    expect(engine.state.windowRadius).toBe(320);
    expect(engine.state.visibility[11]![9]).toBe("l");
    pose((s) => debug.setForagerTile(s, 30, 16));
    await engine.advance(1);
    expect(engine.state.visibility[11]![9]).toBe("r");
  });
  it("sonar bends through paths, marks hunters but not amber entities", async () => {
    const { engine, play, pose, press } = await setup();
    play();
    pose((s) => debug.setForagerTile(s, 9, 11));
    pose((s) => debug.addPredator(s, "gloamfin", 14, 11));
    pose((s) => debug.setPredatorMind(s, 0, false));
    pose((s) => debug.addPredator(s, "lanternjaw", 14, 11));
    pose((s) => debug.setPredatorMind(s, 1, false));
    await press("Space");
    await engine.advance(50);
    expect(engine.state.predators[0]!.lit).toBe(true);
    expect(engine.state.predators[1]!.lit).toBe(false);
    expect(engine.state.visibility[11]![14]).toBe("l");
    expect(engine.state.sonar.cooldown).toBeGreaterThan(0);
  });
  it("lanternjaw follows light, lingers, and is immediately blinded by ink", async () => {
    const { engine, play, fixture, pose, press } = await setup();
    play();
    fixture();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 5, 5));
    pose((s) => debug.addPredator(s, "lanternjaw", 8, 5));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await engine.advance(1);
    expect(engine.state.predators[0]!.state).toBe("chase");
    expect(engine.state.predators[0]!.speed).toBe(C.PREDATOR_SPEED);
    expect(engine.state.predators[0]!.alert).toBe(false);
    await press("ShiftLeft");
    expect(engine.state.predators[0]!.state).toBe("wander");
    expect(engine.state.inkClouds).toHaveLength(1);
  });
  it("mind off holds a hunter still; travel off still senses", async () => {
    const { engine, play, fixture, pose } = await setup();
    play();
    fixture();
    pose((s) => debug.addPredator(s, "flarefish", 18, 16));
    pose((s) => debug.setPredatorMind(s, 0, false));
    await engine.advance(30);
    expect(engine.state.predators[0]!.state).toBe("wander");
    expect(engine.state.predators[0]!.x).toBe(center(18, 16).x);
    pose((s) => debug.setPredatorTravel(s, 0, false));
    pose((s) => debug.setPredatorMind(s, 0, true));
    await engine.advance(1);
    expect(engine.state.predators[0]!.state).toBe("chase");
    expect(engine.state.predators[0]!.alert).toBe(true);
  });
  it("gloamfin hears through rock and ignores ink", async () => {
    const { engine, play, pose, press } = await setup();
    play();
    pose((s) => debug.setForagerTile(s, 14, 11));
    pose((s) => debug.addPredator(s, "gloamfin", 14, 12));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await press("ShiftLeft");
    expect(engine.state.predators[0]!.hearingLock).toBe(true);
    expect(engine.state.predators[0]!.state).toBe("chase");
    expect(engine.state.predators[0]!.speed).toBe(C.GLOAMFIN_CHASE_SPEED);
  });
  it("gloamfin searches a stale fix and casts an orange ping", async () => {
    const { engine, play, fixture, pose } = await setup();
    play();
    fixture();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 6, 6));
    pose((s) => debug.addPredator(s, "gloamfin", 6, 6));
    pose((s) => debug.setPredatorState(s, 0, "chase"));
    pose((s) => debug.setForagerTile(s, 30, 15));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await engine.advance(155);
    expect(engine.state.predators[0]!.state).toBe("search");
    expect(engine.state.pulses.some((p) => p.tint === "orange")).toBe(true);
    await engine.advance(500);
    expect(engine.state.predators[0]!.state).toBe("wander");
  });
  it("flare charge, bloom and fade are timed independently of the renderer", async () => {
    const { engine, play, fixture, pose } = await setup();
    play();
    fixture();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 1, 1));
    pose((s) => debug.addPredator(s, "flarefish", 28, 12));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await engine.advance(841);
    expect(engine.state.predators[0]!.flareCharging).toBe(true);
    await engine.advance(60);
    expect(engine.state.predators[0]!.flaring).toBe(true);
    expect(engine.state.visibility[12]![28]).toBe("l");
    await engine.advance(120);
    expect(engine.state.predators[0]!.flaring).toBe(false);
    expect(engine.state.predators[0]!.flarePhase).toBe("fade");
  });
  it("den release uses absolute staggered slots and continuous travel", async () => {
    const { engine, pose } = await setup();
    pose((s) => debug.setScreen(s, "playing"));
    await engine.advance(1);
    expect(engine.state.predators[0]!.released).toBe(true);
    expect(engine.state.predators[0]!.state).toBe("den");
    expect(engine.state.predators[1]!.released).toBe(false);
    await engine.advance(610);
    expect(engine.state.predators[1]!.released).toBe(true);
    expect(engine.state.predators[2]!.released).toBe(false);
  });
  it("contact resets attempts but preserves food, fog, score and depth", async () => {
    const { engine, play, pose } = await setup();
    play();
    await engine.advance(1);
    const food = engine.state.planktonRemaining;
    pose((s) => debug.addPredator(s, "lanternjaw", 17, 16));
    pose((s) => debug.setPredatorMind(s, 0, false));
    await engine.advance(1);
    expect(engine.state.lives).toBe(2);
    expect(engine.state.screen).toBe("countdown");
    expect(engine.state.score).toBe(10);
    expect(engine.state.planktonRemaining).toBe(food);
    expect(engine.state.predators.every((p) => !p.released)).toBe(true);
    expect(engine.state.visibility.join("")).toContain("l");
  });
  it("no reserve life ends the run and play again starts fresh", async () => {
    const { engine, play, pose, press } = await setup();
    play();
    pose((s) => debug.setLives(s, 0));
    pose((s) => debug.addPredator(s, "lanternjaw", 17, 16));
    pose((s) => debug.setPredatorMind(s, 0, false));
    await engine.advance(1);
    expect(engine.state.screen).toBe("gameover");
    await press("Enter");
    expect(engine.state.screen).toBe("countdown");
    expect(engine.state.lives).toBe(C.START_LIVES);
    expect(engine.state.score).toBe(0);
  });
});
describe("edge cases and presentation", () => {
  it("lights only remembered terrain inside the window and leaves distant amber lights black", async () => {
    const { engine, canvas, play, fixture, pose } = await setup();
    play();
    fixture();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 5, 5));
    pose((s) => debug.spawnDrifter(s, 9, 5));
    pose((s) => debug.spawnDrifter(s, 12, 5));
    pose((s) => debug.setDrifterMind(s, 0, false));
    pose((s) => debug.setDrifterMind(s, 1, false));
    await engine.advance(1);
    const pixel = (tx: number, ty: number) => {
      const c = center(tx, ty);
      return [...canvas.getContext("2d").getImageData(c.x, c.y, 1, 1).data];
    };
    expect(engine.state.drifters[0]!.lit).toBe(false);
    expect(pixel(9, 5)[0]).toBeGreaterThan(80);
    expect(pixel(12, 5)).toEqual([3, 6, 12, 255]);
    pose((s) => debug.clearDrifters(s));
    pose((s) => debug.setBrightness(s, 1));
    pose((s) => debug.setBrightHold(s, 1));
    await engine.advance(1);
    pose((s) => debug.setForagerTile(s, 3, 5));
    await engine.advance(1);
    expect(engine.state.visibility[5]![10]).toBe("r");
    expect(pixel(10, 5)).not.toEqual([3, 6, 12, 255]);
    pose((s) => debug.setForagerTile(s, 30, 5));
    await engine.advance(1);
    expect(engine.state.visibility[5]![10]).toBe("r");
    expect(pixel(10, 5)).toEqual([3, 6, 12, 255]);
  });
  it("a newly held turn overrides a still-held heading", async () => {
    const { engine, play, fixture, pose, key } = await setup();
    play();
    fixture();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 5, 5));
    key("ArrowRight");
    await engine.advance(12);
    key("ArrowUp");
    await engine.advance(30);
    expect(engine.state.forager.dir).toBe("up");
    expect(engine.state.forager.x).toBeCloseTo(center(6, 5).x);
  });
  it("a pulse arriving at a stationary Gloamfin takes a fix at arrival, not emission", async () => {
    const { engine, play, pose, press } = await setup();
    play();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 9, 11));
    pose((s) => debug.addPredator(s, "gloamfin", 14, 11));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await press("Space");
    expect(engine.state.predators[0]!.state).toBe("wander");
    pose((s) => debug.setForagerTile(s, 9, 12));
    await engine.advance(45);
    expect(engine.state.predators[0]!.state).toBe("chase");
    expect(engine.state.predators[0]!.fix).toEqual({ tx: 9, ty: 12 });
    expect(engine.state.predators[0]!.alert).toBe(true);
  });
  it("pursuit paths around a blocking rock instead of swimming toward it", async () => {
    const { engine, play, fixture, pose } = await setup();
    play();
    const rows = Array.from({ length: 18 }, () => ".".repeat(36));
    for (let y = 3; y <= 7; y++)
      rows[y] = rows[y]!.slice(0, 6) + "#" + rows[y]!.slice(7);
    fixture(rows);
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 8, 5));
    pose((s) => debug.addPredator(s, "gloamfin", 5, 5));
    pose((s) => debug.setPredatorState(s, 0, "chase"));
    await engine.advance(30);
    const p = engine.state.predators[0]!;
    expect(p.x).toBeCloseTo(center(5, 5).x);
    expect(p.y).toBeLessThan(center(5, 5).y);
    expect(engine.state.tiles[p.ty]![p.tx]).toBe(".");
  });
  it("a lingering light fix expires, while an isolated body never travels", async () => {
    const { engine, play, pose, fixture } = await setup();
    play();
    fixture();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 5, 5));
    pose((s) => debug.addPredator(s, "lanternjaw", 8, 5));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await engine.advance(1);
    pose((s) => debug.setForagerTile(s, 30, 15));
    await engine.advance(239);
    expect(engine.state.predators[0]!.state).toBe("chase");
    await engine.advance(1);
    expect(engine.state.predators[0]!.state).toBe("wander");
    const rows = Array<string>(18).fill("#".repeat(36));
    rows[5] = "#".repeat(8) + "." + "#".repeat(27);
    fixture(rows);
    pose((s) => debug.setPredatorTile(s, 0, 8, 5));
    pose((s) => debug.setPredatorTravel(s, 0, true));
    await engine.advance(120);
    expect(engine.state.predators[0]!.x).toBe(center(8, 5).x);
  });
  it("a flare sees through rock and ends its bloom the moment it acquires", async () => {
    const { engine, play, pose, fixture } = await setup();
    play();
    const rows = Array.from({ length: 18 }, () => ".".repeat(36));
    for (let y = 0; y < 18; y++)
      rows[y] = rows[y]!.slice(0, 7) + "#" + rows[y]!.slice(8);
    fixture(rows);
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 5, 5));
    pose((s) => debug.addPredator(s, "flarefish", 10, 5));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await engine.advance(900);
    expect(engine.state.predators[0]!.state).toBe("chase");
    expect(engine.state.predators[0]!.alert).toBe(true);
    expect(engine.state.predators[0]!.flaring).toBe(false);
  });
  it("cooldowns and wavefronts freeze during countdown and pause", async () => {
    const { engine, play, pose, press } = await setup();
    play();
    await press("Space");
    await press("ShiftLeft");
    pose((s) => debug.setScreen(s, "paused"));
    const sonar = engine.state.sonar.cooldown,
      front = engine.state.pulses[0]!.front;
    await engine.advance(40);
    expect(engine.state.sonar.cooldown).toBe(sonar);
    expect(engine.state.pulses[0]!.front).toBe(front);
    pose((s) => debug.setScreen(s, "countdown"));
    await engine.advance(40);
    expect(engine.state.sonar.cooldown).toBe(sonar);
  });
  it("fractional brightness holds decay only over the unheld part of a tick", async () => {
    const { engine, play, pose } = await setup();
    play();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setBrightness(s, 1));
    pose((s) => debug.setBrightHold(s, C.TICK_DT / 2));
    await engine.advance(1);
    expect(engine.state.brightness).toBeCloseTo(
      0.5 ** (C.TICK_DT / 2 / C.BRIGHT_HALFLIFE),
      12,
    );
  });
});

describe("debug poses", () => {
  it("never mutates its read-only input; reconcile is pure and idempotent", () => {
    const a = initial();
    const original = debug.snapshot(a);
    const b = debug.setBrightness(a, 1);
    expect(debug.snapshot(a)).toEqual(original);
    expect(b.windowRadius).toBe(320);
    expect(debug.reconcile(debug.reconcile(b))).toEqual(debug.reconcile(b));
    const c = debug.clearFog(b);
    expect(debug.reconcile(c).visibility.join("")).toBe("u".repeat(648));
  });
  it.each([1, 2, 3, 4, 8])(
    "builds the depth %i roster and sonar range",
    (d) => {
      const s = debug.setDepth(initial(), d);
      expect(s.predators.length).toBe(3 + Math.min(3, d - 1));
      expect(s.sonar.range).toBe(Math.max(5, 10 - d));
    },
  );
  it("permits disconnected fixtures without den or tunnel and bodies on closed tiles", async () => {
    const { engine, play, pose, key } = await setup();
    play();
    pose((s) => debug.setMaze(s, Array<string>(18).fill("#".repeat(36))));
    key("ArrowLeft");
    const b = engine.state.forager;
    await engine.advance(60);
    expect(engine.state.forager.x).toBe(b.x);
    expect(sameTile(b, engine.state.forager)).toBe(true);
  });
  it("poses every creature switch and scalar without advancing or sensing", () => {
    let s = initial();
    s = debug.setForagerTile(s, 1, 1);
    s = debug.setForagerDir(s, "down");
    s = debug.setBrightHold(s, 1);
    s = debug.setScore(s, 999);
    s = debug.setLives(s, 8);
    s = debug.setTitleIndex(s, 1);
    s = debug.setSonarCooldown(s, 20);
    s = debug.setInkCooldown(s, 13);
    s = debug.clearPredators(s);
    s = debug.addPredator(s, "lanternjaw", 1, 5);
    s = debug.setPredatorTile(s, 0, 5, 5);
    s = debug.setPredatorDir(s, 0, "left");
    s = debug.setPredatorState(s, 0, "chase");
    s = debug.setPredatorReleased(s, 0, false);
    s = debug.setPredatorMind(s, 0, false);
    s = debug.setPredatorTravel(s, 0, false);
    s = debug.spawnDrifter(s, 9, 5);
    s = debug.setDrifterMind(s, 0, false);
    s = debug.setDrifterTravel(s, 0, false);
    s = debug.setDrifterIn(s, 2);
    expect(s.simTime).toBe(0);
    expect(s.predators[0]!.speed).toBe(116);
    expect(s.predators[0]!.alert).toBe(false);
    expect(s.sonar.ready).toBe(false);
    s = debug.clearDrifters(s);
    expect(s.drifters).toHaveLength(0);
    expect(debug.reset(s)).toEqual(initial());
  });
  it("fails loudly for invalid domains and subjects", () => {
    const s = initial();
    const bad = [
      () => debug.setBrightness(s, 1.1),
      () => debug.setScore(s, -1),
      () => debug.setLives(s, 0.5),
      () => debug.setForagerTile(s, 0, 0),
      () => debug.setMenuIndex(s, 2),
      () => debug.setPredatorMind(s, 9, false),
      () => debug.setMaze(s, ["#"]),
      () => debug.setBrightHold(s, 2),
      () => debug.setDrifterIn(s, 26),
      () => debug.setForagerDir(s, "diagonal" as Direction),
    ];
    for (const call of bad) expect(call).toThrow(RangeError);
  });
  it("lighting reveals nothing through a solid wall", () => {
    let s = initial();
    const rows = Array.from({ length: 18 }, () => ".".repeat(36));
    rows[6] = "#".repeat(36);
    s = debug.setMaze(s, rows);
    s = debug.setForagerTile(s, 5, 5);
    lighting(s);
    expect(s.visibility[6]![5]).toBe("l");
    expect(s.visibility[7]![5]).toBe("u");
  });
});
