// Floating bubble over other apps: press and hold, silently mouth a phrase, release -> the phrase is typed.
package com.subvocal.radar

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.TextView
import kotlin.concurrent.thread
import kotlin.math.abs

class BubbleService : Service() {
    companion object {
        @Volatile var running = false
        private const val CHANNEL = "subvocal"
    }

    private lateinit var wm: WindowManager
    private lateinit var bubble: BubbleView
    private lateinit var label: TextView
    private lateinit var bubbleLp: WindowManager.LayoutParams
    private lateinit var labelLp: WindowManager.LayoutParams
    private val main = Handler(Looper.getMainLooper())
    private val recorder by lazy { Recorder(this) }
    private val recognizer = Recognizer()
    private var modelStamp = -1L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        startInForeground()
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val type = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        // NOT_FOCUSABLE: the bubble never takes focus, so the text field in the other app stays focused
        val flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        val size = (56 * resources.displayMetrics.density).toInt()
        bubble = BubbleView(this)
        bubbleLp = WindowManager.LayoutParams(size, size, type, flags, PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.START; x = resources.displayMetrics.widthPixels - size - 12; y = resources.displayMetrics.heightPixels / 3
        }
        label = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 14f; setPadding(28, 14, 28, 14); visibility = View.GONE
            background = GradientDrawable().apply { setColor(Color.argb(235, 23, 27, 33)); cornerRadius = 40f }
        }
        labelLp = WindowManager.LayoutParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, type,
            flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE, PixelFormat.TRANSLUCENT).apply { gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; y = 120 }
        wm.addView(label, labelLp)
        wm.addView(bubble, bubbleLp)
        bubble.setOnTouchListener(TouchHandler())
        recorder.onLevel = { l -> main.post { bubble.level = l; bubble.invalidate() } }
    }

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Subvocal bubble", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_launcher).setContentTitle("Subvocal is ready")
            .setContentText("Hold the bubble and silently mouth a phrase").setContentIntent(open).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) else startForeground(1, n)
    }

    private fun reloadModelIfChanged() {
        val f = PhraseModel.file(this)
        val stamp = if (f.exists()) f.lastModified() else 0L
        recognizer.rejectScale = Prefs.sensitivity(this)
        if (stamp != modelStamp) { recognizer.train(PhraseModel.load(this)); modelStamp = stamp }
    }

    private fun show(text: String, ms: Long = 1600) {
        label.text = text; label.visibility = View.VISIBLE
        main.removeCallbacksAndMessages("hide")
        main.postAtTime({ label.visibility = View.GONE }, "hide", android.os.SystemClock.uptimeMillis() + ms)
    }

    private fun beginCapture() {
        if (!recorder.start()) { show("Radar not found: plug in the dongle"); return }
        bubble.listening = true; bubble.invalidate()
        show("Mouth your phrase", 60_000)
    }

    private fun endCapture() {
        if (!recorder.isRecording) return
        main.postDelayed({
            val pcm = recorder.stop()
            bubble.listening = false; bubble.level = 0f; bubble.invalidate()
            thread {
                reloadModelIfChanged()
                val iq = Decoder.demodulate(pcm, Recorder.SAMPLE_RATE)
                val r = recognizer.recognize(iq.i, iq.q)
                main.post {
                    val text = r.text
                    if (text == null) { show(if (r.bestGuess != null) "Not recognised (closest: ${r.bestGuess})" else r.reason.replaceFirstChar { it.uppercase() }); return@post }
                    val out = if (Prefs.trailingSpace(this)) "$text " else text
                    val svc = InsertService.instance
                    when {
                        svc == null -> { copy(out); show("Copied \"$text\": turn on Subvocal typing in Accessibility") }
                        svc.insert(out) -> show(text)
                        else -> { copy(out); show("No text field focused: copied \"$text\"") }
                    }
                }
            }
        }, 120)   // keep the tail of the movement
    }

    private fun copy(text: String) =
        (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Subvocal", text))

    /** Hold (no movement for 150 ms) = record; drag = move the bubble. */
    private inner class TouchHandler : View.OnTouchListener {
        private var downX = 0f; private var downY = 0f; private var startX = 0; private var startY = 0
        private var dragging = false
        private val slop = ViewConfiguration.get(this@BubbleService).scaledTouchSlop
        private val holdStart = Runnable { if (!dragging) beginCapture() }

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouch(v: View, e: MotionEvent): Boolean {
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = bubbleLp.x; startY = bubbleLp.y; dragging = false
                    main.postDelayed(holdStart, 150)
                }
                MotionEvent.ACTION_MOVE -> {
                    if (!dragging && !recorder.isRecording && (abs(e.rawX - downX) > slop || abs(e.rawY - downY) > slop)) { dragging = true; main.removeCallbacks(holdStart) }
                    if (dragging) { bubbleLp.x = startX + (e.rawX - downX).toInt(); bubbleLp.y = startY + (e.rawY - downY).toInt(); wm.updateViewLayout(bubble, bubbleLp) }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    main.removeCallbacks(holdStart)
                    if (!dragging) endCapture()
                }
            }
            return true
        }
    }

    override fun onDestroy() {
        running = false
        recorder.stop()
        try { wm.removeView(bubble); wm.removeView(label) } catch (_: Exception) {}
        super.onDestroy()
    }

    private class BubbleView(ctx: Context) : View(ctx) {
        var listening = false
        var level = 0f
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        override fun onDraw(c: Canvas) {
            val r = width / 2f
            paint.style = Paint.Style.FILL
            paint.color = if (listening) Color.rgb(214, 69, 69) else Color.rgb(11, 122, 117)
            c.drawCircle(r, r, r - 2, paint)
            if (listening) { paint.color = Color.argb(90, 255, 255, 255); c.drawCircle(r, r, (r - 6) * (0.35f + 0.65f * level), paint) }
            paint.color = Color.WHITE; paint.style = Paint.Style.STROKE; paint.strokeWidth = r / 9; paint.strokeCap = Paint.Cap.ROUND
            c.drawArc(r * 0.55f, r * 0.55f, r * 1.45f, r * 1.45f, -55f, 110f, false, paint)
            c.drawArc(r * 0.3f, r * 0.3f, r * 1.7f, r * 1.7f, -45f, 90f, false, paint)
            paint.style = Paint.Style.FILL
            c.drawCircle(r * 0.85f, r, r / 7, paint)
        }
    }
}
