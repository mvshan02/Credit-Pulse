$ErrorActionPreference = 'Stop'
$media = Join-Path (Split-Path -Parent $PSScriptRoot) 'media'
Add-Type -AssemblyName PresentationCore, WindowsBase
[xml]$svg = Get-Content -LiteralPath (Join-Path $media 'pulse.svg') -Raw
$visual = [System.Windows.Media.DrawingVisual]::new()
$drawing = $visual.RenderOpen()
$background = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#0d1712')
$drawing.DrawRoundedRectangle($background, $null, [System.Windows.Rect]::new(0, 0, 256, 256), 52, 52)
$drawing.PushTransform([System.Windows.Media.ScaleTransform]::new(8, 8))
$drawing.PushTransform([System.Windows.Media.TranslateTransform]::new(4, 4))
$color = [System.Windows.Media.ColorConverter]
$signal = [System.Windows.Media.LinearGradientBrush]::new()
$signal.StartPoint = [System.Windows.Point]::new(0, 0)
$signal.EndPoint = [System.Windows.Point]::new(1, 1)
$signal.GradientStops.Add([System.Windows.Media.GradientStop]::new($color::ConvertFromString('#6dff8b'), 0))
$signal.GradientStops.Add([System.Windows.Media.GradientStop]::new($color::ConvertFromString('#ffd166'), .65))
$signal.GradientStops.Add([System.Windows.Media.GradientStop]::new($color::ConvertFromString('#ff4d6d'), 1))
foreach ($path in $svg.svg.path) {
    $pen = [System.Windows.Media.Pen]::new($signal, [double]$path.'stroke-width')
    $pen.StartLineCap = 'Round'; $pen.EndLineCap = 'Round'; $pen.LineJoin = 'Round'
    $drawing.DrawGeometry($null, $pen, [System.Windows.Media.Geometry]::Parse($path.d))
}
$drawing.Pop(); $drawing.Pop(); $drawing.Close()
$bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new(256, 256, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
$bitmap.Render($visual)
$encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
$encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
$file = [System.IO.File]::Create((Join-Path $media 'icon.png'))
try { $encoder.Save($file) } finally { $file.Dispose() }
