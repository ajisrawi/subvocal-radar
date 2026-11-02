using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace Subvocal
{
    /// <summary>Records 16 kHz mono 16-bit PCM with waveIn (no extra libraries). Buffers are recycled on a worker thread.</summary>
    public sealed class WaveRecorder : IDisposable
    {
        public const int SampleRate = 16000;
        const int BufferCount = 6, BufferSamples = SampleRate / 20;   // 50 ms each
        const int CALLBACK_EVENT = 0x50000;

        [DllImport("winmm.dll")] static extern uint waveInOpen(out IntPtr h, IntPtr id, ref Native.WAVEFORMATEX fmt, IntPtr cb, IntPtr inst, int flags);

        IntPtr _h;
        readonly List<IntPtr> _hdrs = new();
        AutoResetEvent? _evt;
        Thread? _thread;
        volatile bool _running;
        readonly List<short> _pcm = new();
        readonly object _lock = new();

        public bool IsRecording => _running;
        public event Action<float>? Level;   // 0..1, from the worker thread

        public static List<string> Devices()
        {
            var list = new List<string>();
            uint n = Native.waveInGetNumDevs();
            for (uint i = 0; i < n; i++)
                list.Add(Native.waveInGetDevCaps((IntPtr)i, out var c, (uint)Marshal.SizeOf<Native.WAVEINCAPS>()) == 0 ? c.szPname : $"Device {i}");
            return list;
        }

        /// <summary>Index of the first input whose name contains "Radar" (the dongle), or -1.</summary>
        public static int FindRadar()
        {
            var d = Devices();
            for (int i = 0; i < d.Count; i++) if (d[i].IndexOf("radar", StringComparison.OrdinalIgnoreCase) >= 0) return i;
            return -1;
        }

        public bool Start(int device)
        {
            Stop();
            lock (_lock) _pcm.Clear();
            var fmt = new Native.WAVEFORMATEX { wFormatTag = 1, nChannels = 1, nSamplesPerSec = SampleRate, wBitsPerSample = 16, nBlockAlign = 2, nAvgBytesPerSec = SampleRate * 2 };
            _evt = new AutoResetEvent(false);
            IntPtr id = device >= 0 ? (IntPtr)device : (IntPtr)(-1);   // -1 = WAVE_MAPPER
            if (waveInOpen(out _h, id, ref fmt, _evt.SafeWaitHandle.DangerousGetHandle(), IntPtr.Zero, CALLBACK_EVENT) != 0) { _evt.Dispose(); _evt = null; return false; }
            int hsz = Marshal.SizeOf<Native.WAVEHDR>();
            for (int i = 0; i < BufferCount; i++)
            {
                var hdr = new Native.WAVEHDR { lpData = Marshal.AllocHGlobal(BufferSamples * 2), dwBufferLength = BufferSamples * 2 };
                IntPtr p = Marshal.AllocHGlobal(hsz);
                Marshal.StructureToPtr(hdr, p, false);
                Native.waveInPrepareHeader(_h, p, hsz);
                Native.waveInAddBuffer(_h, p, hsz);
                _hdrs.Add(p);
            }
            _running = true;
            _thread = new Thread(Pump) { IsBackground = true, Name = "waveIn" };
            _thread.Start();
            Native.waveInStart(_h);
            return true;
        }

        void Pump()
        {
            int hsz = Marshal.SizeOf<Native.WAVEHDR>();
            var tmp = new short[BufferSamples];
            while (_running)
            {
                _evt!.WaitOne(100);
                foreach (var p in _hdrs)
                {
                    var hdr = Marshal.PtrToStructure<Native.WAVEHDR>(p);
                    if ((hdr.dwFlags & Native.WHDR_DONE) == 0) continue;
                    int n = (int)hdr.dwBytesRecorded / 2;
                    if (n > 0)
                    {
                        Marshal.Copy(hdr.lpData, tmp, 0, n);
                        double sum = 0;
                        for (int i = 0; i < n; i++) sum += (double)tmp[i] * tmp[i];
                        lock (_lock) for (int i = 0; i < n; i++) _pcm.Add(tmp[i]);
                        Level?.Invoke((float)Math.Min(1, Math.Sqrt(sum / n) / 32768 * 4));
                    }
                    if (!_running) break;
                    hdr.dwFlags &= ~(uint)Native.WHDR_DONE;
                    hdr.dwBytesRecorded = 0;
                    Marshal.StructureToPtr(hdr, p, false);
                    Native.waveInAddBuffer(_h, p, hsz);
                }
            }
        }

        /// <summary>Stops and returns everything recorded since Start.</summary>
        public short[] Stop()
        {
            if (_h == IntPtr.Zero) { lock (_lock) return _pcm.ToArray(); }
            _running = false;
            Native.waveInReset(_h);
            _thread?.Join(500);
            int hsz = Marshal.SizeOf<Native.WAVEHDR>();
            foreach (var p in _hdrs)
            {
                var hdr = Marshal.PtrToStructure<Native.WAVEHDR>(p);
                Native.waveInUnprepareHeader(_h, p, hsz);
                Marshal.FreeHGlobal(hdr.lpData);
                Marshal.FreeHGlobal(p);
            }
            _hdrs.Clear();
            Native.waveInClose(_h);
            _h = IntPtr.Zero;
            _evt?.Dispose(); _evt = null;
            lock (_lock) return _pcm.ToArray();
        }

        public void Dispose() => Stop();
    }
}
