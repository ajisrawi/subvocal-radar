// Board header for the SubvocalRadar dongle (hardware/subvocal-radar.opensch.json).
// RP2040 IOVDD is 1.8 V because the BGT60TR13C's SPI pins are 1.8 V only (absolute max 2.0 V).

// pico_cmake_set PICO_PLATFORM=rp2040

#ifndef _BOARDS_SUBVOCAL_RADAR_H
#define _BOARDS_SUBVOCAL_RADAR_H

// W25Q16JW speaks the same QSPI command set as the W25Q080 boot stage 2 expects
#ifndef PICO_BOOT_STAGE2_CHOOSE_W25Q080
#define PICO_BOOT_STAGE2_CHOOSE_W25Q080 1
#endif
#ifndef PICO_FLASH_SPI_CLKDIV
#define PICO_FLASH_SPI_CLKDIV 4
#endif

// pico_cmake_set_default PICO_FLASH_SIZE_BYTES = (2 * 1024 * 1024)
#ifndef PICO_FLASH_SIZE_BYTES
#define PICO_FLASH_SIZE_BYTES (2 * 1024 * 1024)
#endif

#ifndef PICO_XOSC_STARTUP_DELAY_MULTIPLIER
#define PICO_XOSC_STARTUP_DELAY_MULTIPLIER 64
#endif

#ifndef PICO_RP2040_B0_SUPPORTED
#define PICO_RP2040_B0_SUPPORTED 0
#endif

#endif
