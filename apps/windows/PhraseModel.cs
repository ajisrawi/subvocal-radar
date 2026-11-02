// Trained phrases and their recorded takes. Same JSON on Windows and Android ("subvocal/phrases-v1"), so phrases
// trained on one device can be copied to the other, and the takes can later train a neural decoder.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Subvocal
{
    public sealed class Take
    {
        [JsonPropertyName("time")] public string Time { get; set; } = DateTime.UtcNow.ToString("o");
        [JsonPropertyName("i")] public float[] I { get; set; } = Array.Empty<float>();   // 200 Hz
        [JsonPropertyName("q")] public float[] Q { get; set; } = Array.Empty<float>();
    }

    public sealed class Phrase
    {
        [JsonPropertyName("text")] public string Text { get; set; } = "";
        [JsonPropertyName("takes")] public List<Take> Takes { get; set; } = new();
    }

    public sealed class PhraseModel
    {
        [JsonPropertyName("format")] public string Format { get; set; } = "subvocal/phrases-v1";
        [JsonPropertyName("rate")] public double Rate { get; set; } = Decoder.FrameHz;
        [JsonPropertyName("phrases")] public List<Phrase> Phrases { get; set; } = new();

        static readonly JsonSerializerOptions Opts = new() { WriteIndented = false };

        public Phrase GetOrAdd(string text)
        {
            var p = Phrases.FirstOrDefault(x => x.Text == text);
            if (p == null) { p = new Phrase { Text = text }; Phrases.Add(p); }
            return p;
        }

        public static PhraseModel Load(string path)
        {
            try { if (File.Exists(path)) return JsonSerializer.Deserialize<PhraseModel>(File.ReadAllText(path), Opts) ?? new PhraseModel(); }
            catch { }
            return new PhraseModel();
        }

        public void Save(string path)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(this, Opts));
            File.Copy(tmp, path, true);
            File.Delete(tmp);
        }
    }
}
