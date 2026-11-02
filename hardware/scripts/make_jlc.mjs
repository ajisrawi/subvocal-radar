// Writes the JLCPCB order package (hardware/jlcpcb/) from the routed board:
//   subvocal-radar-gerbers.zip   Gerber X2 + Excellon drill (all 4 copper layers)
//   subvocal-radar-BOM-JLCPCB.csv   Comment, Designator, Footprint, JLCPCB Part #
//   subvocal-radar-CPL-JLCPCB.csv   Designator, Mid X, Mid Y, Layer, Rotation (rotation offsets for JLC's library)
//   parts.md                     what each part is, basic/extended, stock when checked, setup fees
// Run after make_board.mjs:  node hardware/scripts/make_jlc.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PARTS, partFor, ROTATION_OFFSETS } from './jlc_parts.mjs';

const HW = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(HW, 'jlcpcb');
mkdirSync(OUT, { recursive: true });
const board = JSON.parse(readFileSync(join(HW, 'subvocal-radar.openboard.json'), 'utf8'));

const skip = (c) => c.ref === 'J1B' || c.ref.startsWith('TP') || /^DNP/i.test(c.value ?? '');
const placed = board.components.filter((c) => !skip(c));
const missing = placed.filter((c) => !partFor(c.value, c.footprint));
if (missing.length) throw new Error('no LCSC part for: ' + missing.map((c) => `${c.ref} (${c.value}, ${c.footprint})`).join(', '));

const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true });

// ---- BOM: one line per LCSC part
const groups = new Map();
for (const c of placed) {
  const p = partFor(c.value, c.footprint);
  if (!groups.has(p.lcsc)) groups.set(p.lcsc, { p, refs: [] });
  groups.get(p.lcsc).refs.push(c.ref);
}
const bomRows = [...groups.values()].sort((a, b) => natural(a.refs[0], b.refs[0]));
const bom = ['Comment,Designator,Footprint,JLCPCB Part #',
  ...bomRows.map(({ p, refs }) => [p.value, refs.sort(natural).join(','), p.footprint, p.lcsc].map(csv).join(','))];
writeFileSync(join(OUT, 'subvocal-radar-BOM-JLCPCB.csv'), bom.join('\r\n') + '\r\n');

// ---- CPL: board coordinates are the Gerber frame (mm, y up), same as JLC expects
const offset = (fp) => (ROTATION_OFFSETS.find(([re]) => re.test(fp)) ?? [null, 0])[1];
const cpl = ['Designator,Mid X,Mid Y,Layer,Rotation',
  ...placed.slice().sort((a, b) => natural(a.ref, b.ref)).map((c) => {
    const rot = (((c.rot + offset(c.footprint)) % 360) + 360) % 360;
    return [c.ref, `${c.x.toFixed(4)}mm`, `${c.y.toFixed(4)}mm`, c.side === 'back' ? 'Bottom' : 'Top', rot].map(csv).join(',');
  })];
writeFileSync(join(OUT, 'subvocal-radar-CPL-JLCPCB.csv'), cpl.join('\r\n') + '\r\n');

// ---- Gerbers: fresh export, bottom paste emptied (nothing is assembled on the bottom; its pads are bare test pads and
// J1's optional hand-soldered bottom row), then zipped
const OPENPCB = process.env.OPENPCB_DIR ?? join(homedir(), 'Documents', 'PCB Router 2022');   // openpcb checkout (github.com/ajisrawi/openpcb)
const gdir = join(OUT, '.gerber-tmp');
rmSync(gdir, { recursive: true, force: true });
execFileSync(process.execPath, [`${OPENPCB}/packages/cli/dist/cli/src/openpcb.js`, 'gerber', join(HW, 'subvocal-radar.openboard.json'), gdir, '--name', 'subvocal-radar'], { encoding: 'utf8' });
const gfiles = readdirSync(gdir).filter((f) => /\.(gbr|drl)$/i.test(f)).sort();
for (const need of ['F_Cu', 'In1_Cu', 'In2_Cu', 'B_Cu', 'F_Mask', 'B_Mask', 'F_Paste', 'F_Silkscreen', 'Edge_Cuts', 'PTH.drl'])
  if (!gfiles.some((f) => f.includes(need))) throw new Error(`Gerber layer missing: ${need}`);
