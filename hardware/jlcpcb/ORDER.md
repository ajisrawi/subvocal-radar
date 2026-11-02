# Ordering the Subvocal Radar board from JLCPCB (PCB + assembly)

Everything JLCPCB asks for is in this folder:

| File | Upload where |
|---|---|
| `subvocal-radar-gerbers.zip` | "Add gerber file" on the PCB order page |
| `subvocal-radar-BOM-JLCPCB.csv` | PCB Assembly > "Add BOM File" |
| `subvocal-radar-CPL-JLCPCB.csv` | PCB Assembly > "Add CPL File" |
| `parts.md` | Not uploaded: the part list with LCSC numbers, stock and fees, for your reference |

All parts are on the **top side**, so the cheaper **Economic PCBA** service applies. Every placed part has an LCSC part number from JLCPCB's own stock.

## 1. PCB options

Open <https://cart.jlcpcb.com/quote>, upload `subvocal-radar-gerbers.zip`, then set:

| Option | Choose | Why |
|---|---|---|
| Base material | FR-4 | |
| Layers | **4** | Detected from the Gerbers |
| Dimensions | 17 x 46 mm | Detected from the outline (it includes the USB-C tongue) |
| PCB Qty | 5 (minimum) | |
| Product type | Industrial/Consumer electronics | |
| Different design | 1 | |
| Delivery format | Single PCB | |
| PCB thickness | **0.8 mm** | **Required**: the Molex USB-C plug clamps onto a 0.8 mm board. 1.6 mm will not fit |
| PCB color | Green | Fastest and cheapest; any colour works |
| Silkscreen | White | |
| Surface finish | **ENIG** | Flat pads for the 0.5 mm-pitch radar BGA and the 0.4 mm-pitch RP2040 |
| Outer copper weight | 1 oz | |
| Inner copper weight | 0.5 oz | |
| Specify stackup | No (JLCPCB default for 0.8 mm 4-layer) | USB full speed needs no impedance control |
| Via covering | Tented | |
| Min via hole size/diameter | **0.2 mm / (0.3/0.35 mm)** or smaller | The board uses 0.2 mm drills with 0.45 mm via pads |
| Board outline tolerance | ±0.2 mm (regular) | |
| Mark on PCB | Remove mark | The board is tiny; keeps the order number off it |
| Gold fingers, castellated holes, edge plating | No | |

## 2. Assembly options

Turn on **PCB Assembly**:

| Option | Choose |
|---|---|
| PCBA type | **Economic** |
| Assembly side | **Top side** |
| PCBA Qty | 2 or 5 |
| Tooling holes | Added by JLCPCB |
| Confirm parts placement | **Yes** (a JLCPCB engineer checks every rotation for free before production) |

Then **Next**, upload the BOM and CPL. On the BOM page every line should show its part matched. If one says "out of stock", see "Stock" below.

## 3. Check the placement preview (important)

JLCPCB shows each part drawn on the board. Rotations were preset with the usual JLCPCB corrections (SOT-23: +180°, QFN and SOIC: +270°), but check these against the pin-1 marks on the silkscreen:

- **U7 (BGT60TR13C radar)**: ball A1 is the silkscreen dot at the top-left corner of the chip, with the plug at the bottom.
- **U5 (RP2040)**: rotated 180° on purpose. Pin 1 is at the bottom-right of the chip in the board view.
- **U6 (flash), U1-U4 (regulators), X1 (80 MHz oscillator), Y1 (crystal), D1 (LED)**: pin 1 / cathode on the silkscreen mark.
- **J1 (USB-C plug)**: the plug's mouth must point down, off the board's tongue edge.

To fix a part, rotate it in the preview; JLCPCB saves it with the order.

## 4. The USB-C plug (J1)

J1 is a "clamping plate" plug: the board slides between its two rows of contacts.

- JLCPCB solders the **top row**. It carries everything the dongle uses: D+, D-, CC, VBUS and ground.
- The **bottom row** (pads B1, B4, B9, B12 on the back) only duplicates VBUS and ground. The dongle works without it; soldering those 4 pads by hand afterwards makes the plug stronger.
- If JLCPCB's review says J1 cannot be machine placed, ask them to leave it off (mark it "do not place"). Then solder it by hand: 0.5 mm pitch, with flux and a fine tip.

## 5. Stock and cost

- Check stock again before paying. The radar chip **C3606641 had only 82 in stock**; if it runs out, use "Order parts" / pre-order on JLCPCB's parts page, or global sourcing.
- Basic parts have no setup fee. Each **extended part costs about $3 setup** per order; this board has the extended parts listed in `parts.md`.
- Economic PCBA does X-ray inspection for BGAs like the radar.
- The radar chip is moisture-sensitive (MSL 3); JLCPCB bakes such parts as part of assembly.

## 6. After the boards arrive

1. Plug the dongle into a computer: it appears as the **RPI-RP2** drive.
2. Copy `firmware/release/subvocal_radar.uf2` onto it ([docs/FLASHING.md](../../docs/FLASHING.md)).
3. Type `status` in the console: `chip id 0x000303` and growing `frames` mean the radar works.

## Regenerating this folder

```bash
node hardware/scripts/make_schematic.mjs
node hardware/scripts/make_board.mjs
node hardware/scripts/make_jlc.mjs
```

Part numbers live in `hardware/scripts/jlc_parts.mjs`; the build stops if a placed part has none.
