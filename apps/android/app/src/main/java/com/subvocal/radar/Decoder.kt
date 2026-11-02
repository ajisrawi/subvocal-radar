// Silent-speech decoder. Line-for-line port of apps/windows/Decoder.cs (tested by apps/decoder-test); keep both equal.
//   PCM from the "Radar Microphone" (2 kHz carrier) -> I/Q at 200 Hz -> motion features -> DTW against recorded takes.
package com.subvocal.radar

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

object Decoder {
    const val CARRIER_HZ = 2000.0
    const val FRAME_HZ = 200.0
    const val LOWPASS_HZ = 150.0
    val MM_PER_RAD = (299.792458 / 61.0) / (4 * PI)
    const val SETTLE_FRAMES = 12
    const val FEATURE_DECIMATION = 4

    class IQ(val i: FloatArray, val q: FloatArray)

    fun demodulate(pcm: ShortArray, sampleRate: Int): IQ {
        val w = 2 * PI * CARRIER_HZ / sampleRate
        val dec = (sampleRate / FRAME_HZ).roundToInt()
        val a = 1 - exp(-2 * PI * LOWPASS_HZ / sampleRate)
        var ph = 0.0; var li = 0.0; var lq = 0.0; var lj = 0.0; var lk = 0.0
        var n = 0
        val oi = ArrayList<Float>(pcm.size / dec + 1)
        val oq = ArrayList<Float>(pcm.size / dec + 1)
        for (k in pcm.indices) {
            val x = pcm[k] / 32768.0
            val c = cos(ph); val s = sin(ph)
            ph += w; if (ph > 2 * PI) ph -= 2 * PI
            li += a * (2 * x * c - li); lq += a * (-2 * x * s - lq)
            lj += a * (li - lj); lk += a * (lq - lk)
            if (++n >= dec) { n = 0; oi.add(lj.toFloat()); oq.add(lk.toFloat()) }
        }
        val skip = min(SETTLE_FRAMES, oi.size)
        return IQ(oi.drop(skip).toFloatArray(), oq.drop(skip).toFloatArray())
    }

    fun displacement(i: FloatArray, q: FloatArray): DoubleArray {
        val d = DoubleArray(i.size)
        var last = 0.0; var un = 0.0
        for (k in i.indices) {
            val p = atan2(q[k].toDouble(), i[k].toDouble())
            if (k > 0) {
                var dp = p - last
                if (dp > PI) dp -= 2 * PI
                if (dp < -PI) dp += 2 * PI
                un += dp
            }
            last = p
            d[k] = un * MM_PER_RAD
        }
        return d
    }

    /** [displacement, velocity] of the active part, z-normalised, at 50 Hz; null when there is no articulation. */
    fun features(i: FloatArray, q: FloatArray): Array<FloatArray>? {
        val n = i.size
        if (n < 40) return null
        val d = displacement(i, q)
        val v = DoubleArray(n)
        for (k in 1 until n) v[k] = d[k] - d[k - 1]
        val vs = DoubleArray(n) { k -> (v[max(0, k - 1)] + v[k] + v[min(n - 1, k + 1)]) / 3.0 }

        val e = DoubleArray(n)
        var acc = 0.0
        for (k in 0 until n) {
            acc += abs(vs[k])
            if (k >= 10) acc -= abs(vs[k - 10])
            e[k] = acc / min(k + 1, 10)
        }
        val sorted = e.copyOf(); sorted.sort()
        val floor = sorted[(0.2 * (n - 1)).toInt()]; val peak = sorted[n - 1]
        if (peak < 4 * floor || peak < 1e-4) return null
        val thr = max(3 * floor, 0.08 * peak)

        var s = 0; var t = n - 1
        while (s < n && e[s] < thr) s++
        while (t > s && e[t] < thr) t--
        s = max(0, s - 20); t = min(n - 1, t + 20)
        val len = t - s + 1
        if (len < 30) return null

        var md = 0.0; var mv = 0.0
        for (k in s..t) { md += d[k]; mv += vs[k] }
        md /= len; mv /= len
        var sd = 0.0; var sv = 0.0
        for (k in s..t) { sd += (d[k] - md) * (d[k] - md); sv += (vs[k] - mv) * (vs[k] - mv) }
        sd = sqrt(sd / len) + 1e-9; sv = sqrt(sv / len) + 1e-9

        val m = len / FEATURE_DECIMATION
        return Array(m) { j ->
            var fd = 0.0; var fv = 0.0
            for (r in 0 until FEATURE_DECIMATION) { val k = s + j * FEATURE_DECIMATION + r; fd += (d[k] - md) / sd; fv += (vs[k] - mv) / sv }
            floatArrayOf((fd / FEATURE_DECIMATION).toFloat(), (fv / FEATURE_DECIMATION).toFloat())
        }
    }

