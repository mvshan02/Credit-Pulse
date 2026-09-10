using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace CreditPulse {
    static class Program {
        [STAThread]
        static void Main() {
            try { new Application().Run(new Overlay()); }
            catch { Wire.Send(new { type = "error" }); }
        }
    }

    static class Wire {
        static readonly StreamWriter Output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        public static void Send(object value) {
            try { lock (Output) Output.WriteLine(new JavaScriptSerializer().Serialize(value)); }
            catch (IOException) { }
        }
    }

    sealed class Overlay : Window {
        readonly SolidColorBrush accent = new SolidColorBrush(Color.FromRgb(109, 255, 139));
        readonly SolidColorBrush surface = new SolidColorBrush(Color.FromRgb(16, 29, 28));
        readonly SolidColorBrush ink = new SolidColorBrush(Color.FromRgb(235, 247, 244));
        readonly SolidColorBrush muted = new SolidColorBrush(Color.FromRgb(167, 191, 190));
        readonly Border shell = new Border();
        readonly Grid root = new Grid();
        readonly StackPanel bubble = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        readonly Grid card = new Grid();
        readonly TextBlock bubbleValue;
        readonly TextBlock sessionValue;
        readonly TextBlock longValue;
        readonly TextBlock sessionReset;
        readonly TextBlock longReset;
        readonly TextBlock signal;
        readonly TextBlock credit;
        readonly ProgressBar sessionBar;
        readonly ProgressBar longBar;
        readonly StackPanel tips = new StackPanel();
        readonly StackPanel history = new StackPanel();
        readonly System.Windows.Shapes.Path mouth;
        readonly DispatcherTimer positionTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        readonly DispatcherTimer clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
        bool isBubble = true, initialized;
        Dictionary<string, object> latest = new Dictionary<string, object>();
        IntPtr hwnd;

        public Overlay() {
            Title = "Credit Pulse Desktop";
            Width = 96; Height = 96;
            WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
            AllowsTransparency = true; Background = Brushes.Transparent;
            ShowInTaskbar = false; ShowActivated = false; Topmost = true;
            FontFamily = new FontFamily("Cascadia Code, Consolas"); Foreground = ink;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = SystemParameters.WorkArea.Right - 118; Top = SystemParameters.WorkArea.Top + 100;
            shell.Margin = new Thickness(4); shell.Padding = new Thickness(0);
            shell.BorderThickness = new Thickness(2); shell.BorderBrush = accent;
            shell.CornerRadius = new CornerRadius(48);
            shell.Background = new LinearGradientBrush(Color.FromRgb(49, 72, 70), Color.FromRgb(8, 19, 22), 65);
            shell.Child = root; Content = shell;

            Grid robot = new Grid { Width = 38, Height = 32, HorizontalAlignment = HorizontalAlignment.Center };
            robot.Children.Add(new Border { Margin = new Thickness(3, 6, 3, 0), BorderBrush = accent, BorderThickness = new Thickness(1.5), CornerRadius = new CornerRadius(8), Background = surface });
            robot.Children.Add(Stroke("M19,2 L19,6 M11,14 L11,18 M27,14 L27,18", 2.5));
            mouth = Stroke("M13,23 Q19,29 25,23", 2);
            robot.Children.Add(mouth);
            bubbleValue = Label("--", 18, accent); bubbleValue.HorizontalAlignment = HorizontalAlignment.Center;
            bubble.Children.Add(robot); bubble.Children.Add(bubbleValue); root.Children.Add(bubble);
            shell.ToolTip = "Drag anywhere on your desktop. Click to expand. Right-click for controls.";

            card.Margin = new Thickness(16);
            card.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            card.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            card.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var header = new DockPanel { Margin = new Thickness(0, 0, 0, 14), Cursor = Cursors.SizeAll, Background = Brushes.Transparent };
            var close = Button("X", delegate { Close(); }); close.ToolTip = "Close desktop overlay";
            DockPanel.SetDock(close, Dock.Right); header.Children.Add(close);
            var minimize = Button("O", delegate { ApplyMode("bubble"); }); minimize.ToolTip = "Minimize to desktop bubble";
            DockPanel.SetDock(minimize, Dock.Right); header.Children.Add(minimize);
            var logo = new Canvas { Width = 24, Height = 24 };
            logo.Children.Add(Stroke("M12,2.5 A9.5,9.5 0 1 0 12,21.5 A9.5,9.5 0 1 0 12,2.5 M13.2,2.9 L6.9,12 L11,12 L9.8,21.1 L17.1,11.1 L12.8,11.1 Z", 1.5));
            header.Children.Add(new Viewbox { Child = logo, Width = 30, Height = 30, Margin = new Thickness(0, 0, 9, 0) });
            header.Children.Add(Label("CREDIT PULSE\nDRAG TO MOVE", 12, ink));
            Grid.SetRow(header, 0); card.Children.Add(header);
            var content = new StackPanel();
            signal = Label("CONNECTING", 11, muted); content.Children.Add(signal);
            var sessionCard = QuotaCard("5-HOUR SESSION", out sessionValue, out sessionReset, out sessionBar);
            var longCard = QuotaCard("LONG WINDOW", out longValue, out longReset, out longBar);
            content.Children.Add(sessionCard); content.Children.Add(longCard);
            credit = Label("CREDITS --", 11, muted); credit.Margin = new Thickness(2, 10, 0, 16); content.Children.Add(credit);
            content.Children.Add(Label("TAILORED ADVICE", 11, accent)); content.Children.Add(tips);
            var historyLabel = Label("RECENT CHAT", 11, accent); historyLabel.Margin = new Thickness(0, 18, 0, 7);
            content.Children.Add(historyLabel); content.Children.Add(history);
            var scroll = new ScrollViewer { Content = content, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
            Grid.SetRow(scroll, 1); card.Children.Add(scroll);
            var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 14, 0, 0) };
            actions.Children.Add(Button("REFRESH", delegate { SendAction("refresh"); }));
            actions.Children.Add(Button("VS CODE", delegate { SendAction("open"); }));
            Grid.SetRow(actions, 2); card.Children.Add(actions);
            card.Visibility = Visibility.Collapsed; root.Children.Add(card);

            var menu = new ContextMenu();
            AddMenu(menu, "Bubble / card", delegate { ApplyMode(isBubble ? "card" : "bubble"); });
            AddMenu(menu, "Refresh usage", delegate { SendAction("refresh"); });
            AddMenu(menu, "Open console in VS Code", delegate { SendAction("open"); });
            AddMenu(menu, "Close overlay", delegate { Close(); });
            shell.ContextMenu = menu;
            AttachDrag(shell, true); AttachDrag(header, false);
            KeyDown += delegate(object sender, KeyEventArgs e) {
                if (e.Key == Key.Escape) { if (isBubble) Close(); else ApplyMode("bubble"); e.Handled = true; }
                if (e.Key == Key.Enter && isBubble) { ApplyMode("card"); e.Handled = true; }
            };
            SourceInitialized += delegate {
                hwnd = new WindowInteropHelper(this).Handle;
                Native.SetWindowLong(hwnd, -20, Native.GetWindowLong(hwnd, -20) | 0x80);
                HwndSource.FromHwnd(hwnd).AddHook(WindowMessage);
            };
            positionTimer.Tick += delegate { positionTimer.Stop(); SavePosition(); };
            LocationChanged += delegate { if (initialized) { positionTimer.Stop(); positionTimer.Start(); } };
            clockTimer.Tick += delegate { UpdateClock(); };
            Closed += delegate { positionTimer.Stop(); clockTimer.Stop(); SavePosition(); };
            Loaded += delegate {
                Wire.Send(new { type = "ready" });
                clockTimer.Start();
                var reader = new Thread(ReadMessages) { IsBackground = true, Name = "Credit Pulse bridge" };
                reader.Start();
            };
        }

        TextBlock Label(string text, double size, Brush color) {
            return new TextBlock { Text = text, FontSize = size, Foreground = color, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center };
        }
        System.Windows.Shapes.Path Stroke(string geometry, double width) {
            return new System.Windows.Shapes.Path { Data = Geometry.Parse(geometry), Stroke = accent, StrokeThickness = width, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round };
        }
        Button Button(string title, Action action) {
            var button = new Button { Content = title, Foreground = ink, Background = surface, BorderBrush = accent, Padding = new Thickness(9, 6, 9, 6), Margin = new Thickness(0, 0, 6, 0), FontSize = 10, Cursor = Cursors.Hand };
            button.Click += delegate { action(); };
            return button;
        }
        Border QuotaCard(string title, out TextBlock value, out TextBlock reset, out ProgressBar bar) {
            var body = new StackPanel(); body.Children.Add(Label(title, 10, muted));
            value = Label("--", 29, accent); value.Margin = new Thickness(0, 5, 0, 5); body.Children.Add(value);
            bar = new ProgressBar { Height = 5, Maximum = 100, Foreground = accent, Background = surface, BorderThickness = new Thickness(0) }; body.Children.Add(bar);
            reset = Label("Reset unknown", 10, muted); reset.Margin = new Thickness(0, 8, 0, 0); body.Children.Add(reset);
            return new Border { Child = body, Padding = new Thickness(12), Margin = new Thickness(0, 10, 0, 0), CornerRadius = new CornerRadius(15), BorderBrush = new SolidColorBrush(Color.FromArgb(48, 220, 255, 245)), BorderThickness = new Thickness(1), Background = surface };
        }
        void AddMenu(ContextMenu menu, string title, Action action) {
            var item = new MenuItem { Header = title }; item.Click += delegate { action(); }; menu.Items.Add(item);
        }
        void SendAction(string action) { Wire.Send(new { type = "action", action = action }); }

        void AttachDrag(UIElement handle, bool bubbleOnly) {
            Native.Point? start = null;
            Native.Rect origin = new Native.Rect();
            bool moved = false;
            Action move = delegate {
                if (!start.HasValue) return;
                Native.Point point; if (!Native.GetCursorPos(out point)) return;
                int dx = point.X - start.Value.X, dy = point.Y - start.Value.Y;
                if (!moved && Math.Abs(dx) < 5 && Math.Abs(dy) < 5) return;
                moved = true;
                // Physical screen coordinates avoid DPI drift and permit crossing monitors.
                Native.SetWindowPos(hwnd, new IntPtr(-1), origin.Left + dx, origin.Top + dy, 0, 0, 0x0011);
            };
            Action finish = delegate {
                if (!start.HasValue) return;
                start = null;
                handle.ReleaseMouseCapture();
                KeepOnScreen(false); SavePosition();
            };
            handle.MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e) {
                if (bubbleOnly != isBubble || IsButton(e.OriginalSource as DependencyObject)) return;
                Native.Point point;
                if (!Native.GetCursorPos(out point) || !Native.GetWindowRect(hwnd, out origin)) return;
                if (!handle.CaptureMouse()) return;
                start = point; moved = false; e.Handled = true;
            };
            handle.MouseMove += delegate(object sender, MouseEventArgs e) {
                if (!start.HasValue) return;
                if (e.LeftButton != MouseButtonState.Pressed || bubbleOnly != isBubble) { finish(); return; }
                move(); e.Handled = true;
            };
            handle.MouseLeftButtonUp += delegate(object sender, MouseButtonEventArgs e) {
                if (!start.HasValue) return;
                move();
                bool expand = !moved && isBubble && bubbleOnly;
                finish(); e.Handled = true;
                if (expand) ApplyMode("card");
            };
            handle.LostMouseCapture += delegate { finish(); };
        }
        static bool IsButton(DependencyObject source) {
            while (source != null) {
                if (source is System.Windows.Controls.Primitives.ButtonBase) return true;
                source = source is Visual ? VisualTreeHelper.GetParent(source) : LogicalTreeHelper.GetParent(source);
            }
            return false;
        }

        void ReadMessages() {
            try {
                using (var reader = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8)) {
                    string line;
                    while ((line = reader.ReadLine()) != null) {
                        if (line.Length > 4000000) break;
                        Dictionary<string, object> message;
                        try { message = new JavaScriptSerializer { MaxJsonLength = 4000000 }.DeserializeObject(line) as Dictionary<string, object>; }
                        catch (ArgumentException) { continue; }
                        if (message != null) {
                            var copy = message;
                            Dispatcher.BeginInvoke(new Action(delegate { Receive(copy); }));
                        }
                    }
                }
            } catch (IOException) { }
            // Closing VS Code closes the private pipe, so no orphan overlay remains.
            Dispatcher.BeginInvoke(new Action(Close));
        }
        void Receive(Dictionary<string, object> message) {
            string type = Text(message, "type");
            if (type == "initialize") {
                initialized = true;
                ApplyMode(Text(message, "mode"));
                var position = Obj(message, "position");
                if (Number(position, "x").HasValue && Number(position, "y").HasValue) {
                    Native.SetWindowPos(hwnd, new IntPtr(-1), (int)Number(position, "x").Value, (int)Number(position, "y").Value, 0, 0, 0x0011);
                }
                Dispatcher.BeginInvoke(new Action(delegate { KeepOnScreen(false); SavePosition(); }));
            } else if (type == "mode") { ApplyMode(Text(message, "mode")); }
            else if (type == "usage") { latest = message; Render(); }
            else if (type == "close") Close();
            else if (type == "inspect") {
                Native.Rect bounds; Native.GetWindowRect(hwnd, out bounds);
                Wire.Send(new { type = "inspection", handle = hwnd.ToInt64(), bubble = isBubble, topmost = Topmost, nativeTopmost = (Native.GetWindowLong(hwnd, -20) & 8) != 0, showInTaskbar = ShowInTaskbar, session = sessionValue.Text, longWindow = longValue.Text, accent = accent.Color.ToString(), adviceCount = tips.Children.Count, x = bounds.Left, y = bounds.Top, width = bounds.Right - bounds.Left, height = bounds.Bottom - bounds.Top });
            }
        }
        void ApplyMode(string mode) {
            isBubble = mode != "card";
            Width = isBubble ? 96 : 378;
            Height = isBubble ? 96 : Math.Min(680, SystemParameters.WorkArea.Height - 24);
            shell.CornerRadius = new CornerRadius(isBubble ? 48 : 24);
            bubble.Visibility = isBubble ? Visibility.Visible : Visibility.Collapsed;
            card.Visibility = isBubble ? Visibility.Collapsed : Visibility.Visible;
            shell.ToolTip = isBubble ? "Drag across your screen. Click to expand. Right-click to close." : null;
            Dispatcher.BeginInvoke(new Action(delegate { KeepOnScreen(false); SavePosition(); }));
        }
        void Render() {
            var data = Obj(latest, "data"); var settings = Obj(latest, "settings"); var appearance = Obj(settings, "appearance");
            var session = Quota(data, "primary"); var longer = Quota(data, "secondary");
            double pressure = Math.Max(Number(session, "used") ?? 0, Number(longer, "used") ?? 0);
            double threshold = Number(settings, "threshold") ?? 80;
            Color safe = ColorValue(Text(appearance, "safeColor"), Color.FromRgb(109, 255, 139));
            Color warn = ColorValue(Text(appearance, "warningColor"), Color.FromRgb(255, 209, 102));
            Color danger = ColorValue(Text(appearance, "dangerColor"), Color.FromRgb(255, 77, 109));
            accent.Color = pressure <= threshold ? Mix(safe, warn, pressure / threshold) : Mix(warn, danger, (pressure - threshold) / Math.Max(1, 100 - threshold));
            surface.Color = ColorValue(Text(appearance, "panelSurface"), Color.FromRgb(16, 29, 28));
            Color background = ColorValue(Text(appearance, "panelBackground"), Color.FromRgb(8, 19, 22));
            shell.Background = new LinearGradientBrush(Mix(surface.Color, Colors.White, .12), background, 65);
            sessionValue.Text = Percent(session); longValue.Text = Percent(longer);
            bubbleValue.Text = session.Count > 0 ? Percent(session) : Percent(longer);
            AnimateBar(sessionBar, Number(session, "used") ?? 0, settings); AnimateBar(longBar, Number(longer, "used") ?? 0, settings);
            mouth.Data = Geometry.Parse(pressure >= threshold ? "M13,27 Q19,21 25,27" : "M13,23 Q19,29 25,23");
            var credits = Obj(data, "credits"); credit.Text = "CREDITS " + (Flag(credits, "unlimited") ? "Unlimited" : Text(credits, "balance", "--"));
            tips.Children.Clear();
            foreach (object tip in Items(latest, "advice").Take(3)) {
                var label = Label(Convert.ToString(tip), 11, ink); label.Margin = new Thickness(0, 8, 0, 0); tips.Children.Add(label);
            }
            history.Children.Clear();
            var chat = Items(latest, "chats").OfType<Dictionary<string, object>>().FirstOrDefault();
            if (chat != null) {
                history.Children.Add(Label(Text(chat, "title"), 12, ink));
                history.Children.Add(Label(Text(chat, "requestCount", "0") + " requests / " + Tokens(Number(Obj(chat, "usage"), "total_tokens")) + " tokens", 10, muted));
                foreach (var request in Items(chat, "requests").OfType<Dictionary<string, object>>().Reverse().Take(3)) {
                    var label = Label(Text(request, "preview") + "  [" + Tokens(Number(Obj(request, "usage"), "total_tokens")) + "]", 10, muted);
                    label.Margin = new Thickness(0, 8, 0, 0); history.Children.Add(label);
                }
            } else history.Children.Add(Label("No local chat telemetry", 10, muted));
            UpdateClock();
        }
        void AnimateBar(ProgressBar bar, double value, Dictionary<string, object> settings) {
            double previous = bar.Value; bar.BeginAnimation(ProgressBar.ValueProperty, null); bar.Value = Math.Max(0, Math.Min(100, value));
            if (Flag(settings, "emojiAnimations") && SystemParameters.ClientAreaAnimation) bar.BeginAnimation(ProgressBar.ValueProperty, new DoubleAnimation(previous, bar.Value, TimeSpan.FromMilliseconds(450)) { FillBehavior = FillBehavior.Stop });
        }
        void UpdateClock() {
            var data = Obj(latest, "data");
            double now = (DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalSeconds;
            bool live = Text(data, "source") == "live" && now - (Number(data, "observedAt") ?? 0) < 120;
            signal.Text = (live ? "LIVE" : "LAST OBSERVED") + "  /  ALWAYS ON TOP";
            sessionReset.Text = Reset(Quota(data, "primary"), now); longReset.Text = Reset(Quota(data, "secondary"), now);
        }
        static string Reset(Dictionary<string, object> quota, double now) {
            var stamp = Number(quota, "resetsAt"); if (!stamp.HasValue) return "Reset unknown";
            var span = TimeSpan.FromSeconds(Math.Max(0, stamp.Value - now));
            return (Flag(quota, "estimated") ? "Estimated / " : "") + "Reset in " + (span.TotalDays >= 1 ? (int)span.TotalDays + "d " : "") + span.Hours + "h " + span.Minutes + "m";
        }
        static string Percent(Dictionary<string, object> quota) { var number = Number(quota, "used"); return number.HasValue ? Math.Round(number.Value) + "%" : "--"; }
        static string Tokens(double? number) { return !number.HasValue ? "--" : number >= 1000000 ? (number.Value / 1000000).ToString("0.0") + "M" : number >= 1000 ? Math.Round(number.Value / 1000) + "k" : number.Value.ToString(); }
        static Dictionary<string, object> Quota(Dictionary<string, object> data, string id) { return Items(data, "windows").OfType<Dictionary<string, object>>().FirstOrDefault(w => Text(w, "id") == id) ?? new Dictionary<string, object>(); }
        static Dictionary<string, object> Obj(Dictionary<string, object> data, string key) { object value; return data.TryGetValue(key, out value) ? value as Dictionary<string, object> ?? new Dictionary<string, object>() : new Dictionary<string, object>(); }
        static IEnumerable<object> Items(Dictionary<string, object> data, string key) { object value; return data.TryGetValue(key, out value) ? value as object[] ?? new object[0] : new object[0]; }
        static string Text(Dictionary<string, object> data, string key, string fallback = "") { object value; return data.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : fallback; }
        static double? Number(Dictionary<string, object> data, string key) { double result; return double.TryParse(Text(data, key), out result) && !double.IsNaN(result) && !double.IsInfinity(result) ? result : (double?)null; }
        static bool Flag(Dictionary<string, object> data, string key) { object value; return data.TryGetValue(key, out value) && value is bool && (bool)value; }
        static Color ColorValue(string text, Color fallback) { try { return (Color)ColorConverter.ConvertFromString(text); } catch { return fallback; } }
        static Color Mix(Color a, Color b, double amount) { amount = Math.Max(0, Math.Min(1, amount)); return Color.FromRgb((byte)(a.R + (b.R - a.R) * amount), (byte)(a.G + (b.G - a.G) * amount), (byte)(a.B + (b.B - a.B) * amount)); }

        IntPtr WindowMessage(IntPtr handle, int message, IntPtr wParam, IntPtr lParam, ref bool handled) {
            if (message == 0x007E) Dispatcher.BeginInvoke(new Action(delegate { KeepOnScreen(false); SavePosition(); }));
            return IntPtr.Zero;
        }
        void KeepOnScreen(bool snap) {
            if (hwnd == IntPtr.Zero) return;
            Native.Rect bounds; Native.GetWindowRect(hwnd, out bounds);
            var monitor = new Native.MonitorInfo { Size = Marshal.SizeOf(typeof(Native.MonitorInfo)) };
            Native.GetMonitorInfo(Native.MonitorFromWindow(hwnd, 2), ref monitor);
            var work = monitor.Work;
            int width = bounds.Right - bounds.Left, height = bounds.Bottom - bounds.Top;
            int x = Math.Max(work.Left + 8, Math.Min(work.Right - width - 8, bounds.Left));
            int y = Math.Max(work.Top + 8, Math.Min(work.Bottom - height - 8, bounds.Top));
            if (snap) x = bounds.Left + width / 2 < (work.Left + work.Right) / 2 ? work.Left + 8 : work.Right - width - 8;
            Native.SetWindowPos(hwnd, new IntPtr(-1), x, y, 0, 0, 0x0011);
        }
        void SavePosition() {
            if (!initialized || hwnd == IntPtr.Zero) return;
            Native.Rect bounds; if (Native.GetWindowRect(hwnd, out bounds)) Wire.Send(new { type = "position", x = bounds.Left, y = bounds.Top });
        }
    }

    static class Native {
        [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
        [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
        [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int index);
        [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hwnd, int index, int value);
    }
}
