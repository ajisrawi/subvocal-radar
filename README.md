# Subvocal Radar: open 60 GHz silent-speech sensor on a USB-C dongle

An open take on what [The Subvocal Company](https://www.ycombinator.com/companies/the-subvocal-company) (YC F26) is building: low-power radio waves aimed at the face pick up the tiny jaw and lip movements you make while silently mouthing words. This is the sensing half as a 17 x 46 mm USB-C dongle that plugs straight into a PC or a phone. The decoding model is the part you train on recordings from this device.

| | |
|---|---|
| Radar | Infineon BGT60TR13C, 58-63.5 GHz FMCW, 1 Tx / 3 Rx, antennas in the package |
| MCU | Raspberry Pi RP2040, I/O at 1.8 V (the radar's SPI pins are 1.8 V only) |
| USB | USB-C plug. Shows up as a **USB microphone** (no driver on Windows, macOS, Linux, Android, iPhone), a **WebUSB stream** and a **serial console** |
| Board | 4 layers, 0.8 mm thick, 17 x 46 mm, all parts on the top side; designed with openpcb (OpenSchematic, OpenBoard, OpenRoute) |

## How it works

1. The radar sweeps 58.6 to 63.2 GHz every chirp, 8 chirps per frame, 200 frames per second, on all 3 receivers.
2. The RP2040 averages each frame's chirps, computes the first 16 range bins (about 3.5 cm each), removes static reflections, picks the bin with the most motion and combines the three receivers.
3. Each frame gives one complex sample whose phase follows skin displacement: 0.39 mm of motion per radian, so motion of a few micrometres is visible.
4. That signal goes out three ways:
   - **USB microphone**: the complex signal rides on a 2 kHz carrier, so phone and PC audio processing (low-cut filters, auto gain) cannot destroy it. Any app that records a mic can capture it; `host/index.html` decodes it.
   - **WebUSB** (Chrome or Edge on PC and Android): per-frame range profiles of all 3 receivers, or the raw ADC frames, for training data.
   - **Serial console**: commands (`help`, `status`, `preset`, `bin`, `stream`, `reg`, `boot`).

## Folders

| Path | What |
|---|---|
| `hardware/subvocal-radar.opensch.json` | Schematic (OpenSchematic). `hardware/subvocal-radar-schematic.pdf` is the printable version |
| `hardware/subvocal-radar.openboard.json` | PCB (OpenBoard) |
| `hardware/jlcpcb/` | **Ready-to-order JLCPCB package**: Gerbers, BOM with LCSC part numbers, placement file, and [ORDER.md](hardware/jlcpcb/ORDER.md) with every option to pick |
| `hardware/fab/` | Raw openpcb outputs: Gerbers + drill (zip), generic BOM/CPL, STEP model |
| `hardware/footprints/` | BGT60TR13C footprint (from the datasheet ball map) |
| `hardware/scripts/` | Scripts that regenerate the schematic, footprint and board from scratch |
| `firmware/` | RP2040 firmware (Pico SDK 2.3, TinyUSB 0.18). Ready-to-flash file: `firmware/release/subvocal_radar.uf2` |
| `docs/FLASHING.md` | How to install and update the firmware |
| `host/index.html` | Viewer and recorder for PC, Android and iPhone (single file, no install) |
| `apps/` | **Subvocal apps for Windows and Android**: hold a key or bubble, mouth a trained phrase, and it is typed into any text field. See [apps/README.md](apps/README.md) |

## Rebuild the hardware

Needs Node.js, KiCad 10 (only for its footprint library) and openpcb (`C:\Users\ahmad\Documents\PCB Router 2022`, or set `OPENPCB_DIR`).

```bash
node hardware/scripts/make_schematic.mjs
node hardware/scripts/make_bgt60_footprint.mjs
node hardware/scripts/make_board.mjs
node hardware/scripts/make_jlc.mjs      # JLCPCB order package in hardware/jlcpcb/
```

`make_board.mjs` creates the 4-layer board, imports footprints, transfers the schematic, places parts, routes with OpenRoute (lattice pass, gridless finish, a pass that keeps the copper and adds the remaining plane vias), runs DRC and the pour connectivity check, and writes the fab files.

Stack-up: F.Cu (radar, MCU, signals) / In1.Cu solid GND / In2.Cu signals / B.Cu signals. Nothing but ground sits under the radar (Infineon's layout rule).

## Install the firmware

Full guide: **[docs/FLASHING.md](docs/FLASHING.md)** (first install, checking it works, updates, recovery, SWD, building).

Short version:

1. Plug the dongle into a computer. A new board appears as a USB drive called **RPI-RP2**. On a board that already has firmware, hold **BOOT** (SW1, left edge) while plugging in, or type `boot` in the console.
2. Copy **`firmware/release/subvocal_radar.uf2`** onto that drive.
3. The dongle restarts as **Subvocal Radar** (Radar Microphone + Radar Console + WebUSB). Type `status` in the console to check it.

To build the `.uf2` yourself on Windows, run `firmware\build.ps1` (details in the guide).

## Use it

- **Phone or PC, any browser**: serve `host/` over HTTPS or `localhost` (for example `npx serve host`), open it, press Start and pick "Radar Microphone". Mouth words silently; the trace shows jaw and lip motion in millimetres. Record labelled 2-second takes and download them as JSON.
- **Chrome or Edge on PC and Android**: Connect under WebUSB for the range-vs-time view and raw recordings.
- Placement: the radar looks straight out of the top face of the board. Point it at your jaw and lips from 3 to 15 cm (a short USB-C extension lets you clip it to a collar or glasses arm).

## Status and things to check before ordering

- The schematic passes ERC; the board passes DRC and the pour connectivity check (see `hardware/drc.json`). Routing is automatic, so review the radar fan-out and the USB pair before ordering.
- The firmware has **not been compiled or run on hardware yet**. Expect bring-up fixes.
- The wide sweep preset was computed from the datasheet formulas, which reproduce Infineon's own preset exactly. If the chip misbehaves, `preset narrow` falls back to Infineon's configuration.
- USB IDs are the pid.codes test pair (0x1209:0x0001). Get your own PID before making more than a few.
- 60 GHz radar is legal for this use in the US (FCC 15.255) and EU (57-64 GHz SRD) at this power level. Check your local rules.

## Licenses

Radar register access is ported from Infineon's `sensor-xensiv-bgt60trxx` (Apache-2.0). USB descriptors follow TinyUSB examples (MIT). Everything else here: MIT.
