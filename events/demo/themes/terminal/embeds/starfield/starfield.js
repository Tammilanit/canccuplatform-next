// Demo custom JS: runs only in the sandboxed embed frame on the sandbox origin (contracts/theming.md).
// Stars come from a fixed seed. With prefers-reduced-motion it draws one still frame and stops,
// which is how CI screenshots it the same every run: the embed gets no data, but the browser can
// emulate that media feature.
const canvas = document.getElementById("sky");
const ctx = canvas.getContext("2d");
const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let seed = 42;
function random() {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}
const stars = Array.from({ length: 200 }, () => ({ x: random(), y: random(), z: random() }));

function resize() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  if (still) draw();
}

function draw() {
  ctx.fillStyle = "#121212";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const s of stars) {
    ctx.fillStyle = s.z > 0.7 ? "#00d8d8" : "#4a4a4a";
    ctx.fillRect(s.x * canvas.width, s.y * canvas.height, 1 + 2 * s.z, 1 + 2 * s.z);
  }
}

function frame() {
  for (const s of stars) s.x = (s.x + 0.0005 * (1 + s.z)) % 1;
  draw();
  requestAnimationFrame(frame);
}

window.addEventListener("resize", resize);
resize();
if (!still) frame();
