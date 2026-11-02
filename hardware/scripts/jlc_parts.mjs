// Every part on the board with its LCSC / JLCPCB part number. Single source for the schematic properties,
// the JLCPCB BOM and the order notes. Looked up on jlcpcb.com parts search on 2026-11-02 (stock at that time).
// basic = JLCPCB basic library (no setup fee); extended = $3 setup fee per unique part.
export const PARTS = [
  // key: value as on the schematic + footprint
  { value: 'RP2040', footprint: 'QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm', lcsc: 'C2040', mpn: 'RP2040', lib: 'extended', stock: 60790 },
  { value: 'BGT60TR13C', footprint: 'BGT60TR13C_PG-VF2BGA-40', lcsc: 'C3606641', mpn: 'BGT60TR13CE6327XUMA1', lib: 'extended', stock: 82 },
  { value: 'W25Q16JWSNIQ', footprint: 'SOIC-8_3.9x4.9mm_P1.27mm', lcsc: 'C7117004', mpn: 'W25Q16JWSNIQ', lib: 'extended', stock: 1460 },
  { value: 'TLV62569DBVR', footprint: 'SOT-23-5', lcsc: 'C141836', mpn: 'TLV62569DBVR', lib: 'extended', stock: 280113 },
  { value: 'TPS7A2018PDBVR', footprint: 'SOT-23-5', lcsc: 'C963430', mpn: 'TPS7A2018PDBVR', lib: 'extended', stock: 10948 },
  { value: 'TPS7A2033PDBVR', footprint: 'SOT-23-5', lcsc: 'C2862740', mpn: 'TPS7A2033PDBVR', lib: 'extended', stock: 133294 },
  { value: '7X80000600 80MHz 1.8V', footprint: 'Oscillator_SMD_Abracon_ASE-4Pin_3.2x2.5mm', lcsc: 'C5203597', mpn: 'TXC 7X80000600', lib: 'extended', stock: 2173 },
  { value: '12MHz', footprint: 'Crystal_SMD_3225-4Pin_3.2x2.5mm', lcsc: 'C20625731', mpn: 'ABM8-272-T3 (10 pF)', lib: 'extended', stock: 9181 },
  { value: 'USB-C plug (Molex 105444)', footprint: 'USB_C_Plug_Molex_105444', lcsc: 'C134082', mpn: 'Molex 1054440001', lib: 'extended', stock: 3370 },
  { value: 'BOOTSEL', footprint: 'SW_SPST_B3U-1000P', lcsc: 'C231329', mpn: 'Omron B3U-1000P', lib: 'extended', stock: 87869 },
  { value: '2.2uH 1.5A', footprint: 'L_1008_2520Metric', lcsc: 'C98350', mpn: 'WPN252012H2R2MT (2.2 uH, 1.9 A)', lib: 'extended', stock: 38108 },
  { value: 'BLM15PX601SN1 600R', footprint: 'L_0402_1005Metric', lcsc: 'C160977', mpn: 'Murata BLM15PX601SN1D', lib: 'extended', stock: 82053 },
  { value: 'red', footprint: 'LED_0603_1608Metric', lcsc: 'C2286', mpn: 'KT-0603R', lib: 'basic', stock: 6980726 },
  { value: '10uF', footprint: 'C_0805_2012Metric', lcsc: 'C15850', mpn: 'CL21A106KAYNNNE 25V X5R', lib: 'basic', stock: 8090801 },
  { value: '4.7uF', footprint: 'C_0603_1608Metric', lcsc: 'C19666', mpn: 'CL10A475KO8NNNC 16V X5R', lib: 'basic', stock: 4070647 },
  { value: '2.2uF', footprint: 'C_0603_1608Metric', lcsc: 'C23630', mpn: 'CL10A225KO8NNNC 16V X5R', lib: 'basic', stock: 2769287 },
  { value: '1uF', footprint: 'C_0402_1005Metric', lcsc: 'C52923', mpn: 'CL05A105KA5NQNC 25V X5R', lib: 'basic', stock: 10663987 },
  { value: '470nF', footprint: 'C_0402_1005Metric', lcsc: 'C47339', mpn: 'CL05A474KP5NNNC 10V X5R', lib: 'extended', stock: 671263 },
  { value: '100nF', footprint: 'C_0402_1005Metric', lcsc: 'C1525', mpn: 'CL05B104KO5NNNC 16V X7R', lib: 'basic', stock: 34991117 },
  { value: '15pF', footprint: 'C_0402_1005Metric', lcsc: 'C1548', mpn: '0402CG150J500NT 50V C0G', lib: 'basic', stock: 1318381 },
  { value: '5.1k', footprint: 'R_0402_1005Metric', lcsc: 'C25905', mpn: '0402WGF5101TCE 1%', lib: 'basic', stock: 4976542 },
  { value: '27R', footprint: 'R_0402_1005Metric', lcsc: 'C25100', mpn: '0402WGF270JTCE', lib: 'extended', stock: 38554 },
  { value: '100k', footprint: 'R_0402_1005Metric', lcsc: 'C25741', mpn: '0402WGF1003TCE 1%', lib: 'basic', stock: 7924158 },
  { value: '35.7k', footprint: 'R_0402_1005Metric', lcsc: 'C2998133', mpn: 'FRC0402F3572TS 1%', lib: 'extended', stock: 66173 },
  { value: '1k', footprint: 'R_0402_1005Metric', lcsc: 'C11702', mpn: '0402WGF1001TCE 1%', lib: 'basic', stock: 21117192 },
  { value: '10k', footprint: 'R_0402_1005Metric', lcsc: 'C25744', mpn: '0402WGF1002TCE 1%', lib: 'basic', stock: 16138954 },
  { value: '22R', footprint: 'R_0402_1005Metric', lcsc: 'C25092', mpn: '0402WGF220JTCE', lib: 'basic', stock: 2790517 },
];

export function partFor(value, footprint) {
  return PARTS.find((p) => p.value === value && p.footprint === footprint);
}

// JLCPCB placement rotation offsets (degrees, added to the layout rotation) for KiCad-style footprints, from the
// community tables used by JLC tools (pin 1 orientation of JLC's library models). JLCPCB shows every part in its
// placement preview before you pay: confirm pin 1 there, especially U5, U6, U7, X1, Y1, D1 and J1.
export const ROTATION_OFFSETS = [
  [/^SOT-23/, 180],
  [/^QFN-/, 270],
  [/^SOIC-/, 270],
];
