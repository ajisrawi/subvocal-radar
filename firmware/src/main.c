// SubvocalRadar firmware: RP2040 + Infineon BGT60TR13C 60 GHz radar on a USB-C dongle.
//
// core 1: radar. Waits for the FIFO interrupt, burst-reads one frame (8 chirps x 64 samples x 3 Rx), runs the DSP,
//         hands a slow-time sample to the USB microphone and (optionally) a raw/profile packet to the WebUSB stream.
// core 0: USB (TinyUSB). Composite device: USB microphone (works on PC, Android and iPhone without drivers),
//         WebUSB/vendor bulk stream, CDC serial console for commands.
#include <string.h>

#define RADAR_CONFIG_IMPL
#include "radar_config.h"
#include "app.h"
#include "bgt60.h"
#include "board_pins.h"
#include "dsp.h"
#include "hardware/structs/padsbank0.h"
#include "hardware/structs/pads_qspi.h"
#include "pico/multicore.h"
#include "pico/stdlib.h"
#include "radar_config.h"
#include "tusb.h"

packet_t packets[NUM_PKTS];
queue_t q_pkt_free, q_pkt_ready, q_slow, q_cmd, q_resp;
volatile stream_mode_t stream_mode = STREAM_OFF;
radar_stats_t radar_stats;

static uint32_t regs[RADAR_NUM_REGS];
static uint8_t frame_buf[RADAR_FRAME_BYTES];

static void load_preset(radar_preset_t p) {
    memcpy(regs, RADAR_REGS_NARROW, sizeof regs);
    for (size_t i = 0; i < RADAR_NUM_REGS; i++) {
        uint8_t addr = (uint8_t)(regs[i] >> 25);
        if (p == PRESET_WIDE && addr == 0x30) regs[i] = RADAR_REG_PLL1_0_WIDE;
        if (p == PRESET_WIDE && addr == 0x31) regs[i] = RADAR_REG_PLL1_1_WIDE;
    }
    radar_stats.preset = (uint8_t)p;
    dsp_set_min_bin(p == PRESET_WIDE ? 1 : 0);   // narrow preset: the face sits in bin 0
}

static int radar_start(void) {
    uint32_t id = 0;
    int st = bgt60_init(regs, RADAR_NUM_REGS, RADAR_FRAME_SAMPLES, &id);
    radar_stats.chip_id = id;
    radar_stats.init_status = st;
    if (st == BGT60_OK) st = bgt60_start_frames(true);
    radar_stats.running = (st == BGT60_OK);
    dsp_init();
    return st;
}

static void radar_stop(void) {
    bgt60_start_frames(false);
    radar_stats.running = 0;
}

static void handle_command(const radar_cmd_t *c) {
    radar_resp_t r = { 0, 0 };
    switch (c->type) {
        case CMD_START: r.status = radar_start(); break;
        case CMD_STOP: radar_stop(); break;
        case CMD_PRESET: {
            bool was = radar_stats.running;
            radar_stop();
            load_preset((radar_preset_t)c->data);
            if (was) r.status = radar_start();
            break;
        }
        case CMD_REG_WRITE: {
            // keep the change across restarts if the register is part of the preset
            for (size_t i = 0; i < RADAR_NUM_REGS; i++)
                if ((uint8_t)(regs[i] >> 25) == c->addr) regs[i] = ((uint32_t)c->addr << 25) | 0x01000000u | (c->data & 0xFFFFFFu);
            r.data = bgt60_write_reg(c->addr, c->data);
            break;
        }
        case CMD_REG_READ: r.data = 0; r.status = bgt60_read_reg(c->addr, &r.data); break;
        default: r.status = -100;
    }
    queue_try_add(&q_resp, &r);
}

static void put_u16(uint8_t *p, uint16_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }
static void put_u32(uint8_t *p, uint32_t v) { for (int i = 0; i < 4; i++) p[i] = (uint8_t)(v >> (8 * i)); }

