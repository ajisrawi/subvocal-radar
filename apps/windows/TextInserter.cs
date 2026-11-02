using System.Threading.Tasks;
using System.Windows;

namespace Subvocal
{
    /// <summary>Types text into the focused app by pasting it (Unicode-safe), then puts the previous clipboard text back.</summary>
    public static class TextInserter
    {
        public static async Task InsertAsync(string text)
        {
            for (int i = 0; i < 40 && Native.AnyModifierDown(); i++) await Task.Delay(50);   // avoid Ctrl+V becoming Win+V
            string? previous = null;
            try { if (Clipboard.ContainsText()) previous = Clipboard.GetText(); } catch { }
            if (!TrySet(text)) return;
            await Task.Delay(30);
            Native.SendKeys((Native.VK_CONTROL, false), (Native.VK_V, false), (Native.VK_V, true), (Native.VK_CONTROL, true));
            await Task.Delay(450);   // let the target app read the clipboard first
            if (previous != null) TrySet(previous);
        }

        static bool TrySet(string text)
        {
            for (int i = 0; i < 10; i++)
            {
                try { Clipboard.SetDataObject(new DataObject(DataFormats.UnicodeText, text), true); return true; }
                catch { System.Threading.Thread.Sleep(30); }
            }
            return false;
        }
    }
}
