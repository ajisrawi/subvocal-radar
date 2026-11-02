// Builds the SubvocalRadar schematic as an OpenSchematic design (subvocal-radar.opensch.json).
// Every pin gets a short wire stub with a net label, so the netlist is defined by the tables below.
// Run: node hardware/scripts/make_schematic.mjs
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const OPENPCB = process.env.OPENPCB_DIR ?? join(homedir(), 'Documents', 'PCB Router 2022');   // openpcb checkout (github.com/ajisrawi/openpcb)
const SCH = `${OPENPCB}/packages/cli/dist/schematic/src/`;
const { newDesign, newPage } = await import(pathToFileURL(SCH + 'model.js'));
const { basicLibrary } = await import(pathToFileURL(SCH + 'library.js'));
const { partFor } = await import('./jlc_parts.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'subvocal-radar.opensch.json');

// ---------------------------------------------------------------- symbols
const LIB = 'SubvocalRadar';
const parts = {};
const PIN_LEN = 100;

/** Box symbol: left/right are lists of [number, name, type]. Pin tips sit on a 100 mil grid. */
function boxPart(name, refPrefix, left, right, props, description) {
  const rows = Math.max(left.length, right.length);
  const longest = Math.max(4, ...[...left, ...right].map((p) => p[1].length));
  const w = Math.ceil((longest * 2 * 45 + 100) / 200) * 200; // room for both pin names
  const h = rows * 100 + 100;
  const pins = [];
  left.forEach(([number, nm, type], i) => pins.push({ number, name: nm, type: type ?? 'passive', x: -w / 2 - PIN_LEN, y: i * 100, length: PIN_LEN, orient: 'left' }));
  right.forEach(([number, nm, type], i) => pins.push({ number, name: nm, type: type ?? 'passive', x: w / 2 + PIN_LEN, y: i * 100, length: PIN_LEN, orient: 'right' }));
  parts[name] = {
    name, refPrefix, props, description,
    units: [{ normal: { graphics: [{ kind: 'rect', x1: -w / 2, y1: -100, x2: w / 2, y2: h - 100 }], pins } }],
  };
}
/** Two-pin symbol (pins "1" left, "2" right). */
function twoPin(name, refPrefix, props, description, names = ['1', '2']) {
  parts[name] = {
    name, refPrefix, props, description,
    units: [{ normal: { graphics: [{ kind: 'rect', x1: -100, y1: -40, x2: 100, y2: 40 }], pins: [
      { number: '1', name: names[0], type: 'passive', x: -200, y: 0, length: 100, orient: 'left' },
      { number: '2', name: names[1], type: 'passive', x: 200, y: 0, length: 100, orient: 'right' },
    ] } }],
  };
}

const P = 'power', I = 'input', O = 'output', B = 'bidirectional', NC = 'no_connect';

// RP2040, QFN-56 (pin numbers from the RP2040 datasheet)
const rpGpio = (n, pin) => [String(pin), `GPIO${n}`, B];
boxPart('RP2040', 'U',
  [
    ['1', 'IOVDD', P], ['10', 'IOVDD', P], ['22', 'IOVDD', P], ['33', 'IOVDD', P], ['42', 'IOVDD', P], ['49', 'IOVDD', P],
    ['23', 'DVDD', P], ['50', 'DVDD', P], ['44', 'VREG_VIN', P], ['45', 'VREG_VOUT', P], ['48', 'USB_VDD', P], ['43', 'ADC_AVDD', P],
    ['20', 'XIN', I], ['21', 'XOUT', O], ['26', 'RUN', I], ['24', 'SWCLK', I], ['25', 'SWD', B], ['19', 'TESTEN', I],
    ['47', 'USB_DP', B], ['46', 'USB_DM', B],
    ['56', 'QSPI_SS', B], ['52', 'QSPI_SCLK', O], ['53', 'QSPI_SD0', B], ['55', 'QSPI_SD1', B], ['54', 'QSPI_SD2', B], ['51', 'QSPI_SD3', B],
    ['57', 'GND', P],
  ],
  [
    rpGpio(0, 2), rpGpio(1, 3), rpGpio(2, 4), rpGpio(3, 5), rpGpio(4, 6), rpGpio(5, 7), rpGpio(6, 8), rpGpio(7, 9),
    rpGpio(8, 11), rpGpio(9, 12), rpGpio(10, 13), rpGpio(11, 14), rpGpio(12, 15), rpGpio(13, 16), rpGpio(14, 17), rpGpio(15, 18),
    rpGpio(16, 27), rpGpio(17, 28), rpGpio(18, 29), rpGpio(19, 30), rpGpio(20, 31), rpGpio(21, 32),
    rpGpio(22, 34), rpGpio(23, 35), rpGpio(24, 36), rpGpio(25, 37), rpGpio(26, 38), rpGpio(27, 39), rpGpio(28, 40), rpGpio(29, 41),
  ],
  { Value: 'RP2040', 'PCB Footprint': 'QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm', MPN: 'RP2040', 'JLCPCB Part #': 'C2040' }, 'Raspberry Pi RP2040 MCU');

// BGT60TR13C, PG-VF2BGA-40-1 (ball map from Infineon datasheet v2.4.9, Table 1)
const VSSRF = ['M7', 'M9', 'L9', 'K9', 'J9', 'H9', 'E9', 'D9', 'C9', 'B9', 'B8', 'A9', 'A8', 'A7', 'A6', 'A5', 'B4', 'A4', 'B3', 'A3'];
boxPart('BGT60TR13C', 'U',
  [
    ['M1', 'VDDRF', P], ['F9', 'VDDRF', P], ['G9', 'VDDRF', P], ['M6', 'VDDVCO', P], ['M4', 'VDDPLL', P], ['M3', 'VDDLF', P],
    ['J1', 'VDDA', P], ['H1', 'VDDD', P], ['L1', 'VAREF', P], ['M2', 'OSC_CLK', I], ['M5', 'DIV_TEST', O],
    ['B1', 'CLK', I], ['G1', 'CS_N', I], ['D1', 'DI', I], ['E1', 'DO', O], ['C1', 'IRQ', O], ['F1', 'DIO3', B],
  ],
  [['A1', 'VSSD', P], ['A2', 'VSSD', P], ['K1', 'VSSA', P], ...VSSRF.map((b) => [b, 'VSSRF', P])],
  { Value: 'BGT60TR13C', 'PCB Footprint': 'BGT60TR13C_PG-VF2BGA-40', MPN: 'BGT60TR13CE6327XUMA1', Manufacturer: 'Infineon' }, '60 GHz FMCW radar, 1 Tx / 3 Rx, antennas in package');

boxPart('TLV62569DBV', 'U', [['4', 'VIN', P], ['1', 'EN', I], ['2', 'GND', P]], [['3', 'SW', O], ['5', 'FB', I]],
  { Value: 'TLV62569DBVR', 'PCB Footprint': 'SOT-23-5', MPN: 'TLV62569DBVR' }, '2 A buck converter, 1.5 MHz');
boxPart('TPS7A20DBV', 'U', [['1', 'IN', P], ['3', 'EN', I], ['2', 'GND', P]], [['5', 'OUT', P], ['4', 'NC', NC]],
  { Value: 'TPS7A2018PDBVR', 'PCB Footprint': 'SOT-23-5' }, '300 mA ultra-low-noise LDO (7 uVrms)');
boxPart('W25Q16JW', 'U', [['1', '/CS', I], ['6', 'CLK', I], ['5', 'IO0', B], ['2', 'IO1', B], ['3', 'IO2', B], ['7', 'IO3', B]], [['8', 'VCC', P], ['4', 'GND', P]],
  { Value: 'W25Q16JWSNIQ', 'PCB Footprint': 'SOIC-8_3.9x4.9mm_P1.27mm', MPN: 'W25Q16JWSNIQ' }, '16 Mbit 1.8 V QSPI flash');
boxPart('OSC_4PIN', 'X', [['4', 'VDD', P], ['1', 'OE', I], ['2', 'GND', P]], [['3', 'OUT', O]],
  { Value: '7X80000600 80MHz 1.8V', 'PCB Footprint': 'Oscillator_SMD_Abracon_ASE-4Pin_3.2x2.5mm', MPN: 'TXC 7X80000600' }, '80 MHz 1.8 V CMOS oscillator (radar reference)');
boxPart('XTAL_4PIN', 'Y', [['1', 'X1', 'passive'], ['3', 'X2', 'passive']], [['2', 'GND', 'passive'], ['4', 'GND', 'passive']],
  { Value: '12MHz', 'PCB Footprint': 'Crystal_SMD_3225-4Pin_3.2x2.5mm', MPN: 'ABM8-272-T3' }, '12 MHz crystal, CL 10 pF');
boxPart('USB_C_PLUG_A', 'J',
  [['A4', 'VBUS', P], ['A9', 'VBUS', P], ['A5', 'CC', B], ['A6', 'D+', B], ['A7', 'D-', B]],
  [['A1', 'GND', P], ['A12', 'GND', P], ['SH', 'SHIELD', 'passive'], ['A2', 'TX1+', NC], ['A3', 'TX1-', NC], ['A8', 'SBU1', NC], ['A10', 'RX2-', NC], ['A11', 'RX2+', NC]],
  { Value: 'USB-C plug (Molex 105444)', 'PCB Footprint': 'USB_C_Plug_Molex_105444', MPN: '1054440001' }, 'USB Type-C plug, top-side contacts');
boxPart('USB_C_PLUG_B', 'J',
  [['B4', 'VBUS', P], ['B9', 'VBUS', P], ['B5', 'VCONN', NC]],
  [['B1', 'GND', P], ['B12', 'GND', P], ['B2', 'TX2+', NC], ['B3', 'TX2-', NC], ['B8', 'SBU2', NC], ['B10', 'RX1-', NC], ['B11', 'RX1+', NC]],
  { Value: 'DNP (J1 bottom contacts)', 'PCB Footprint': 'USB_C_Plug_Molex_105444_B' }, 'Bottom-side contact row of J1 (same physical part)');
boxPart('SW_PUSH', 'SW', [['1', '1', 'passive']], [['2', '2', 'passive']],
  { Value: 'BOOTSEL', 'PCB Footprint': 'SW_SPST_B3U-1000P', MPN: 'B3U-1000P' }, 'Tactile switch');
twoPin('TP', 'TP', { Value: 'TP', 'PCB Footprint': 'TestPoint_Pad_D1.0mm' }, 'Test pad');
parts.TP.units[0].normal.pins = [parts.TP.units[0].normal.pins[0]];
twoPin('LED', 'D', { Value: 'red', 'PCB Footprint': 'LED_0603_1608Metric' }, 'LED (pin 1 = cathode)', ['K', 'A']);

// ---------------------------------------------------------------- design
const d = newDesign('subvocal-radar');
d.libraries.push(basicLibrary());
d.libraries.push({ name: LIB, parts });
const sch = d.schematics[0];
const pageDefs = ['USB_Power', 'MCU', 'Radar'];
sch.pages = pageDefs.map((n) => newPage(n, 'A2'));
const page = Object.fromEntries(pageDefs.map((n, i) => [n, sch.pages[i]]));
for (const [n, pg] of Object.entries(page)) pg.title = { Title: `Subvocal radar dongle - ${n.replace('_', ' / ')}`, Revision: 'A', Company: 'SubvocalRadar (open hardware)', Date: '2026-11-02' };

let nextId = 1;
const id = () => nextId++;
const libOf = (part) => (parts[part] ? LIB : 'OpenSch');
const pinsOf = (part) => (parts[part] ?? basicLibrary().parts[part]).units[0].normal.pins;

/**
 * Place a part and connect pins: conn maps pin number -> net name, or null for a no-connect.
 * Pins missing from conn are an error (so every pin is accounted for).
 */
function place(pg, part, ref, x, y, conn, props = {}) {
  const pi = { id: id(), lib: libOf(part), part, unit: 0, ref, x, y, rot: 0, props };
  pg.parts.push(pi);
  for (const pin of pinsOf(part)) {
    if (!(pin.number in conn)) throw new Error(`${ref}: pin ${pin.number} (${pin.name}) not assigned`);
    const net = conn[pin.number];
    const tip = { x: x + pin.x, y: y + pin.y };
    if (net === null) { pg.noConnects.push({ id: id(), at: tip }); continue; }
    const dx = pin.orient === 'left' ? -1 : pin.orient === 'right' ? 1 : 0;
    const dy = pin.orient === 'up' ? -1 : pin.orient === 'down' ? 1 : 0;
    const end = { x: tip.x + dx * 200, y: tip.y + dy * 200 };
    const w = { id: id(), pts: [tip, end] };
    pg.wires.push(w);
    pg.aliases.push({ id: id(), at: end, name: net, wire: w.id });
  }
  for (const k of Object.keys(conn)) if (!pinsOf(part).some((p) => p.number === k)) throw new Error(`${ref}: no pin ${k}`);
  return pi;
}
const R = (pg, ref, x, y, a, b, value, fp = 'R_0402_1005Metric') => place(pg, 'R', ref, x, y, { 1: a, 2: b }, { Value: value, 'PCB Footprint': fp });
const C = (pg, ref, x, y, a, value, fp = 'C_0402_1005Metric') => place(pg, 'C', ref, x, y, { 1: a, 2: 'GND' }, { Value: value, 'PCB Footprint': fp });
const FB = (pg, ref, x, y, a, b) => place(pg, 'FB', ref, x, y, { 1: a, 2: b }, { Value: 'BLM15PX601SN1 600R', 'PCB Footprint': 'L_0402_1005Metric' });

// ----- USB and power ------------------------------------------------------
{
  const pg = page.USB_Power;
  place(pg, 'USB_C_PLUG_A', 'J1', 1500, 1500, { A4: 'VBUS', A9: 'VBUS', A5: 'USB_CC', A6: 'USB_C_DP', A7: 'USB_C_DM', A1: 'GND', A12: 'GND', SH: 'GND', A2: null, A3: null, A8: null, A10: null, A11: null });
  place(pg, 'USB_C_PLUG_B', 'J1B', 1500, 3000, { B4: 'VBUS', B9: 'VBUS', B5: null, B1: 'GND', B12: 'GND', B2: null, B3: null, B8: null, B10: null, B11: null }, { Value: 'DNP' });
  R(pg, 'R1', 3200, 1300, 'USB_CC', 'GND', '5.1k');                    // Rd: sink (device) on CC
  R(pg, 'R2', 3200, 1600, 'USB_C_DP', 'USB_DP', '27R');
  R(pg, 'R3', 3200, 1900, 'USB_C_DM', 'USB_DM', '27R');
  C(pg, 'C1', 3200, 2300, 'VBUS', '10uF', 'C_0805_2012Metric');

  // 5 V -> 2.3 V buck (pre-regulator for the low-noise 1.8 V LDOs)
  place(pg, 'TLV62569DBV', 'U1', 5500, 1500, { 4: 'VBUS', 1: 'VBUS', 2: 'GND', 3: 'BUCK_SW', 5: 'BUCK_FB' });
  C(pg, 'C2', 5500, 2300, 'VBUS', '4.7uF', 'C_0603_1608Metric');
  place(pg, 'L', 'L1', 7300, 1500, { 1: 'BUCK_SW', 2: '+2V3' }, { Value: '2.2uH 1.5A', 'PCB Footprint': 'L_1008_2520Metric' });
  R(pg, 'R4', 7300, 1900, '+2V3', 'BUCK_FB', '100k');                   // Vout = 0.6 V * (1 + 100k/35.7k) = 2.28 V
  R(pg, 'R5', 7300, 2200, 'BUCK_FB', 'GND', '35.7k');
  C(pg, 'C3', 7300, 2600, '+2V3', '10uF', 'C_0805_2012Metric');

  // 2.3 V -> 1.8 V, radar RF domains (VDDRF, VDDVCO, VDDPLL)
  place(pg, 'TPS7A20DBV', 'U2', 5500, 3300, { 1: '+2V3', 3: '+2V3', 2: 'GND', 5: '+1V8_RF', 4: null }, { Value: 'TPS7A2018PDBVR' });
  C(pg, 'C4', 5500, 4000, '+2V3', '1uF');
  C(pg, 'C5', 7300, 3300, '+1V8_RF', '2.2uF', 'C_0603_1608Metric');
  // 2.3 V -> 1.8 V, digital/analog (RP2040 IOVDD, flash, radar VDDA/VDDD, oscillator)
  place(pg, 'TPS7A20DBV', 'U3', 5500, 4700, { 1: '+2V3', 3: '+2V3', 2: 'GND', 5: '+1V8', 4: null }, { Value: 'TPS7A2018PDBVR' });
  C(pg, 'C6', 5500, 5400, '+2V3', '1uF');
  C(pg, 'C7', 7300, 4700, '+1V8', '2.2uF', 'C_0603_1608Metric');
  // 5 V -> 3.3 V (RP2040 USB PHY + core regulator input, radar VDDLF, power LED)
  place(pg, 'TPS7A20DBV', 'U4', 5500, 6100, { 1: 'VBUS', 3: 'VBUS', 2: 'GND', 5: '+3V3', 4: null }, { Value: 'TPS7A2033PDBVR' });
  C(pg, 'C8', 5500, 6800, 'VBUS', '1uF');
  C(pg, 'C9', 7300, 6100, '+3V3', '1uF');
  R(pg, 'R6', 3200, 6100, '+3V3', 'LED_A', '1k');
  place(pg, 'LED', 'D1', 3200, 6500, { 1: 'GND', 2: 'LED_A' });
}

// ----- MCU ----------------------------------------------------------------
{
  const pg = page.MCU;
  const gpioNc = Object.fromEntries([2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 34, 35, 36, 37, 38, 39, 40, 41].map((n) => [String(n), null]));
  place(pg, 'RP2040', 'U5', 2500, 1000, {
    1: '+1V8', 10: '+1V8', 22: '+1V8', 33: '+1V8', 42: '+1V8', 49: '+1V8',     // IOVDD at 1.8 V: radar IO is 1.8 V only
    23: '+1V1', 50: '+1V1', 45: '+1V1', 44: '+3V3', 48: '+3V3', 43: '+1V8',
    20: 'XIN', 21: 'XOUT', 26: 'RUN', 24: 'SWCLK', 25: 'SWDIO', 19: 'GND',
    47: 'USB_DP', 46: 'USB_DM',
    56: 'QSPI_SS', 52: 'QSPI_SCLK', 53: 'QSPI_SD0', 55: 'QSPI_SD1', 54: 'QSPI_SD2', 51: 'QSPI_SD3', 57: 'GND',
    27: 'RAD_MISO', 28: 'RAD_CS', 29: 'RAD_SCK', 30: 'RAD_MOSI', 31: 'RAD_RST', 32: 'RAD_IRQ',
    ...gpioNc,
  });
  // decoupling: one 100 nF per IOVDD pin, DVDD, regulator in/out
  ['C10', 'C11', 'C12', 'C13', 'C14', 'C15'].forEach((r, i) => C(pg, r, 5200, 600 + i * 300, '+1V8', '100nF'));
  C(pg, 'C16', 5200, 2600, '+1V1', '100nF');
  C(pg, 'C17', 5200, 2900, '+1V1', '100nF');
  C(pg, 'C18', 5200, 3200, '+1V1', '1uF');
  C(pg, 'C19', 5200, 3500, '+3V3', '1uF');
  C(pg, 'C20', 5200, 3800, '+3V3', '100nF');
  C(pg, 'C21', 5200, 4100, '+1V8', '100nF');

  place(pg, 'XTAL_4PIN', 'Y1', 7000, 1000, { 1: 'XIN', 3: 'XTAL_O', 2: 'GND', 4: 'GND' });
  R(pg, 'R7', 7000, 1700, 'XOUT', 'XTAL_O', '1k');
  C(pg, 'C22', 7000, 2000, 'XIN', '15pF');
  C(pg, 'C23', 7000, 2300, 'XTAL_O', '15pF');

  place(pg, 'W25Q16JW', 'U6', 7300, 3200, { 1: 'QSPI_SS', 6: 'QSPI_SCLK', 5: 'QSPI_SD0', 2: 'QSPI_SD1', 3: 'QSPI_SD2', 7: 'QSPI_SD3', 8: '+1V8', 4: 'GND' });
  C(pg, 'C24', 7300, 4100, '+1V8', '100nF');
  place(pg, 'SW_PUSH', 'SW1', 7300, 4600, { 1: 'BOOT_N', 2: 'GND' });
  R(pg, 'R8', 7300, 5000, 'BOOT_N', 'QSPI_SS', '1k');
  R(pg, 'R9', 7300, 5300, 'RUN', '+1V8', '10k');
  place(pg, 'TP', 'TP1', 8800, 4600, { 1: 'SWCLK' });
  place(pg, 'TP', 'TP2', 8800, 4900, { 1: 'SWDIO' });
  place(pg, 'TP', 'TP3', 8800, 5200, { 1: 'RUN' });
  place(pg, 'TP', 'TP4', 8800, 5500, { 1: 'GND' });
}

// ----- Radar --------------------------------------------------------------
{
  const pg = page.Radar;
  place(pg, 'BGT60TR13C', 'U7', 3000, 1000, {
    M1: 'VDDRF_R', F9: 'VDDRF_R', G9: 'VDDRF_R', M6: 'VDDVCO_R', M4: 'VDDPLL_R', M3: 'VDDLF_R',
    J1: 'VDDA_R', H1: 'VDDD_R', L1: 'VAREF', M2: 'OSC80', M5: null,
    B1: 'RAD_SCK', G1: 'RAD_CS', D1: 'RAD_MOSI', E1: 'RAD_MISO', C1: 'RAD_IRQ', F1: 'RAD_RST',
    A1: 'GND', A2: 'GND', K1: 'GND', ...Object.fromEntries(VSSRF.map((b) => [b, 'GND'])),
  });
  // pi filters per supply domain (Infineon shield practice); 470 nF at the balls
  FB(pg, 'FB1', 6000, 600, '+1V8_RF', 'VDDRF_R'); C(pg, 'C30', 7500, 600, 'VDDRF_R', '470nF'); C(pg, 'C31', 7500, 900, 'VDDRF_R', '470nF');
  FB(pg, 'FB2', 6000, 1300, '+1V8_RF', 'VDDVCO_R'); C(pg, 'C32', 7500, 1300, 'VDDVCO_R', '470nF');
  FB(pg, 'FB3', 6000, 1700, '+1V8_RF', 'VDDPLL_R'); C(pg, 'C33', 7500, 1700, 'VDDPLL_R', '470nF');
  FB(pg, 'FB4', 6000, 2100, '+1V8', 'VDDA_R'); C(pg, 'C34', 7500, 2100, 'VDDA_R', '1uF');      // Cb1 = 1 uF (datasheet fig. 69)
  C(pg, 'C35', 7500, 2500, 'VAREF', '470nF');                                                   // Cb2 = 470 nF
  FB(pg, 'FB5', 6000, 2900, '+1V8', 'VDDD_R'); C(pg, 'C36', 7500, 2900, 'VDDD_R', '470nF');
  FB(pg, 'FB6', 6000, 3300, '+3V3', 'VDDLF_R'); C(pg, 'C37', 7500, 3300, 'VDDLF_R', '470nF');
  // 80 MHz reference
  FB(pg, 'FB7', 6000, 4000, '+1V8', '+1V8_OSC'); C(pg, 'C38', 7500, 4000, '+1V8_OSC', '100nF');
  place(pg, 'OSC_4PIN', 'X1', 6000, 4700, { 4: '+1V8_OSC', 1: '+1V8_OSC', 2: 'GND', 3: 'OSC80_RAW' });
  R(pg, 'R10', 7500, 4700, 'OSC80_RAW', 'OSC80', '22R');
}

// LCSC / JLCPCB part number on every part (from jlc_parts.mjs); fail if one is missing
const missing = [];
for (const pg of sch.pages) for (const pi of pg.parts) {
  const lp = parts[pi.part] ?? basicLibrary().parts[pi.part];
  const value = pi.props.Value ?? lp.props.Value, fp = pi.props['PCB Footprint'] ?? lp.props['PCB Footprint'];
  if (pi.ref === 'J1B' || pi.ref.startsWith('TP')) continue;   // J1B: bottom row of J1; TP: bare test pads, nothing to place
  const jp = partFor(value, fp);
  if (!jp) { missing.push(`${pi.ref} (${value}, ${fp})`); continue; }
  pi.props['LCSC'] = jp.lcsc; pi.props['MPN'] = jp.mpn;
}
if (missing.length) throw new Error('no LCSC part for: ' + missing.join(', '));
writeFileSync(OUT, JSON.stringify(d, null, 1));
const count = sch.pages.reduce((s, p) => s + p.parts.length, 0);
console.log(JSON.stringify({ ok: true, file: OUT, parts: count }));
