// Synthetic end-to-end test of the decoder: articulation -> radar phase -> firmware audio (2 kHz carrier, 16 kHz)
// -> optional resampling (48 kHz, as on many phones) -> Decoder.Demodulate -> Recognizer.
// Real mouth motion is richer than these gesture sums, so this checks the signal path and the matching logic,
// not real-world accuracy.
using System;
using System.Collections.Generic;
using System.Linq;
using Subvocal;

static class Program
{
    // a "word" = sequence of gestures (time s, displacement mm, width s); similar pairs on purpose
    static readonly (string name, (double t, double a, double w)[] g)[] Words =
    {
        ("hello",     new[] { (0.15, 1.0, 0.07), (0.40, -0.5, 0.06), (0.60, 0.7, 0.08) }),
        ("yes",       new[] { (0.15, 0.8, 0.10) }),
        ("no",        new[] { (0.15, -0.8, 0.10) }),
        ("thanks",    new[] { (0.15, 0.6, 0.05), (0.30, 0.6, 0.05), (0.55, -0.9, 0.09) }),
        ("on my way", new[] { (0.15, -0.6, 0.07), (0.38, 1.1, 0.07), (0.62, -0.4, 0.06), (0.85, 0.8, 0.09) }),
        ("send",      new[] { (0.15, 0.9, 0.06), (0.35, 0.9, 0.06) }),
        ("call me",   new[] { (0.15, 1.2, 0.12), (0.50, -1.0, 0.05) }),
        ("stop",      new[] { (0.15, -0.4, 0.05), (0.30, 1.3, 0.06) }),
    };

    static readonly Random Rng = new(1234);
    static double Gauss() { double u = 1 - Rng.NextDouble(), v = Rng.NextDouble(); return Math.Sqrt(-2 * Math.Log(u)) * Math.Cos(2 * Math.PI * v); }

    /// <summary>Displacement (mm) of one take at 200 Hz with random speed, strength, timing jitter, lead-in and drift.</summary>
    static double[] TakeDisplacement((double t, double a, double w)[] g, bool randomMotion = false)
    {
        double speed = 0.8 + 0.45 * Rng.NextDouble(), strength = 0.5 + 1.5 * Rng.NextDouble();
        double lead = 0.2 + 0.4 * Rng.NextDouble(), total = 2.0;
        if (randomMotion) g = Enumerable.Range(0, 1 + Rng.Next(4)).Select(k => (0.15 + 0.25 * k + 0.05 * Gauss(), 1.2 * Gauss(), 0.05 + 0.06 * Rng.NextDouble())).ToArray();
        var jit = g.Select(x => (t: x.t * speed + 0.02 * Gauss(), a: x.a * (1 + 0.15 * Gauss()), w: x.w * speed * (1 + 0.1 * Gauss()))).ToArray();
        int n = (int)(total * 200);
        var d = new double[n];
        double drift = 0.05 * Gauss();
        for (int k = 0; k < n; k++)
        {
            double t = k / 200.0 - lead;
            double s = 0;
            foreach (var x in jit) s += strength * x.a * Math.Exp(-0.5 * Math.Pow((t - x.t) / x.w, 2));
            d[k] = s + drift * k / 200.0;
        }
        return d;
    }

    /// <summary>What the firmware sends: z = A e^{j phase} + noise, interpolated to 16 kHz on a 2 kHz carrier, then resampled.</summary>
    static short[] Audio(double[] d, int hostRate, double noise)
    {
        double rot = 2 * Math.PI * Rng.NextDouble(), amp = 0.3 + Rng.NextDouble();
        int n = d.Length;
        var zi = new double[n]; var zq = new double[n];
        for (int k = 0; k < n; k++)
        {
            double ph = d[k] / Decoder.MmPerRad + rot;
            zi[k] = amp * Math.Cos(ph) + noise * Gauss();
            zq[k] = amp * Math.Sin(ph) + noise * Gauss();
        }
        double[] cos8 = { 1, .70710678, 0, -.70710678, -1, -.70710678, 0, .70710678 }, sin8 = { 0, .70710678, 1, .70710678, 0, -.70710678, -1, -.70710678 };
        int dev = n * 80;   // 16 kHz
        var a16 = new double[dev];
        double peak = 1e-9;
        for (int j = 0; j < dev; j++)
        {
            double f = j / 80.0; int k = Math.Min((int)f, n - 2); double t = f - k;
            double i = zi[k] + t * (zi[k + 1] - zi[k]), q = zq[k] + t * (zq[k + 1] - zq[k]);
            a16[j] = i * cos8[j % 8] - q * sin8[j % 8];
            peak = Math.Max(peak, Math.Abs(i) + Math.Abs(q));
        }
        int outN = (int)((long)dev * hostRate / 16000);
        var o = new short[outN];
        for (int j = 0; j < outN; j++)
        {
            double x = j * 16000.0 / hostRate; int k = Math.Min((int)x, dev - 2); double t = x - k;
            double v = (a16[k] + t * (a16[k + 1] - a16[k])) * 0.45 / peak;
            o[j] = (short)Math.Clamp(v * 32767, -32768, 32767);
        }
        return o;
    }

