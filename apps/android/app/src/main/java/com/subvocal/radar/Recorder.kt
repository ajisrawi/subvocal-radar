// Records from the dongle's USB microphone ("Radar Microphone") at 16 kHz.
package com.subvocal.radar

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import kotlin.concurrent.thread

class Recorder(private val ctx: Context) {
    companion object {
        const val SAMPLE_RATE = 16000

        /** The dongle: a USB input, preferably one whose name mentions "Radar". */
        fun findRadar(ctx: Context): AudioDeviceInfo? {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val usb = am.getDevices(AudioManager.GET_DEVICES_INPUTS).filter {
                it.type == AudioDeviceInfo.TYPE_USB_DEVICE || it.type == AudioDeviceInfo.TYPE_USB_HEADSET || it.type == AudioDeviceInfo.TYPE_USB_ACCESSORY
            }
            return usb.firstOrNull { it.productName?.toString()?.contains("radar", ignoreCase = true) == true } ?: usb.firstOrNull()
        }
    }

    private var rec: AudioRecord? = null
    private var worker: Thread? = null
    @Volatile private var running = false
    private val buf = ArrayList<Short>()
    var onLevel: ((Float) -> Unit)? = null

    val isRecording get() = running

    /** Returns false when the dongle is not connected or the microphone cannot be opened. */
    @SuppressLint("MissingPermission")
    fun start(): Boolean {
        stop()
        val dev = findRadar(ctx) ?: return false
        val min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        // UNPROCESSED skips the phone's voice processing where the phone supports it (the carrier survives either way)
        val source = if (am.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true") MediaRecorder.AudioSource.UNPROCESSED else MediaRecorder.AudioSource.MIC
        val r = try { AudioRecord(source, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, SAMPLE_RATE / 5 * 2)) } catch (e: Exception) { return false }
        if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); return false }
        r.preferredDevice = dev
        synchronized(buf) { buf.clear() }
        rec = r
        running = true
        r.startRecording()
        worker = thread(name = "radar-mic") {
            val chunk = ShortArray(SAMPLE_RATE / 20)
            while (running) {
                val n = r.read(chunk, 0, chunk.size)
                if (n <= 0) continue
                var sum = 0.0
                synchronized(buf) { for (k in 0 until n) { buf.add(chunk[k]); sum += chunk[k] * chunk[k].toDouble() } }
                onLevel?.invoke(minOf(1f, (Math.sqrt(sum / n) / 32768 * 4).toFloat()))
            }
        }
        return true
    }

    fun stop(): ShortArray {
        val r = rec
        if (r != null) {
            running = false
            worker?.join(500)
            try { r.stop() } catch (_: Exception) {}
            r.release()
            rec = null
        }
        return synchronized(buf) { buf.toShortArray() }
    }
}
