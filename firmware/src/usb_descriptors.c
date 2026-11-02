// USB descriptors: CDC console (itf 0-1), vendor bulk / WebUSB stream (itf 2), UAC2 mono microphone (itf 3-4).
// Based on TinyUSB's webusb_serial and audio_test examples (MIT, Copyright Ha Thach / tinyusb.org).
#include <string.h>

#include "pico/unique_id.h"
#include "tusb.h"
#include "usb_descriptors.h"

// pid.codes test VID/PID: fine for development, request your own PID before shipping devices.
#define USB_VID 0x1209
#define USB_PID 0x0001

tusb_desc_device_t const desc_device = {
    .bLength = sizeof(tusb_desc_device_t),
    .bDescriptorType = TUSB_DESC_DEVICE,
    .bcdUSB = 0x0210,                       // 2.1: required for the BOS descriptor (WebUSB, MS OS 2.0)
    .bDeviceClass = TUSB_CLASS_MISC,        // interface association descriptors (CDC, audio)
    .bDeviceSubClass = MISC_SUBCLASS_COMMON,
    .bDeviceProtocol = MISC_PROTOCOL_IAD,
    .bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE,
    .idVendor = USB_VID,
    .idProduct = USB_PID,
    .bcdDevice = 0x0100,
    .iManufacturer = 0x01,
    .iProduct = 0x02,
    .iSerialNumber = 0x03,
    .bNumConfigurations = 0x01,
};

uint8_t const *tud_descriptor_device_cb(void) { return (uint8_t const *)&desc_device; }

#define EPNUM_CDC_NOTIF  0x81
#define EPNUM_CDC_OUT    0x02
#define EPNUM_CDC_IN     0x82
#define EPNUM_VENDOR_OUT 0x03
#define EPNUM_VENDOR_IN  0x83
#define EPNUM_AUDIO_IN   0x84

#define CONFIG_TOTAL_LEN (TUD_CONFIG_DESC_LEN + TUD_CDC_DESC_LEN + TUD_VENDOR_DESC_LEN + TUD_AUDIO_MIC_ONE_CH_DESC_LEN)

uint8_t const desc_configuration[] = {
    TUD_CONFIG_DESCRIPTOR(1, ITF_NUM_TOTAL, 0, CONFIG_TOTAL_LEN, 0x00, 400),
    TUD_CDC_DESCRIPTOR(ITF_NUM_CDC, 4, EPNUM_CDC_NOTIF, 8, EPNUM_CDC_OUT, EPNUM_CDC_IN, 64),
    TUD_VENDOR_DESCRIPTOR(ITF_NUM_VENDOR, 5, EPNUM_VENDOR_OUT, EPNUM_VENDOR_IN, 64),
    TUD_AUDIO_MIC_ONE_CH_DESCRIPTOR(ITF_NUM_AUDIO_CONTROL, 6, CFG_TUD_AUDIO_FUNC_1_N_BYTES_PER_SAMPLE_TX,
                                    CFG_TUD_AUDIO_FUNC_1_N_BYTES_PER_SAMPLE_TX * 8, EPNUM_AUDIO_IN, CFG_TUD_AUDIO_EP_SZ_IN),
};

uint8_t const *tud_descriptor_configuration_cb(uint8_t index) { (void)index; return desc_configuration; }

// BOS: WebUSB (no landing page) + Microsoft OS 2.0, so Windows binds WinUSB to the vendor interface by itself
#define BOS_TOTAL_LEN     (TUD_BOS_DESC_LEN + TUD_BOS_WEBUSB_DESC_LEN + TUD_BOS_MICROSOFT_OS_DESC_LEN)
#define MS_OS_20_DESC_LEN 0xB2

uint8_t const desc_bos[] = {
    TUD_BOS_DESCRIPTOR(BOS_TOTAL_LEN, 2),
    TUD_BOS_WEBUSB_DESCRIPTOR(VENDOR_REQUEST_WEBUSB, 0),
    TUD_BOS_MS_OS_20_DESCRIPTOR(MS_OS_20_DESC_LEN, VENDOR_REQUEST_MICROSOFT),
};

uint8_t const *tud_descriptor_bos_cb(void) { return desc_bos; }

