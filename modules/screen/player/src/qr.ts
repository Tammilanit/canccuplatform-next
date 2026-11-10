/**
 * The pairing QR, built in the browser (contracts/screen.md, Pairing: the kiosk has no device yet,
 * so the server cannot build it for the page). One SVG path of the dark modules, made with DOM
 * calls rather than an SVG string.
 */
/*! The bundle includes qrcode-generator, Copyright (c) 2009 Kazuhiko Arase, MIT license. */
import qrcode from "qrcode-generator";

const SVG = "http://www.w3.org/2000/svg";
/** The quiet zone the QR standard asks for, in modules. */
const MARGIN = 4;

export function qrSvg(text: string): SVGSVGElement {
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();
  const count = code.getModuleCount();
  const size = count + MARGIN * 2;
  const d: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (code.isDark(row, col)) d.push(`M${col + MARGIN} ${row + MARGIN}h1v1h-1z`);
    }
  }
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "canccu-qr");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code");
  svg.setAttribute("shape-rendering", "crispEdges");
  const back = document.createElementNS(SVG, "rect");
  back.setAttribute("width", String(size));
  back.setAttribute("height", String(size));
  back.setAttribute("fill", "#fff");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", d.join(""));
  path.setAttribute("fill", "#000");
  svg.append(back, path);
  return svg;
}
