using System.Runtime.InteropServices;

namespace AutomationSidecar.Services;

public static class WindowAutomation
{
    public const int SW_RESTORE = 9;
    public const int SW_MINIMIZE = 6;
    public const int SW_MAXIMIZE = 3;
    public const uint GW_OWNER = 4;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetActiveWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    public static IntPtr FindMainWindowForProcess(int processId)
    {
        IntPtr found = IntPtr.Zero;

        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd))
                return true;

            GetWindowThreadProcessId(hwnd, out uint windowPid);
            if (windowPid != processId)
                return true;

            if (GetWindow(hwnd, GW_OWNER) != IntPtr.Zero)
                return true;

            found = hwnd;
            return false;
        }, IntPtr.Zero);

        return found;
    }

    public static void BringWindowToFront(IntPtr hwnd)
    {
        uint currentThreadId = GetCurrentThreadId();
        uint foregroundThreadId = GetWindowThreadProcessId(GetForegroundWindow(), out _);

        if (foregroundThreadId != 0 && foregroundThreadId != currentThreadId)
        {
            AttachThreadInput(currentThreadId, foregroundThreadId, true);
            try
            {
                SetForegroundWindow(hwnd);
                BringWindowToTop(hwnd);
                SetActiveWindow(hwnd);
                SetFocus(hwnd);
            }
            finally
            {
                AttachThreadInput(currentThreadId, foregroundThreadId, false);
            }
        }
        else
        {
            SetForegroundWindow(hwnd);
            BringWindowToTop(hwnd);
            SetActiveWindow(hwnd);
            SetFocus(hwnd);
        }
    }

    public static void RestoreAndFocusProcessWindow(int processId)
    {
        var hwnd = FindMainWindowForProcess(processId);
        if (hwnd == IntPtr.Zero)
            throw new InvalidOperationException($"No top-level window found for processId={processId}");

        ShowWindow(hwnd, SW_RESTORE);
        BringWindowToFront(hwnd);
    }

    public static object TransformWindow(
        int processId,
        int? x,
        int? y,
        int? width,
        int? height,
        bool minimize,
        bool maximize,
        bool bringToFront)
    {
        var hwnd = FindMainWindowForProcess(processId);
        if (hwnd == IntPtr.Zero)
            throw new InvalidOperationException($"No top-level window found for processId={processId}");

        if (minimize)
        {
            ShowWindow(hwnd, SW_MINIMIZE);
        }
        else if (maximize)
        {
            ShowWindow(hwnd, SW_MAXIMIZE);
        }
        else if (bringToFront || x.HasValue || y.HasValue || width.HasValue || height.HasValue)
        {
            ShowWindow(hwnd, SW_RESTORE);
        }

        if (bringToFront)
        {
            BringWindowToFront(hwnd);
        }

        if (x.HasValue || y.HasValue || width.HasValue || height.HasValue)
        {
            if (!GetWindowRect(hwnd, out RECT rect))
                throw new InvalidOperationException($"GetWindowRect failed for hwnd={hwnd}");

            int newX = x ?? rect.Left;
            int newY = y ?? rect.Top;
            int newWidth = width ?? (rect.Right - rect.Left);
            int newHeight = height ?? (rect.Bottom - rect.Top);

            if (!MoveWindow(hwnd, newX, newY, newWidth, newHeight, true))
                throw new InvalidOperationException($"MoveWindow failed for hwnd={hwnd}");
        }

        return new
        {
            ok = true,
            processId,
            hwnd = hwnd.ToInt64(),
            applied = new
            {
                x,
                y,
                width,
                height,
                minimize,
                maximize,
                bringToFront
            }
        };
    }
}