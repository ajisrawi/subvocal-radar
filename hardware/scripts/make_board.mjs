// Builds the SubvocalRadar PCB with openpcb (OpenSchematic -> OpenBoard -> OpenRoute).
//   node hardware/scripts/make_board.mjs            build, place, route, DRC, fab outputs
//   node hardware/scripts/make_board.mjs --no-route stop after placement (for inspection)
// Coordinates are OpenBoard's: millimetres, y grows upwards. Board: 17 x 45 mm (+ plug tongue), USB-C plug at the bottom edge.
// All parts on the top side so JLCPCB can assemble it with Economic (single-sided) PCBA.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OPENPCB = process.env.OPENPCB_DIR ?? join(homedir(), 'Documents', 'PCB Router 2022');   // openpcb checkout (github.com/ajisrawi/openpcb)
const CLI = `${OPENPCB}/packages/cli/dist/cli/src/openpcb.js`;
const KICAD = process.env.KICAD_FOOTPRINTS ?? 'C:/Program Files/KiCad/10.0/share/kicad/footprints';
const HW = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOARD = join(HW, 'subvocal-radar.openboard.json');
const SCH = join(HW, 'subvocal-radar.opensch.json');
const OUT = join(HW, 'fab');
const args = new Set(process.argv.slice(2));

function op(...a) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...a.map(String)], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const last = out.trim().split('\n').pop();
    try { return JSON.parse(last); } catch { return { raw: out }; }
  } catch (e) {
    if (e.status === 2) { try { return JSON.parse(e.stdout.trim().split('\n').pop()); } catch { /* fall through */ } }
    throw new Error(`openpcb ${a.join(' ')} failed:\n${e.stdout ?? ''}${e.stderr ?? ''}`);
  }
}
const load = () => JSON.parse(readFileSync(BOARD, 'utf8'));
const save = (p) => writeFileSync(BOARD, JSON.stringify(p, null, 1));
const log = (msg, o) => console.log(msg, o === undefined ? '' : JSON.stringify(o));

// ---------------------------------------------------------------- 1. new board + footprints
const W = 17, H = 46, EDGE_Y = 1.0;  // main bottom edge at y = 1.0; the plug tongue reaches y = 0.04
if (existsSync(BOARD)) rmSync(BOARD);
op('new', BOARD, '--name', 'subvocal-radar', '--layers', 4, '--width', W, '--height', H);
const kicad = [
  'Package_DFN_QFN.pretty/QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm',
  'Connector_USB.pretty/USB_C_Plug_Molex_105444',
  'Package_TO_SOT_SMD.pretty/SOT-23-5',
  'Package_SO.pretty/SOIC-8_3.9x4.9mm_P1.27mm',
  'Crystal.pretty/Crystal_SMD_3225-4Pin_3.2x2.5mm',
  'Oscillator.pretty/Oscillator_SMD_Abracon_ASE-4Pin_3.2x2.5mm',
  'Button_Switch_SMD.pretty/SW_SPST_B3U-1000P',
  'TestPoint.pretty/TestPoint_Pad_D1.0mm',
  'Capacitor_SMD.pretty/C_0402_1005Metric', 'Capacitor_SMD.pretty/C_0603_1608Metric', 'Capacitor_SMD.pretty/C_0805_2012Metric',
  'Resistor_SMD.pretty/R_0402_1005Metric', 'Inductor_SMD.pretty/L_0402_1005Metric', 'Inductor_SMD.pretty/L_1008_2520Metric',
  'LED_SMD.pretty/LED_0603_1608Metric',
].map((f) => `${KICAD}/${f}.kicad_mod`);
log('import kicad footprints', op('import-footprint', BOARD, ...kicad, join(HW, 'footprints', 'BGT60TR13C_PG-VF2BGA-40.kicad_mod')).names?.length);

