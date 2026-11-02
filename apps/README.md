# Subvocal apps: type with silent speech on Windows and Android

Click into any text field, hold a key (Windows) or the floating bubble (Android), **silently mouth** a phrase you trained, and let go. Subvocal types the phrase where your cursor is.

These are standalone apps for the Subvocal Radar dongle. They do not change or depend on any other dictation app.

| | Windows | Android |
|---|---|---|
| Install | `dist/windows/Subvocal.exe` (needs the .NET 6 Desktop Runtime) | `dist/Subvocal-android.apk` (Android 8+) |
| Trigger | Hold **F8** (changeable) | Hold the floating bubble |
| Types into | The focused field, by pasting (your clipboard is restored) | The focused field, through an accessibility service |
| Training | Main window: Record take, or training mode with the hold key | Main screen: "Hold to record a take" |

The dongle needs the firmware installed first: [../docs/FLASHING.md](../docs/FLASHING.md). Both apps read the dongle through its **Radar Microphone** USB audio input, so no drivers are needed.

## How it works today

The radar does not hear sound. It measures how far your skin moves, to a few micrometres, 200 times a second, while you mouth words.

1. The dongle sends that motion as audio on its USB microphone (a 2 kHz carrier, so phone audio processing cannot damage it).
2. The app decodes it back into a motion trace and keeps only the part where you moved.
3. It compares the shape of that trace with your recorded takes of each phrase, allowing for faster or slower mouthing (dynamic time warping).
4. If the closest phrase is close enough, it types that phrase. Otherwise it types nothing and shows the closest guess.

So today Subvocal recognises **a personal list of phrases you train** (words, short sentences, replies, commands). It does not yet transcribe free, open-ended speech. That needs a neural model trained on many hours of recordings, which is what The Subvocal Company is collecting data for. Every take you record is saved in a format (`subvocal/phrases-v1`: raw I/Q at 200 Hz with its label) that can train such a model later.

In a simulated test (8 phrases, 5 training takes each, takes varying in speed, strength, distance and noise), the decoder picked the right phrase 95-99% of the time and typed a wrong phrase about 1% of the time. Real mouth movement is messier than the simulation, so expect to tune Sensitivity and record more takes.

## Setup

### Windows

1. Plug in the dongle (it shows up as "Radar Microphone").
2. Run `Subvocal.exe`. A teal icon appears in the tray, and the main window opens.
3. Under **Phrases**, type a phrase (for example `on my way`) and press **Add**.
4. Record **5 or more takes**: press **Record take (2 s)** and mouth the phrase. Or tick **Training mode** and hold F8 while you mouth it.
5. Repeat for each phrase, then untick Training mode.
6. In any app, click into a text field, hold **F8**, mouth the phrase, release.

Closing the window keeps Subvocal running in the tray (right-click the icon to quit).

### Android

1. Install `Subvocal-android.apk` and open **Subvocal**.
2. Complete the setup steps: Microphone, Show over other apps, Accessibility > Subvocal typing, and Notifications. On Android 13+, if the Accessibility switch is greyed out: App info > ⋮ > *Allow restricted settings*.
3. Plug the dongle into the USB-C port. The Radar card should say "Dongle connected".
4. Add phrases and use **Hold to record a take** 5+ times each. Check them with **Hold to test**.
5. Tap **Start bubble**. In any app, tap a text field, then press and hold the bubble, mouth the phrase, release. Drag the bubble to move it.

Start the bubble from inside the app: Android only allows microphone use by a service started while the app is on screen.

### Use the same phrases on both

**Export phrases** on one device and **Import** on the other. It is the same file format on both.

## Tips for good recognition

- Keep the dongle in the same place each time, 3-15 cm from your jaw and lips. A short USB-C extension cable lets you clip it to a collar or a glasses arm.
- Record takes the way you will use them: same distance, same pace, same posture.
- Make phrases distinct. "yes" and "no" are both one movement and can be confused; "yes please" and "no thanks" separate better.
- Too many misses: raise **Sensitivity** or add takes. Wrong phrases typed: lower Sensitivity, add takes, or reword similar phrases.
- Each phrase gets its own hold. Pause briefly between phrases.

## Build from source

```bash
# Windows app (.NET 6 SDK)
cd apps/windows && dotnet publish -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -p:DebugType=none -o ../dist/windows
# Android app (JDK 17+, Android SDK 35)
cd apps/android && ./gradlew assembleRelease          # -> app/build/outputs/apk/release/app-release.apk
# Decoder checks
cd apps/decoder-test && dotnet run -c Release          # simulated accuracy at several sensitivities
cd apps/android && ./gradlew testReleaseUnitTest       # Kotlin decoder gives the same numbers as the C# one
```

| Path | What |
|---|---|
| `windows/Decoder.cs` | Decoder (demodulation, motion features, DTW, recogniser) |
| `android/app/src/main/java/com/subvocal/radar/Decoder.kt` | The same decoder in Kotlin (checked against the C# one by `DecoderParityTest`) |
| `windows/` | Windows app: tray, hold-key hook, waveIn recording, paste-to-type, training window |
| `android/` | Android app: bubble service, accessibility typing, training screen. No third-party libraries |
| `decoder-test/` | Simulated end-to-end test and the fixture for the Kotlin parity test |

The Android APK is signed with the debug key so it installs directly. Sign it with your own key before sharing it.
