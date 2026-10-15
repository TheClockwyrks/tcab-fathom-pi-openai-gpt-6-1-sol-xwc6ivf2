import type { RenderApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import { menus, menuItemRect } from "./debug";
import { COUNTDOWN_TIME } from "./simulation";
import type { Direction, ReadState } from "./types";
import { center, DELTA, DIRECTIONS, distances, neighbor } from "./world";
export const BACKGROUND = "#03060c";
const CYAN = "#8ff9e7",
  DIM = "#567c87",
  WHITE = "#d9f5ef",
  AMBER = "#ff9164";
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const facing: Record<Direction, number> = { down: 0, up: 2, left: 4, right: 6 };
type Ctx = CanvasRenderingContext2D;
function text(
  ctx: Ctx,
  str: string,
  x: number,
  y: number,
  size = 16,
  color = DIM,
  align: CanvasTextAlign = "left",
) {
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(str, x, y);
}
function spaced(
  ctx: Ctx,
  str: string,
  x: number,
  y: number,
  size: number,
  spacing: number,
  color: string,
) {
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  const w = ctx.measureText(str).width + (str.length - 1) * spacing;
  let at = x - w / 2;
  for (const char of str) {
    ctx.fillText(char, at, y);
    at += ctx.measureText(char).width + spacing;
  }
}
function line(
  ctx: Ctx,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color = "#16333d",
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function disc(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  color: string | CanvasGradient,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
function glow(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 0.25,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.save();
  ctx.globalAlpha = alpha;
  disc(ctx, x, y, r, g);
  ctx.restore();
}
function sprite(
  ctx: Ctx,
  s: ReadState,
  sheet: string,
  index: number,
  x: number,
  y: number,
  size = C.TILE,
) {
  const image = s.art[sheet]?.[index];
  if (image)
    ctx.drawImage(image as ImageBitmap, x - size / 2, y - size / 2, size, size);
}
function amber(ctx: Ctx, x: number, y: number) {
  glow(ctx, x, y, 20, AMBER, 0.7);
  disc(ctx, x, y, 3, AMBER);
  disc(ctx, x - 1, y - 1, 1.2, "#ffe4b4");
}
function terrain(ctx: Ctx, s: ReadState) {
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++) {
      const v = s.visibility[y]![x];
      if (v === "u") continue;
      const ch = s.tiles[y]![x];
      let frame = 16;
      if (ch === "#") {
        frame = 0;
        for (const [d, bit] of [
          ["up", 1],
          ["right", 2],
          ["down", 4],
          ["left", 8],
        ] as const) {
          const n = neighbor(s, x, y, d);
          if (n && s.tiles[n.ty]![n.tx] === "#") frame += bit;
        }
      }
      if (ch === "g") frame = 18;
      const c = center(x, y);
      ctx.globalAlpha = v === "l" ? 1 : 0.27;
      sprite(ctx, s, "trench-walls", frame, c.x, c.y);
      if (s.plankton[y]![x] === "*") {
        ctx.shadowColor = CYAN;
        ctx.shadowBlur = v === "l" ? 8 : 0;
        disc(
          ctx,
          c.x,
          c.y,
          C.PLANKTON_DOT / 2,
          v === "l" ? "#b9ffed" : "#65a197",
        );
        ctx.shadowBlur = 0;
      }
    }
  ctx.globalAlpha = 1;
}
function mazeView(ctx: Ctx, s: ReadState) {
  // Flat darkness is independent of the concealed tile underneath.
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  const fog = s.art["trench-walls"]?.[17];
  if (fog)
    ctx.drawImage(
      fog as ImageBitmap,
      C.GRID_ORIGIN_X,
      C.GRID_ORIGIN_Y,
      C.GRID_COLS * C.TILE,
      C.GRID_ROWS * C.TILE,
    );
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.clip();
  ctx.save();
  ctx.beginPath();
  ctx.arc(s.forager.x, s.forager.y, s.windowRadius, 0, Math.PI * 2);
  ctx.clip();
  terrain(ctx, s);
  glow(ctx, s.forager.x, s.forager.y, s.windowRadius, "#19636b", 0.22);
  for (const b of [
    ...s.drifters,
    ...s.predators.filter((p) => p.kind === "lanternjaw" && p.state !== "den"),
  ])
    amber(ctx, b.x, b.y);
  for (const cloud of s.inkClouds) {
    disc(ctx, cloud.x, cloud.y, cloud.radius, "#000306");
    for (let i = 0; i < 7; i++)
      disc(
        ctx,
        cloud.x + Math.cos(i * 2.4) * cloud.radius * 0.55,
        cloud.y + Math.sin(i * 2.4) * cloud.radius * 0.55,
        cloud.radius * 0.45,
        "#000306",
      );
  }
  ctx.restore();
  for (const p of s.predators)
    if (p.flaring) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, C.FLARE_RADIUS, 0, Math.PI * 2);
      ctx.clip();
      terrain(ctx, s);
      ctx.restore();
    }
  for (const d of s.drifters)
    if (d.lit)
      sprite(ctx, s, "drifter", Math.floor(s.playTime * 8) % 8, d.x, d.y);
  for (const p of s.predators) {
    if (p.lit) {
      const frame =
        p.kind === "lanternjaw" && p.state === "wander"
          ? 8 + (Math.floor(s.playTime * 8) % 8)
          : facing[p.dir] + (Math.floor(s.playTime * 7) % 2);
      sprite(ctx, s, p.kind, frame, p.x, p.y);
    }
    if (p.alert) {
      const color = p.kind === "gloamfin" ? "#ba9aff" : "#ffb478";
      ctx.save();
      ctx.globalAlpha = p.alertLeft / C.ALERT_TIME;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      const r = 12 + (1 - p.alertLeft / C.ALERT_TIME) * 38;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        line(
          ctx,
          p.x + Math.cos(a) * (r + 4),
          p.y + Math.sin(a) * (r + 4),
          p.x + Math.cos(a) * (r + 13),
          p.y + Math.sin(a) * (r + 13),
          color,
        );
      }
      ctx.restore();
    }
    if (p.flarePhase !== "idle") {
      const frame =
        p.flarePhase === "charge"
          ? Math.min(2, Math.floor((p.flareTime / C.FLARE_CHARGE) * 3))
          : p.flarePhase === "bloom"
            ? 3 + Math.min(2, Math.floor((p.flareTime / C.FLARE_BLOOM) * 3))
            : 6 + Math.min(1, Math.floor((p.flareTime / 0.3) * 2));
      sprite(ctx, s, "flare-bloom", frame, p.x, p.y, C.FLARE_RADIUS * 2);
    }
  }
  for (const p of s.pulses) {
    const dist = distances(s, p.ox, p.oy, true);
    const color =
      p.tint === "cyan" ? CYAN : p.tint === "violet" ? "#b69bff" : "#ff985e";
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const d = dist[y * C.GRID_COLS + x]!;
        const delta = p.front - d;
        if (delta < 0 || delta > 1.4 || d >= p.range) continue;
        const c = center(x, y);
        // Each graph edge carries a moving transverse crest. Branches split
        // it at junctions; a corner rotates it, rather than drawing a disc.
        for (const dir of DIRECTIONS) {
          const n = neighbor(s, x, y, dir);
          if (!n || dist[n.ty * C.GRID_COLS + n.tx] !== d + 1) continue;
          const [dx, dy] = DELTA[dir];
          const progress = Math.min(1, delta);
          let px = c.x + dx * C.TILE * progress;
          const py = c.y + dy * C.TILE * progress;
          if (px < C.GRID_ORIGIN_X) px += C.GRID_COLS * C.TILE;
          if (px >= C.GRID_ORIGIN_X + C.GRID_COLS * C.TILE)
            px -= C.GRID_COLS * C.TILE;
          ctx.globalAlpha = Math.min(1, (1.4 - delta) * 2) * 0.9;
          ctx.fillStyle = color;
          if (dx) ctx.fillRect(px - 2, py - 12, 4, 24);
          else ctx.fillRect(px - 12, py - 2, 24, 4);
        }
      }
    ctx.restore();
  }
  glow(ctx, s.forager.x, s.forager.y, 38, CYAN, 0.35);
  sprite(
    ctx,
    s,
    "glimmerfin",
    facing[s.forager.dir] +
      (s.forager.moving ? Math.floor(s.playTime * 9) % 2 : 0),
    s.forager.x,
    s.forager.y,
  );
  ctx.restore();
  // Instrument rails sit outside, not over, the dark water.
  line(ctx, 64, 78, 1216, 78);
  line(ctx, 64, 658, 1216, 658);
  for (let y = 96; y < 650; y += 32) {
    line(ctx, 53, y, 57, y);
    line(ctx, 1223, y, 1227, y);
  }
}
function gauge(
  ctx: Ctx,
  label: string,
  key: string,
  x: number,
  y: number,
  fill: number,
  color: string,
) {
  text(ctx, label, x, y, 12, color);
  text(ctx, key, x + 188, y, 11, DIM, "right");
  ctx.fillStyle = "#102831";
  ctx.fillRect(x, y + 9, 188, 4);
  ctx.fillStyle = color;
  ctx.fillRect(x, y + 9, 188 * Math.max(0, Math.min(1, fill)), 4);
}
function hud(ctx: Ctx, s: ReadState) {
  spaced(ctx, C.TITLE_TEXT, 151, 35, 23, 4, WHITE);
  text(ctx, `PELAGIC SURVEY / ${C.DIVE_LABEL}`, 64, 58, 10, DIM);
  text(ctx, "PLANKTON", 378, 28, 10, DIM);
  text(ctx, String(s.planktonRemaining).padStart(3, "0"), 378, 56, 26, CYAN);
  text(ctx, C.DIVE_LABEL, 640, 27, 12, DIM, "center");
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i < Math.round(s.brightness * 16) ? CYAN : "#12303a";
    ctx.fillRect(580 + i * 8, 43, 5, 8);
  }
  text(ctx, "SCORE", 1216, 19, 10, DIM, "right");
  text(ctx, String(s.score).padStart(6, "0"), 1216, 64, 48, WHITE, "right");
  text(ctx, `DEPTH ${s.depth}`, 64, 695, 18, WHITE);
  text(ctx, "RESERVE", 218, 688, 10, DIM);
  for (let i = 0; i < s.lives; i++)
    sprite(ctx, s, "glimmerfin", 6, 300 + i * 28, 687, 24);
  text(ctx, "P  PAUSE  /  M  SOUND", 476, 693, 11, DIM);
  gauge(
    ctx,
    "SONAR",
    "SPACE",
    752,
    686,
    1 - s.sonar.cooldown / C.SONAR_COOLDOWN,
    CYAN,
  );
  gauge(
    ctx,
    "INK",
    "SHIFT",
    1028,
    686,
    1 - s.ink.cooldown / C.INK_COOLDOWN,
    "#9f9dc9",
  );
}
function menu(ctx: Ctx, s: ReadState) {
  menus(s).forEach((name, i) => {
    const r = menuItemRect(s, i)!;
    const selected = s.menuIndex === i;
    ctx.fillStyle = selected ? "#103138" : "#07151d";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    line(ctx, r.x, r.y, r.x + r.w, r.y, selected ? "#609f9a" : "#17313a");
    if (selected) {
      ctx.fillStyle = CYAN;
      ctx.fillRect(r.x, r.y, 3, r.h);
      text(ctx, "›", r.x + 19, r.y + 31, 24, CYAN);
    }
    text(ctx, name, 640, r.y + 30, 18, selected ? WHITE : DIM, "center");
    text(
      ctx,
      `0${i + 1}`,
      r.x + r.w - 23,
      r.y + 28,
      10,
      selected ? CYAN : DIM,
      "right",
    );
  });
}
function backdrop(ctx: Ctx, s: ReadState) {
  // A quiet bathymetric chart, not the active maze's revealed memory.
  glow(ctx, 640, 315, 520, "#0d4754", 0.35);
  ctx.save();
  ctx.strokeStyle = "#12303a";
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.ellipse(640, 325, 210 + i * 44, 70 + i * 28, -0.16, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  for (let i = 0; i < 65; i++) {
    const x = (i * 181.7) % C.STAGE_W;
    const y = (i * 117.3) % C.STAGE_H;
    disc(
      ctx,
      x,
      y,
      i % 4 === 0 ? 1.5 : 0.7,
      i % 5 === 0 ? "#27535c" : "#112b35",
    );
  }
  line(ctx, 64, 62, 1216, 62);
  text(ctx, "F / 01", 64, 43, 12, CYAN);
  text(ctx, "ABYSSAL EXPLORATION DIVISION", 640, 43, 11, DIM, "center");
  text(ctx, "SIGNAL: ACTIVE", 1216, 43, 11, DIM, "right");
  line(ctx, 64, 654, 1216, 654);
  text(ctx, "MOVE  WASD / ARROWS", 64, 686, 11, DIM);
  text(ctx, "SELECT  ENTER / SPACE", 640, 686, 11, DIM, "center");
  text(
    ctx,
    `M  ${s.muted ? "SOUND OFF" : "SOUND ON"}`,
    1216,
    686,
    11,
    DIM,
    "right",
  );
}
function title(ctx: Ctx, s: ReadState) {
  backdrop(ctx, s);
  spaced(ctx, "B E L O W   T H E   L I G H T", 640, 146, 12, 1, DIM);
  ctx.save();
  ctx.shadowColor = "#3bb8b3";
  ctx.shadowBlur = 35;
  spaced(ctx, C.TITLE_TEXT, 640, 270, 106, 17, WHITE);
  ctx.restore();
  spaced(ctx, C.TAGLINE_TEXT, 640, 314, 16, 7, CYAN);
  text(ctx, "A light to feed. A sound to follow.", 640, 365, 14, DIM, "center");
  menu(ctx, s);
  glow(ctx, 235, 433, 100, CYAN, 0.2);
  sprite(
    ctx,
    s,
    "glimmerfin",
    6 + (Math.floor(s.simTime * 3) % 2),
    235,
    427,
    80,
  );
  text(ctx, "YOU ARE THE LIGHT", 235, 505, 10, CYAN, "center");
  line(ctx, 235, 453, 235, 484);
  amber(ctx, 1045, 415);
  sprite(
    ctx,
    s,
    "lanternjaw",
    8 + (Math.floor(s.simTime * 8) % 8),
    1045,
    429,
    64,
  );
  text(ctx, "NOT EVERY GLOW IS SAFE", 1045, 505, 10, AMBER, "center");
  line(ctx, 1045, 463, 1045, 484);
  text(ctx, "GRAZE · LISTEN · DISAPPEAR", 640, 602, 11, DIM, "center");
}
function howto(ctx: Ctx, s: ReadState) {
  backdrop(ctx, s);
  spaced(ctx, "READ THE DARK", 640, 135, 34, 5, WHITE);
  text(
    ctx,
    "Your light finds the way. It also gives you away.",
    640,
    174,
    15,
    CYAN,
    "center",
  );
  const rows = [
    [
      "lanternjaw",
      "01 / LANTERNJAW",
      "Follows your light. Eat, glow brighter, get noticed.",
      AMBER,
    ],
    [
      "gloamfin",
      "02 / GLOAMFIN",
      "Hears you through rock. Your sonar calls it closer.",
      "#ba9aff",
    ],
    [
      "flarefish",
      "03 / FLAREFISH",
      "Flashes the abyss. Escape its bloom before it locks on.",
      "#ffb478",
    ],
  ] as const;
  rows.forEach(([sheet, name, copy, color], i) => {
    const y = 238 + i * 91;
    sprite(ctx, s, sheet, sheet === "lanternjaw" ? 6 : 4, 174, y + 9, 48);
    text(ctx, name, 224, y, 15, color);
    text(ctx, copy, 224, y + 26, 14, WHITE);
    line(ctx, 224, y + 46, 1110, y + 46);
  });
  text(ctx, "WASD / ARROWS   Swim while held", 140, 528, 14, WHITE);
  text(
    ctx,
    "SPACE   Sonar: map corridors, expose hunters",
    640,
    528,
    14,
    WHITE,
  );
  text(ctx, "SHIFT   Ink: break a light hunter’s fix", 140, 563, 14, WHITE);
  text(ctx, "P / ESC   Pause     M   Toggle sound", 640, 563, 14, WHITE);
  text(
    ctx,
    "Graze every mote to descend. Explored ground stays mapped, but vanishes outside your light-circle.",
    640,
    610,
    12,
    DIM,
    "center",
  );
  text(ctx, "ENTER / ESC / CLICK TO RETURN", 640, 638, 11, CYAN, "center");
}
export function render(s: ReadState, api: RenderApi) {
  const ctx = api.ctx;
  ctx.imageSmoothingEnabled = false;
  if (s.screen === "title") {
    title(ctx, s);
    return;
  }
  if (s.screen === "howto") {
    howto(ctx, s);
    return;
  }
  if (s.screen === "gameover") {
    backdrop(ctx, s);
    spaced(ctx, "SIGNAL LOST", 640, 199, 48, 7, WHITE);
    text(
      ctx,
      `DEPTH ${s.depth}   /   FINAL SCORE`,
      640,
      255,
      14,
      DIM,
      "center",
    );
    text(ctx, String(s.score).padStart(6, "0"), 640, 318, 48, CYAN, "center");
    menu(ctx, s);
    text(
      ctx,
      "The abyss keeps its secrets. Dive again.",
      640,
      563,
      14,
      DIM,
      "center",
    );
    return;
  }
  mazeView(ctx, s);
  hud(ctx, s);
  if (s.screen === "playing") return;
  ctx.fillStyle = s.screen === "paused" ? "#02090fbb" : "#02090f60";
  ctx.fillRect(64, 80, 1152, 576);
  if (s.screen === "paused") {
    text(ctx, "DIVE SUSPENDED", 640, 278, 34, WHITE, "center");
    text(ctx, "HOLD YOUR BREATH", 640, 314, 12, DIM, "center");
    menu(ctx, s);
  }
  if (s.screen === "countdown") {
    spaced(ctx, "DIVE", 640, 328, 44, 10, WHITE);
    text(
      ctx,
      String(Math.max(1, Math.ceil(COUNTDOWN_TIME - s.screenTime))),
      640,
      399,
      48,
      CYAN,
      "center",
    );
    text(
      ctx,
      "FOLLOW THE LIGHT. QUESTION THE GLOW.",
      640,
      446,
      12,
      DIM,
      "center",
    );
  }
  if (s.screen === "cleared") {
    spaced(ctx, `DEPTH ${s.depth} CLEARED`, 640, 334, 36, 4, WHITE);
    text(ctx, `+${C.SCORE_CLEAR}  /  DESCENDING`, 640, 388, 18, CYAN, "center");
  }
}
