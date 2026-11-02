// Silent-speech decoder for the Subvocal Radar dongle. Kept line-for-line equal to the Kotlin port in
// apps/android/app/src/main/java/com/subvocal/radar/Decoder.kt; the algorithm is described in apps/DECODER.md.
//
//   PCM from the "Radar Microphone" (2 kHz carrier)  ->  I/Q at 200 Hz  ->  motion features  ->  DTW against the
//   user's recorded takes of each phrase  ->  the phrase text, or nothing if no phrase is close enough.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Subvocal
{
    public static class Decoder
    {
        public const double CarrierHz = 2000.0;
        public const double FrameHz = 200.0;
        public const double LowpassHz = 150.0;
        public const double MmPerRad = (299.792458 / 61.0) / (4 * Math.PI);   // 0.391 mm of skin motion per radian
        public const int SettleFrames = 12;                                    // 60 ms filter start-up, dropped
        public const int FeatureDecimation = 4;                                // features at 50 Hz

        /// <summary>Recover the radar's complex signal from the microphone audio (mix with 2 kHz, low-pass, 200 Hz).</summary>
        public static (float[] I, float[] Q) Demodulate(short[] pcm, int sampleRate)
        {
            double w = 2 * Math.PI * CarrierHz / sampleRate;
            int dec = (int)Math.Round(sampleRate / FrameHz);
            double a = 1 - Math.Exp(-2 * Math.PI * LowpassHz / sampleRate);
            double ph = 0, li = 0, lq = 0, lj = 0, lk = 0;
            int n = 0;
            var oi = new List<float>(pcm.Length / dec + 1);
            var oq = new List<float>(pcm.Length / dec + 1);
            for (int k = 0; k < pcm.Length; k++)
            {
                double x = pcm[k] / 32768.0;
                double c = Math.Cos(ph), s = Math.Sin(ph);
                ph += w; if (ph > 2 * Math.PI) ph -= 2 * Math.PI;
                li += a * (2 * x * c - li); lq += a * (-2 * x * s - lq);
                lj += a * (li - lj); lk += a * (lq - lk);
                if (++n >= dec) { n = 0; oi.Add((float)lj); oq.Add((float)lk); }
            }
            int skip = Math.Min(SettleFrames, oi.Count);
            return (oi.Skip(skip).ToArray(), oq.Skip(skip).ToArray());
        }

        /// <summary>Skin displacement in mm (unwrapped phase), one value per 200 Hz frame.</summary>
        public static double[] Displacement(float[] i, float[] q)
        {
            var d = new double[i.Length];
            double last = 0, un = 0;
            for (int k = 0; k < i.Length; k++)
            {
                double p = Math.Atan2(q[k], i[k]);
                if (k > 0)
                {
                    double dp = p - last;
                    if (dp > Math.PI) dp -= 2 * Math.PI;
                    if (dp < -Math.PI) dp += 2 * Math.PI;
                    un += dp;
                }
                last = p;
                d[k] = un * MmPerRad;
            }
            return d;
        }

        /// <summary>
        /// Motion features of the active part of a take: [displacement, velocity], each z-normalised, at 50 Hz.
        /// Returns null when the take holds no articulation (silence or too short).
        /// </summary>
        public static float[][]? Features(float[] i, float[] q)
        {
            int n = i.Length;
            if (n < 40) return null;
            var d = Displacement(i, q);

            var v = new double[n];
            for (int k = 1; k < n; k++) v[k] = d[k] - d[k - 1];
            var vs = new double[n];
            for (int k = 0; k < n; k++) vs[k] = (v[Math.Max(0, k - 1)] + v[k] + v[Math.Min(n - 1, k + 1)]) / 3.0;

            // activity: 50 ms moving average of |velocity|
            var e = new double[n];
            double acc = 0;
            for (int k = 0; k < n; k++)
            {
                acc += Math.Abs(vs[k]);
                if (k >= 10) acc -= Math.Abs(vs[k - 10]);
                e[k] = acc / Math.Min(k + 1, 10);
            }
            var sorted = (double[])e.Clone();
            Array.Sort(sorted);
            double floor = sorted[(int)(0.2 * (n - 1))], peak = sorted[n - 1];
            if (peak < 4 * floor || peak < 1e-4) return null;
            double thr = Math.Max(3 * floor, 0.08 * peak);

            int s = 0, t = n - 1;
            while (s < n && e[s] < thr) s++;
            while (t > s && e[t] < thr) t--;
            s = Math.Max(0, s - 20); t = Math.Min(n - 1, t + 20);
            int len = t - s + 1;
            if (len < 30) return null;

            double md = 0, mv = 0;
            for (int k = s; k <= t; k++) { md += d[k]; mv += vs[k]; }
            md /= len; mv /= len;
            double sd = 0, sv = 0;
            for (int k = s; k <= t; k++) { sd += (d[k] - md) * (d[k] - md); sv += (vs[k] - mv) * (vs[k] - mv); }
            sd = Math.Sqrt(sd / len) + 1e-9; sv = Math.Sqrt(sv / len) + 1e-9;

            int m = len / FeatureDecimation;
            var f = new float[m][];
            for (int j = 0; j < m; j++)
            {
                double fd = 0, fv = 0;
                for (int r = 0; r < FeatureDecimation; r++) { int k = s + j * FeatureDecimation + r; fd += (d[k] - md) / sd; fv += (vs[k] - mv) / sv; }
                f[j] = new[] { (float)(fd / FeatureDecimation), (float)(fv / FeatureDecimation) };
            }
            return f;
        }

        /// <summary>Dynamic time warping distance (Sakoe-Chiba band), normalised by path length.</summary>
        public static double Dtw(float[][] a, float[][] b)
        {
            int n = a.Length, m = b.Length;
            if (n == 0 || m == 0) return double.PositiveInfinity;
            int band = Math.Max(Math.Abs(n - m), (int)(0.3 * Math.Max(n, m))) + 1;
            var prev = new double[m + 1];
            var cur = new double[m + 1];
            for (int j = 0; j <= m; j++) prev[j] = double.PositiveInfinity;
            prev[0] = 0;
            for (int i = 1; i <= n; i++)
            {
                for (int j = 0; j <= m; j++) cur[j] = double.PositiveInfinity;
                int jc = (int)Math.Round((double)i * m / n);
                int j0 = Math.Max(1, jc - band), j1 = Math.Min(m, jc + band);
                for (int j = j0; j <= j1; j++)
                {
                    double dx = a[i - 1][0] - b[j - 1][0], dy = a[i - 1][1] - b[j - 1][1];
                    double c = Math.Sqrt(dx * dx + dy * dy);
                    cur[j] = c + Math.Min(prev[j - 1], Math.Min(prev[j], cur[j - 1]));
                }
                var tmp = prev; prev = cur; cur = tmp;
            }
            return prev[m] / (n + m);
        }
    }

    public sealed class Recognition
    {
        public string? Text;          // null = nothing recognised
        public double Distance;       // DTW distance of the best phrase
        public double Threshold;      // acceptance threshold in use
        public string? BestGuess;     // best phrase even when rejected
        public string Reason = "";
    }

    /// <summary>Nearest-neighbour phrase recogniser over DTW distances.</summary>
    public sealed class Recognizer
    {
        public double RejectScale = 1.8;   // accept when distance < RejectScale x typical same-phrase distance (Sensitivity setting)

        readonly List<(string text, List<float[][]> takes)> _phrases = new();
        double _typical = double.NaN;

        public int PhraseCount => _phrases.Count;

        public void Train(PhraseModel model)
        {
            _phrases.Clear();
            foreach (var p in model.Phrases)
            {
                var feats = p.Takes.Select(t => Decoder.Features(t.I, t.Q)).Where(f => f != null).Select(f => f!).ToList();
                if (feats.Count > 0) _phrases.Add((p.Text, feats));
            }
            // typical distance between two takes of the same phrase (leave-one-out nearest neighbour)
            var within = new List<double>();
            foreach (var (_, takes) in _phrases)
                for (int a = 0; a < takes.Count; a++)
                {
                    double best = double.PositiveInfinity;
                    for (int b = 0; b < takes.Count; b++) if (a != b) best = Math.Min(best, Decoder.Dtw(takes[a], takes[b]));
                    if (!double.IsInfinity(best)) within.Add(best);
                }
            within.Sort();
            _typical = within.Count > 0 ? within[within.Count / 2] : double.NaN;
        }

        public Recognition Recognize(float[] i, float[] q)
        {
            var r = new Recognition();
            if (_phrases.Count == 0) { r.Reason = "no phrases trained yet"; return r; }
            var f = Decoder.Features(i, q);
            if (f == null) { r.Reason = "no movement detected"; return r; }
            double best = double.PositiveInfinity;
            string? bestText = null;
            foreach (var (text, takes) in _phrases)
                foreach (var t in takes)
                {
                    double dist = Decoder.Dtw(f, t);
                    if (dist < best) { best = dist; bestText = text; }
                }
            r.Distance = best; r.BestGuess = bestText;
            r.Threshold = double.IsNaN(_typical) ? double.PositiveInfinity : RejectScale * _typical;
            if (best <= r.Threshold) { r.Text = bestText; r.Reason = "ok"; }
            else r.Reason = "not close to any trained phrase";
            return r;
        }
    }
}
