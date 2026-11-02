// Subvocal for Windows: hold a key, silently mouth a trained phrase, release; the phrase is typed into the focused field.
using System;
using System.Drawing;
using System.Linq;
using System.Media;
using System.Threading.Tasks;
using System.Windows;
using Forms = System.Windows.Forms;

namespace Subvocal
{
    public partial class App : Application
    {
        public AppSettings Settings = AppSettings.Load();
        public PhraseModel Model = PhraseModel.Load(AppSettings.ModelPath);
        public readonly Recognizer Recognizer = new();
        public string? TrainPhrase;                     // set by the main window: next hold records a take for this phrase
        public event Action<string>? Status;            // human-readable result line for the main window
        public event Action? ModelChanged;

        readonly WaveRecorder _rec = new();
        KeyHook? _hook;
        Forms.NotifyIcon? _tray;
        PillWindow? _pill;
        MainWindow? _main;
        bool _busy;

        public static new App Current => (App)Application.Current;

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            Retrain();
            _pill = new PillWindow();
            _hook = new KeyHook { VirtualKey = AppSettings.KeyCode(Settings.HoldKey) };
            _hook.Pressed += () => Dispatcher.BeginInvoke(new Action(BeginCapture));
            _hook.Released += () => Dispatcher.BeginInvoke(new Action(EndCapture));
            _rec.Level += (l) => _pill?.Dispatcher.BeginInvoke(new Action(() => _pill.SetLevel(l)));

            _tray = new Forms.NotifyIcon { Icon = MakeIcon(), Visible = true, Text = "Subvocal: hold " + Settings.HoldKey + " and mouth a phrase" };
            var menu = new Forms.ContextMenuStrip();
            menu.Items.Add("Open Subvocal", null, (_, _) => ShowMain());
            menu.Items.Add("Quit", null, (_, _) => Quit());
            _tray.ContextMenuStrip = menu;
            _tray.DoubleClick += (_, _) => ShowMain();

            ShowMain();
        }

        public void ShowMain()
        {
            if (_main == null || !_main.IsLoaded) { _main = new MainWindow(); }
            _main.Show(); _main.Activate();
        }

        public void ApplySettings()
        {
            if (_hook != null) _hook.VirtualKey = AppSettings.KeyCode(Settings.HoldKey);
            Recognizer.RejectScale = Settings.Sensitivity;
            if (_tray != null) _tray.Text = "Subvocal: hold " + Settings.HoldKey + " and mouth a phrase";
            Settings.Save();
        }

        public void Retrain()
        {
            Recognizer.RejectScale = Settings.Sensitivity;
            Recognizer.Train(Model);
            ModelChanged?.Invoke();
        }

        public void SaveModel() { try { Model.Save(AppSettings.ModelPath); } catch (Exception ex) { Status?.Invoke("Could not save phrases: " + ex.Message); } }

        int ResolveDevice()
        {
            var devs = WaveRecorder.Devices();
            if (!string.IsNullOrEmpty(Settings.Device)) { int i = devs.IndexOf(Settings.Device); if (i >= 0) return i; }
            return WaveRecorder.FindRadar();
        }

        void BeginCapture()
        {
            if (_busy || _rec.IsRecording) return;
            int dev = ResolveDevice();
            if (dev < 0) { _pill!.ShowMessage("Radar not found: plug in the dongle", false); Status?.Invoke("No input named \"Radar Microphone\" found. Plug in the dongle or pick the device in settings."); return; }
            if (!_rec.Start(dev)) { _pill!.ShowMessage("Could not open the radar microphone", false); return; }
            if (Settings.Sounds) SystemSounds.Asterisk.Play();
            _pill!.ShowListening(TrainPhrase != null ? $"Training \"{TrainPhrase}\"" : "Mouth your phrase");
        }

        async void EndCapture()
        {
            if (!_rec.IsRecording) return;
            await Task.Delay(120);   // keep the tail of the movement
            var pcm = _rec.Stop();
            _busy = true;
            try
            {
                var (i, q) = await Task.Run(() => Decoder.Demodulate(pcm, WaveRecorder.SampleRate));
                if (TrainPhrase != null) { AddTake(TrainPhrase, i, q); return; }
                var r = await Task.Run(() => Recognizer.Recognize(i, q));
                if (r.Text != null)
                {
                    _pill!.ShowMessage(r.Text, true);
                    Status?.Invoke($"Typed \"{r.Text}\" (distance {r.Distance:F2}, limit {r.Threshold:F2})");
                    await TextInserter.InsertAsync(Settings.TrailingSpace ? r.Text + " " : r.Text);
                }
                else
                {
                    _pill!.ShowMessage(r.Reason == "ok" ? "Not recognised" : Capitalise(r.Reason), false);
                    Status?.Invoke(r.BestGuess != null ? $"Not typed: closest was \"{r.BestGuess}\" (distance {r.Distance:F2}, limit {r.Threshold:F2}). Train more takes or raise Sensitivity." : Capitalise(r.Reason));
                }
            }
            finally { _busy = false; }
        }

        public void AddTake(string phrase, float[] i, float[] q)
        {
            if (Decoder.Features(i, q) == null)
            {
                _pill!.ShowMessage("No movement detected, take not saved", false);
                Status?.Invoke("Take not saved: no movement detected. Keep the dongle 3-15 cm from your jaw and mouth the phrase clearly.");
                return;
            }
            Model.GetOrAdd(phrase).Takes.Add(new Take { I = i, Q = q });
            SaveModel();
            Retrain();
            int n = Model.Phrases.First(p => p.Text == phrase).Takes.Count;
            _pill!.ShowMessage($"Saved take {n} of \"{phrase}\"", true);
            Status?.Invoke($"Saved take {n} for \"{phrase}\". Five or more takes per phrase work best.");
        }

        /// <summary>Records a fixed-length take from the main window (mouse users).</summary>
        public async Task RecordTimedTake(string phrase, int ms)
        {
            if (_busy || _rec.IsRecording) return;
            var keep = TrainPhrase; TrainPhrase = phrase;
            BeginCapture();
            if (!_rec.IsRecording) { TrainPhrase = keep; return; }
            await Task.Delay(ms);
            EndCapture();
            while (_busy || _rec.IsRecording) await Task.Delay(50);
            TrainPhrase = keep;
        }

        static string Capitalise(string s) => string.IsNullOrEmpty(s) ? s : char.ToUpper(s[0]) + s.Substring(1);

        static Icon MakeIcon()
        {
            using var bmp = new Bitmap(32, 32);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                using var b = new SolidBrush(Color.FromArgb(11, 122, 117));
                g.FillEllipse(b, 2, 2, 28, 28);
                using var p = new Pen(Color.White, 2.4f);
                g.DrawArc(p, 9, 9, 14, 14, -60, 120);
                g.DrawArc(p, 5, 5, 22, 22, -50, 100);
                g.FillEllipse(Brushes.White, 13, 14, 4, 4);
            }
            return Icon.FromHandle(bmp.GetHicon());
        }

        public void Quit()
        {
            _hook?.Dispose();
            _rec.Dispose();
            if (_tray != null) { _tray.Visible = false; _tray.Dispose(); }
            Shutdown();
        }
    }
}
