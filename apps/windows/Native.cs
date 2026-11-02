using System;
using System.Runtime.InteropServices;

namespace Subvocal
{
    /// <summary>Win32 calls: low-level keyboard hook, synthetic key presses, waveIn recording.</summary>
    static class Native
    {
        // ---- keyboard hook ----
        public const int WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
        public const int LLKHF_INJECTED = 0x10;
        [StructLayout(LayoutKind.Sequential)] public struct KBDLLHOOKSTRUCT { public int vkCode, scanCode, flags, time; public IntPtr dwExtraInfo; }
        public delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
        [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr hhk);
        [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string? name);
        [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);

        // ---- synthetic input (Ctrl+V) ----
        public const ushort VK_CONTROL = 0x11, VK_V = 0x56, VK_SHIFT = 0x10, VK_MENU = 0x12, VK_LWIN = 0x5B, VK_RWIN = 0x5C;
        [StructLayout(LayoutKind.Sequential)] struct INPUT { public int type; public InputUnion u; }
        [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public MOUSEINPUT mi; }
        [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);

        public static void SendKeys(params (ushort vk, bool up)[] keys)
        {
            var arr = new INPUT[keys.Length];
            for (int i = 0; i < keys.Length; i++)
                arr[i] = new INPUT { type = 1, u = new InputUnion { ki = new KEYBDINPUT { wVk = keys[i].vk, dwFlags = keys[i].up ? 2u : 0u } } };
            SendInput((uint)arr.Length, arr, Marshal.SizeOf<INPUT>());
        }

        public static bool AnyModifierDown() =>
            (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0 || (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0 ||
            (GetAsyncKeyState(VK_MENU) & 0x8000) != 0 || (GetAsyncKeyState(VK_LWIN) & 0x8000) != 0 || (GetAsyncKeyState(VK_RWIN) & 0x8000) != 0;

        // ---- waveIn ----
        public const int CALLBACK_FUNCTION = 0x30000, WIM_DATA = 0x3C0, WHDR_DONE = 1;
        [StructLayout(LayoutKind.Sequential)] public struct WAVEFORMATEX { public ushort wFormatTag, nChannels; public uint nSamplesPerSec, nAvgBytesPerSec; public ushort nBlockAlign, wBitsPerSample, cbSize; }
        [StructLayout(LayoutKind.Sequential)] public struct WAVEHDR { public IntPtr lpData; public uint dwBufferLength, dwBytesRecorded; public IntPtr dwUser; public uint dwFlags, dwLoops; public IntPtr lpNext, reserved; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct WAVEINCAPS { public ushort wMid, wPid; public uint vDriverVersion; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname; public uint dwFormats; public ushort wChannels, wReserved1; }
        public delegate void WaveInProc(IntPtr hwi, uint msg, IntPtr inst, IntPtr p1, IntPtr p2);
        [DllImport("winmm.dll")] public static extern uint waveInGetNumDevs();
        [DllImport("winmm.dll", CharSet = CharSet.Unicode)] public static extern uint waveInGetDevCaps(IntPtr id, out WAVEINCAPS caps, uint size);
        [DllImport("winmm.dll")] public static extern uint waveInOpen(out IntPtr h, IntPtr id, ref WAVEFORMATEX fmt, WaveInProc cb, IntPtr inst, int flags);
        [DllImport("winmm.dll")] public static extern uint waveInPrepareHeader(IntPtr h, IntPtr hdr, int size);
        [DllImport("winmm.dll")] public static extern uint waveInUnprepareHeader(IntPtr h, IntPtr hdr, int size);
        [DllImport("winmm.dll")] public static extern uint waveInAddBuffer(IntPtr h, IntPtr hdr, int size);
        [DllImport("winmm.dll")] public static extern uint waveInStart(IntPtr h);
        [DllImport("winmm.dll")] public static extern uint waveInReset(IntPtr h);
        [DllImport("winmm.dll")] public static extern uint waveInClose(IntPtr h);
    }
}
