// Checks that the Kotlin decoder gives the same numbers as the C# decoder (apps/windows/Decoder.cs) on the same audio.
// Fixture: `dotnet run -c Release -- fixture <path>` in apps/decoder-test.
package com.subvocal.radar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.max

class DecoderParityTest {
    private fun close(name: String, expected: Double, actual: Double, rel: Double = 1e-4) {
        val tol = rel * max(1.0, abs(expected))
        assertTrue("$name: expected $expected, got $actual", abs(expected - actual) <= tol)
    }

    @Test
    fun matchesCSharpDecoder() {
        val lines = javaClass.classLoader!!.getResource("decoder_fixture.txt")!!.readText().lines().filter { it.isNotBlank() }
        val pcm = LinkedHashMap<String, Pair<String, ShortArray>>()
        val iq = HashMap<String, Decoder.IQ>()
        val feats = HashMap<String, Array<FloatArray>?>()
        var checks = 0
        for (line in lines) {
            val p = line.split(' ')
            when (p[0]) {
                "pcm" -> {
                    val samples = ShortArray(p.size - 3) { p[it + 3].toShort() }
                    pcm[p[1]] = p[2].replace('_', ' ') to samples
                    val d = Decoder.demodulate(samples, 16000)
                    iq[p[1]] = d
                    feats[p[1]] = Decoder.features(d.i, d.q)
                }
                "iq" -> {
                    val d = iq[p[1]]!!
                    assertEquals("${p[1]} I/Q length", p[2].toInt(), d.i.size)
                    close("${p[1]} sum I", p[3].toDouble(), d.i.sumOf { it.toDouble() })
                    close("${p[1]} sum Q", p[4].toDouble(), d.q.sumOf { it.toDouble() })
                    close("${p[1]} sum |I|", p[5].toDouble(), d.i.sumOf { abs(it.toDouble()) })
                    checks += 4
                }
                "feat" -> {
                    val f = feats[p[1]]
                    assertEquals("${p[1]} feature frames", p[2].toInt(), f?.size ?: -1)
                    if (f != null) {
                        close("${p[1]} feature energy", p[3].toDouble(), f.sumOf { it[0].toDouble() * it[0] })
                        close("${p[1]} feature sum", p[4].toDouble(), f.sumOf { it[1].toDouble() }, 1e-3)
                    }
                    checks += 3
                }
                "dtw" -> { close("dtw ${p[1]}-${p[2]}", p[3].toDouble(), Decoder.dtw(feats[p[1]]!!, feats[p[2]]!!)); checks++ }
                "rec" -> {
                    val model = PhraseModel()
                    pcm.entries.take(6).forEach { (name, v) -> model.getOrAdd(v.first).takes.add(Take("", iq[name]!!.i, iq[name]!!.q)) }
                    val rec = Recognizer().apply { train(model) }
                    val r = rec.recognize(iq[p[1]]!!.i, iq[p[1]]!!.q)
                    assertEquals("recognised text", p[2].replace('_', ' '), r.text ?: "-")
                    close("recognition distance", p[3].toDouble(), r.distance)
                    close("recognition threshold", p[4].toDouble(), r.threshold)
                    checks += 3
                }
            }
        }
        println("decoder parity: $checks checks passed on ${pcm.size} takes")
        assertTrue(checks > 50)
    }
}
