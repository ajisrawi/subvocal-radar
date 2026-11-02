# Installing the firmware

The dongle's RP2040 has a USB bootloader in ROM, so installing firmware is drag and drop: no programmer, no drivers, and nothing you do here can brick it.

The firmware file is **`firmware/release/subvocal_radar.uf2`** (or build your own, see the end of this page).

## 1. First install (new board)

A freshly assembled board has empty flash, and an RP2040 with empty flash starts its bootloader by itself.

1. Plug the dongle into a computer (Windows, macOS or Linux). Use a computer for this step; phones are for using the dongle afterwards.
2. A USB drive called **RPI-RP2** appears.
3. Copy `subvocal_radar.uf2` onto it (drag and drop).
4. The drive disappears and the dongle restarts as **Subvocal Radar**. It now shows up as:
   - a microphone called **Radar Microphone**,
   - a serial port (**Radar Console**: COM port on Windows, `/dev/tty.usbmodem*` on macOS, `/dev/ttyACM*` on Linux),
   - a WebUSB device (**Radar Stream**). Windows needs no driver for any of these.

The red LED (D1) is a power light: it is on whenever the dongle has power, whatever the firmware is doing.

## 2. Check that it works

Open the console and type `status`:

- **Browser:** serve `host/` (`npx serve host`), open it in Chrome or Edge, press **Connect** under WebUSB and type `status` in the console box.
- **Terminal:** `python -m serial.tools.miniterm COM5 115200` (use your COM port; the baud rate is ignored).

A healthy dongle reports:

```
radar running, preset wide, chip id 0x000303, init 0
frames 12345, errors 0, irq timeouts 0, dropped 0
```

- `chip id 0x000303` means the RP2040 talks to the radar.
- `frames` should grow by about 200 every second.
- `init -1` (chip ID error) points to the radar's supplies, its 80 MHz oscillator (X1) or the SPI connections.
- Growing `irq timeouts` means the radar is configured but no frames arrive. Try `preset narrow` (Infineon's own settings); if that works, the wide sweep needs tuning on your chip.

## 3. Updating the firmware

Either of these puts the dongle back into the bootloader (the **RPI-RP2** drive appears again), then copy the new `.uf2` as in step 1:

- **Software:** type `boot` in the console (browser page or terminal).
- **Button:** unplug the dongle, hold the **BOOT** button (SW1, the small button at the left edge), plug it in, then release.

With [picotool](https://github.com/raspberrypi/picotool) installed, `picotool load subvocal_radar.uf2` followed by `picotool reboot` works while the dongle is in the bootloader.

## 4. If something goes wrong

- **The RPI-RP2 drive never appears:** hold BOOT while plugging in. If it still does not appear, check the 3.3 V rail and the 12 MHz crystal (Y1), and that the flash chip (U6) is a 1.8 V part (W25Q16**JW**).
- **Copying works but the dongle does not come back:** the image may not match the flash chip. Recover with the BOOT button and copy a known-good `.uf2`.
- You cannot brick the RP2040: the bootloader is in ROM, so the BOOT button always gets you back.

## 5. Debugging over SWD (optional)

The bottom side has test pads: **TP1 SWCLK, TP2 SWDIO, TP3 RUN, TP4 GND**.

**This board's I/O runs at 1.8 V.** A Raspberry Pi Debug Probe or a plain Pico running debugprobe drives 3.3 V and can damage the RP2040 and the radar. Use a probe that follows the target voltage instead, for example a SEGGER J-Link with VTref connected to the 1.8 V rail (C7, or any `+1V8` pad), or put a 1.8 V level shifter in between.

## 6. Building the firmware yourself

Windows, with the tools the build script expects in `C:\Users\ahmad\pico-tools` (Arm GNU toolchain 14.2, Pico SDK 2.3.1, picotool 2.3.1; CMake and Ninja on PATH):

```powershell
cd firmware
.\build.ps1            # writes build\subvocal_radar.uf2 and copies it to release\
```

Any OS, by hand:

```bash
cd firmware
cmake -B build -G Ninja -DPICO_SDK_PATH=/path/to/pico-sdk -Dpicotool_DIR=/path/to/picotool
cmake --build build
```

The board definition is in `firmware/boards/subvocal_radar.h`: 1.8 V I/O, W25Q16JW 2 MB flash, 12 MHz crystal.
