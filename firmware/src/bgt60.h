// Minimal BGT60TR13C driver for the RP2040 (register access, reset, FIFO burst read).
// Ported from Infineon's sensor-xensiv-bgt60trxx (Apache-2.0, Copyright 2022 Infineon Technologies AG).
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define BGT60_REG_MAIN      0x00
#define BGT60_REG_CHIP_ID   0x02
#define BGT60_REG_SFCTL     0x06
#define BGT60_REG_FSTAT     0x5f
#define BGT60_REG_FIFO      0x60

#define BGT60_RESET_SW      0x02u
#define BGT60_RESET_FSM     0x04u
#define BGT60_RESET_FIFO    0x08u

typedef enum {
    BGT60_OK = 0,
    BGT60_ERR_CHIP_ID = -1,     // no BGT60TR13C answering (wiring, power, 80 MHz clock)
    BGT60_ERR_GSR0 = -2,        // FIFO overflow/underflow or SPI burst error reported in the status byte
    BGT60_ERR_TIMEOUT = -3,
} bgt60_status_t;

void bgt60_io_init(void);                                   // SPI + CS/RST/IRQ pins
void bgt60_hard_reset(void);                                // DIO3 low pulse while CS is high (datasheet 5.9)
uint8_t bgt60_write_reg(uint8_t addr, uint32_t data);       // returns GSR0
uint8_t bgt60_read_reg(uint8_t addr, uint32_t *data);       // returns GSR0
int bgt60_soft_reset(uint32_t reset_bits);
int bgt60_init(const uint32_t *regs, size_t n, uint32_t fifo_limit_samples, uint32_t *chip_id_out);
int bgt60_start_frames(bool start);
int bgt60_read_fifo(uint8_t *dst, size_t nbytes);           // burst read of packed 12-bit samples
bool bgt60_irq(void);
