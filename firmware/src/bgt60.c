// Minimal BGT60TR13C driver for the RP2040.
// Ported from Infineon's sensor-xensiv-bgt60trxx, xensiv_bgt60trxx.c (Apache-2.0, Copyright 2022 Infineon
// Technologies AG): SPI frame layout, burst FIFO read, soft reset and FIFO-limit handling follow that driver.
#include "bgt60.h"

#include "board_pins.h"
#include "hardware/gpio.h"
#include "hardware/spi.h"
#include "pico/stdlib.h"

#define SPI_WR_BIT          0x01000000u
#define SPI_BURST_CMD       0xFF000000u
#define SPI_BURST_SADR_POS  17
#define GSR0_ERR_MASK       (0x01u /*FOU_ERR*/ | 0x04u /*SPI_BURST_ERR*/ | 0x08u /*CLK_NUM_ERR*/)
#define SFCTL_FIFO_CREF_MSK 0x001FFFu
#define SFCTL_MISO_HS_MSK   0x010000u
#define CHIP_ID_TR13C_DIG   3u
#define CHIP_ID_TR13C_RF    3u

static inline void cs(bool level) { gpio_put(PIN_RAD_CS, level); }

void bgt60_io_init(void) {
    spi_init(RADAR_SPI, RADAR_SPI_HZ);
    spi_set_format(RADAR_SPI, 8, SPI_CPOL_0, SPI_CPHA_0, SPI_MSB_FIRST);
    gpio_set_function(PIN_RAD_MISO, GPIO_FUNC_SPI);
    gpio_set_function(PIN_RAD_SCK, GPIO_FUNC_SPI);
    gpio_set_function(PIN_RAD_MOSI, GPIO_FUNC_SPI);
    gpio_set_slew_rate(PIN_RAD_SCK, GPIO_SLEW_RATE_FAST);
    gpio_set_slew_rate(PIN_RAD_MOSI, GPIO_SLEW_RATE_FAST);

    gpio_init(PIN_RAD_CS);  gpio_set_dir(PIN_RAD_CS, GPIO_OUT);  gpio_put(PIN_RAD_CS, 1);
    gpio_init(PIN_RAD_RST); gpio_set_dir(PIN_RAD_RST, GPIO_OUT); gpio_put(PIN_RAD_RST, 1);
    gpio_init(PIN_RAD_IRQ); gpio_set_dir(PIN_RAD_IRQ, GPIO_IN);  gpio_pull_down(PIN_RAD_IRQ);
}

void bgt60_hard_reset(void) {
    cs(1);
    gpio_put(PIN_RAD_RST, 1); sleep_ms(1);
    gpio_put(PIN_RAD_RST, 0); sleep_ms(1);
    gpio_put(PIN_RAD_RST, 1); sleep_ms(1);
}

static uint8_t xfer_word(uint32_t word, uint32_t *rx_word) {
    uint8_t tx[4] = { (uint8_t)(word >> 24), (uint8_t)(word >> 16), (uint8_t)(word >> 8), (uint8_t)word };
    uint8_t rx[4];
    cs(0);
    spi_write_read_blocking(RADAR_SPI, tx, rx, 4);
    cs(1);
    if (rx_word) *rx_word = ((uint32_t)rx[1] << 16) | ((uint32_t)rx[2] << 8) | rx[3];
    return rx[0];   // GSR0
}

uint8_t bgt60_write_reg(uint8_t addr, uint32_t data) {
    return xfer_word(((uint32_t)addr << 25) | SPI_WR_BIT | (data & 0x00FFFFFFu), NULL);
}

uint8_t bgt60_read_reg(uint8_t addr, uint32_t *data) {
    return xfer_word((uint32_t)addr << 25, data);
}

int bgt60_soft_reset(uint32_t reset_bits) {
    uint32_t v;
    bgt60_read_reg(BGT60_REG_MAIN, &v);
    bgt60_write_reg(BGT60_REG_MAIN, v | reset_bits);
    for (int i = 0; i < 1000; i++) {
        bgt60_read_reg(BGT60_REG_MAIN, &v);
        if ((v & reset_bits) == 0) { sleep_ms(1); return BGT60_OK; }
        sleep_us(10);
    }
    return BGT60_ERR_TIMEOUT;
}

int bgt60_init(const uint32_t *regs, size_t n, uint32_t fifo_limit_samples, uint32_t *chip_id_out) {
    bgt60_hard_reset();
    uint32_t id = 0;
    bgt60_read_reg(BGT60_REG_CHIP_ID, &id);
    if (chip_id_out) *chip_id_out = id;
    if ((id & 0xFFu) != CHIP_ID_TR13C_RF || ((id >> 8) & 0xFFFFu) != CHIP_ID_TR13C_DIG) return BGT60_ERR_CHIP_ID;

    int st = bgt60_soft_reset(BGT60_RESET_SW);
    if (st) return st;

    for (size_t i = 0; i < n; i++) {
        uint8_t addr = (uint8_t)(regs[i] >> 25);
        uint32_t data = regs[i] & 0x00FFFFFFu;
        if (addr == BGT60_REG_SFCTL) {
            // FIFO limit (CREF) is set below; normal-speed MISO sampling at <= 25 MHz SPI
            data &= ~SFCTL_FIFO_CREF_MSK;
            data &= ~SFCTL_MISO_HS_MSK;
            data |= ((fifo_limit_samples / 2u) - 1u) & SFCTL_FIFO_CREF_MSK;
        }
        bgt60_write_reg(addr, data);
    }
    return bgt60_soft_reset(BGT60_RESET_FSM | BGT60_RESET_FIFO);
}

int bgt60_start_frames(bool start) {
    if (!start) return bgt60_soft_reset(BGT60_RESET_FSM | BGT60_RESET_FIFO);
    uint32_t v;
    bgt60_read_reg(BGT60_REG_MAIN, &v);
    bgt60_write_reg(BGT60_REG_MAIN, v | 0x1u);   // FRAME_START
    return BGT60_OK;
}

int bgt60_read_fifo(uint8_t *dst, size_t nbytes) {
    uint32_t cmd = SPI_BURST_CMD | ((uint32_t)BGT60_REG_FIFO << SPI_BURST_SADR_POS);   // read, unbounded length
    uint8_t tx[4] = { (uint8_t)(cmd >> 24), (uint8_t)(cmd >> 16), (uint8_t)(cmd >> 8), (uint8_t)cmd };
    uint8_t rx[4];
    cs(0);
    spi_write_read_blocking(RADAR_SPI, tx, rx, 4);
    if (rx[0] & GSR0_ERR_MASK) { cs(1); return BGT60_ERR_GSR0; }
    spi_read_blocking(RADAR_SPI, 0x00, dst, nbytes);
    cs(1);
    return BGT60_OK;
}

bool bgt60_irq(void) { return gpio_get(PIN_RAD_IRQ); }
