// Trained phrases and takes, same JSON as the Windows app ("subvocal/phrases-v1").
package com.subvocal.radar

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

class Take(val time: String, val i: FloatArray, val q: FloatArray)
class Phrase(val text: String, val takes: MutableList<Take> = ArrayList())

class PhraseModel(val phrases: MutableList<Phrase> = ArrayList()) {

    fun getOrAdd(text: String): Phrase = phrases.firstOrNull { it.text == text } ?: Phrase(text).also { phrases.add(it) }

    fun toJson(): String {
        val ps = JSONArray()
        for (p in phrases) {
            val ts = JSONArray()
            for (t in p.takes) ts.put(JSONObject().put("time", t.time).put("i", arr(t.i)).put("q", arr(t.q)))
            ps.put(JSONObject().put("text", p.text).put("takes", ts))
        }
        return JSONObject().put("format", "subvocal/phrases-v1").put("rate", Decoder.FRAME_HZ).put("phrases", ps).toString()
    }

    fun merge(other: PhraseModel): Int {
        var n = 0
        for (p in other.phrases) { getOrAdd(p.text).takes.addAll(p.takes); n += p.takes.size }
        return n
    }

    companion object {
        private fun arr(a: FloatArray) = JSONArray().also { j -> for (v in a) j.put(v.toDouble()) }
        private fun floats(j: JSONArray?) = if (j == null) FloatArray(0) else FloatArray(j.length()) { j.getDouble(it).toFloat() }

        fun parse(json: String): PhraseModel {
            val m = PhraseModel()
            val ps = JSONObject(json).optJSONArray("phrases") ?: return m
            for (k in 0 until ps.length()) {
                val p = ps.getJSONObject(k)
                val ph = Phrase(p.getString("text"))
                val ts = p.optJSONArray("takes")
                if (ts != null) for (j in 0 until ts.length()) {
                    val t = ts.getJSONObject(j)
                    ph.takes.add(Take(t.optString("time"), floats(t.optJSONArray("i")), floats(t.optJSONArray("q"))))
                }
                m.phrases.add(ph)
            }
            return m
        }

        fun file(ctx: Context) = File(ctx.filesDir, "phrases.json")

        fun load(ctx: Context): PhraseModel = try { val f = file(ctx); if (f.exists()) parse(f.readText()) else PhraseModel() } catch (e: Exception) { PhraseModel() }

        fun newTake(i: FloatArray, q: FloatArray) = Take(Instant.now().toString(), i, q)
    }

    fun save(ctx: Context) {
        val f = file(ctx)
        val tmp = File(f.path + ".tmp")
        tmp.writeText(toJson())
        tmp.renameTo(f)
    }
}
