// Demo custom JS: runs only in the sandboxed embed frame on the sandbox origin (contracts/theming.md).
// It draws from a fixed seed, so CI screenshots of the first frame stay the same.
const canvas = document.getElementById("sky");
const ctx = canvas.getContext("2d");
let seed = 42;
function random() {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}
const stars = Array.from({ length: 200 }, () => ({ x: random(), y: random(), z: random() }));
function frame() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  ctx.fillStyle = "#121212";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const s of stars) {
    s.x = (s.x + 0.0005 * (1 + s.z)) % 1;
    ctx.fillStyle = s.z > 0.7 ? "#00d8d8" : "#4a4a4a";
    ctx.fillRect(s.x * canvas.width, s.y * canvas.height, 1 + 2 * s.z, 1 + 2 * s.z);
  }
  requestAnimationFrame(frame);
}
frame();
