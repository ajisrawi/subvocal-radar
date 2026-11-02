// Pin map, matching the schematic (hardware/scripts/make_schematic.mjs, sheet "MCU").
#pragma once

#define RADAR_SPI        spi0
#define PIN_RAD_MISO     16   // GPIO16 <- BGT60 DO   (ball E1)
#define PIN_RAD_CS       17   // GPIO17 -> BGT60 CS_N (ball G1), driven as a plain GPIO
#define PIN_RAD_SCK      18   // GPIO18 -> BGT60 CLK  (ball B1)
#define PIN_RAD_MOSI     19   // GPIO19 -> BGT60 DI   (ball D1)
#define PIN_RAD_RST      20   // GPIO20 -> BGT60 DIO3 (ball F1), hardware reset, active low
#define PIN_RAD_IRQ      21   // GPIO21 <- BGT60 IRQ  (ball C1), high when the FIFO reaches its limit

#define RADAR_SPI_HZ     (20u * 1000u * 1000u)   // BGT60TR13C allows 50 MHz; 20 MHz is comfortable at 1.8 V