{
  const p = load();
  // KiCad paste windows (unnumbered pads inside an exposed pad) come in as extra copper pads: drop them.
  for (const fp of Object.values(p.footprints)) {
    const inside = (a, b) => a !== b && Math.abs(a.x - b.x) + a.w / 2 <= b.w / 2 + 1e-6 && Math.abs(a.y - b.y) + a.h / 2 <= b.h / 2 + 1e-6;
    const before = fp.pads.length;
    fp.pads = fp.pads.filter((a) => !fp.pads.some((b) => b.w * b.h > a.w * a.h && inside(a, b)));
    fp.pads = fp.pads.filter((a) => a.id !== '');
    if (fp.pads.length !== before) log(`  ${fp.name}: removed ${before - fp.pads.length} paste-only pads`);
    // autoplace keeps bodies apart: make each body cover its pads (+0.1 mm), some KiCad bodies are smaller than the pads
    let w = 0, h = 0;
    for (const q of fp.pads) { w = Math.max(w, 2 * (Math.abs(q.x) + q.w / 2) + 0.2); h = Math.max(h, 2 * (Math.abs(q.y) + q.h / 2) + 0.2); }
    fp.body = { w: Math.max(fp.body?.w ?? 0, w), h: Math.max(fp.body?.h ?? 0, h) };
  }
  // USB-C plug: OpenBoard puts all SMD pads of a part on its side, so the bottom contact row is its own footprint
  // (J1B, placed on the back at the same spot). Back placement mirrors x, so pre-mirror the pads.
  const plug = p.footprints.USB_C_Plug_Molex_105444;
  const bRow = plug.pads.filter((q) => q.id.startsWith('B'));
  plug.pads = plug.pads.filter((q) => !q.id.startsWith('B'));
  plug.body = { w: 8.8, h: 4.0 };   // the plug housing over the board (Molex drawing), so autoplace keeps parts off it
  p.footprints.USB_C_Plug_Molex_105444_B = { name: 'USB_C_Plug_Molex_105444_B', pads: bRow.map((q) => ({ ...q, x: -q.x })), outline: [], body: { w: 6.4, h: 1.2 }, outlineKind: 'reference' };
  // board outline with the plug tongue (Molex 105444 drawing: tongue 6.1 mm wide, 0.96 mm into the plug)
  const cx = W / 2;
  p.outline = [
    { x: 0, y: EDGE_Y }, { x: cx - 3.35, y: EDGE_Y }, { x: cx - 3.05, y: EDGE_Y - 0.3 }, { x: cx - 3.05, y: EDGE_Y - 0.66 }, { x: cx - 2.75, y: EDGE_Y - 0.96 },
    { x: cx + 2.75, y: EDGE_Y - 0.96 }, { x: cx + 3.05, y: EDGE_Y - 0.66 }, { x: cx + 3.05, y: EDGE_Y - 0.3 }, { x: cx + 3.35, y: EDGE_Y },
    { x: W, y: EDGE_Y }, { x: W, y: H }, { x: 0, y: H },
  ];
  // stack-up: F.Cu signals + radar, In1 solid GND plane, In2 signals/power, B.Cu signals
  p.layers.find((l) => l.name === 'In1.Cu').type = 'power';
  save(p);
}
// JLCPCB 4-layer capabilities (2026): 0.09 mm track/space, 0.2 mm via drill / 0.45 mm via pad
op('rules', BOARD, '--width', 0.15, '--clearance', 0.1, '--via', 0.45, '--drill', 0.2,
  '--edgeClearance', 0.3, '--minTrackWidth', 0.09, '--minAnnularRing', 0.1, '--holeToCopper', 0.2, '--holeToHole', 0.25,
  '--silkToCopper', 0.1, '--viaLength', 0.8, '--silkWidth', 0.12, '--maskExpansion', 0.05, '--minMaskSliver', 0.08);

// ---------------------------------------------------------------- 2. schematic -> board
const eco = op('sch-to-board', SCH, BOARD);
log('sch-to-board', { added: eco.added?.length, placeholders: eco.placeholders, missingPins: eco.missingPins });
if (eco.placeholders?.length || eco.missingPins?.length) throw new Error('footprint mismatch between schematic and board');
// openpcb stores the board link as an absolute path; keep it relative so the repo does not carry local paths
{ const d = JSON.parse(readFileSync(SCH, 'utf8')); if (d.boardLink) { d.boardLink.project = 'subvocal-radar.openboard.json'; delete d.boardLink.lastSync; writeFileSync(SCH, JSON.stringify(d, null, 1)); } }

