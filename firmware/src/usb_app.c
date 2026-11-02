// Core 0: USB side. Text commands (CDC console or WebUSB), stream packets to WebUSB, generate the microphone signal.
//
// "Radar as microphone": each radar frame gives one complex sample z = I + jQ (~200 per second) whose phase follows
// skin displacement. Phone and PC audio stacks high-pass and auto-gain microphone input, which would wipe out a
// 0-20 Hz signal, so z is interpolated to 16 kHz and moved up to a 2 kHz carrier:  audio = I*cos(wt) - Q*sin(wt).
// A host recovers z by mixing with 2 kHz and low-passing (see host/index.html). Gain changes do not touch the phase.
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "app.h"
#include "pico/bootrom.h"
#include "pico/stdlib.h"
#include "tusb.h"
#include "usb_descriptors.h"

#define AUDIO_RATE        CFG_TUD_AUDIO_FUNC_1_SAMPLE_RATE
#define SAMPLES_PER_MS    (AUDIO_RATE / 1000)
#define AUDIO_DELAY_US    20000.0       // play the radar signal 20 ms late so there are always two frames to interpolate
#define CARRIER_STEPS     8             // 2 kHz carrier at 16 kHz: 8 samples per period

// ------------------------------------------------------------------ console output (to the interface that asked)
typedef enum { SRC_CDC, SRC_VENDOR } cmd_src_t;
static cmd_src_t reply_to;

