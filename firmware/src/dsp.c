// Per-frame radar processing (runs on core 1, ~200 frames/s).
//
//  1. unpack 12-bit samples (two per 3 bytes, Rx1/Rx2/Rx3 interleaved per sample, datasheet fig. 58)
//  2. average the 8 chirps of a frame per receiver (coherent, they are 70 us apart)
//  3. remove the mean, Hann window, DFT of the first DSP_BINS range bins (fixed point)
//  4. per bin and receiver: subtract a slow average (static reflections: face, glasses, Tx->Rx leakage)
//  5. pick the bin with the most motion energy (or a fixed one), phase-align Rx2/Rx3 to Rx1, sum
// The result is one complex sample per frame whose phase follows skin displacement (0.39 mm per radian at 61 GHz).
#include "dsp.h"

#include <math.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
#define N RADAR_SAMPLES_PER_CHIRP

static int16_t cos_q12[N], sin_q12[N], hann_q15[N];
static float ema_i[RADAR_NUM_RX][DSP_BINS], ema_q[RADAR_NUM_RX][DSP_BINS];
static float energy[DSP_BINS];
static float align_i[RADAR_NUM_RX], align_q[RADAR_NUM_RX];   // slow average of y1 * conj(yk) for the current bin
static int cur_bin = 2, fixed_bin = -1, min_bin = 1;
static uint16_t seq;
static uint32_t frames;

void dsp_init(void) {
    for (int k = 0; k < N; k++) {
        float a = 2.0f * (float)M_PI * (float)k / (float)N;
        cos_q12[k] = (int16_t)lrintf(4095.0f * cosf(a));
        sin_q12[k] = (int16_t)lrintf(4095.0f * sinf(a));
        hann_q15[k] = (int16_t)lrintf(32767.0f * 0.5f * (1.0f - cosf(2.0f * (float)M_PI * (float)k / (float)(N - 1))));
    }
    memset(ema_i, 0, sizeof ema_i); memset(ema_q, 0, sizeof ema_q); memset(energy, 0, sizeof energy);
    for (int r = 0; r < RADAR_NUM_RX; r++) { align_i[r] = 1.0f; align_q[r] = 0.0f; }
    frames = 0;
}

void dsp_set_bin(int bin) { fixed_bin = (bin >= 0 && bin < DSP_BINS) ? bin : -1; if (fixed_bin >= 0) cur_bin = fixed_bin; }
int dsp_bin(void) { return cur_bin; }
void dsp_set_min_bin(int bin) { min_bin = bin < 0 ? 0 : bin >= DSP_BINS ? DSP_BINS - 1 : bin; }

static inline int16_t sat16(int32_t v) { return v > 32767 ? 32767 : v < -32768 ? -32768 : (int16_t)v; }

void dsp_process(const uint8_t *packed, range_profile_t *prof, slow_sample_t *out) {
    // 1+2: unpack and average chirps -> acc[rx][sample] (sum of 8 x 12-bit fits easily)
    int32_t acc[RADAR_NUM_RX][N];
    memset(acc, 0, sizeof acc);
    for (int k = 0; k < RADAR_FRAME_SAMPLES / 2; k++) {
        const uint8_t *b = packed + 3 * k;
        int32_t s0 = ((int32_t)b[0] << 4) | (b[1] >> 4);
        int32_t s1 = ((int32_t)(b[1] & 0x0F) << 8) | b[2];
        int idx = 2 * k;                                   // sample index in the frame: (chirp*N + n)*3 + rx
        int n0 = (idx / RADAR_NUM_RX) % N, r0 = idx % RADAR_NUM_RX;
        int n1 = ((idx + 1) / RADAR_NUM_RX) % N, r1 = (idx + 1) % RADAR_NUM_RX;
        acc[r0][n0] += s0;
        acc[r1][n1] += s1;
    }

    float yi[RADAR_NUM_RX][DSP_BINS], yq[RADAR_NUM_RX][DSP_BINS];
    for (int r = 0; r < RADAR_NUM_RX; r++) {
        // 3: mean removal + window, scaled to +-8191 so the Q12 DFT sums fit in 32 bits (8191 * 4096 * 64 < 2^31)
        int32_t mean = 0;
        for (int n = 0; n < N; n++) mean += acc[r][n];
        mean /= N;
        int32_t x[N];
        for (int n = 0; n < N; n++) x[n] = ((acc[r][n] - mean) * hann_q15[n]) >> 17;   // |acc-mean| <= 32760
        for (int b = 0; b < DSP_BINS; b++) {
            int32_t re = 0, im = 0;
            for (int n = 0; n < N; n++) {
                int t = (b * n) & (N - 1);
                re += x[n] * cos_q12[t];
                im -= x[n] * sin_q12[t];
            }
            if (prof) { prof->iq[r][b][0] = sat16(re >> 12); prof->iq[r][b][1] = sat16(im >> 12); }
            // 4: static clutter removal (time constant ~1.3 s at 200 frames/s)
            float fi = (float)re * (1.0f / 4096.0f), fq = (float)im * (1.0f / 4096.0f);
            if (frames == 0) { ema_i[r][b] = fi; ema_q[r][b] = fq; }
            ema_i[r][b] += (fi - ema_i[r][b]) * (1.0f / 256.0f);
            ema_q[r][b] += (fq - ema_q[r][b]) * (1.0f / 256.0f);
            yi[r][b] = fi - ema_i[r][b];
            yq[r][b] = fq - ema_q[r][b];
        }
    }

    // 5: motion energy per bin and automatic bin choice (with hysteresis)
    int best = min_bin;
    for (int b = 0; b < DSP_BINS; b++) {
        float e = 0;
        for (int r = 0; r < RADAR_NUM_RX; r++) e += yi[r][b] * yi[r][b] + yq[r][b] * yq[r][b];
        energy[b] += (e - energy[b]) * 0.01f;
        if (b >= min_bin && b <= 10 && energy[b] > energy[best]) best = b;
    }
    if (fixed_bin >= 0) cur_bin = fixed_bin;
    else if (best != cur_bin && energy[best] > 1.5f * energy[cur_bin]) {
        cur_bin = best;
        for (int r = 0; r < RADAR_NUM_RX; r++) { align_i[r] = 1.0f; align_q[r] = 0.0f; }
    }

    // phase-align receivers 2 and 3 to receiver 1 and sum (simple beamforming towards the moving surface)
    const int b = cur_bin;
    float zi = yi[0][b], zq = yq[0][b];
    for (int r = 1; r < RADAR_NUM_RX; r++) {
        float pi = yi[0][b] * yi[r][b] + yq[0][b] * yq[r][b];     // y1 * conj(yr)
        float pq = yq[0][b] * yi[r][b] - yi[0][b] * yq[r][b];
        align_i[r] += (pi - align_i[r]) * 0.02f;
        align_q[r] += (pq - align_q[r]) * 0.02f;
        float m = sqrtf(align_i[r] * align_i[r] + align_q[r] * align_q[r]);
        float wi = m > 1e-9f ? align_i[r] / m : 1.0f, wq = m > 1e-9f ? align_q[r] / m : 0.0f;
        zi += wi * yi[r][b] - wq * yq[r][b];
        zq += wi * yq[r][b] + wq * yi[r][b];
    }

    out->i = zi; out->q = zq; out->bin = (uint8_t)b; out->seq = seq++;
    frames++;
}
