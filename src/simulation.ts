import * as C from "./constants";
import type { CueName } from "./constants";
import type { Direction, FathomState, Predator } from "./types";
import {
  center,
  choices,
  distance,
  distances,
  move,
  neighbor,
  newDive,
  open,
  opposite,
  path,
  put,
  reconcile,
  retry,
  roster,
  sameTile,
  screen,
  segmentDistance,
  sight,
  wander,
} from "./world";
export const COUNTDOWN_TIME = 1.8;
export const CLEAR_TIME = 2;
const down = (v: number) => (v - C.TICK_DT < 1e-10 ? 0 : v - C.TICK_DT);
function acquire(s: FathomState, p: Predator) {
  if (p.state !== "chase") {
    p.alertLeft = p.kind === "lanternjaw" ? 0 : C.ALERT_TIME;
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
  }
  p.state = "chase";
  p.fix = { tx: s.forager.tx, ty: s.forager.ty };
  p.linger = C.LINGER_TIME;
  if (
    p.kind === "flarefish" &&
    (p.flarePhase === "charge" || p.flarePhase === "bloom")
  ) {
    p.flarePhase = "fade";
    p.flareTime = 0;
  }
}
function lose(p: Predator) {
  p.state = "wander";
  p.fix = null;
  if (p.kind === "flarefish") {
    p.flareIn = C.FLARE_INTERVAL;
    if (p.flarePhase === "bloom" || p.flarePhase === "charge") {
      p.flarePhase = "fade";
      p.flareTime = 0;
    }
  }
}
function ping(
  s: FathomState,
  p: Predator,
  index: number,
  orange: boolean,
  cues: Set<CueName>,
) {
  s.pulses.push({
    source: "gloamfin",
    tint: orange ? "orange" : "violet",
    ox: p.tx,
    oy: p.ty,
    front: 0,
    range: C.GLOAMFIN_PING_RANGE,
    owner: index,
    caught: false,
  });
  p.pingIn = C.GLOAMFIN_PING_INTERVAL;
  p.pingGap = 0;
  cues.add(C.CUES.predatorPing);
}
function hunters(s: FathomState, cues: Set<CueName>) {
  const f = s.forager;
  s.predators.forEach((p, index) => {
    p.mark = down(p.mark);
    p.alertLeft = down(p.alertLeft);
    if (p.slot !== null && s.playTime + 1e-8 >= p.slot * C.DEN_RELEASE_GAP)
      p.released = true;
    if (!p.mind) return;
    if (p.state === "den") {
      const chamber = s.tiles.some((r) => r.includes("d"));
      if (!chamber || !p.released) return;
      const gy = s.tiles.findIndex((r) => r.includes("g"));
      if (gy < 0) return;
      const gx = s.tiles[gy]!.indexOf("g");
      const gate = { tx: gx, ty: gy };
      const exit = choices(s, gate)
        .map((d) => neighbor(s, gx, gy, d)!)
        .find((n) => open(s, n.tx, n.ty));
      if (exit && p.travel)
        move(s, p, C.PREDATOR_SPEED, (b) => path(s, b, exit, true), true);
      if (open(s, p.tx, p.ty)) {
        p.state = "wander";
        p.flareIn = C.FLARE_INTERVAL;
      }
      return;
    }
    if (p.kind === "gloamfin") {
      const was = p.hearingLock;
      p.hearingLock = distance(p, f) <= C.GLOAMFIN_HEAR;
      p.pingIn = down(p.pingIn);
      p.pingGap += C.TICK_DT;
      if (p.hearingLock) {
        acquire(s, p);
        p.pingIn = 0;
      }
      const guaranteed =
        p.state === "search" &&
        p.searchTime >= C.GLOAMFIN_SEARCH_DELAY &&
        !p.searchPing;
      if (
        !p.hearingLock &&
        p.pingGap + 1e-8 >= C.GLOAMFIN_PING_MIN_GAP &&
        (p.pingIn === 0 || guaranteed || was)
      ) {
        ping(s, p, index, guaranteed, cues);
        if (guaranteed) p.searchPing = true;
      }
      if (
        p.state === "chase" &&
        p.fix &&
        sameTile(p, p.fix) &&
        !sameTile(p, f)
      ) {
        p.state = "search";
        p.searchTime = 0;
        p.searchPing = false;
      }
      if (p.state === "search") {
        p.searchTime += C.TICK_DT;
        if (p.searchTime >= C.GLOAMFIN_GIVEUP) lose(p);
      }
      if (p.state === "chase")
        p.chaseSpeed = Math.min(
          C.GLOAMFIN_CHASE_SPEED,
          p.chaseSpeed +
            ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * C.TICK_DT) /
              C.GLOAMFIN_RAMP_TIME,
        );
    } else {
      const blind = s.inkClouds.some(
        (c) => segmentDistance(c, p, f) <= c.radius,
      );
      const sees =
        !blind &&
        ((distance(p, f) <= p.detectRange! && sight(s, p, f)) ||
          (p.kind === "flarefish" &&
            p.flarePhase === "bloom" &&
            distance(p, f) <= C.FLARE_RADIUS));
      if (blind) {
        if (p.state === "chase") lose(p);
      } else if (sees) acquire(s, p);
      else if (p.state === "chase") {
        p.linger = down(p.linger);
        if (p.linger === 0) lose(p);
      }
      if (p.kind === "flarefish") {
        if (p.flarePhase === "idle" && p.state === "wander") {
          p.flareIn = down(p.flareIn);
          if (p.flareIn === 0) {
            p.flarePhase = "charge";
            p.flareTime = 0;
          }
        } else if (p.flarePhase !== "idle") {
          // Fade is presentation alone; the new interval runs from bloom's end.
          if (p.flarePhase === "fade" && p.state === "wander")
            p.flareIn = down(p.flareIn);
          p.flareTime += C.TICK_DT;
          if (
            p.flarePhase === "charge" &&
            p.flareTime + 1e-8 >= C.FLARE_CHARGE
          ) {
            p.flarePhase = "bloom";
            p.flareTime = 0;
            cues.add(C.CUES.flare);
          } else if (
            p.flarePhase === "bloom" &&
            p.flareTime + 1e-8 >= C.FLARE_BLOOM
          ) {
            p.flarePhase = "fade";
            p.flareTime = 0;
            p.flareIn = C.FLARE_INTERVAL;
          } else if (p.flarePhase === "fade" && p.flareTime >= 0.3) {
            p.flarePhase = "idle";
            p.flareTime = 0;
          }
        }
        // The first bloom tick is already a sensing tick, not just a picture.
        if (
          p.flarePhase === "bloom" &&
          !blind &&
          distance(p, f) <= C.FLARE_RADIUS
        )
          acquire(s, p);
        p.flareCharging = p.flarePhase === "charge";
        p.flaring = p.flarePhase === "bloom";
        p.flareRadius = p.flaring ? C.FLARE_RADIUS : 0;
      }
    }
    reconcileSpeed(p);
    if (p.travel) {
      if (p.fix && p.state === "chase") {
        const d = path(s, p, p.fix);
        if (d === opposite(p.dir)) p.dir = d;
      }
      move(s, p, p.speed, (b) => {
        let d: Direction | null;
        if (p.state === "chase" && p.fix) d = path(s, b, p.fix);
        else if (
          p.state === "search" &&
          p.fix &&
          Math.abs(p.tx - p.fix.tx) + Math.abs(p.ty - p.fix.ty) >=
            C.GLOAMFIN_SEARCH_ROAM
        )
          d = path(s, b, p.fix);
        else d = wander(s, b);
        if (
          p.kind === "gloamfin" &&
          p.state === "chase" &&
          d &&
          d !== p.dir &&
          d !== opposite(p.dir)
        )
          p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
        return d;
      });
    }
  });
}
function reconcileSpeed(p: Predator) {
  p.speed =
    p.kind === "lanternjaw" && p.state === "wander"
      ? C.DRIFTER_SPEED
      : p.kind === "gloamfin" && p.state === "chase"
        ? p.chaseSpeed
        : C.PREDATOR_SPEED;
}
function waves(s: FathomState) {
  for (const pulse of s.pulses) {
    const old = pulse.front;
    pulse.front += C.SONAR_WAVE_SPEED * C.TICK_DT;
    const dist = distances(s, pulse.ox, pulse.oy, true);
    const reached = (tx: number, ty: number) => {
      const d = dist[ty * C.GRID_COLS + tx]!;
      return d <= pulse.range && d <= pulse.front && (d > old || old === 0);
    };
    if (pulse.source === "forager") {
      for (let y = 0; y < C.GRID_ROWS; y++)
        for (let x = 0; x < C.GRID_COLS; x++)
          if (reached(x, y)) {
            s.tileMarks[y * C.GRID_COLS + x] = C.SONAR_MARK_TIME;
            for (const d of ["up", "down", "left", "right"] as const) {
              const n = neighbor(s, x, y, d);
              if (n && s.tiles[n.ty]![n.tx] === "#")
                s.tileMarks[n.ty * C.GRID_COLS + n.tx] = C.SONAR_MARK_TIME;
            }
          }
      for (const p of s.predators)
        if (p.state !== "den" && reached(p.tx, p.ty)) {
          if (p.kind !== "lanternjaw") p.mark = C.SONAR_MARK_TIME;
          if (p.kind === "gloamfin" && p.mind) acquire(s, p);
        }
    } else if (!pulse.caught && reached(s.forager.tx, s.forager.ty)) {
      const p = pulse.owner === null ? null : s.predators[pulse.owner];
      if (p?.mind && p.kind === "gloamfin" && p.state !== "den") acquire(s, p);
      pulse.caught = true;
    }
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range);
}
export function lighting(s: FathomState) {
  const flares = s.predators.filter((p) => p.flaring && p.state !== "den");
  const vis: string[][] = s.visibility.map((r) =>
    [...r].map((c) => (c === "u" ? "u" : "r")),
  );
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++) {
      const c = center(x, y);
      const lit =
        (distance(c, s.forager) <= s.visionRadius &&
          sight(s, s.forager, c, true)) ||
        s.tileMarks[y * C.GRID_COLS + x]! > 0 ||
        flares.some((p) => distance(p, c) <= C.FLARE_RADIUS);
      if (lit) vis[y]![x] = "l";
    }
  s.visibility = vis.map((r) => r.join(""));
  const passive = (b: { x: number; y: number }) =>
    (distance(b, s.forager) <= s.visionRadius && sight(s, s.forager, b)) ||
    flares.some((p) => distance(p, b) <= C.FLARE_RADIUS);
  for (const p of s.predators) {
    p.alert = p.kind !== "lanternjaw" && p.alertLeft > 0;
    p.lit = p.state !== "den" && (passive(p) || p.mark > 0 || p.alert);
  }
  for (const d of s.drifters) d.lit = passive(d);
}
export interface TickInput {
  held: boolean;
  desired: Direction;
}
export function tick(
  s: FathomState,
  input: TickInput,
  cues: Set<CueName>,
): FathomState {
  s.simTime += C.TICK_DT;
  s.screenTime += C.TICK_DT;
  if (s.screen === "countdown") {
    lighting(s);
    if (s.screenTime + 1e-8 >= COUNTDOWN_TIME) {
      screen(s, "playing");
      s.playTime = 0;
    }
    return s;
  }
  if (s.screen === "cleared") {
    if (s.screenTime + 1e-8 >= CLEAR_TIME) {
      const n = newDive(s);
      n.depth = s.depth + 1;
      n.score = s.score;
      n.lives = s.lives;
      n.predators = roster(n.depth);
      n.titleIndex = s.titleIndex;
      return reconcile(n);
    }
    return s;
  }
  if (s.screen !== "playing") return s;
  s.playTime += C.TICK_DT;
  s.sonar.cooldown = down(s.sonar.cooldown);
  s.ink.cooldown = down(s.ink.cooldown);
  s.tileMarks = s.tileMarks.map(down);
  const decayTime = Math.max(0, C.TICK_DT - s.brightHold);
  s.brightHold = down(s.brightHold);
  s.brightness *= 0.5 ** (decayTime / C.BRIGHT_HALFLIFE);
  s.inkClouds = s.inkClouds
    .map((c) => ({ ...c, remaining: down(c.remaining) }))
    .filter((c) => c.remaining > 0);
  if (s.pendingSonar && s.sonar.cooldown === 0) {
    s.pulses.push({
      source: "forager",
      tint: "cyan",
      ox: s.forager.tx,
      oy: s.forager.ty,
      front: 0,
      range: s.sonar.range,
      owner: null,
      caught: false,
    });
    s.sonar.cooldown = C.SONAR_COOLDOWN;
    cues.add(C.CUES.sonar);
  }
  if (s.pendingInk && s.ink.cooldown === 0) {
    s.inkClouds.push({
      x: s.forager.x,
      y: s.forager.y,
      radius: C.INK_RADIUS,
      remaining: C.INK_LIFE,
    });
    s.ink.cooldown = C.INK_COOLDOWN;
    cues.add(C.CUES.ink);
  }
  s.pendingSonar = false;
  s.pendingInk = false;
  s.desired = input.desired;
  if (input.held) {
    if (s.desired === opposite(s.forager.dir)) s.forager.dir = s.desired;
    s.forager.moving = move(s, s.forager, C.FORAGER_SPEED, (b) =>
      choices(s, b).includes(s.desired)
        ? s.desired
        : choices(s, b).includes(b.dir)
          ? b.dir
          : null,
    );
  } else s.forager.moving = false;
  const f = s.forager;
  if (s.plankton[f.ty]?.[f.tx] === "*" && open(s, f.tx, f.ty)) {
    put(s.plankton, f.tx, f.ty, "-");
    s.planktonRemaining--;
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    cues.add(C.CUES.eat);
    if (s.planktonRemaining === 0) {
      s.score += C.SCORE_CLEAR;
      cues.add(C.CUES.descend);
      screen(s, "cleared");
      return reconcile(s);
    }
  }
  reconcile(s);
  hunters(s, cues);
  waves(s);
  s.drifterIn = down(s.drifterIn);
  if (
    s.drifterIn === 0 &&
    s.planktonRemaining > 0 &&
    s.drifters.length < C.DRIFTER_MAX
  ) {
    const gy = s.tiles.findIndex((r) => r.includes("g"));
    if (gy >= 0) {
      const gx = s.tiles[gy]!.indexOf("g");
      const n = choices(s, { tx: gx, ty: gy })
        .map((d) => neighbor(s, gx, gy, d)!)
        .find((n) => open(s, n.tx, n.ty));
      if (n) {
        s.drifters.push({
          ...center(n.tx, n.ty),
          dir: "up",
          lit: false,
          mind: true,
          travel: true,
        });
        s.drifterIn = C.DRIFTER_INTERVAL;
      }
    }
  }
  for (const d of s.drifters)
    if (d.mind && d.travel) move(s, d, C.DRIFTER_SPEED, (b) => wander(s, b));
  s.drifters = s.drifters.filter((d) => {
    if (sameTile(d, f)) {
      s.score += C.SCORE_DRIFTER;
      return false;
    }
    return true;
  });
  if (s.predators.some((p) => p.state !== "den" && sameTile(p, f))) {
    cues.add(C.CUES.caught);
    if (s.lives === 0) screen(s, "gameover");
    else {
      s.lives--;
      retry(s);
    }
  }
  reconcile(s);
  lighting(s);
  return s;
}
