using System;
using System.Runtime.InteropServices;

namespace Subvocal
{
    /// <summary>Global hold-to-talk key (default F8). The key itself is swallowed so it does not reach the focused app.</summary>
    public sealed class KeyHook : IDisposable
    {
        readonly Native.LowLevelKeyboardProc _proc;   // keep a reference: the hook calls into it
        IntPtr _hook;
        bool _down;

        public int VirtualKey { get; set; } = 0x77;    // F8
        public event Action? Pressed;
        public event Action? Released;

        public KeyHook()
        {
            _proc = Hook;
            _hook = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, _proc, Native.GetModuleHandle(null), 0);
        }

        IntPtr Hook(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                var k = Marshal.PtrToStructure<Native.KBDLLHOOKSTRUCT>(lParam);
                if ((k.flags & Native.LLKHF_INJECTED) == 0 && k.vkCode == VirtualKey)
                {
                    int msg = (int)wParam;
                    if (msg == Native.WM_KEYDOWN || msg == Native.WM_SYSKEYDOWN) { if (!_down) { _down = true; Pressed?.Invoke(); } return (IntPtr)1; }
                    if (msg == Native.WM_KEYUP || msg == Native.WM_SYSKEYUP) { if (_down) { _down = false; Released?.Invoke(); } return (IntPtr)1; }
                }
            }
            return Native.CallNextHookEx(_hook, nCode, wParam, lParam);
        }

        public void Dispose()
        {
            if (_hook != IntPtr.Zero) { Native.UnhookWindowsHookEx(_hook); _hook = IntPtr.Zero; }
        }
    }
}
