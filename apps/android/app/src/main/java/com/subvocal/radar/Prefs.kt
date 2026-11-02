package com.subvocal.radar

import android.content.Context

object Prefs {
    private fun sp(ctx: Context) = ctx.getSharedPreferences("subvocal", Context.MODE_PRIVATE)
    fun sensitivity(ctx: Context) = sp(ctx).getFloat("sensitivity", 1.8f).toDouble()
    fun setSensitivity(ctx: Context, v: Double) = sp(ctx).edit().putFloat("sensitivity", v.toFloat()).apply()
    fun trailingSpace(ctx: Context) = sp(ctx).getBoolean("space", true)
    fun setTrailingSpace(ctx: Context, v: Boolean) = sp(ctx).edit().putBoolean("space", v).apply()
}
