import * as C from "./constants";
import type {
  Direction,
  FathomDebugApi,
  FathomState,
  Predator,
  ReadState,
  Screen,
  Snapshot,
} from "./types";
import {
  center,
  copy,
  initial,
  layer,
  makePredator,
  open,
  put,
  reconcile,
  roster,
  screen,
} from "./world";
export const menus = (s: ReadState): readonly string[] =>
  s.screen === "title"
    ? C.TITLE_ITEMS
    : s.screen === "paused"
      ? C.PAUSE_ITEMS
      : s.screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
export function menuItemRect(s: ReadState, index: number) {
  return Number.isInteger(index) && index >= 0 && index < menus(s).length
    ? {
        x: 475,
        y: (s.screen === "title" ? 420 : 360) + index * 62,
        w: 330,
        h: 48,
      }
    : null;
}
function requireValue(ok: boolean) {
  if (!ok) throw new RangeError("Invalid Fathom pose");
}
function range(n: number, min = 0, max = Infinity, whole = false) {
  requireValue(
    Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!whole || Number.isInteger(n)),
  );
}
function tile(s: ReadState, tx: number, ty: number, den = false) {
  range(tx, 0, C.GRID_COLS - 1, true);
  range(ty, 0, C.GRID_ROWS - 1, true);
  requireValue(open(s, tx, ty, den));
}
function dir(d: Direction) {
  requireValue(["up", "down", "left", "right"].includes(d));
}
function change(s: ReadState, fn: (n: FathomState) => void) {
  const n = copy(s);
  fn(n);
  return reconcile(n);
}
function predator(
  s: ReadState,
  index: number,
  fn: (p: Predator, n: FathomState) => void,
) {
  range(index, 0, s.predators.length - 1, true);
  return change(s, (n) => fn(n.predators[index]!, n));
}
function drifter(
  s: ReadState,
  index: number,
  key: "mind" | "travel",
  value: boolean,
) {
  range(index, 0, s.drifters.length - 1, true);
  requireValue(typeof value === "boolean");
  return change(s, (n) => {
    n.drifters[index]![key] = value;
  });
}
export function snapshot(s: ReadState): Snapshot {
  return {
    version: s.version,
    screen: s.screen,
    menuIndex: s.menuIndex,
    titleIndex: s.titleIndex,
    depth: s.depth,
    score: s.score,
    lives: s.lives,
    muted: s.muted,
    planktonRemaining: s.planktonRemaining,
    drifterIn: s.drifterIn,
    brightness: s.brightness,
    brightHold: s.brightHold,
    visionRadius: s.visionRadius,
    windowRadius: s.windowRadius,
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    grid: { ...s.grid },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    forager: { ...s.forager },
    drifters: s.drifters.map(({ x, y, tx, ty, lit, mind, travel }) => ({
      x,
      y,
      tx,
      ty,
      lit,
      mind,
      travel,
    })),
    predators: s.predators.map(
      ({
        kind,
        x,
        y,
        tx,
        ty,
        dir,
        state,
        released,
        mind,
        travel,
        speed,
        alert,
        lit,
        detectRange,
        hearingRange,
        hearingLock,
        flareCharging,
        flaring,
        flareRadius,
      }) => ({
        kind,
        x,
        y,
        tx,
        ty,
        dir,
        state,
        released,
        mind,
        travel,
        speed,
        alert,
        lit,
        detectRange,
        hearingRange,
        hearingLock,
        flareCharging,
        flaring,
        flareRadius,
      }),
    ),
    pulses: s.pulses.map(({ source, tint, ox, oy, front, range }) => ({
      source,
      tint,
      ox,
      oy,
      front,
      range,
    })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    simTime: s.simTime,
  };
}
export const debug: FathomDebugApi = {
  version: C.FATHOM_DEBUG_VERSION,
  reset: (s) => initial(s.art as Record<string, ImageBitmap[]>, s.muted),
  snapshot,
  reconcile: (s) => reconcile(copy(s)),
  menuItemRect,
  setScreen: (s, v) => {
    requireValue(
      (
        [
          "title",
          "howto",
          "countdown",
          "playing",
          "paused",
          "cleared",
          "gameover",
        ] satisfies Screen[]
      ).includes(v),
    );
    return change(s, (n) => {
      if (v === "playing" && n.screen !== "paused") n.playTime = 0;
      screen(n, v);
    });
  },
  setMenuIndex: (s, i) => {
    range(i, 0, menus(s).length - 1, true);
    return change(s, (n) => {
      n.menuIndex = i;
    });
  },
  setTitleIndex: (s, i) => {
    range(i, 0, C.TITLE_ITEMS.length - 1, true);
    return change(s, (n) => {
      n.titleIndex = i;
    });
  },
  setScore: (s, v) => {
    range(v, 0, Infinity, true);
    return change(s, (n) => {
      n.score = v;
    });
  },
  setLives: (s, v) => {
    range(v, 0, Infinity, true);
    return change(s, (n) => {
      n.lives = v;
    });
  },
  setDepth: (s, v) => {
    range(v, 1, Infinity, true);
    return change(s, (n) => {
      n.depth = v;
      n.predators = roster(v);
      for (const pulse of n.pulses) pulse.owner = null;
    });
  },
  setMaze: (s, rows) => {
    requireValue(
      rows.length === C.GRID_ROWS &&
        rows.every((r) => r.length === C.GRID_COLS && /^[#.dg]+$/.test(r)),
    );
    const text = rows.join("");
    requireValue(
      !/[dg]/.test(text) || [...text].filter((c) => c === "g").length === 1,
    );
    return change(s, (n) => {
      n.tiles = [...rows];
    });
  },
  setPlankton: (s, x, y, present) => {
    tile(s, x, y);
    requireValue(typeof present === "boolean");
    return change(s, (n) => put(n.plankton, x, y, present ? "*" : "-"));
  },
  clearPlankton: (s) =>
    change(s, (n) => {
      n.plankton = layer("-");
    }),
  clearFog: (s) =>
    change(s, (n) => {
      n.visibility = layer("u");
      n.tileMarks.fill(0);
    }),
  setForagerTile: (s, x, y) => {
    tile(s, x, y);
    return change(s, (n) => {
      Object.assign(n.forager, center(x, y), { moving: false });
      n.desired = n.forager.dir;
    });
  },
  setForagerDir: (s, d) => {
    dir(d);
    return change(s, (n) => {
      n.forager.dir = d;
      n.desired = d;
      n.forager.moving = false;
    });
  },
  setBrightness: (s, v) => {
    range(v, 0, 1);
    return change(s, (n) => {
      n.brightness = v;
    });
  },
  setBrightHold: (s, v) => {
    range(v, 0, C.BRIGHT_HOLD);
    return change(s, (n) => {
      n.brightHold = v;
    });
  },
  clearPredators: (s) =>
    change(s, (n) => {
      n.predators = [];
      for (const pulse of n.pulses) pulse.owner = null;
    }),
  addPredator: (s, k, x, y) => {
    requireValue(C.DEN_ORDER.includes(k));
    tile(s, x, y);
    return change(s, (n) => {
      n.predators.push(makePredator(k, x, y));
    });
  },
  setPredatorTile: (s, i, x, y) => {
    tile(s, x, y, true);
    return predator(s, i, (p) => Object.assign(p, center(x, y)));
  },
  setPredatorDir: (s, i, d) => {
    dir(d);
    return predator(s, i, (p) => {
      p.dir = d;
    });
  },
  setPredatorState: (s, i, v) => {
    requireValue(["den", "wander", "chase"].includes(v));
    return predator(s, i, (p, n) => {
      requireValue(
        v === "den"
          ? ["g", "d"].includes(n.tiles[p.ty]![p.tx]!)
          : open(n, p.tx, p.ty),
      );
      p.state = v;
      p.fix = v === "chase" ? { tx: n.forager.tx, ty: n.forager.ty } : null;
      p.linger = C.LINGER_TIME;
      p.alertLeft = 0;
      p.alert = false;
      p.mark = 0;
      p.flarePhase = "idle";
      p.flareIn = C.FLARE_INTERVAL;
      p.flareCharging = p.kind === "flarefish" ? false : null;
      p.flaring = p.kind === "flarefish" ? false : null;
      p.flareRadius = p.kind === "flarefish" ? 0 : null;
      p.hearingLock = p.kind === "gloamfin" ? false : null;
    });
  },
  setPredatorReleased: (s, i, v) => {
    requireValue(typeof v === "boolean");
    return predator(s, i, (p) => {
      p.released = v;
    });
  },
  setPredatorMind: (s, i, v) => {
    requireValue(typeof v === "boolean");
    return predator(s, i, (p) => {
      p.mind = v;
    });
  },
  setPredatorTravel: (s, i, v) => {
    requireValue(typeof v === "boolean");
    return predator(s, i, (p) => {
      p.travel = v;
    });
  },
  spawnDrifter: (s, x, y) => {
    tile(s, x, y);
    return change(s, (n) => {
      n.drifters.push({
        ...center(x, y),
        dir: "up",
        lit: false,
        mind: true,
        travel: true,
      });
    });
  },
  clearDrifters: (s) =>
    change(s, (n) => {
      n.drifters = [];
    }),
  setDrifterMind: (s, i, v) => drifter(s, i, "mind", v),
  setDrifterTravel: (s, i, v) => drifter(s, i, "travel", v),
  setDrifterIn: (s, v) => {
    range(v, 0, C.DRIFTER_INTERVAL);
    return change(s, (n) => {
      n.drifterIn = v;
    });
  },
  setSonarCooldown: (s, v) => {
    range(v);
    return change(s, (n) => {
      n.sonar.cooldown = v;
    });
  },
  setInkCooldown: (s, v) => {
    range(v);
    return change(s, (n) => {
      n.ink.cooldown = v;
    });
  },
};
