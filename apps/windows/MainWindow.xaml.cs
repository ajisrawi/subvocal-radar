using System;
using System.ComponentModel;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace Subvocal
{
    public partial class MainWindow : Window
    {
        readonly App _app = App.Current;
        bool _loading = true;

        public MainWindow()
        {
            InitializeComponent();
            foreach (var k in AppSettings.KeyNames) KeyBox.Items.Add(k);
            KeyBox.SelectedItem = _app.Settings.HoldKey;
            SensSlider.Value = _app.Settings.Sensitivity;
            SensValue.Text = _app.Settings.Sensitivity.ToString("F1");
            SpaceBox.IsChecked = _app.Settings.TrailingSpace;
            SoundBox.IsChecked = _app.Settings.Sounds;
            RefreshDevices();
            RefreshPhrases();
            UpdateHowTo();
            _app.Status += OnStatus;
            _app.ModelChanged += OnModelChanged;
            _loading = false;
        }

        void OnStatus(string s) => Dispatcher.BeginInvoke(new Action(() => StatusText.Text = s));
        void OnModelChanged() => Dispatcher.BeginInvoke(new Action(RefreshPhrases));

        protected override void OnClosing(CancelEventArgs e)
        {
            // closing the window keeps Subvocal running in the tray
            _app.Status -= OnStatus; _app.ModelChanged -= OnModelChanged;
            _app.TrainPhrase = null;
            base.OnClosing(e);
        }

        void UpdateHowTo() => HowTo.Text = $"Click into any text field, hold {_app.Settings.HoldKey}, silently mouth a trained phrase, release. Subvocal keeps running in the tray when this window is closed.";

        // ---- devices ----
        void RefreshDevices()
        {
            var devs = WaveRecorder.Devices();
            DeviceBox.Items.Clear();
            DeviceBox.Items.Add("Automatic (Radar Microphone)");
            foreach (var d in devs) DeviceBox.Items.Add(d);
            DeviceBox.SelectedIndex = string.IsNullOrEmpty(_app.Settings.Device) ? 0 : Math.Max(0, devs.IndexOf(_app.Settings.Device) + 1);
            int radar = WaveRecorder.FindRadar();
            DeviceState.Text = radar >= 0 ? $"Dongle found: {devs[radar]}" : "Dongle not found. Plug it in (it appears as \"Radar Microphone\"), then press Refresh.";
        }
        void RefreshDevices_Click(object s, RoutedEventArgs e) => RefreshDevices();
        void DeviceBox_Changed(object s, SelectionChangedEventArgs e)
        {
            if (_loading || DeviceBox.SelectedIndex < 0) return;
            _app.Settings.Device = DeviceBox.SelectedIndex == 0 ? "" : (string)DeviceBox.SelectedItem;
            _app.ApplySettings();
        }

        // ---- phrases ----
        string? Selected => (PhraseList.SelectedItem as ListBoxItem)?.Tag as string;

        void RefreshPhrases()
        {
            var keep = Selected;
            PhraseList.Items.Clear();
            foreach (var p in _app.Model.Phrases)
            {
                int n = p.Takes.Count;
                PhraseList.Items.Add(new ListBoxItem { Tag = p.Text, Content = $"{p.Text}    ({n} take{(n == 1 ? "" : "s")}{(n < 5 ? ", record more" : "")})" });
            }
            foreach (ListBoxItem it in PhraseList.Items) if ((string)it.Tag == keep) PhraseList.SelectedItem = it;
            if (PhraseList.SelectedItem == null && PhraseList.Items.Count > 0) PhraseList.SelectedIndex = 0;
        }

        void AddPhrase_Click(object s, RoutedEventArgs e)
        {
            var t = NewPhrase.Text.Trim();
            if (t.Length == 0) return;
            _app.Model.GetOrAdd(t);
            _app.SaveModel();
            NewPhrase.Clear();
            RefreshPhrases();
            foreach (ListBoxItem it in PhraseList.Items) if ((string)it.Tag == t) PhraseList.SelectedItem = it;
            StatusText.Text = $"Added \"{t}\". Now record 5 takes of it.";
        }
        void NewPhrase_KeyDown(object s, KeyEventArgs e) { if (e.Key == Key.Enter) AddPhrase_Click(s, e); }

        void PhraseList_Changed(object s, SelectionChangedEventArgs e) { if (TrainMode.IsChecked == true) _app.TrainPhrase = Selected; }

        async void Record_Click(object s, RoutedEventArgs e)
        {
            var p = Selected;
            if (p == null) { StatusText.Text = "Add or select a phrase first."; return; }
            RecordBtn.IsEnabled = false;
            StatusText.Text = $"Recording \"{p}\" for 2 seconds: mouth it now.";
            try { await _app.RecordTimedTake(p, 2000); }
            finally { RecordBtn.IsEnabled = true; }
        }

        void DeleteTake_Click(object s, RoutedEventArgs e)
        {
            var p = _app.Model.Phrases.FirstOrDefault(x => x.Text == Selected);
            if (p == null || p.Takes.Count == 0) return;
            p.Takes.RemoveAt(p.Takes.Count - 1);
            _app.SaveModel(); _app.Retrain();
        }

        void DeletePhrase_Click(object s, RoutedEventArgs e)
        {
            var p = _app.Model.Phrases.FirstOrDefault(x => x.Text == Selected);
            if (p == null) return;
            if (MessageBox.Show(this, $"Delete \"{p.Text}\" and its {p.Takes.Count} takes?", "Subvocal", MessageBoxButton.YesNo) != MessageBoxResult.Yes) return;
            _app.Model.Phrases.Remove(p);
            _app.SaveModel(); _app.Retrain();
        }

        void TrainMode_Changed(object s, RoutedEventArgs e)
        {
            _app.TrainPhrase = TrainMode.IsChecked == true ? Selected : null;
            StatusText.Text = TrainMode.IsChecked == true ? $"Training mode on: holding {_app.Settings.HoldKey} records a take for the selected phrase." : "Training mode off: holding the key types the recognised phrase.";
        }

        // ---- settings ----
        void KeyBox_Changed(object s, SelectionChangedEventArgs e)
        {
            if (_loading || KeyBox.SelectedItem == null) return;
            _app.Settings.HoldKey = (string)KeyBox.SelectedItem;
            _app.ApplySettings(); UpdateHowTo();
        }
        void Sens_Changed(object s, RoutedPropertyChangedEventArgs<double> e)
        {
            if (SensValue != null) SensValue.Text = SensSlider.Value.ToString("F1");
            if (_loading) return;
            _app.Settings.Sensitivity = Math.Round(SensSlider.Value, 1);
            _app.ApplySettings();
        }
        void Opt_Changed(object s, RoutedEventArgs e)
        {
            if (_loading) return;
            _app.Settings.TrailingSpace = SpaceBox.IsChecked == true;
            _app.Settings.Sounds = SoundBox.IsChecked == true;
            _app.ApplySettings();
        }

        // ---- import / export ----
        void Export_Click(object s, RoutedEventArgs e)
        {
            var dlg = new Microsoft.Win32.SaveFileDialog { FileName = "subvocal-phrases.json", Filter = "Subvocal phrases|*.json" };
            if (dlg.ShowDialog(this) != true) return;
            _app.Model.Save(dlg.FileName);
            StatusText.Text = $"Exported {_app.Model.Phrases.Count} phrases to {dlg.FileName}. Copy it to the phone and import it in the Android app.";
        }
        void Import_Click(object s, RoutedEventArgs e)
        {
            var dlg = new Microsoft.Win32.OpenFileDialog { Filter = "Subvocal phrases|*.json" };
            if (dlg.ShowDialog(this) != true) return;
            var other = PhraseModel.Load(dlg.FileName);
            int takes = 0;
            foreach (var p in other.Phrases) { _app.Model.GetOrAdd(p.Text).Takes.AddRange(p.Takes); takes += p.Takes.Count; }
            _app.SaveModel(); _app.Retrain();
            StatusText.Text = $"Imported {other.Phrases.Count} phrases ({takes} takes).";
        }
    }
}
