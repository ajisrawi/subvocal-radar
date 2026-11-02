// State shared between core 0 (USB) and core 1 (radar). Cross-core traffic goes through pico_util queues only.
#pragma once
#include <stdint.h>
#include "dsp.h"
#include "pico/util/queue.h"
#include "radar_config.h"

#define FW_VERSION "0.1.0"

typedef enum { STREAM_OFF = 0, STREAM_PROFILE = 1, STREAM_RAW = 2 } stream_mode_t;

// Commands from core 0 to core 1 (core 1 owns the SPI bus)
typedef enum { CMD_START, CMD_STOP, CMD_PRESET, CMD_REG_WRITE, CMD_REG_READ } radar_cmd_type_t;
typedef struct { uint8_t type; uint8_t addr; uint32_t data; } radar_cmd_t;
typedef struct { int32_t status; uint32_t data; } radar_resp_t;

// Stream packet (WebUSB / vendor bulk endpoint), little-endian:
//   0  'S','V','R','1'   4 type (1 raw, 2 profile)   5 range bin   6 frame seq (u16)
//   8  time us (u32)    12 payload length (u16)    14 preset (u8)   15 flags (u8, bit0 = frame error since last)
//   raw payload:     2304 bytes = 1536 packed 12-bit samples (8 chirps x 64 samples x Rx1,Rx2,Rx3 interleaved)
//   profile payload: int16 iq[3 rx][16 bins][2] (192 bytes) + float slow i, q (8 bytes)
#define PKT_HDR_LEN      16
#define PKT_TYPE_RAW     1
#define PKT_TYPE_PROFILE 2
#define PKT_MAX_LEN      (PKT_HDR_LEN + RADAR_FRAME_BYTES)
#define NUM_PKTS         6
typedef struct { uint16_t len; uint8_t data[PKT_MAX_LEN]; } packet_t;

typedef struct {
    volatile uint32_t frames, frame_errors, irq_timeouts, dropped_pkts;
    volatile uint32_t chip_id;
    volatile int32_t init_status;   // bgt60_status_t of the last init
    volatile uint8_t running, preset;
} radar_stats_t;

extern packet_t packets[NUM_PKTS];
extern queue_t q_pkt_free, q_pkt_ready;   // uint8_t packet indices
extern queue_t q_slow;                     // slow_sample_t, core 1 -> core 0 (audio)
extern queue_t q_cmd, q_resp;              // radar_cmd_t / radar_resp_t
extern volatile stream_mode_t stream_mode;
extern radar_stats_t radar_stats;

void radar_core1_main(void);
void usb_app_init(void);
void usb_app_task(void);
