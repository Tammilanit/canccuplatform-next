/**
 * Pizza is here's art (#775): a whole pizza from above, cut in six. It travels in the step as a
 * data: image, as a step's QR does (content.ts), so the card needs no upload or asset route and a
 * screen offline still has it. Fixed food colours, not the theme's: a pizza reads as one in any
 * look, and the card's text and frame carry the theme.
 */
const SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">',
  '<circle cx="60" cy="60" r="57" fill="#c9782f"/>',
  '<circle cx="60" cy="60" r="49" fill="#d9472b"/>',
  '<circle cx="60" cy="60" r="45" fill="#ffcf5c"/>',
  '<g fill="#a8281f"><circle cx="40" cy="40" r="8"/><circle cx="78" cy="36" r="7"/>',
  '<circle cx="63" cy="68" r="8"/><circle cx="35" cy="76" r="7"/><circle cx="86" cy="74" r="7"/>',
  '<circle cx="58" cy="94" r="6"/></g>',
  '<g fill="#3e8e41"><ellipse cx="58" cy="44" rx="5" ry="3"/><ellipse cx="84" cy="56" rx="3" ry="5"/>',
  '<ellipse cx="44" cy="58" rx="3" ry="5"/><ellipse cx="74" cy="90" rx="5" ry="3"/></g>',
  '<path d="M60 4v112M11.5 32l97 56M11.5 88l97-56" stroke="#c9782f" stroke-width="2.5"/>',
  "</svg>",
].join("");

export const PIZZA_ART = `data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`;