const bpaste = gfiles.find((f) => f.includes('B_Paste'));
if (bpaste) {
  // keep the header and file attributes, drop every flash/draw so the layer is valid but empty
  const keep = readFileSync(join(gdir, bpaste), 'utf8').split('\n').filter((l) => /^(%|G04)/.test(l) && !/^%ADD/.test(l));
  writeFileSync(join(gdir, bpaste), [...keep, 'M02*', ''].join('\n'));
}
writeFileSync(join(OUT, 'subvocal-radar-gerbers.zip'), zipStore(gfiles.map((f) => ({ name: f, data: readFileSync(join(gdir, f)) }))));

// sanity checks on what goes to the fab
const edge = readFileSync(join(gdir, gfiles.find((f) => f.includes('Edge_Cuts'))), 'utf8');
const fmt = /%FSLAX(\d)(\d)Y/.exec(edge); const div = 10 ** (fmt ? +fmt[2] : 6);
const xs = [...edge.matchAll(/X(-?\d+)/g)].map((m) => +m[1] / div), ys = [...edge.matchAll(/Y(-?\d+)/g)].map((m) => +m[1] / div);
const drl = readFileSync(join(gdir, gfiles.find((f) => f.endsWith('PTH.drl'))), 'utf8');
const tools = Object.fromEntries([...drl.matchAll(/^T(\d+)C([\d.]+)/gm)].map((m) => [m[1], +m[2]]));
const holes = {}; let tool = null;
for (const l of drl.split('\n')) { const t = /^T(\d+)\s*$/.exec(l.trim()); if (t) tool = t[1]; else if (/^X/.test(l) && tool) holes[tools[tool]] = (holes[tools[tool]] ?? 0) + 1; }
rmSync(gdir, { recursive: true, force: true });
const gerberCheck = { layers: gfiles, outline_mm: [+(Math.max(...xs) - Math.min(...xs)).toFixed(2), +(Math.max(...ys) - Math.min(...ys)).toFixed(2)], drills_mm: holes };

/** Minimal ZIP writer (stored, no compression): enough for a Gerber upload. */
function zipStore(files) {
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), crc = zlib.crc32(f.data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6); h.writeUInt16LE(0, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x5821, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(f.data.length, 18); h.writeUInt32LE(f.data.length, 22);
    h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    parts.push(h, name, f.data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x5821, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(f.data.length, 20); c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, name);
    off += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

// ---- parts summary
const used = bomRows.map(({ p, refs }) => ({ ...p, qty: refs.length, refs }));
const ext = used.filter((p) => p.lib === 'extended');
const top = placed.filter((c) => c.side !== 'back').length, bottom = placed.length - top;
const md = [
  '# Parts (LCSC / JLCPCB)', '',
  `${used.length} unique parts, ${placed.length} placements (${top} top, ${bottom} bottom). ` +
  `${ext.length} extended parts: JLCPCB charges a setup fee for each (about $3 per extended part per order); basic parts have none.`, '',
  'Stock as seen on jlcpcb.com on 2026-11-02. Check again before ordering; the radar chip (C3606641) had only 82 in stock.', '',
  '| LCSC | Part | Value | Qty | Designators | Library | Stock |', '|---|---|---|---|---|---|---|',
  ...used.map((p) => `| [${p.lcsc}](https://jlcpcb.com/partdetail/${p.lcsc}) | ${p.mpn} | ${p.value} | ${p.qty} | ${p.refs.join(', ')} | ${p.lib} | ${p.stock.toLocaleString('en-US')} |`),
  '', 'Not placed: J1B (the bottom contact row of J1, same physical plug) and TP1-TP4 (bare test pads).', '',
];
writeFileSync(join(OUT, 'parts.md'), md.join('\n'));

if (bottom) throw new Error(`${bottom} parts are on the bottom: Economic PCBA assembles one side only`);
console.log(JSON.stringify({ ok: true, out: OUT, uniqueParts: used.length, placements: placed.length, top, bottom, extended: ext.length, basic: used.length - ext.length, gerbers: gerberCheck }));