static void out_str(const char *s) {
    if (reply_to == SRC_VENDOR) {
        if (stream_mode != STREAM_OFF) return;   // the vendor pipe carries binary packets while streaming
        tud_vendor_write_str(s); tud_vendor_write_flush();
    } else if (tud_cdc_connected()) {
        tud_cdc_write_str(s); tud_cdc_write_flush();
    }
}
static void outf(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
static void outf(const char *fmt, ...) {
    char b[192]; va_list ap; va_start(ap, fmt); vsnprintf(b, sizeof b, fmt, ap); va_end(ap); out_str(b);
}

// ------------------------------------------------------------------ radar commands (executed by core 1)
static bool radar_call(uint8_t type, uint8_t addr, uint32_t data, radar_resp_t *resp) {
    radar_cmd_t c = { type, addr, data };
    radar_resp_t junk;
    while (queue_try_remove(&q_resp, &junk)) {}
    if (!queue_try_add(&q_cmd, &c)) return false;
    absolute_time_t to = make_timeout_time_ms(500);
    while (!time_reached(to)) {
        if (queue_try_remove(&q_resp, resp)) return true;
        tud_task();                                // keep USB (and the microphone) alive while waiting
    }
    return false;
}

static const char *HELP =
    "Subvocal Radar " FW_VERSION " commands:\r\n"
    "  status                 radar and stream state\r\n"
    "  start | stop           radar on/off\r\n"
    "  preset wide|narrow     wide: 58.6-63.2 GHz (~3.5 cm bins), narrow: Infineon 61.0-61.5 GHz\r\n"
    "  bin auto|<0..15>       range bin used for the microphone signal\r\n"
    "  stream off|profile|raw binary packets on the WebUSB interface\r\n"
    "  reg <addr> [<data>]    read/write a BGT60TR13C register (hex)\r\n"
    "  boot                   reboot into the USB bootloader (drag a .uf2 to update)\r\n";

static void run_command(char *line) {
    char *argv[4] = { 0 }; int argc = 0;
    for (char *t = strtok(line, " \t"); t && argc < 4; t = strtok(NULL, " \t")) argv[argc++] = t;
    if (!argc) return;
    radar_resp_t r = { 0, 0 };
    const char *cmd = argv[0];

    if (!strcmp(cmd, "help") || !strcmp(cmd, "?")) out_str(HELP);
    else if (!strcmp(cmd, "status")) {
        static const char *modes[] = { "off", "profile", "raw" };
        outf("radar %s, preset %s, chip id 0x%06lx, init %ld\r\nframes %lu, errors %lu, irq timeouts %lu, dropped %lu\r\n"
             "bin %d, stream %s, mic %s\r\n",
             radar_stats.running ? "running" : "stopped", radar_stats.preset == PRESET_WIDE ? "wide" : "narrow",
             (unsigned long)radar_stats.chip_id, (long)radar_stats.init_status, (unsigned long)radar_stats.frames,
             (unsigned long)radar_stats.frame_errors, (unsigned long)radar_stats.irq_timeouts,
             (unsigned long)radar_stats.dropped_pkts, dsp_bin(), modes[stream_mode], tud_audio_mounted() ? "mounted" : "idle");
    }
    else if (!strcmp(cmd, "start")) { if (radar_call(CMD_START, 0, 0, &r)) outf("start: %s\r\n", r.status ? "FAILED (check status)" : "ok"); }
    else if (!strcmp(cmd, "stop")) { radar_call(CMD_STOP, 0, 0, &r); out_str("stopped\r\n"); }
    else if (!strcmp(cmd, "preset") && argc > 1) {
        uint32_t p = !strcmp(argv[1], "narrow") ? PRESET_NARROW : PRESET_WIDE;
        if (radar_call(CMD_PRESET, 0, p, &r)) outf("preset %s: %s\r\n", p == PRESET_WIDE ? "wide" : "narrow", r.status ? "FAILED" : "ok");
    }
    else if (!strcmp(cmd, "bin") && argc > 1) {
        // dsp state lives on core 1 but these are single word writes, safe to set from here
        if (!strcmp(argv[1], "auto")) dsp_set_bin(-1); else dsp_set_bin(atoi(argv[1]));
        outf("bin %s\r\n", argv[1]);
    }
    else if (!strcmp(cmd, "stream") && argc > 1) {
        stream_mode = !strcmp(argv[1], "raw") ? STREAM_RAW : !strcmp(argv[1], "profile") ? STREAM_PROFILE : STREAM_OFF;
        outf("stream %s\r\n", argv[1]);
    }
    else if (!strcmp(cmd, "reg") && argc > 1) {
        uint8_t addr = (uint8_t)strtoul(argv[1], NULL, 16);
        if (argc > 2) { uint32_t d = strtoul(argv[2], NULL, 16); if (radar_call(CMD_REG_WRITE, addr, d, &r)) outf("reg %02x <= %06lx (gsr0 %02lx)\r\n", addr, (unsigned long)d, (unsigned long)r.data); }
        else if (radar_call(CMD_REG_READ, addr, 0, &r)) outf("reg %02x = %06lx (gsr0 %02lx)\r\n", addr, (unsigned long)r.data, (unsigned long)r.status);
    }
    else if (!strcmp(cmd, "boot")) { out_str("rebooting to bootloader\r\n"); sleep_ms(50); reset_usb_boot(0, 0); }
    else outf("unknown command '%s' (try help)\r\n", cmd);
}

static void feed(cmd_src_t src, const uint8_t *buf, uint32_t n, char *line, size_t *len, size_t cap) {
    for (uint32_t i = 0; i < n; i++) {
        char ch = (char)buf[i];
        if (ch == '\r' || ch == '\n') {
            if (*len) { line[*len] = 0; reply_to = src; run_command(line); *len = 0; }
        } else if (*len + 1 < cap) line[(*len)++] = ch;
    }
}

// ------------------------------------------------------------------ WebUSB stream
static int cur_pkt = -1;
static uint16_t cur_off;

static void stream_task(void) {
    if (!tud_vendor_mounted() || stream_mode == STREAM_OFF) {
        uint8_t idx;   // nobody listening: recycle packets
        if (cur_pkt >= 0) { idx = (uint8_t)cur_pkt; queue_try_add(&q_pkt_free, &idx); cur_pkt = -1; }
        while (queue_try_remove(&q_pkt_ready, &idx)) queue_try_add(&q_pkt_free, &idx);
        return;
    }
    for (;;) {
        if (cur_pkt < 0) {
            uint8_t idx;
            if (!queue_try_remove(&q_pkt_ready, &idx)) return;
            cur_pkt = idx; cur_off = 0;
        }
        packet_t *pk = &packets[cur_pkt];
        uint32_t room = tud_vendor_write_available();
        if (!room) { tud_vendor_write_flush(); return; }
        uint32_t n = pk->len - cur_off; if (n > room) n = room;
        cur_off += (uint16_t)tud_vendor_write(pk->data + cur_off, n);
        if (cur_off >= pk->len) { uint8_t idx = (uint8_t)cur_pkt; queue_try_add(&q_pkt_free, &idx); cur_pkt = -1; }
        tud_vendor_write_flush();
    }
}

bool tud_vendor_control_xfer_cb(uint8_t rhport, uint8_t stage, tusb_control_request_t const *request) {
    if (stage != CONTROL_STAGE_SETUP) return true;
    if (request->bmRequestType_bit.type == TUSB_REQ_TYPE_VENDOR && request->bRequest == VENDOR_REQUEST_MICROSOFT && request->wIndex == 7) {
        uint16_t total_len; memcpy(&total_len, desc_ms_os_20 + 8, 2);
        return tud_control_xfer(rhport, request, (void *)(uintptr_t)desc_ms_os_20, total_len);
    }
    if (request->bmRequestType_bit.type == TUSB_REQ_TYPE_CLASS && request->bRequest == 0x22) {
        return tud_control_status(rhport, request);   // WebSerial-style "connect", accepted and ignored
    }
    return false;
}

// ------------------------------------------------------------------ microphone (UAC2)
static bool mute[2];
static int16_t volume[2];
static uint32_t samp_freq = AUDIO_RATE;
static uint8_t clk_valid = 1;
static audio_control_range_4_n_t(1) samp_freq_rng;

#define HIST 32
static slow_sample_t hist[HIST];
static int hist_n, hist_head;          // ring of the newest radar samples
static double t_audio;                 // virtual audio clock, us (32-bit radar timestamps unwrapped against it)
static bool t_audio_valid;
static float peak = 1.0f;
static uint8_t carrier_ix;
static const float COS8[CARRIER_STEPS] = { 1.0f, 0.70710678f, 0.0f, -0.70710678f, -1.0f, -0.70710678f, 0.0f, 0.70710678f };
static const float SIN8[CARRIER_STEPS] = { 0.0f, 0.70710678f, 1.0f, 0.70710678f, 0.0f, -0.70710678f, -1.0f, -0.70710678f };

static void pull_radar_samples(void) {
    slow_sample_t s;
    while (queue_try_remove(&q_slow, &s)) {
        hist[hist_head] = s; hist_head = (hist_head + 1) % HIST; if (hist_n < HIST) hist_n++;
    }
}

// value of z at time t (us, same clock as time_us_32), linear interpolation between radar frames
static void z_at(double t, float *zi, float *zq) {
    if (!hist_n) { *zi = *zq = 0; return; }
    uint64_t now64 = time_us_64();
    uint32_t now = (uint32_t)now64;                // time_us_32() is the low word of the same timer
    int newest = (hist_head + HIST - 1) % HIST;
    double prev_t = 0; float pi = 0, pq = 0; bool have_prev = false;
    for (int k = hist_n - 1; k >= 0; k--) {        // oldest -> newest
        const slow_sample_t *s = &hist[(newest - k + HIST) % HIST];
        double ts = (double)now64 - (double)(uint32_t)(now - s->t_us);
        if (ts >= t) {
            if (!have_prev) { *zi = s->i; *zq = s->q; return; }
            double a = (t - prev_t) / (ts - prev_t);
            *zi = pi + (float)a * (s->i - pi); *zq = pq + (float)a * (s->q - pq);
            return;
        }
        prev_t = ts; pi = s->i; pq = s->q; have_prev = true;
    }
    *zi = pi; *zq = pq;                            // ran past the newest frame: hold it
}

bool tud_audio_tx_done_pre_load_cb(uint8_t rhport, uint8_t itf, uint8_t ep_in, uint8_t cur_alt_setting) {
    (void)rhport; (void)itf; (void)ep_in; (void)cur_alt_setting;
    int16_t buf[SAMPLES_PER_MS];
    pull_radar_samples();
    double target = (double)time_us_64() - AUDIO_DELAY_US;
    if (!t_audio_valid || t_audio < target - 3000.0 || t_audio > target + 3000.0) { t_audio = target; t_audio_valid = true; }
    for (int n = 0; n < SAMPLES_PER_MS; n++) {
        float zi, zq;
        z_at(t_audio, &zi, &zq);
        t_audio += 1e6 / AUDIO_RATE;
        float m = fabsf(zi) + fabsf(zq);
        peak = m > peak ? m : peak * 0.99995f + 1e-6f;          // slow automatic gain, ~1.3 s release
        float g = 0.45f * 32767.0f / (peak > 1e-3f ? peak : 1e-3f);
        float v = (zi * COS8[carrier_ix] - zq * SIN8[carrier_ix]) * g;
        carrier_ix = (uint8_t)((carrier_ix + 1) % CARRIER_STEPS);
        buf[n] = mute[0] ? 0 : (int16_t)(v > 32767.f ? 32767 : v < -32768.f ? -32768 : v);
    }
    tud_audio_write((uint8_t *)buf, sizeof buf);
    return true;
}

bool tud_audio_tx_done_post_load_cb(uint8_t rhport, uint16_t n_bytes_copied, uint8_t itf, uint8_t ep_in, uint8_t cur_alt_setting) {
    (void)rhport; (void)n_bytes_copied; (void)itf; (void)ep_in; (void)cur_alt_setting;
    return true;
}

bool tud_audio_set_itf_close_EP_cb(uint8_t rhport, tusb_control_request_t const *p_request) {
    (void)rhport; (void)p_request;
    t_audio_valid = false;
    return true;
}

bool tud_audio_set_req_entity_cb(uint8_t rhport, tusb_control_request_t const *p_request, uint8_t *pBuff) {
    (void)rhport;
    uint8_t ch = TU_U16_LOW(p_request->wValue), sel = TU_U16_HIGH(p_request->wValue), entity = TU_U16_HIGH(p_request->wIndex);
    TU_VERIFY(p_request->bRequest == AUDIO_CS_REQ_CUR);
    if (entity == UAC2_ENTITY_FEATURE_UNIT && ch < 2) {
        if (sel == AUDIO_FU_CTRL_MUTE) { TU_VERIFY(p_request->wLength == sizeof(audio_control_cur_1_t)); mute[ch] = ((audio_control_cur_1_t *)pBuff)->bCur; return true; }
        if (sel == AUDIO_FU_CTRL_VOLUME) { TU_VERIFY(p_request->wLength == sizeof(audio_control_cur_2_t)); volume[ch] = (int16_t)((audio_control_cur_2_t *)pBuff)->bCur; return true; }
    }
    return false;
}

bool tud_audio_get_req_entity_cb(uint8_t rhport, tusb_control_request_t const *p_request) {
    uint8_t ch = TU_U16_LOW(p_request->wValue), sel = TU_U16_HIGH(p_request->wValue), entity = TU_U16_HIGH(p_request->wIndex);
    if (entity == UAC2_ENTITY_INPUT_TERMINAL && sel == AUDIO_TE_CTRL_CONNECTOR) {
        audio_desc_channel_cluster_t ret = { .bNrChannels = 1, .bmChannelConfig = (audio_channel_config_t)0, .iChannelNames = 0 };
        return tud_audio_buffer_and_schedule_control_xfer(rhport, p_request, (void *)&ret, sizeof(ret));
    }
    if (entity == UAC2_ENTITY_FEATURE_UNIT && ch < 2) {
        if (sel == AUDIO_FU_CTRL_MUTE) return tud_control_xfer(rhport, p_request, &mute[ch], 1);
        if (sel == AUDIO_FU_CTRL_VOLUME) {
            if (p_request->bRequest == AUDIO_CS_REQ_CUR) return tud_control_xfer(rhport, p_request, &volume[ch], sizeof(volume[ch]));
            if (p_request->bRequest == AUDIO_CS_REQ_RANGE) {
                audio_control_range_2_n_t(1) ret = { .wNumSubRanges = 1, .subrange = { { .bMin = 0, .bMax = 0, .bRes = 1 } } };
                return tud_audio_buffer_and_schedule_control_xfer(rhport, p_request, (void *)&ret, sizeof(ret));
            }
        }
    }
    if (entity == UAC2_ENTITY_CLOCK) {
        if (sel == AUDIO_CS_CTRL_SAM_FREQ) {
            if (p_request->bRequest == AUDIO_CS_REQ_CUR) return tud_control_xfer(rhport, p_request, &samp_freq, sizeof(samp_freq));
            if (p_request->bRequest == AUDIO_CS_REQ_RANGE) return tud_control_xfer(rhport, p_request, &samp_freq_rng, sizeof(samp_freq_rng));
        }
        if (sel == AUDIO_CS_CTRL_CLK_VALID) return tud_control_xfer(rhport, p_request, &clk_valid, sizeof(clk_valid));
    }
    return false;
}

// ------------------------------------------------------------------ main loop hooks
static char cdc_line[96], ven_line[96];
static size_t cdc_len, ven_len;

void usb_app_init(void) {
    samp_freq_rng.wNumSubRanges = 1;
    samp_freq_rng.subrange[0].bMin = AUDIO_RATE;
    samp_freq_rng.subrange[0].bMax = AUDIO_RATE;
    samp_freq_rng.subrange[0].bRes = 0;
}

void usb_app_task(void) {
    uint8_t buf[64];
    if (tud_cdc_available()) { uint32_t n = tud_cdc_read(buf, sizeof buf); feed(SRC_CDC, buf, n, cdc_line, &cdc_len, sizeof cdc_line); }
    if (tud_vendor_available()) { uint32_t n = tud_vendor_read(buf, sizeof buf); feed(SRC_VENDOR, buf, n, ven_line, &ven_len, sizeof ven_line); }
    stream_task();
    if (!tud_audio_mounted()) pull_radar_samples();   // keep the history fresh while nobody records
}