static void emit_packet(uint8_t type, const slow_sample_t *s, const range_profile_t *prof, bool err) {
    uint8_t idx;
    if (!queue_try_remove(&q_pkt_free, &idx)) { radar_stats.dropped_pkts++; return; }
    packet_t *pk = &packets[idx];
    uint8_t *h = pk->data;
    uint16_t plen = (type == PKT_TYPE_RAW) ? RADAR_FRAME_BYTES : (uint16_t)(sizeof(prof->iq) + 8);
    memcpy(h, "SVR1", 4);
    h[4] = type; h[5] = s->bin; put_u16(h + 6, s->seq); put_u32(h + 8, s->t_us); put_u16(h + 12, plen);
    h[14] = radar_stats.preset; h[15] = err ? 1 : 0;
    if (type == PKT_TYPE_RAW) memcpy(h + PKT_HDR_LEN, frame_buf, RADAR_FRAME_BYTES);
    else { memcpy(h + PKT_HDR_LEN, prof->iq, sizeof(prof->iq)); memcpy(h + PKT_HDR_LEN + sizeof(prof->iq), &s->i, 4); memcpy(h + PKT_HDR_LEN + sizeof(prof->iq) + 4, &s->q, 4); }
    pk->len = (uint16_t)(PKT_HDR_LEN + plen);
    queue_try_add(&q_pkt_ready, &idx);
}

void radar_core1_main(void) {
    bgt60_io_init();
    load_preset(PRESET_WIDE);
    radar_start();
    bool err_flag = false;
    absolute_time_t deadline = make_timeout_time_ms(100);
    range_profile_t prof;
    for (;;) {
        radar_cmd_t c;
        while (queue_try_remove(&q_cmd, &c)) { handle_command(&c); deadline = make_timeout_time_ms(100); }
        if (!radar_stats.running) { sleep_ms(1); continue; }

        if (!bgt60_irq()) {
            if (time_reached(deadline)) {          // no frame for 100 ms: restart the chip
                radar_stats.irq_timeouts++;
                err_flag = true;
                radar_start();
                deadline = make_timeout_time_ms(100);
            }
            continue;
        }
        deadline = make_timeout_time_ms(100);
        uint32_t t = time_us_32();
        if (bgt60_read_fifo(frame_buf, RADAR_FRAME_BYTES) != BGT60_OK) {
            radar_stats.frame_errors++;
            err_flag = true;
            radar_start();                          // FIFO overflow: reset and resynchronise
            continue;
        }
        slow_sample_t s;
        dsp_process(frame_buf, &prof, &s);
        s.t_us = t;
        radar_stats.frames++;
        if (!queue_try_add(&q_slow, &s)) { slow_sample_t junk; queue_try_remove(&q_slow, &junk); queue_try_add(&q_slow, &s); }

        stream_mode_t m = stream_mode;
        if (m != STREAM_OFF) { emit_packet(m == STREAM_RAW ? PKT_TYPE_RAW : PKT_TYPE_PROFILE, &s, &prof, err_flag); err_flag = false; }
    }
}

int main(void) {
    // IOVDD is 1.8 V on this board: tell the GPIO and QSPI pads (RP2040 datasheet, VOLTAGE_SELECT registers)
    padsbank0_hw->voltage_select = PADS_BANK0_VOLTAGE_SELECT_VALUE_1V8 << PADS_BANK0_VOLTAGE_SELECT_LSB;
    pads_qspi_hw->voltage_select = PADS_QSPI_VOLTAGE_SELECT_VALUE_1V8 << PADS_QSPI_VOLTAGE_SELECT_LSB;

    queue_init(&q_pkt_free, sizeof(uint8_t), NUM_PKTS);
    queue_init(&q_pkt_ready, sizeof(uint8_t), NUM_PKTS);
    for (uint8_t i = 0; i < NUM_PKTS; i++) queue_try_add(&q_pkt_free, &i);
    queue_init(&q_slow, sizeof(slow_sample_t), 32);
    queue_init(&q_cmd, sizeof(radar_cmd_t), 8);
    queue_init(&q_resp, sizeof(radar_resp_t), 8);

    multicore_launch_core1(radar_core1_main);

    usb_app_init();
    tud_init(BOARD_TUD_RHPORT);
    for (;;) {
        tud_task();
        usb_app_task();
    }
}
