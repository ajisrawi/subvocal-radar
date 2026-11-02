cmake_minimum_required(VERSION 3.13)

# Custom board: RP2040 with IOVDD at 1.8 V, W25Q16JW (1.8 V) flash, 12 MHz crystal
set(PICO_BOARD subvocal_radar CACHE STRING "Board type")
set(PICO_BOARD_HEADER_DIRS ${CMAKE_CURRENT_LIST_DIR}/boards)

include(pico_sdk_import.cmake)
project(subvocal_radar C CXX ASM)
set(CMAKE_C_STANDARD 11)
pico_sdk_init()

add_executable(subvocal_radar
    src/main.c
    src/bgt60.c
    src/dsp.c
    src/usb_descriptors.c
    src/usb_app.c
)
target_include_directories(subvocal_radar PRIVATE ${CMAKE_CURRENT_LIST_DIR}/src)
target_compile_options(subvocal_radar PRIVATE -Wall -Wextra -Wno-unused-parameter)

# The app owns USB (TinyUSB device with its own descriptors), so stdio over USB/UART stays off.
target_link_libraries(subvocal_radar PRIVATE
    pico_stdlib
    pico_multicore
    pico_unique_id
    pico_bootrom
    pico_util
    hardware_spi
    hardware_gpio
    tinyusb_device
)
pico_enable_stdio_usb(subvocal_radar 0)
pico_enable_stdio_uart(subvocal_radar 0)
pico_add_extra_outputs(subvocal_radar)