// ---------------------------------------------------------------- 3. placement
// Fixed parts (locked): radar at the top, MCU in the middle, plug at the bottom edge.
const fixed = {
  // Single-sided assembly (JLCPCB Economic PCBA): every part on the top side. The bottom only has bare copper:
  // J1B (the plug's bottom contact row, optional hand solder) and the test pads TP1-TP4.
  J1: [W / 2, EDGE_Y, 180, 'front'], J1B: [W / 2, EDGE_Y, 180, 'back'],
  // power (the plug housing covers x 4.1..12.9, y < 3.0). Pad extents were measured from the footprints.
  L1: [2.1, 2.5, 0, 'front'], U1: [2.2, 6.0, 0, 'front'],                    // buck + inductor
  C2: [4.7, 6.2, 90, 'front'], C3: [5.8, 4.0, 0, 'front'],
  R5: [2.2, 9.0, 0, 'front'], R4: [2.2, 10.2, 0, 'front'],                  // buck feedback divider next to its FB pin
  C1: [W / 2, 10.3, 0, 'front'],                                             // VBUS bulk
  R3: [8.0, 4.5, 90, 'front'], R2: [9.0, 4.5, 90, 'front'], R1: [10.0, 4.5, 90, 'front'],   // USB D-/D+ series, CC pull-down: just above the plug pins
  U4: [W / 2, 8.0, 0, 'front'], C8: [6.0, 8.0, 90, 'front'], C9: [10.8, 8.0, 90, 'front'],   // 3.3 V LDO
  U3: [14.8, 6.0, 0, 'front'], C7: [12.3, 5.6, 90, 'front'], C6: [12.2, 7.75, 0, 'front'],  // 1.8 V digital LDO
  U2: [14.8, 10.2, 0, 'front'], C5: [12.3, 10.4, 90, 'front'], C4: [15.6, 12.6, 0, 'front'], // 1.8 V RF LDO
  // MCU
  U6: [W / 2, 14.2, 0, 'front'],          // QSPI flash, SOIC-8
  SW1: [2.0, 13.4, 90, 'front'],          // BOOT button at the left edge
  U5: [W / 2, 21.0, 180, 'front'],        // RP2040 rotated: USB pins face the plug, radar SPI pins face the radar
  // RP2040 decoupling next to its power pins (rotated chip: IOVDD 1/10 on the right, 33/42 on the left, 22/23 on top,
  // 43-50 along the bottom edge, which faces the flash, so those caps sit just beside it)
  C10: [13.4, 18.4, 0, 'front'], C11: [13.4, 22.0, 0, 'front'],          // IOVDD pins 1, 10
  C12: [3.6, 18.4, 0, 'front'], C13: [3.6, 22.0, 0, 'front'],            // IOVDD pins 42, 33
  C14: [9.4, 26.4, 90, 'front'], C16: [7.4, 26.4, 90, 'front'],          // IOVDD 22, DVDD 23
  C15: [13.2, 15.6, 0, 'front'], C17: [13.2, 16.6, 0, 'front'], C20: [13.2, 14.6, 0, 'front'],   // IOVDD 49, DVDD 50, USB_VDD 48
  C18: [3.9, 16.6, 0, 'front'], C19: [3.9, 15.6, 0, 'front'], C21: [3.9, 14.6, 0, 'front'],      // VREG_VOUT 45, VREG_VIN 44, ADC_AVDD 43
  Y1: [12.2, 27.8, 0, 'front'], C23: [15.3, 27.0, 90, 'front'], C22: [15.3, 28.8, 90, 'front'],   // 12 MHz crystal
  // radar
  X1: [W / 2 - 1.6, 32.2, 0, 'front'],    // 80 MHz oscillator below OSC_CLK (ball M2, bottom-left of the radar)
  U7: [W / 2, 41.4, 0, 'front'],          // radar: 5 x 6.5 mm, 1.35 mm from the top edge
  // radar supply caps at their balls (datasheet / Infineon shield practice). Ball map, top view: number-1 column on the left
  // (H1 VDDD y 40.65, J1 VDDA 40.15, L1 VAREF 39.15, M1 VDDRF 38.65), M row along the bottom (M2 OSC x 7.0, M3 VDDLF 7.5,
  // M4 VDDPLL 8.0, M6 VDDVCO 9.0), F9/G9 VDDRF on the right. SPI leaves the left column above y 41.
  // Rotations put each cap's supply pad (pin 1) towards its ball and the GND pad away from the chip.
  C30: [5.4, 38.5, 180, 'front'],             // VDDRF (M1)
  C31: [11.8, 41.4, 90, 'front'],           // VDDRF (F9/G9)
  C37: [7.0, 37.3, 270, 'front'],            // VDDLF (M3)
  C33: [8.0, 37.3, 270, 'front'],            // VDDPLL (M4)
  C32: [9.0, 37.3, 270, 'front'],            // VDDVCO (M6)
  R10: [6.0, 36.5, 90, 'front'],            // 22R series in the 80 MHz clock line to M2
  C35: [5.2, 39.5, 180, 'front'],             // VAREF (L1), 470 nF
  C34: [5.2, 40.5, 180, 'front'],             // VDDA (J1), 1 uF
  C36: [3.6, 40.0, 90, 'front'],            // VDDD (H1)
  C38: [9.4, 32.2, 90, 'front'],            // 80 MHz oscillator supply
  // test pads (bare copper) on the bottom
  TP1: [13.4, 21.0, 0, 'back'], TP2: [15.4, 21.0, 0, 'back'], TP3: [13.4, 19.0, 0, 'back'], TP4: [15.4, 19.0, 0, 'back'],
};
{
  const p = load();
  const backRefs = new Set();   // single-sided: nothing assembled on the bottom
  for (const c of p.components) {
    const f = fixed[c.ref];
    if (f) { [c.x, c.y, c.rot, c.side] = f; c.locked = true; continue; }
    c.side = backRefs.has(c.ref) ? 'back' : 'front';
    c.x = W / 2; c.y = H / 2; c.rot = 0;
  }
  save(p);
}
const unlocked = load().components.filter((c) => !c.locked).map((c) => c.ref);
log('autoplace', op('place', BOARD, '--mode', 'anneal', '--spacing', 0.25, '--grid', 0.05, '--iters', 400, '--seed', 7,
  '--decap', 8, '--weight', 'OSC80=8,VDD.*_R=6,VAREF=6,XIN=6,XTAL_O=6,USB_.*=4,QSPI_.*=3', '--ignore-nets', 'GND').summary ?? unlocked.length);

