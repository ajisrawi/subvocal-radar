// Setup, phrase training and the bubble switch. UI is built in code (no layout files, no libraries).
package com.subvocal.radar

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var model: PhraseModel
    private val recorder by lazy { Recorder(this) }
    private val recognizer = Recognizer()
    private var selected: String? = null

    private lateinit var root: LinearLayout
    private lateinit var radarState: TextView
    private lateinit var setupBox: LinearLayout
    private lateinit var bubbleBtn: Button
    private lateinit var phraseBox: LinearLayout
    private lateinit var status: TextView

    private val teal = Color.rgb(11, 122, 117)
    private val muted = Color.rgb(93, 102, 115)
    private val dp get() = resources.displayMetrics.density

    companion object { private const val REQ_EXPORT = 11; private const val REQ_IMPORT = 12 }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        model = PhraseModel.load(this)
        retrain()
        buildUi()
    }

    override fun onResume() { super.onResume(); refreshSetup(); refreshRadar() }

    private fun retrain() { recognizer.rejectScale = Prefs.sensitivity(this); recognizer.train(model) }

    // ------------------------------------------------------------------ UI
    private fun px(v: Int) = (v * dp).toInt()
    private fun text(s: String, size: Float = 15f, color: Int = Color.rgb(20, 23, 28), bold: Boolean = false) = TextView(this).apply {
        text = s; textSize = size; setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD
    }
    private fun button(s: String, primary: Boolean = false, onClick: (() -> Unit)? = null) = Button(this).apply {
        text = s; isAllCaps = false; textSize = 15f
        if (primary) { setTextColor(Color.WHITE); background = GradientDrawable().apply { setColor(teal); cornerRadius = 14 * dp } }
        if (onClick != null) setOnClickListener { onClick() }
    }
    private fun card(title: String): LinearLayout {
        val c = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(px(14), px(12), px(14), px(14))
            background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = 12 * dp; setStroke(px(1), Color.rgb(223, 227, 232)) }
        }
        c.addView(text(title.uppercase(), 12f, muted, true).apply { letterSpacing = 0.08f; setPadding(0, 0, 0, px(8)) })
        root.addView(c, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = px(12) })
        return c
    }

    private fun buildUi() {
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(px(16), px(20), px(16), px(24)); setBackgroundColor(Color.rgb(246, 247, 249)) }
        root.addView(text("Subvocal", 24f, bold = true))
        root.addView(text("Type with silent speech: hold the bubble, mouth a phrase you trained, release.", 14f, muted).apply { setPadding(0, px(4), 0, px(14)) })

        val radar = card("Radar")
        radarState = text("", 14f)
        radar.addView(radarState)
        radar.addView(button("Check again") { refreshRadar() })

        setupBox = card("Setup")

        val bubble = card("Bubble")
        bubble.addView(text("Shows a floating button over every app. Tap a text field, then hold the bubble while you mouth the phrase.", 14f, muted))
        bubbleBtn = button("Start bubble", primary = true) { toggleBubble() }
        bubble.addView(bubbleBtn)

        val phrases = card("Phrases")
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val input = EditText(this).apply { hint = "Text to type, e.g. on my way"; inputType = InputType.TYPE_CLASS_TEXT; isSingleLine = true }
        row.addView(input, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(button("Add") {
            val t = input.text.toString().trim()
            if (t.isNotEmpty()) { model.getOrAdd(t); save(); selected = t; input.setText(""); refreshPhrases(); say("Added \"$t\". Now record 5 takes.") }
        })
        phrases.addView(row)
        phraseBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, px(6), 0, px(6)) }
        phrases.addView(phraseBox)
        phrases.addView(holdButton("Hold to record a take") { iq ->
            val p = selected
            when {
                p == null -> say("Add or select a phrase first.")
                Decoder.features(iq.i, iq.q) == null -> say("Take not saved: no movement detected. Hold the dongle 3-15 cm from your jaw.")
                else -> { model.getOrAdd(p).takes.add(PhraseModel.newTake(iq.i, iq.q)); save(); refreshPhrases(); say("Saved take ${model.getOrAdd(p).takes.size} for \"$p\".") }
            }
        })
        val edit = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        edit.addView(button("Delete last take") { model.phrases.firstOrNull { it.text == selected }?.takes?.removeLastOrNull(); save(); refreshPhrases() })
        edit.addView(button("Delete phrase") { model.phrases.removeAll { it.text == selected }; selected = null; save(); refreshPhrases() })
        phrases.addView(edit)
        phrases.addView(text("Record each phrase 5 or more times, the way you will mouth it later. The radar sees jaw and lip movement, not sound.", 13f, muted))

        val test = card("Try it")
        test.addView(holdButton("Hold to test") { iq ->
            val r = recognizer.recognize(iq.i, iq.q)
            say(if (r.text != null) "Recognised \"${r.text}\" (distance %.2f, limit %.2f)".format(r.distance, r.threshold)
                else if (r.bestGuess != null) "Not recognised: closest \"${r.bestGuess}\" (distance %.2f, limit %.2f)".format(r.distance, r.threshold)
                else r.reason.replaceFirstChar { it.uppercase() })
        })

        val settings = card("Settings")
        val sensLabel = text("", 14f)
        settings.addView(sensLabel)
        settings.addView(SeekBar(this).apply {
            max = 18; progress = ((Prefs.sensitivity(this@MainActivity) - 1.2) * 10).toInt()
            sensLabel.text = "Sensitivity %.1f (higher accepts looser matches)".format(1.2 + progress / 10.0)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(s: SeekBar?, p: Int, fromUser: Boolean) { sensLabel.text = "Sensitivity %.1f (higher accepts looser matches)".format(1.2 + p / 10.0) }
                override fun onStartTrackingTouch(s: SeekBar?) {}
                override fun onStopTrackingTouch(s: SeekBar?) { Prefs.setSensitivity(this@MainActivity, 1.2 + progress / 10.0); retrain() }
            })
        })
        settings.addView(Switch(this).apply {
            text = "Add a space after each phrase"; isChecked = Prefs.trailingSpace(this@MainActivity)
            setOnCheckedChangeListener { _, v -> Prefs.setTrailingSpace(this@MainActivity, v) }
        })

        val share = card("Move phrases between devices")
        share.addView(text("The same file works in the Windows app.", 13f, muted))
        val sr = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        sr.addView(button("Export") { startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE, "subvocal-phrases.json"), REQ_EXPORT) })
        sr.addView(button("Import") { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"), REQ_IMPORT) })
        share.addView(sr)

        status = text("Ready.", 14f).apply { setPadding(px(4), px(4), px(4), px(4)) }
        root.addView(status)

        setContentView(ScrollView(this).apply { addView(root) })
        refreshPhrases(); refreshSetup(); refreshRadar()
    }

    /** A button that records from the dongle while it is held down, then hands the decoded I/Q to [done] (UI thread). */
    @SuppressLint("ClickableViewAccessibility")
    private fun holdButton(label: String, done: (Decoder.IQ) -> Unit) = button(label, primary = true).apply {
        setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1); return@setOnTouchListener true }
                    if (recorder.start()) { (v as Button).text = "Listening... release when done"; say("Mouth it now.") } else say("Radar not found: plug in the dongle.")
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> if (recorder.isRecording) {
                    (v as Button).text = label
                    main.postDelayed({
                        val pcm = recorder.stop()
                        thread { val iq = Decoder.demodulate(pcm, Recorder.SAMPLE_RATE); main.post { done(iq) } }
                    }, 120)
                }
            }
            true
        }
    }

    private fun say(s: String) { status.text = s }
    private fun save() { model.save(this); retrain() }

    private fun refreshRadar() {
        val d = Recorder.findRadar(this)
        radarState.text = if (d != null) "Dongle connected: ${d.productName}" else "Dongle not found. Plug it into the USB-C port (it appears as \"Radar Microphone\")."
        radarState.setTextColor(if (d != null) teal else Color.rgb(180, 68, 28))
    }

    private fun refreshPhrases() {
        phraseBox.removeAllViews()
        if (model.phrases.isEmpty()) phraseBox.addView(text("No phrases yet.", 14f, muted))
        if (selected == null) selected = model.phrases.firstOrNull()?.text
        for (p in model.phrases) {
            val n = p.takes.size
            val sel = p.text == selected
            phraseBox.addView(text("${p.text}    ($n take${if (n == 1) "" else "s"}${if (n < 5) ", record more" else ""})", 15f, if (sel) Color.WHITE else Color.rgb(20, 23, 28)).apply {
                setPadding(px(10), px(9), px(10), px(9))
                if (sel) background = GradientDrawable().apply { setColor(teal); cornerRadius = 8 * dp }
                setOnClickListener { selected = p.text; refreshPhrases() }
            })
        }
    }

    private fun accessibilityOn(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        return enabled.contains("$packageName/")
    }

    private fun refreshSetup() {
        if (!::setupBox.isInitialized) return
        while (setupBox.childCount > 1) setupBox.removeViewAt(1)
        fun step(done: Boolean, label: String, action: () -> Unit) {
            val r = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            r.addView(text(if (done) "✓" else "•", 18f, if (done) teal else muted, true).apply { setPadding(0, 0, px(10), 0) })
            r.addView(text(label, 15f), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            if (!done) r.addView(button("Allow") { action() })
            setupBox.addView(r)
        }
        step(checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED, "Microphone (to read the radar)") { requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1) }
        step(Settings.canDrawOverlays(this), "Show over other apps (the bubble)") { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) }
        step(accessibilityOn(), "Accessibility > Subvocal typing (types into text fields)") { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        if (Build.VERSION.SDK_INT >= 33) step(checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED, "Notifications") { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2) }
        setupBox.addView(text("On Android 13+, if the Accessibility switch is greyed out: App info > menu > Allow restricted settings.", 12f, muted).apply { setPadding(0, px(6), 0, 0) })
        bubbleBtn.text = if (BubbleService.running) "Stop bubble" else "Start bubble"
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) { refreshSetup() }

    private fun toggleBubble() {
        if (BubbleService.running) { stopService(Intent(this, BubbleService::class.java)); main.postDelayed({ refreshSetup() }, 200); return }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || !Settings.canDrawOverlays(this)) { say("Finish the setup steps first."); return }
        // started while the app is on screen: Android only lets such a service use the microphone
        startForegroundService(Intent(this, BubbleService::class.java))
        main.postDelayed({ refreshSetup() }, 300)
        say(if (accessibilityOn()) "Bubble started. Tap a text field in any app, then hold the bubble." else "Bubble started. Turn on Accessibility > Subvocal typing so it can type.")
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data ?: return
        if (resultCode != RESULT_OK) return
        try {
            when (requestCode) {
                REQ_EXPORT -> { contentResolver.openOutputStream(uri)!!.use { it.write(model.toJson().toByteArray()) }; say("Exported ${model.phrases.size} phrases.") }
                REQ_IMPORT -> {
                    val other = PhraseModel.parse(contentResolver.openInputStream(uri)!!.use { it.readBytes().decodeToString() })
                    val n = model.merge(other); save(); refreshPhrases(); say("Imported ${other.phrases.size} phrases ($n takes).")
                }
            }
        } catch (e: Exception) { say("Could not read or write the file: ${e.message}") }
    }
}