    static (float[] I, float[] Q) Record(double[] d, int rate, double noise) => Decoder.Demodulate(Audio(d, rate, noise), rate);

    /// <summary>
    /// Writes a fixture for the Kotlin port's unit test (apps/android/app/src/test): PCM of a few takes plus what this
    /// C# decoder computes from them (I/Q, features, DTW distances, recognition), so both implementations can be compared.
    /// </summary>
    static void WriteFixture(string path)
    {
        var inv = System.Globalization.CultureInfo.InvariantCulture;
        var sb = new System.Text.StringBuilder();
        var takes = new List<(string name, string word, short[] pcm)>();
        foreach (var (w, k) in new[] { (0, 0), (0, 1), (0, 2), (3, 0), (3, 1), (3, 2), (0, 3) })
            takes.Add(($"t{takes.Count}", Words[w].name, Audio(TakeDisplacement(Words[w].g), 16000, 0.01)));
        var model = new PhraseModel();
        var iqs = new List<(float[] I, float[] Q)>();
        foreach (var (name, word, pcm) in takes)
        {
            sb.Append("pcm ").Append(name).Append(' ').Append(word.Replace(' ', '_')).Append(' ').AppendJoin(' ', pcm).Append('\n');
            var (i, q) = Decoder.Demodulate(pcm, 16000);
            iqs.Add((i, q));
            sb.Append(inv, $"iq {name} {i.Length} {i.Sum(x => (double)x):R} {q.Sum(x => (double)x):R} {i.Sum(x => Math.Abs((double)x)):R}\n");
            var f = Decoder.Features(i, q);
            sb.Append(inv, $"feat {name} {(f == null ? -1 : f.Length)} {(f == null ? 0 : f.Sum(r => (double)r[0] * r[0])):R} {(f == null ? 0 : f.Sum(r => (double)r[1])):R}\n");
        }
        for (int a = 0; a < takes.Count; a++)
            for (int b = a + 1; b < takes.Count; b++)
                sb.Append(inv, $"dtw {takes[a].name} {takes[b].name} {Decoder.Dtw(Decoder.Features(iqs[a].I, iqs[a].Q)!, Decoder.Features(iqs[b].I, iqs[b].Q)!):R}\n");
        for (int k = 0; k < 6; k++) model.GetOrAdd(takes[k].word).Takes.Add(new Take { I = iqs[k].I, Q = iqs[k].Q });
        var rec = new Recognizer();
        rec.Train(model);
        var r = rec.Recognize(iqs[6].I, iqs[6].Q);
        sb.Append(inv, $"rec t6 {(r.Text ?? "-").Replace(' ', '_')} {r.Distance:R} {r.Threshold:R}\n");
        System.IO.File.WriteAllText(path, sb.ToString());
        Console.WriteLine($"fixture written: {path} ({takes.Count} takes, recognised '{r.Text}')");
    }

    static void Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "fixture") { WriteFixture(args[1]); return; }
        foreach (var scale in new[] { 1.3, 1.6, 2.0 })
        foreach (var (rate, noise) in new[] { (48000, 0.01), (48000, 0.05) })
        {
            var model = new PhraseModel();
            foreach (var (name, g) in Words)
                for (int k = 0; k < 5; k++) { var (i, q) = Record(TakeDisplacement(g), rate, noise); model.GetOrAdd(name).Takes.Add(new Take { I = i, Q = q }); }
            var rec = new Recognizer { RejectScale = scale };
            rec.Train(model);

            int correct = 0, wrong = 0, rejected = 0, tests = 0;
            var confusion = new Dictionary<string, int>();
            foreach (var (name, g) in Words)
                for (int k = 0; k < 30; k++)
                {
                    var (i, q) = Record(TakeDisplacement(g), rate, noise);
                    var r = rec.Recognize(i, q);
                    tests++;
                    if (r.Text == null) rejected++;
                    else if (r.Text == name) correct++;
                    else { wrong++; var key = $"{name}->{r.Text}"; confusion[key] = confusion.GetValueOrDefault(key) + 1; }
                }
            int falseAccept = 0;
            for (int k = 0; k < 100; k++) { var (i, q) = Record(TakeDisplacement(Words[0].g, randomMotion: true), rate, noise); if (rec.Recognize(i, q).Text != null) falseAccept++; }
            int silenceAccept = 0;
            for (int k = 0; k < 50; k++) { var (i, q) = Record(new double[400], rate, noise); if (rec.Recognize(i, q).Text != null) silenceAccept++; }

            Console.WriteLine($"scale {scale}: {rate / 1000} kHz, noise {noise}: {8} phrases x 5 training takes; {tests} test takes -> " +
                              $"correct {100.0 * correct / tests:F1}%, wrong {100.0 * wrong / tests:F1}%, rejected {100.0 * rejected / tests:F1}%; " +
                              $"random motion accepted {falseAccept}/100; silence accepted {silenceAccept}/50");
            if (confusion.Count > 0) Console.WriteLine("   confusions: " + string.Join(", ", confusion.OrderByDescending(x => x.Value).Take(5).Select(x => $"{x.Key} x{x.Value}")));
        }
    }
}
