import type { Game, UpdateApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import { debug, menuItemRect, menus } from "./debug";
import { BACKGROUND, render } from "./render";
import { tick } from "./simulation";
import type {
  Direction,
  FathomDebugApi,
  FathomState,
  ReadState,
} from "./types";
import { copy, initial, newDive, reconcile, screen } from "./world";
export type * from "./types";
export { BACKGROUND };
function controls(
  s: FathomState,
  api: UpdateApi,
): { state: FathomState; held: boolean; desired: Direction } {
  const input = api.input;
  if (input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
  s.muted = api.audio.muted();
  let desired = s.desired;
  if (s.screen === "playing") {
    const directions = (["up", "down", "left", "right"] as const).filter(
      (d) => input.value(d) > 0,
    );
    // A newly held direction replaces the buffer even while the previous
    // direction is still held. Releasing every key stops, not erases, it.
    const fresh = directions.filter((d) => !s.heldDirections.includes(d));
    desired = fresh[fresh.length - 1] ?? desired;
    s.heldDirections = directions;
    const held = directions.length > 0;
    if (input.pressed("pause")) {
      screen(s, "paused");
      return { state: s, held: false, desired };
    }
    s.pendingSonar ||= input.pressed("a");
    s.pendingInk ||= input.pressed("b");
    return { state: s, held, desired };
  }
  if (
    s.screen === "paused" &&
    (input.pressed("pause") || input.pressed("back"))
  ) {
    screen(s, "playing");
    return { state: s, held: false, desired };
  }
  let confirm = input.pressed("confirm");
  const back = input.pressed("back");
  const items = menus(s);
  if (items.length) {
    if (input.pressed("up"))
      s.menuIndex = (s.menuIndex! + items.length - 1) % items.length;
    if (input.pressed("down")) s.menuIndex = (s.menuIndex! + 1) % items.length;
  }
  for (const p of input.pointerSamples().filter((p) => p.primary)) {
    const index = items.findIndex((_, i) => {
      const r = menuItemRect(s, i)!;
      return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    });
    if (index >= 0) s.menuIndex = index;
    if (p.type === "down")
      s.pointerDown = { id: p.id, index: s.screen === "howto" ? -2 : index };
    if (p.type === "up") {
      if (
        s.pointerDown?.id === p.id &&
        s.pointerDown.index === (s.screen === "howto" ? -2 : index) &&
        (index >= 0 || s.screen === "howto")
      )
        confirm = true;
      s.pointerDown = null;
    }
  }
  if (s.screen === "howto" && (confirm || back)) s = newDive(s, "title");
  else if (s.screen === "gameover" && back) s = newDive(s, "title");
  else if (confirm && s.menuIndex !== null) {
    const index = s.menuIndex;
    if (s.screen === "title") {
      s.titleIndex = index;
      if (index === 0) s = newDive(s);
      else screen(s, "howto");
    } else if (s.screen === "paused") {
      if (index === 0) screen(s, "playing");
      else s = newDive(s, index === 1 ? "countdown" : "title");
    } else if (s.screen === "gameover")
      s = newDive(s, index === 0 ? "countdown" : "title");
  }
  return { state: s, held: false, desired };
}
export const game: Game<FathomState, FathomDebugApi> = {
  async initialize(api) {
    for (const action of C.ACTIONS)
      api.input.register(action, { keys: [...C.BINDINGS[action]] });
    const tones = [
      [760, 1080, 55],
      [340, 95, 240],
      [120, 45, 180],
      [230, 510, 220],
      [150, 1500, 300],
      [180, 35, 450],
      [450, 1250, 500],
    ];
    Object.values(C.CUES).forEach((cue, i) => {
      const [freq, freqTo, durationMs] = tones[i]!;
      api.audio.define(cue, {
        freq: freq!,
        freqTo: freqTo!,
        durationMs: durationMs!,
        gain: 0.13,
        wave: i === 2 ? "triangle" : "sine",
      });
    });
    const art: Record<string, ImageBitmap[]> = {};
    await Promise.all(
      Object.entries({
        glimmerfin: 8,
        lanternjaw: 16,
        gloamfin: 8,
        flarefish: 8,
        drifter: 8,
        "flare-bloom": 8,
        "trench-walls": 19,
      }).map(async ([sheet, count]) => {
        art[sheet] = await Promise.all(
          Array.from({ length: count }, (_, i) =>
            api.assets.loadImage(`${sheet}/${i}.png`),
          ),
        );
      }),
    );
    for (const name of [
      "screen",
      "depth",
      "score",
      "lives",
      "brightness",
      "visionRadius",
      "windowRadius",
      "planktonRemaining",
    ] as const)
      api.diagnostics.register(name, (s) => s[name]);
    api.diagnostics.register("sonar", (s) => s.sonar.cooldown);
    api.diagnostics.register("ink", (s) => s.ink.cooldown);
    api.diagnostics.register(
      "forager",
      (s) => `${s.forager.tx},${s.forager.ty} ${s.forager.dir}`,
    );
    for (let i = 0; i < C.ROSTER_CAP * C.DEN_ORDER.length; i++)
      api.diagnostics.register(`hunter ${i + 1}`, (s) => {
        const p = s.predators[i];
        return p
          ? `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed.toFixed(1)} alert:${p.alert}`
          : "none";
      });
    return [initial(art), debug];
  },
  update(state: ReadState, api, dt) {
    const controlled = controls(copy(state), api);
    const { held, desired } = controlled;
    let s = controlled.state;
    s.accumulator += dt;
    while (s.accumulator + 1e-10 >= C.TICK_DT) {
      s.accumulator = Math.max(0, s.accumulator - C.TICK_DT);
      const cues = new Set<C.CueName>();
      s = tick(s, { held, desired }, cues);
      for (const cue of cues) api.audio.play(cue);
    }
    s.muted = api.audio.muted();
    return reconcile(s);
  },
  render,
};
