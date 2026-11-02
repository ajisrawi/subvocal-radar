// BGT60TR13C register presets.
//
// PRESET_NARROW is Infineon's own 3-Rx configuration (BGT60 register configurator SDK 3.6.4, posted by an Infineon
// moderator on the Infineon developer forum): 64 samples/chirp, 8 chirps/frame, 3 Rx, 1 Tx, 2.35 MS/s, frame 5.006 ms,
// 61.02-61.48 GHz. Its 0.46 GHz sweep gives 33 cm range bins: fine for presence, too coarse at face distance.
//
// PRESET_WIDE is the same configuration with only the ramp changed (PLL1_0 = start frequency FSU, PLL1_1 = slope RSU,
// RTU unchanged), computed with the datasheet formulas (v2.4.9, section 3.4.2, f_SYSCLK = 80 MHz, N_DIVSET = 20):
//   f_start = 640 MHz * (96 + FSU / 2^20)   ->  FSU = -4653056 (0xB90000) = 58.600 GHz
//   ramp    = 8 * RTU * RSU * 640 MHz / 2^20 ->  RSU = 2925 (0xB6D), RTU = 322  -> 4.599 GHz, ramp ends at 63.199 GHz
// (Check: the same formulas reproduce Infineon's preset: ramp 60.992-61.481 GHz around its 61.020-61.480 GHz ADC window.)
// The ADC window covers ~94 % of the ramp -> ~4.3 GHz effective bandwidth -> ~3.5 cm range bins.
// Stays inside the chip's 58.0-63.5 GHz range and the 57-64 GHz band. Verify on hardware; "preset narrow" falls back.
#pragma once
#include <stdint.h>

#define RADAR_SAMPLES_PER_CHIRP   64
#define RADAR_CHIRPS_PER_FRAME    8
#define RADAR_NUM_RX              3
#define RADAR_FRAME_SAMPLES       (RADAR_SAMPLES_PER_CHIRP * RADAR_CHIRPS_PER_FRAME * RADAR_NUM_RX)   // 1536
#define RADAR_FRAME_BYTES         (RADAR_FRAME_SAMPLES * 3 / 2)                                       // 2304 (12-bit packed)
#define RADAR_FRAME_PERIOD_US     5006

#define RADAR_REG_PLL1_0_NARROW   0x61f4ca68UL
#define RADAR_REG_PLL1_1_NARROW   0x63000137UL
#define RADAR_REG_PLL1_0_WIDE     0x61b90000UL   // addr 0x30 | write bit | FSU 0xB90000
#define RADAR_REG_PLL1_1_WIDE     0x63000b6dUL   // addr 0x31 | write bit | RSU 0x000B6D

#define RADAR_NUM_REGS 38

// Each word: address [31:25], write bit [24], data [23:0] (the SPI write frame itself).
// Defined only in main.c (RADAR_CONFIG_IMPL) so other files do not carry an unused copy.
#ifdef RADAR_CONFIG_IMPL
static const uint32_t RADAR_REGS_NARROW[RADAR_NUM_REGS] = {
    0x011e8270UL, 0x03088210UL, 0x09e967fdUL, 0x0b0805b4UL, 0x0d1027ffUL, 0x0f010d00UL, 0x11000000UL, 0x13000000UL,
    0x15000000UL, 0x17000be0UL, 0x19000000UL, 0x1b000000UL, 0x1d000000UL, 0x1f000b60UL, 0x2113fc51UL, 0x237ff41fUL,
    0x25006f7bUL, 0x2d000490UL, 0x3b000480UL, 0x49000480UL, 0x57000480UL, 0x5911be0eUL, 0x5b44340aUL, 0x5d007000UL,
    0x5f787e1eUL, RADAR_REG_PLL1_0_NARROW, RADAR_REG_PLL1_1_NARROW, 0x65000142UL, 0x67000040UL, 0x69000000UL,
    0x6b000000UL, 0x6d000000UL, 0x6f0d7910UL, 0x7f000100UL, 0x8f000100UL, 0x9f000100UL, 0xad000000UL, 0xb7000000UL,
};
#endif

typedef enum { PRESET_WIDE = 0, PRESET_NARROW = 1 } radar_preset_t;

// Range per FFT bin (64-point FFT of 64 samples), metres, for reporting.
#define RADAR_BIN_M_WIDE    0.035f
#define RADAR_BIN_M_NARROW  0.326f