// keep everything that is not the radar's own GND/supply copper out from under the radar (Infineon: solid GND below the chip)
{
  const p = load();
  const u7 = p.components.find((c) => c.ref === 'U7');
  const x1 = u7.x - 2.5, x2 = u7.x + 2.5, y1 = u7.y - 3.25, y2 = u7.y + 3.25;
  let id = p.nextId;
  for (const layer of ['In2.Cu', 'B.Cu']) p.keepouts.push({ id: id++, layer, kind: 'keepout', rect: { x1, y1, x2, y2 } });
  p.keepouts.push({ id: id++, layer: 'F.Cu', kind: 'keepout', rect: { x1: u7.x - 1.4, y1: u7.y - 2.35, x2: u7.x + 1.4, y2: u7.y + 1.9 } }); // inside the ball ring
  p.nextId = id;
  save(p);
}
op('zone', BOARD, 'GND', 'In1.Cu', 0, 0, W, H);                       // solid ground plane (power layer)
op('class', BOARD, 'POWER', '--nets', 'VBUS,+2V3,BUCK_SW,+1V8_RF,+1V8,+3V3', '--width', 0.3);
op('class', BOARD, 'USB', '--nets', 'USB_DP,USB_DM,USB_C_DP,USB_C_DM', '--width', 0.2, '--priority', 5);
op('region', BOARD, 'BGA', `${W / 2 - 3.2},${41.4 - 3.9},${W / 2 + 3.2},${41.4 + 3.9}`, '--width', 0.1, '--clearance', 0.1);
op('render', BOARD, join(HW, 'board_placed.svg'), '--width', 900);
// stop if a part ended up outside the board outline (the outline has a notch beside the plug tongue)
{
  const p = load();
  const inside = (x, y) => { let c = false; const o = p.outline; for (let i = 0, j = o.length - 1; i < o.length; j = i++) if ((o[i].y > y) !== (o[j].y > y) && x < ((o[j].x - o[i].x) * (y - o[i].y)) / (o[j].y - o[i].y) + o[i].x) c = !c; return c; };
  const out = [];
  for (const c of p.components) {
    if (c.ref === 'J1' || c.ref === 'J1B') continue;   // the plug overhangs the edge by design
    const fp = p.footprints[c.footprint]; const sw = (c.rot % 180 === 0) ? fp.body.w : fp.body.h, sh = (c.rot % 180 === 0) ? fp.body.h : fp.body.w;
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) if (!inside(c.x + dx * sw / 2, c.y + dy * sh / 2)) { out.push(c.ref); break; }
  }
  if (out.length) throw new Error('parts outside the board outline after placement: ' + out.join(', '));
}
// stop if any two pads of different nets touch after placement (routing cannot fix that)
const padClash = (op('drc', BOARD).items ?? []).filter((m) => m.kind === 'clearance' && /^pad .* to pad /.test(m.message));
if (padClash.length) { padClash.forEach((m) => log('  pad clash', [m.layer, m.at, m.message])); if (!args.has('--force')) throw new Error(`${padClash.length} pad clashes after placement`); }
if (args.has('--no-route')) { log('stopped after placement'); process.exit(0); }

