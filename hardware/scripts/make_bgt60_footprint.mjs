// Writes the BGT60TR13C (Infineon PG-VF2BGA-40-1) footprint as a KiCad .kicad_mod file.
// Source: BGT60TR13C datasheet v2.4.9, Table 1 (ball map) and chapter 12 (package):
//   6.5 x 5.0 x 0.9 mm, 300 um balls, 500 um pitch, 40 balls on the perimeter of a 12 x 9 grid.
// Top view (JEDEC): A1 top-left, ball numbers 1..9 left to right (5 mm side), letters A..M top to bottom (6.5 mm side).
// Pads: 0.25 mm round, non-solder-mask-defined (mask grows by the board's maskExpansion).
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LETTERS = 'ABCDEFGHJKLM';
const BALLS = [
  'A1', 'A2', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'J1', 'K1', 'L1', 'M1',
  'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M9', 'F9', 'G9',
  'L9', 'K9', 'J9', 'H9', 'E9', 'D9', 'C9', 'B9', 'B8', 'A9', 'A8', 'A7', 'A6', 'A5', 'B4', 'A4', 'B3', 'A3',
];
if (BALLS.length !== 40 || new Set(BALLS).size !== 40) throw new Error('ball list must have 40 unique balls');

const PITCH = 0.5, PAD = 0.25;
const pos = (ball) => {
  const row = LETTERS.indexOf(ball[0]), col = Number(ball.slice(1)) - 1;
  return { x: +(col * PITCH - 2.0).toFixed(3), y: +(row * PITCH - 2.75).toFixed(3) };
};
const W = 5.0, H = 6.5;
const line = (x1, y1, x2, y2, layer, w = 0.12) => `\t(fp_line (start ${x1} ${y1}) (end ${x2} ${y2}) (stroke (width ${w}) (type solid)) (layer "${layer}"))`;
const rect = (x1, y1, x2, y2, layer, w) => [line(x1, y1, x2, y1, layer, w), line(x2, y1, x2, y2, layer, w), line(x2, y2, x1, y2, layer, w), line(x1, y2, x1, y1, layer, w)].join('\n');

const out = [
  '(footprint "BGT60TR13C_PG-VF2BGA-40"',
  '\t(version 20240108) (generator "subvocal-radar")',
  '\t(layer "F.Cu")',
  '\t(descr "Infineon BGT60TR13C 60 GHz radar, PG-VF2BGA-40-1, 6.5x5.0 mm, 0.5 mm pitch, antennas in package (keep the top clear)")',
  '\t(tags "BGA radar Infineon XENSIV")',
  '\t(attr smd)',
  rect(-W / 2, -H / 2, W / 2, H / 2, 'F.Fab', 0.1),
  rect(-W / 2 - 0.25, -H / 2 - 0.25, W / 2 + 0.25, H / 2 + 0.25, 'F.CrtYd', 0.05),
  // silkscreen: corner marks outside the pads plus an A1 dot
  line(-W / 2 - 0.12, -H / 2 - 0.12, -W / 2 + 0.8, -H / 2 - 0.12, 'F.SilkS'),
  line(-W / 2 - 0.12, -H / 2 - 0.12, -W / 2 - 0.12, -H / 2 + 0.8, 'F.SilkS'),
  line(W / 2 + 0.12, H / 2 + 0.12, W / 2 - 0.8, H / 2 + 0.12, 'F.SilkS'),
  line(W / 2 + 0.12, H / 2 + 0.12, W / 2 + 0.12, H / 2 - 0.8, 'F.SilkS'),
  `\t(fp_circle (center ${-W / 2 - 0.45} ${-H / 2 - 0.45}) (end ${-W / 2 - 0.35} ${-H / 2 - 0.45}) (stroke (width 0.2) (type solid)) (fill solid) (layer "F.SilkS"))`,
  `\t(fp_text reference "REF**" (at 0 ${-H / 2 - 1}) (layer "F.SilkS") (effects (font (size 0.8 0.8) (thickness 0.12))))`,
  `\t(fp_text value "BGT60TR13C" (at 0 ${H / 2 + 1}) (layer "F.Fab") (effects (font (size 0.8 0.8) (thickness 0.12))))`,
  ...BALLS.map((b) => { const p = pos(b); return `\t(pad "${b}" smd circle (at ${p.x} ${p.y}) (size ${PAD} ${PAD}) (layers "F.Cu" "F.Mask" "F.Paste"))`; }),
  ')',
  '',
];

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, '..', 'footprints', 'BGT60TR13C_PG-VF2BGA-40.kicad_mod');
writeFileSync(file, out.join('\n'));
console.log(JSON.stringify({ ok: true, file, pads: BALLS.length }));
