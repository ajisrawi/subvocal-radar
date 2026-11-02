using System;
using System.IO;
using System.Text.Json;

namespace Subvocal
{
    public sealed class AppSettings
    {
        public string HoldKey { get; set; } = "F8";        // F1..F12, RightCtrl, RightAlt, ScrollLock, Pause
        public string Device { get; set; } = "";           // input device name; "" = first device named "Radar"
        public double Sensitivity { get; set; } = 1.8;     // Recognizer.RejectScale
        public bool TrailingSpace { get; set; } = true;
        public bool Sounds { get; set; } = true;

        public static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Subvocal");
        public static readonly string ModelPath = Path.Combine(Dir, "phrases.json");
        static readonly string FilePath = Path.Combine(Dir, "settings.json");

        public static AppSettings Load()
        {
            try { if (File.Exists(FilePath)) return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath)) ?? new AppSettings(); } catch { }
            return new AppSettings();
        }

        public void Save()
        {
            try { Directory.CreateDirectory(Dir); File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true })); } catch { }
        }

        public static int KeyCode(string name) => name switch
        {
            "RightCtrl" => 0xA3, "RightAlt" => 0xA5, "ScrollLock" => 0x91, "Pause" => 0x13,
            _ when name.Length >= 2 && name[0] == 'F' && int.TryParse(name.Substring(1), out var n) && n >= 1 && n <= 12 => 0x70 + n - 1,
            _ => 0x77,
        };

        public static readonly string[] KeyNames = { "F6", "F7", "F8", "F10", "F11", "F12", "RightCtrl", "RightAlt", "ScrollLock", "Pause" };
    }
}
