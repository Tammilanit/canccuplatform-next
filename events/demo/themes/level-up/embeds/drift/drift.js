// Level up backdrop: slow contour lines and motes that rise, a picture of progress that never
// competes with the text in front of it. Runs only in the sandboxed embed frame (contracts/theming.md):
// no data in, no network. Everything is a function of a fixed seed and the time, so the frame at
// t = 0 is the same on every run; with prefers-reduced-motion it draws that frame once and stops,
// which is also how CI screenshots it.
const canvas = document.getElementById("drift");
const ctx = canvas.getContext("2d");
const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Colours are the theme's background, primary and accent tokens; an embed cannot read them.
const BASE = "#140d0b";
const ORANGE = [255, 154, 60];
const PINK = [255, 111, 174];

let seed = 1337;
function random() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

// Made once for the largest screen; a smaller or portrait canvas uses the share that fits.
const MOTES = Array.from({ length: 220 }, () => ({
  x: random(),
  y: random(),
  size: 1 + random() * 2.2,
  speed: 0.004 + random() * 0.01,
  sway: random() * Math.PI * 2,
  alpha: 0.12 + random() * 0.38,
  pink: random() < 0.4,
}));

const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
let width = 0;
let height = 0;
let moteCount = 0;

function resize() {
  width = canvas.width = canvas.clientWidth;
  height = canvas.height = canvas.clientHeight;
  // Same density on 16:9 and 9:16: the count follows the area, not the width.
  moteCount = Math.min(MOTES.length, Math.round((width * height) / 9500));
  if (still) draw(0);
}

function glow(x, y, radius, colour, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, rgba(colour, alpha));
  g.addColorStop(1, rgba(colour, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

// Wide, gentle waves stacked up the screen, like the rings of a level map.
function contours(t) {
  const span = Math.max(width, height);
  const step = span / 14;
  const drift = (t * 6) % step;
  ctx.lineWidth = 1.5;
  for (let y = -step + drift; y < height + step; y += step) {
    ctx.beginPath();
    for (let x = 0; x <= width; x += 24) {
      const wave = Math.sin(x / (span * 0.18) + y / (span * 0.3) + t * 0.05) * step * 0.22;
      if (x === 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    const share = y / height;
    ctx.strokeStyle = rgba(share < 0.5 ? ORANGE : PINK, 0.07);
    ctx.stroke();
  }
}

function motes(t) {
  for (let i = 0; i < moteCount; i += 1) {
    const m = MOTES[i];
    const y = (((m.y - m.speed * t) % 1) + 1) % 1;
    const x = m.x + Math.sin(t * 0.25 + m.sway) * 0.006;
    // Fade in at the bottom and out at the top, so motes never pop.
    const fade = Math.min(1, y * 4, (1 - y) * 4);
    const colour = m.pink ? PINK : ORANGE;
    ctx.fillStyle = rgba(colour, m.alpha * fade);
    ctx.beginPath();
    ctx.arc(x * width, y * height, m.size, 0, Math.PI * 2);
    ctx.fill();
    if (m.size > 2.6) {
      ctx.fillStyle = rgba(colour, m.alpha * fade * 0.25);
      ctx.fillRect(x * width - 0.5, y * height, 1, m.size * 9);
    }
  }
}

function draw(t) {
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, width, height);
  const span = Math.max(width, height);
  glow(width * 0.1, height * 0.08, span * 0.55, ORANGE, 0.13);
  glow(width * 0.92, height * 0.95, span * 0.6, PINK, 0.13);
  contours(t);
  motes(t);
}

// About 30 frames a second is smooth for motion this slow and halves the work of a small player.
let last = 0;
function frame(now) {
  if (now - last >= 33) {
    last = now;
    draw(now / 1000);
  }
  requestAnimationFrame(frame);
}

window.addEventListener("resize", resize);
resize();
if (!still) requestAnimationFrame(frame);
