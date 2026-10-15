import * as C from "./constants";
import type {
  Body,
  Direction,
  FathomState,
  Predator,
  PredatorKind,
  ReadState,
  Screen,
} from "./types";
export const DIRECTIONS: Direction[] = ["up", "right", "down", "left"];
export const DELTA: Record<Direction, [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};
export const opposite = (d: Direction): Direction =>
  DIRECTIONS[(DIRECTIONS.indexOf(d) + 2) % 4]!;
export const center = (tx: number, ty: number) => ({
  x: C.GRID_ORIGIN_X + (tx + 0.5) * C.TILE,
  y: C.GRID_ORIGIN_Y + (ty + 0.5) * C.TILE,
  tx,
  ty,
});
export function tileOf(b: { x: number; y: number }) {
  return {
    tx: Math.floor((b.x - C.GRID_ORIGIN_X) / C.TILE),
    ty: Math.floor((b.y - C.GRID_ORIGIN_Y) / C.TILE),
  };
}
export const layer = (ch: string) =>
  Array<string>(C.GRID_ROWS).fill(ch.repeat(C.GRID_COLS));
export function put(rows: string[], tx: number, ty: number, ch: string) {
  rows[ty] = rows[ty]!.slice(0, tx) + ch + rows[ty]!.slice(tx + 1);
}
export function maze(): string[] {
  const rows = layer("#");
  for (let y = 1; y < C.GRID_ROWS - 1; y++)
    for (let x = 1; x < C.GRID_COLS - 1; x++) {
      if (
        [1, 5, 11, 16].includes(y) ||
        [1, 5, 9, 14, 21, 26, 30, 34].includes(x)
      )
        put(rows, x, y, ".");
    }
  for (let y = 7; y <= 9; y++)
    for (let x = 16; x <= 19; x++) put(rows, x, y, "d");
  put(rows, 17, 6, "g");
  put(rows, 0, 11, ".");
  put(rows, C.GRID_COLS - 1, 11, ".");
  return rows;
}
export function neighbor(
  s: ReadState,
  tx: number,
  ty: number,
  dir: Direction,
): { tx: number; ty: number } | null {
  const [dx, dy] = DELTA[dir];
  let x = tx + dx;
  const y = ty + dy;
  if (y < 0 || y >= C.GRID_ROWS) return null;
  if (x < 0 || x >= C.GRID_COLS) {
    const wrap = s.tiles.findIndex(
      (r) => r[0] === "." && r[C.GRID_COLS - 1] === ".",
    );
    if (y !== wrap) return null;
    x = (x + C.GRID_COLS) % C.GRID_COLS;
  }
  return { tx: x, ty: y };
}
export function open(s: ReadState, tx: number, ty: number, den = false) {
  const ch = s.tiles[ty]?.[tx];
  return ch === "." || (den && (ch === "g" || ch === "d"));
}
export function choices(
  s: ReadState,
  b: Pick<Body, "tx" | "ty">,
  den = false,
): Direction[] {
  return DIRECTIONS.filter((d) => {
    const n = neighbor(s, b.tx, b.ty, d);
    return n !== null && open(s, n.tx, n.ty, den);
  });
}
export function distances(
  s: ReadState,
  tx: number,
  ty: number,
  den = false,
): number[] {
  const dist = Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(Infinity);
  const queue = [{ tx, ty }];
  if (!open(s, tx, ty, den)) return dist;
  dist[ty * C.GRID_COLS + tx] = 0;
  for (let i = 0; i < queue.length; i++) {
    const b = queue[i]!;
    for (const d of choices(s, b, den)) {
      const n = neighbor(s, b.tx, b.ty, d)!;
      const k = n.ty * C.GRID_COLS + n.tx;
      if (dist[k] === Infinity) {
        dist[k] = dist[b.ty * C.GRID_COLS + b.tx]! + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}
export function path(
  s: ReadState,
  b: Body,
  target: { tx: number; ty: number },
  den = false,
): Direction | null {
  const dist = distances(s, target.tx, target.ty, den);
  let best: Direction | null = null;
  let value = dist[b.ty * C.GRID_COLS + b.tx] ?? Infinity;
  for (const d of choices(s, b, den)) {
    const n = neighbor(s, b.tx, b.ty, d)!;
    const v = dist[n.ty * C.GRID_COLS + n.tx]!;
    if (v < value) {
      value = v;
      best = d;
    }
  }
  return best;
}
export function random(s: FathomState) {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
export function wander(s: FathomState, b: Body, den = false) {
  let dirs = choices(s, b, den).filter((d) => d !== opposite(b.dir));
  if (!dirs.length) dirs = choices(s, b, den);
  return dirs[Math.floor(random(s) * dirs.length)] ?? null;
}
/** Integrates to each intervening center, never overshooting a turn or wall. */
export function move(
  s: FathomState,
  b: Body,
  speed: number,
  choose: (at: Body) => Direction | null,
  den = false,
): boolean {
  Object.assign(b, tileOf(b));
  if (!open(s, b.tx, b.ty, den)) return false;
  let left = speed * C.TICK_DT;
  let moved = false;
  while (left > 1e-8) {
    const c = center(b.tx, b.ty);
    const at = Math.abs(b.x - c.x) < 1e-7 && Math.abs(b.y - c.y) < 1e-7;
    if (at) {
      const d = choose(b);
      if (d === null) break;
      const n = neighbor(s, b.tx, b.ty, d);
      if (!n || !open(s, n.tx, n.ty, den)) break;
      b.dir = d;
    }
    const [dx, dy] = DELTA[b.dir];
    // The next center ahead can lie in the current tile or its neighbor.
    const along = dx !== 0 ? (b.x - c.x) * dx : (b.y - c.y) * dy;
    let distance = along < -1e-7 ? -along : C.TILE - along;
    if (at) distance = C.TILE;
    if (along >= -1e-7) {
      const n = neighbor(s, b.tx, b.ty, b.dir);
      if (!n || !open(s, n.tx, n.ty, den)) break;
    }
    const step = Math.min(left, distance);
    b.x += dx * step;
    b.y += dy * step;
    left -= step;
    moved = true;
    const width = C.GRID_COLS * C.TILE;
    if (b.x < C.GRID_ORIGIN_X) b.x += width;
    if (b.x >= C.GRID_ORIGIN_X + width) b.x -= width;
    Object.assign(b, tileOf(b));
  }
  return moved;
}
export function makePredator(
  kind: PredatorKind,
  tx: number,
  ty: number,
  slot: number | null = null,
): Predator {
  return {
    ...center(tx, ty),
    dir: "up",
    kind,
    state: slot === null ? "wander" : "den",
    released: slot === null,
    mind: true,
    travel: true,
    lit: false,
    speed: C.PREDATOR_SPEED,
    alert: false,
    detectRange: null,
    hearingRange: null,
    hearingLock: kind === "gloamfin" ? false : null,
    flareCharging: kind === "flarefish" ? false : null,
    flaring: kind === "flarefish" ? false : null,
    flareRadius: kind === "flarefish" ? 0 : null,
    slot,
    fix: null,
    linger: 0,
    alertLeft: 0,
    mark: 0,
    pingIn: C.GLOAMFIN_PING_INTERVAL,
    pingGap: C.GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPing: false,
    chaseSpeed: C.GLOAMFIN_CHASE_SPEED,
    flareIn: C.FLARE_INTERVAL,
    flarePhase: "idle",
    flareTime: 0,
  };
}
export function roster(depth: number): Predator[] {
  const kinds = [
    ...C.DEN_ORDER,
    ...C.ROSTER_ADD_ORDER.slice(0, Math.min(depth, C.ROSTER_CAP_DEPTH) - 1),
  ];
  return kinds.map((k, i) =>
    makePredator(k, 16 + (i % 4), 8 + Math.floor(i / 4), i),
  );
}
export function reconcile(s: FathomState): FathomState {
  Object.assign(s.forager, tileOf(s.forager));
  for (const b of [...s.predators, ...s.drifters]) Object.assign(b, tileOf(b));
  s.visionRadius = C.VISION_MIN + C.VISION_GAIN * s.brightness;
  s.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * s.brightness;
  s.sonar.range = Math.max(
    C.SONAR_RANGE_MIN,
    C.SONAR_RANGE_BASE - (s.depth - 1),
  );
  s.sonar.ready = s.sonar.cooldown === 0;
  s.ink.ready = s.ink.cooldown === 0;
  s.planktonRemaining = s.plankton.reduce(
    (n, r) => n + [...r].filter((c) => c === "*").length,
    0,
  );
  for (const p of s.predators) {
    p.detectRange =
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness;
    p.hearingRange = p.kind === "gloamfin" ? C.GLOAMFIN_HEAR : null;
    p.speed =
      p.kind === "lanternjaw" && p.state === "wander"
        ? C.DRIFTER_SPEED
        : p.kind === "gloamfin" && p.state === "chase"
          ? p.chaseSpeed
          : C.PREDATOR_SPEED;
  }
  return s;
}
/** Copy mutable simulation data; decoded assets are immutable handles. */
export function copy(s: ReadState): FathomState {
  return {
    ...s,
    grid: { ...s.grid },
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    forager: { ...s.forager },
    drifters: s.drifters.map((b) => ({ ...b })),
    predators: s.predators.map((p) => ({
      ...p,
      fix: p.fix ? { ...p.fix } : null,
    })),
    pulses: s.pulses.map((p) => ({ ...p })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    art: s.art as Record<string, ImageBitmap[]>,
    tileMarks: [...s.tileMarks],
    pointerDown: s.pointerDown ? { ...s.pointerDown } : null,
    heldDirections: [...s.heldDirections],
  };
}
export function initial(
  art: Record<string, ImageBitmap[]> = {},
  muted = false,
): FathomState {
  const tiles = maze();
  return reconcile({
    version: C.FATHOM_DEBUG_VERSION,
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: C.START_LIVES,
    muted,
    planktonRemaining: 0,
    drifterIn: C.DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: 0,
    windowRadius: 0,
    sonar: { ready: true, cooldown: 0, range: C.SONAR_RANGE_BASE },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: C.GRID_COLS,
      rows: C.GRID_ROWS,
      tile: C.TILE,
      originX: C.GRID_ORIGIN_X,
      originY: C.GRID_ORIGIN_Y,
    },
    tiles,
    plankton: tiles.map((r) => r.replace(/[^.]/g, "-").replace(/\./g, "*")),
    visibility: layer("u"),
    forager: { ...center(17, 16), dir: "left", moving: false },
    drifters: [],
    predators: roster(1),
    pulses: [],
    inkClouds: [],
    simTime: 0,
    accumulator: 0,
    screenTime: 0,
    playTime: 0,
    rng: 7029,
    desired: "left",
    heldDirections: [],
    pendingSonar: false,
    pendingInk: false,
    pointerDown: null,
    art,
    tileMarks: Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(0),
  });
}
export function screen(s: FathomState, value: Screen) {
  s.screen = value;
  s.menuIndex =
    value === "title"
      ? s.titleIndex
      : value === "paused" || value === "gameover"
        ? 0
        : null;
  s.screenTime = 0;
}
export function newDive(s: FathomState, to: Screen = "countdown") {
  const n = initial(s.art, s.muted);
  n.titleIndex = s.titleIndex;
  n.simTime = s.simTime;
  n.accumulator = s.accumulator;
  screen(n, to);
  return n;
}
export function retry(s: FathomState) {
  s.forager = { ...center(17, 16), dir: "left", moving: false };
  s.brightness = 0;
  s.brightHold = 0;
  s.predators = roster(s.depth);
  s.drifters = [];
  s.drifterIn = C.DRIFTER_INTERVAL;
  s.pulses = [];
  s.inkClouds = [];
  s.sonar.cooldown = 0;
  s.ink.cooldown = 0;
  s.playTime = 0;
  s.desired = "left";
  s.heldDirections = [];
  s.tileMarks.fill(0);
  screen(s, "countdown");
}
export const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
) => Math.hypot(a.x - b.x, a.y - b.y);
export const sameTile = (
  a: { tx: number; ty: number },
  b: { tx: number; ty: number },
) => a.tx === b.tx && a.ty === b.ty;
/** Exact grid traversal: light stops at the first rock cell it crosses. */
export function sight(
  s: ReadState,
  a: { x: number; y: number },
  b: { x: number; y: number },
  endRock = false,
) {
  const target = tileOf(b);
  const p = tileOf(a);
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const sx = Math.sign(dx),
    sy = Math.sign(dy);
  const stepX = dx === 0 ? Infinity : C.TILE / Math.abs(dx);
  const stepY = dy === 0 ? Infinity : C.TILE / Math.abs(dy);
  let nextX =
    dx === 0
      ? Infinity
      : (C.GRID_ORIGIN_X + (p.tx + (sx > 0 ? 1 : 0)) * C.TILE - a.x) / dx;
  let nextY =
    dy === 0
      ? Infinity
      : (C.GRID_ORIGIN_Y + (p.ty + (sy > 0 ? 1 : 0)) * C.TILE - a.y) / dy;
  for (;;) {
    if (s.tiles[p.ty]?.[p.tx] === "#" && !(endRock && sameTile(p, target)))
      return false;
    if (sameTile(p, target)) return true;
    if (p.tx === target.tx) nextX = Infinity;
    if (p.ty === target.ty) nextY = Infinity;
    const crossing = Math.min(nextX, nextY);
    if (nextX <= crossing + 1e-12) {
      p.tx += sx;
      nextX += stepX;
    }
    if (nextY <= crossing + 1e-12) {
      p.ty += sy;
      nextY += stepY;
    }
  }
}
export function segmentDistance(
  c: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(c.x - a.x - t * dx, c.y - a.y - t * dy);
}