    fun dtw(a: Array<FloatArray>, b: Array<FloatArray>): Double {
        val n = a.size; val m = b.size
        if (n == 0 || m == 0) return Double.POSITIVE_INFINITY
        val band = max(abs(n - m), (0.3 * max(n, m)).toInt()) + 1
        var prev = DoubleArray(m + 1) { Double.POSITIVE_INFINITY }
        var cur = DoubleArray(m + 1)
        prev[0] = 0.0
        for (i in 1..n) {
            cur.fill(Double.POSITIVE_INFINITY)
            val jc = (i.toDouble() * m / n).roundToInt()
            val j0 = max(1, jc - band); val j1 = min(m, jc + band)
            for (j in j0..j1) {
                val dx = (a[i - 1][0] - b[j - 1][0]).toDouble(); val dy = (a[i - 1][1] - b[j - 1][1]).toDouble()
                val c = sqrt(dx * dx + dy * dy)
                cur[j] = c + min(prev[j - 1], min(prev[j], cur[j - 1]))
            }
            val tmp = prev; prev = cur; cur = tmp
        }
        return prev[m] / (n + m)
    }
}

class Recognition(val text: String?, val distance: Double, val threshold: Double, val bestGuess: String?, val reason: String)

class Recognizer {
    var rejectScale = 1.8
    private val phrases = ArrayList<Pair<String, List<Array<FloatArray>>>>()
    private var typical = Double.NaN

    val phraseCount get() = phrases.size

    fun train(model: PhraseModel) {
        phrases.clear()
        for (p in model.phrases) {
            val feats = p.takes.mapNotNull { Decoder.features(it.i, it.q) }
            if (feats.isNotEmpty()) phrases.add(p.text to feats)
        }
        val within = ArrayList<Double>()
        for ((_, takes) in phrases) for (a in takes.indices) {
            var best = Double.POSITIVE_INFINITY
            for (b in takes.indices) if (a != b) best = min(best, Decoder.dtw(takes[a], takes[b]))
            if (!best.isInfinite()) within.add(best)
        }
        within.sort()
        typical = if (within.isNotEmpty()) within[within.size / 2] else Double.NaN
    }

    fun recognize(i: FloatArray, q: FloatArray): Recognition {
        if (phrases.isEmpty()) return Recognition(null, 0.0, 0.0, null, "no phrases trained yet")
        val f = Decoder.features(i, q) ?: return Recognition(null, 0.0, 0.0, null, "no movement detected")
        var best = Double.POSITIVE_INFINITY; var bestText: String? = null
        for ((text, takes) in phrases) for (t in takes) {
            val dist = Decoder.dtw(f, t)
            if (dist < best) { best = dist; bestText = text }
        }
        val thr = if (typical.isNaN()) Double.POSITIVE_INFINITY else rejectScale * typical
        return if (best <= thr) Recognition(bestText, best, thr, bestText, "ok")
        else Recognition(null, best, thr, bestText, "not close to any trained phrase")
    }
}
