using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace Subvocal
{
    /// <summary>Small status pill at the bottom of the screen. It never takes focus, so text still lands in the user's app.</summary>
    public sealed class PillWindow : Window
    {
        readonly TextBlock _text = new() { Foreground = Brushes.White, FontSize = 14, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 4, 0) };
        readonly Ellipse _dot = new() { Width = 12, Height = 12, VerticalAlignment = VerticalAlignment.Center };
        readonly Rectangle _meter = new() { Height = 3, HorizontalAlignment = HorizontalAlignment.Left, Fill = new SolidColorBrush(Color.FromRgb(63, 184, 174)), RadiusX = 1.5, RadiusY = 1.5 };
        readonly DispatcherTimer _hide = new() { Interval = TimeSpan.FromSeconds(1.6) };

        static readonly Brush Teal = new SolidColorBrush(Color.FromRgb(63, 184, 174)), Amber = new SolidColorBrush(Color.FromRgb(240, 138, 93)), Red = new SolidColorBrush(Color.FromRgb(230, 80, 80));

        public PillWindow()
        {
            WindowStyle = WindowStyle.None; AllowsTransparency = true; Background = Brushes.Transparent; Topmost = true;
            ShowInTaskbar = false; ShowActivated = false; ResizeMode = ResizeMode.NoResize; SizeToContent = SizeToContent.WidthAndHeight;
            var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(14, 9, 16, 6) };
            row.Children.Add(_dot); row.Children.Add(_text);
            var stack = new StackPanel();
            stack.Children.Add(row);
            stack.Children.Add(new Border { Margin = new Thickness(14, 0, 14, 7), Child = _meter });
            Content = new Border { CornerRadius = new CornerRadius(18), Background = new SolidColorBrush(Color.FromArgb(235, 23, 27, 33)), Child = stack };
            _hide.Tick += (_, _) => { _hide.Stop(); Hide(); };
            SourceInitialized += (_, _) =>
            {
                var h = new WindowInteropHelper(this).Handle;
                SetWindowLong(h, -20, GetWindowLong(h, -20) | 0x08000000 /*NOACTIVATE*/ | 0x80 /*TOOLWINDOW*/ | 0x20 /*TRANSPARENT*/);
            };
        }

        void Place()
        {
            UpdateLayout();
            var wa = SystemParameters.WorkArea;
            Left = wa.Left + (wa.Width - ActualWidth) / 2;
            Top = wa.Bottom - ActualHeight - 24;
        }

        public void ShowListening(string text)
        {
            _hide.Stop();
            _dot.Fill = Red; _text.Text = text; _meter.Width = 0; _meter.Visibility = Visibility.Visible;
            Show(); Place();
        }

        public void SetLevel(float level) { if (IsVisible) _meter.Width = Math.Max(2, Math.Min(1, level) * Math.Max(60, ActualWidth - 28)); }

        public void ShowMessage(string text, bool ok)
        {
            _dot.Fill = ok ? Teal : Amber; _text.Text = text; _meter.Visibility = Visibility.Collapsed;
            Show(); Place();
            _hide.Stop(); _hide.Start();
        }

        [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
        [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
    }
}