uint8_t const desc_ms_os_20[] = {
    // set header: length, type, windows version, total length
    U16_TO_U8S_LE(0x000A), U16_TO_U8S_LE(MS_OS_20_SET_HEADER_DESCRIPTOR), U32_TO_U8S_LE(0x06030000), U16_TO_U8S_LE(MS_OS_20_DESC_LEN),
    // configuration subset header
    U16_TO_U8S_LE(0x0008), U16_TO_U8S_LE(MS_OS_20_SUBSET_HEADER_CONFIGURATION), 0, 0, U16_TO_U8S_LE(MS_OS_20_DESC_LEN - 0x0A),
    // function subset header: the vendor interface
    U16_TO_U8S_LE(0x0008), U16_TO_U8S_LE(MS_OS_20_SUBSET_HEADER_FUNCTION), ITF_NUM_VENDOR, 0, U16_TO_U8S_LE(MS_OS_20_DESC_LEN - 0x0A - 0x08),
    // compatible ID: WINUSB
    U16_TO_U8S_LE(0x0014), U16_TO_U8S_LE(MS_OS_20_FEATURE_COMPATBLE_ID), 'W', 'I', 'N', 'U', 'S', 'B', 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    // registry property: DeviceInterfaceGUIDs
    U16_TO_U8S_LE(MS_OS_20_DESC_LEN - 0x0A - 0x08 - 0x08 - 0x14), U16_TO_U8S_LE(MS_OS_20_FEATURE_REG_PROPERTY),
    U16_TO_U8S_LE(0x0007), U16_TO_U8S_LE(0x002A),
    'D', 0x00, 'e', 0x00, 'v', 0x00, 'i', 0x00, 'c', 0x00, 'e', 0x00, 'I', 0x00, 'n', 0x00, 't', 0x00, 'e', 0x00,
    'r', 0x00, 'f', 0x00, 'a', 0x00, 'c', 0x00, 'e', 0x00, 'G', 0x00, 'U', 0x00, 'I', 0x00, 'D', 0x00, 's', 0x00, 0x00, 0x00,
    U16_TO_U8S_LE(0x0050),
    // {6B1F6C2E-5E2A-4C7B-9C1D-3A9E5B7D2F41}
    '{', 0x00, '6', 0x00, 'B', 0x00, '1', 0x00, 'F', 0x00, '6', 0x00, 'C', 0x00, '2', 0x00, 'E', 0x00, '-', 0x00,
    '5', 0x00, 'E', 0x00, '2', 0x00, 'A', 0x00, '-', 0x00, '4', 0x00, 'C', 0x00, '7', 0x00, 'B', 0x00, '-', 0x00,
    '9', 0x00, 'C', 0x00, '1', 0x00, 'D', 0x00, '-', 0x00, '3', 0x00, 'A', 0x00, '9', 0x00, 'E', 0x00, '5', 0x00,
    'B', 0x00, '7', 0x00, 'D', 0x00, '2', 0x00, 'F', 0x00, '4', 0x00, '1', 0x00, '}', 0x00, 0x00, 0x00, 0x00, 0x00,
};
TU_VERIFY_STATIC(sizeof(desc_ms_os_20) == MS_OS_20_DESC_LEN, "Incorrect size");

static char const *string_desc_arr[] = {
    (const char[]){ 0x09, 0x04 },   // 0: English (0x0409)
    "SubvocalRadar",                // 1: manufacturer
    "Subvocal Radar",               // 2: product
    NULL,                           // 3: serial (RP2040 unique ID)
    "Radar Console",                // 4: CDC
    "Radar Stream",                 // 5: vendor / WebUSB
    "Radar Microphone",             // 6: audio
};

static uint16_t desc_str[33];

uint16_t const *tud_descriptor_string_cb(uint8_t index, uint16_t langid) {
    (void)langid;
    size_t chr_count;
    if (index == 0) {
        memcpy(&desc_str[1], string_desc_arr[0], 2);
        chr_count = 1;
    } else {
        char serial[2 * PICO_UNIQUE_BOARD_ID_SIZE_BYTES + 1];
        const char *str;
        if (index == 3) { pico_get_unique_board_id_string(serial, sizeof serial); str = serial; }
        else if (index < sizeof(string_desc_arr) / sizeof(string_desc_arr[0])) str = string_desc_arr[index];
        else return NULL;
        chr_count = strlen(str);
        if (chr_count > 32) chr_count = 32;
        for (size_t i = 0; i < chr_count; i++) desc_str[1 + i] = (uint8_t)str[i];
    }
    desc_str[0] = (uint16_t)((TUSB_DESC_STRING << 8) | (2 * chr_count + 2));
    return desc_str;
}
