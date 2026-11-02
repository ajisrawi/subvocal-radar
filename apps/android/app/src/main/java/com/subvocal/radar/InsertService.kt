// Types the recognised phrase into whatever text field has focus, in any app (accessibility service).
package com.subvocal.radar

import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlin.math.max
import kotlin.math.min

class InsertService : AccessibilityService() {
    companion object {
        @Volatile var instance: InsertService? = null
    }

    override fun onServiceConnected() { instance = this }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}
    override fun onDestroy() { instance = null; super.onDestroy() }

    /** Inserts text at the cursor of the focused field. Returns false when no editable field has focus. */
    fun insert(text: String): Boolean {
        val node = findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        if (!node.isEditable) return false
        val current = if (node.isShowingHintText) "" else node.text?.toString() ?: ""
        var s = node.textSelectionStart; var e = node.textSelectionEnd
        if (s < 0 || e < 0 || s > current.length || e > current.length) { s = current.length; e = current.length }
        val a = min(s, e); val b = max(s, e)
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, current.substring(0, a) + text + current.substring(b)) }
        if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
            val pos = a + text.length
            node.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, Bundle().apply {
                putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, pos)
                putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, pos)
            })
            return true
        }
        // some apps refuse SET_TEXT: paste instead
        (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Subvocal", text))
        return node.performAction(AccessibilityNodeInfo.ACTION_PASTE)
    }
}