// ---------------------------------------------------------------- 4. route + check
const route = op('route', BOARD, '--script', join(HW, 'route.do'), '--log', join(HW, 'route.log'));
log('route (OpenRoute lattice)', { unrouted: route.unrouted, conflicts: route.conflicts, vias: route.vias });
// OpenRoute's gridless shape router finishes what the lattice pass left and cleans up any rule breaks
// (on all nets: restricting it with --nets rips up everything else), then one more lattice pass that keeps the copper
// and adds what the gridless pass dropped, mainly the GND fanout vias down to the In1 plane
const fin = op('route', BOARD, '--gridless', '--finish', '--passes', 30, '--time-limit', 300);
log('route (gridless finish)', { unrouted: fin.unrouted, conflicts: fin.conflicts });
const keep = op('route', BOARD, '--keep', '--passes', 20);
log('route (lattice, keep copper)', { unrouted: keep.unrouted, conflicts: keep.conflicts });
const rats = op('ratsnest', BOARD);
log('open connections before pours', rats.unrouted);
if (rats.unrouted) log('  open', rats.connections.map((c) => c.net));
op('smooth', BOARD);
op('zone', BOARD, 'GND', 'F.Cu', 0, 0, W, H);
op('zone', BOARD, 'GND', 'B.Cu', 0, 0, W, H);
op('stitch', BOARD, '--net', 'GND', '--pitch', 2.0, '--in-zone');
// 0.5 mm pitch plug contacts: no solder-mask web fits between them (one ganged opening, as on any USB-C footprint)
op('waive', BOARD, '--kind', 'mask-sliver', '--match', 'J1-A');
op('waive', BOARD, '--kind', 'mask-sliver', '--match', 'J1B-B');
const drc = op('drc', BOARD);
writeFileSync(join(HW, 'drc.json'), JSON.stringify(drc, null, 1));
log('drc', { violations: drc.violations ?? drc.count, summary: drc.summary });
let pour = op('pourcheck', BOARD);
log('pourcheck (real pour fills)', { opens: pour.opens, nets: pour.nets?.map((n) => [n.net, n.pads]) });
// A pad that only *looks* connected through a pour (its pour island reaches nothing) gets its own via to the In1 plane:
// try spots around the pad and keep the first one that leaves the DRC clean.
if (pour.opens) {
  const { padToBoard } = await import(pathToFileURL(`${OPENPCB}/packages/cli/dist/editor/src/model.js`));
  for (const grp of pour.nets) for (const pin of grp.pads) {
    const p0 = load(); const [ref, padId] = pin.split(/-(?=[^-]+$)/);
    const c = p0.components.find((q) => q.ref === ref); const pad = p0.footprints[c.footprint].pads.find((q) => q.id === padId);
    const at = padToBoard(c, pad); const layer = c.side === 'back' ? 'B.Cu' : 'F.Cu';
    let fixed = false;
    for (const r of [0.55, 0.7, 0.9, 1.1, 1.4]) {
      for (let k = 0; k < 8 && !fixed; k++) {
        const x = +(at.x + r * Math.cos((k * Math.PI) / 4)).toFixed(3), y = +(at.y + r * Math.sin((k * Math.PI) / 4)).toFixed(3);
        const before = readFileSync(BOARD, 'utf8');
        op('via', BOARD, grp.net, x, y); op('trace', BOARD, grp.net, layer, 0.2, at.x, at.y, x, y);
        if ((op('drc', BOARD).violations ?? 1) === 0) fixed = true; else writeFileSync(BOARD, before);
      }
      if (fixed) break;
    }
    log(`  ${pin}: ${fixed ? 'added a plane via' : 'no clean spot for a via'}`);
  }
  pour = op('pourcheck', BOARD);
  log('pourcheck after plane vias', { opens: pour.opens });
}
op('render', BOARD, join(HW, 'board_routed.svg'), '--width', 900, '--no-rats');

// ---------------------------------------------------------------- 5. fabrication outputs
mkdirSync(OUT, { recursive: true });
log('gerber', op('gerber', BOARD, join(OUT, 'gerber'), '--zip', '--name', 'subvocal-radar').files?.length);
log('assembly', op('assembly', BOARD, join(OUT, 'assembly'), '--name', 'subvocal-radar').files);
op('export-step', BOARD, join(OUT, 'subvocal-radar.step'), '--thickness', 0.8);   // 0.8 mm board: required by the USB-C plug
op('sch-pdf', SCH, join(HW, 'subvocal-radar-schematic.pdf'));
op('sch-bom', SCH, join(OUT, 'subvocal-radar-bom-full.csv'));
log('done');
