# Enclosure

A two-part 3D-printable case for the Subvocal Radar board. Closed size: **22.6 × 49.8 × 7.4 mm** (plus the USB-C plug's metal shell sticking out).

| Part | File | Size |
|---|---|---|
| Tray (holds the board) | [`stl/subvocal-radar-tray.stl`](stl/subvocal-radar-tray.stl) | 19.9 × 48.4 × 2.6 mm |
| Lid (slides over the tray) | [`stl/subvocal-radar-lid.stl`](stl/subvocal-radar-lid.stl) | 22.6 × 49.8 × 6.6 mm |

Renders: [`renders/`](renders/). Blender scene: `subvocal-radar-enclosure.blend`.

## Design

- **Radar window.** The lid's top is 1.47 mm thick: half a wavelength in PLA (εr ≈ 2.8) at 61 GHz. Above the radar there is a 2.45 mm air gap, also half a wavelength. Both choices keep the plastic close to invisible to the radar. Do not sand, paint or add labels over the radar window (the area inside the groove ring).
- **USB-C plug.** The case ends flush with the front of the plug housing, so the plug's metal shell inserts fully into a phone or laptop.
- **Fit.** The board drops into the tray on a 1 mm ledge, and the lid's skirt slides over the tray with 0.15 mm clearance (friction fit). A drop of glue or a strip of tape holds it permanently.
- **Openings.** A 1.6 mm pin hole over the BOOT button (press it with a SIM-eject pin) and a 1.2 mm window for the power LED.

## Printing

| Setting | Value |
|---|---|
| Material | **PLA** or PETG (the 1.47 mm window assumes PLA, εr ≈ 2.8; PETG is close enough) |
| Layer height | 0.12-0.16 mm |
| Walls | 3 perimeters |
| Infill | 100 % (the parts are thin) |
| Orientation | Tray: floor on the bed. Lid: top face on the bed (no supports needed) |
| Colour | Any. Avoid carbon-filled or metallic filaments: they block 60 GHz |

If the lid is too tight, scale it 100.5 % in X and Y in the slicer. If it is loose, scale it 99.5 %.

## Rebuild

```bash
node hardware/enclosure/export_board.mjs          # board geometry from the routed layout
python hardware/enclosure/make_board_texture.py   # board textures for the renders
blender -b -P hardware/enclosure/make_enclosure.py -- --renders
```

All dimensions are at the top of `make_enclosure.py`.
