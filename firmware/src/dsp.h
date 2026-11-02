// Per-frame radar processing on core 1.
#pragma once
#include <stdint.h>
#include "radar_config.h"

#define DSP_BINS 16   // first 16 range bins (wide preset: 0..56 cm)

// One slow-time sample per radar frame (~200 Hz): the moving part of the selected range bin, 3 Rx combined.
typedef struct {
    float i, q;
    uint32_t t_us;      // time the frame was read
    uint16_t seq;
    uint8_t bin;
} slow_sample_t;

// Chirp-averaged complex range profile, per receiver (before static-clutter removal).
typedef struct {
    int16_t iq[RADAR_NUM_RX][DSP_BINS][2];
} range_profile_t;

void dsp_init(void);
void dsp_set_bin(int bin);          // -1 = automatic (strongest motion)
int dsp_bin(void);
void dsp_set_min_bin(int bin);      // lowest bin automatic selection may pick (1 skips the Tx->Rx leakage bin)
void dsp_process(const uint8_t *packed, range_profile_t *prof, slow_sample_t *out);
