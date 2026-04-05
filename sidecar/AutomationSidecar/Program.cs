using System.Diagnostics;
using System.Net.Http;
using System.Text.Json;
using AutomationSidecar.Models;
using AutomationSidecar.Services;
using System.Text.Json.Serialization;
using System.Runtime.InteropServices;

var uia = new UiAutomationService();
using var http = new HttpClient
{
    Timeout = TimeSpan.FromSeconds(2)
};

var jsonOptions = new JsonSerializerOptions
{
    PropertyNameCaseInsensitive = true,
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

string? line;
while ((line = Console.ReadLine()) != null)
{
    CommandEnvelope? cmd = null;

    try
    {
        if (string.IsNullOrWhiteSpace(line))
        {
            continue;
        }

        cmd = JsonSerializer.Deserialize<CommandEnvelope>(line, jsonOptions);
        if (cmd == null)
        {
            WriteError(0, "Invalid command envelope: request deserialized to null");
            continue;
        }

        object? result = cmd.method switch
        {
            "ping" => new
            {
                ok = true,
                message = "pong"
            },

            "findWindowByProcessId" => uia.FindWindowByProcessId(
                GetRequiredInt32(cmd, "processId")
            ),
            "launchProcess" => LaunchProcess(cmd),
            "transformWindow" => TransformWindow(cmd),

            _ => throw new InvalidOperationException($"Unknown method: {cmd.method}")
        };

        WriteResponse(new ResponseEnvelope
        {
            Id = cmd.id,
            Result = result
        });
    }

    catch (Exception ex)
    {
        WriteError(cmd?.id ?? 0, ex.ToString());
    }
}

void WriteError(int id, string error)
{
    Console.WriteLine(JsonSerializer.Serialize(new ResponseEnvelope
    {
        Id = id,
        Error = error
    }, jsonOptions));
    Console.Out.Flush();
}

void WriteResponse(ResponseEnvelope response)
{
    Console.WriteLine(JsonSerializer.Serialize(response, jsonOptions));
    Console.Out.Flush();
}

static int GetRequiredInt32(CommandEnvelope cmd, string key)
{
    if (cmd.Params is null || !cmd.Params.TryGetValue(key, out var el))
    {
        throw new InvalidOperationException($"Missing required param: {key}");
    }

    return el.ValueKind switch
    {
        JsonValueKind.Number => el.GetInt32(),
        JsonValueKind.String when int.TryParse(el.GetString(), out var value) => value,
        _ => throw new InvalidOperationException($"Param '{key}' must be an integer")
    };
}

static int GetOptionalInt32(CommandEnvelope cmd, string key, int defaultValue = 0)
{
    if (cmd.Params is null || !cmd.Params.TryGetValue(key, out var el))
    {
        return defaultValue;
    }

    return el.ValueKind switch
    {
        JsonValueKind.Number => el.GetInt32(),
        JsonValueKind.String when int.TryParse(el.GetString(), out var value) => value,
        _ => defaultValue
    };
}

static string GetRequiredString(CommandEnvelope cmd, string key)
{
    if (cmd.Params is null || !cmd.Params.TryGetValue(key, out var el))
    {
        throw new InvalidOperationException($"Missing required param: {key}");
    }

    if (el.ValueKind != JsonValueKind.String)
    {
        throw new InvalidOperationException($"Param '{key}' must be a string");
    }

    var value = el.GetString();
    if (string.IsNullOrWhiteSpace(value))
    {
        throw new InvalidOperationException($"Param '{key}' must not be empty");
    }

    return value;
}

static string? GetOptionalString(CommandEnvelope cmd, string key)
{
    if (cmd.Params is null || !cmd.Params.TryGetValue(key, out var el))
    {
        return null;
    }

    if (el.ValueKind == JsonValueKind.Null)
    {
        return null;
    }

    if (el.ValueKind != JsonValueKind.String)
    {
        throw new InvalidOperationException($"Param '{key}' must be a string");
    }

    var value = el.GetString();
    return string.IsNullOrWhiteSpace(value) ? null : value;
}

static bool GetOptionalBoolean(CommandEnvelope cmd, string key, bool defaultValue = false)
{
    if (cmd.Params is null || !cmd.Params.TryGetValue(key, out var el))
    {
        return defaultValue;
    }

    return el.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.String when bool.TryParse(el.GetString(), out var value) => value,
        _ => defaultValue
    };
}

static string[] GetOptionalStringArray(CommandEnvelope cmd, string key)
{
    if (cmd.Params is null || !cmd.Params.TryGetValue(key, out var el))
    {
        return Array.Empty<string>();
    }

    if (el.ValueKind != JsonValueKind.Array)
    {
        throw new InvalidOperationException($"Param '{key}' must be an array of strings");
    }

    var values = new List<string>();

    foreach (var item in el.EnumerateArray())
    {
        if (item.ValueKind != JsonValueKind.String)
        {
            throw new InvalidOperationException($"Param '{key}' must contain only strings");
        }

        var s = item.GetString();
        if (!string.IsNullOrWhiteSpace(s))
        {
            values.Add(s);
        }
    }

    return values.ToArray();
}

static object LaunchProcess(CommandEnvelope cmd)
{
    var exePath = GetRequiredString(cmd, "exePath");
    var args = GetOptionalStringArray(cmd, "args");
    var detached = GetOptionalBoolean(cmd, "detached", false);

    var startInfo = new ProcessStartInfo
    {
        FileName = exePath,
        UseShellExecute = false,
        CreateNoWindow = true
    };

    foreach (var arg in args)
    {
        startInfo.ArgumentList.Add(arg);
    }

    var process = Process.Start(startInfo);
    if (process == null)
    {
        throw new InvalidOperationException($"Failed to start process: {exePath}");
    }

    return new
    {
        ok = true,
        processId = process.Id,
        exePath,
        args,
        detached
    };
}


static object TransformWindow(CommandEnvelope cmd)
{
    var processId = GetRequiredInt32(cmd, "processId");

    int? width = TryGetOptionalInt32(cmd, "width");
    int? height = TryGetOptionalInt32(cmd, "height");
    int? x = TryGetOptionalInt32(cmd, "x");
    int? y = TryGetOptionalInt32(cmd, "y");

    var minimize = GetOptionalBoolean(cmd, "minimize", false);
    var maximize = GetOptionalBoolean(cmd, "maximize", false);
    var bringToFront = GetOptionalBoolean(cmd, "bringToFront", false);

    var hwnd = FindMainWindowForProcess(processId);
    if (hwnd == IntPtr.Zero)
    {
        throw new InvalidOperationException($"No top-level window found for processId={processId}");
    }

    if (minimize)
    {
        NativeMethods.ShowWindow(hwnd, NativeMethods.SW_MINIMIZE);
    }
    else if (maximize)
    {
        NativeMethods.ShowWindow(hwnd, NativeMethods.SW_MAXIMIZE);
    }
    else if (bringToFront || x.HasValue || y.HasValue || width.HasValue || height.HasValue)
    {
        NativeMethods.ShowWindow(hwnd, NativeMethods.SW_RESTORE);
    }

    if (bringToFront)
    {
        BringWindowToFront(hwnd);
    }

    if (x.HasValue || y.HasValue || width.HasValue || height.HasValue)
    {
        if (!NativeMethods.GetWindowRect(hwnd, out NativeMethods.RECT rect))
        {
            throw new InvalidOperationException($"GetWindowRect failed for hwnd={hwnd}");
        }

        int newX = x ?? rect.Left;
        int newY = y ?? rect.Top;
        int newWidth = width ?? (rect.Right - rect.Left);
        int newHeight = height ?? (rect.Bottom - rect.Top);

        if (!NativeMethods.MoveWindow(hwnd, newX, newY, newWidth, newHeight, true))
        {
            throw new InvalidOperationException($"MoveWindow failed for hwnd={hwnd}");
        }
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



static IntPtr FindMainWindowForProcess(int processId)
{
    IntPtr found = IntPtr.Zero;

    NativeMethods.EnumWindows((hwnd, lParam) =>
    {
        if (!NativeMethods.IsWindowVisible(hwnd))
            return true;

        NativeMethods.GetWindowThreadProcessId(hwnd, out uint windowPid);
        if (windowPid != processId)
            return true;

        if (NativeMethods.GetWindow(hwnd, NativeMethods.GW_OWNER) != IntPtr.Zero)
            return true;

        found = hwnd;
        return false;
    }, IntPtr.Zero);

    return found;
}

static void BringWindowToFront(IntPtr hwnd)
{
    uint currentThreadId = NativeMethods.GetCurrentThreadId();
    uint foregroundThreadId =
        NativeMethods.GetWindowThreadProcessId(NativeMethods.GetForegroundWindow(), out _);

    if (foregroundThreadId != 0 && foregroundThreadId != currentThreadId)
    {
        NativeMethods.AttachThreadInput(currentThreadId, foregroundThreadId, true);
        try
        {
            NativeMethods.SetForegroundWindow(hwnd);
            NativeMethods.BringWindowToTop(hwnd);
            NativeMethods.SetActiveWindow(hwnd);
            NativeMethods.SetFocus(hwnd);
        }
        finally
        {
            NativeMethods.AttachThreadInput(currentThreadId, foregroundThreadId, false);
        }
    }
    else
    {
        NativeMethods.SetForegroundWindow(hwnd);
        NativeMethods.BringWindowToTop(hwnd);
        NativeMethods.SetActiveWindow(hwnd);
        NativeMethods.SetFocus(hwnd);
    }
}

static int? TryGetOptionalInt32(CommandEnvelope cmd, string key)
{
    if (cmd.Params is null || !cmd.Params.TryGetValue(key, out var el))
    {
        return null;
    }

    return el.ValueKind switch
    {
        JsonValueKind.Number => el.GetInt32(),
        JsonValueKind.String when int.TryParse(el.GetString(), out var value) => value,
        JsonValueKind.Null => null,
        _ => throw new InvalidOperationException($"Param '{key}' must be an integer")
    };
}



async Task<object> WaitForCdpAsync(int debugPort, int timeoutMs)
{
    var sw = Stopwatch.StartNew();
    Exception? lastError = null;

    while (sw.ElapsedMilliseconds < timeoutMs)
    {
        try
        {
            using var response = await http.GetAsync($"http://127.0.0.1:{debugPort}/json/list");
            if (response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();

                return new
                {
                    ok = true,
                    debugPort,
                    elapsedMs = sw.ElapsedMilliseconds,
                    raw = JsonSerializer.Deserialize<object>(body)
                };
            }
        }
        catch (Exception ex)
        {
            lastError = ex;
        }

        await Task.Delay(500);
    }

    throw new TimeoutException(
        $"Timed out waiting for CDP on 127.0.0.1:{debugPort}/json/list. Last error: {lastError?.Message ?? "none"}"
    );
}


internal static class NativeMethods
{
    internal const int SW_RESTORE = 9;
    internal const int SW_MINIMIZE = 6;
    internal const int SW_MAXIMIZE = 3;
    internal const uint GW_OWNER = 4;

    [StructLayout(LayoutKind.Sequential)]
    internal struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    internal delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    internal static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    internal static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    internal static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    internal static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    internal static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [DllImport("user32.dll")]
    internal static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    internal static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    internal static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    internal static extern IntPtr SetActiveWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    internal static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    internal static extern IntPtr GetForegroundWindow();

    [DllImport("kernel32.dll")]
    internal static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    internal static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
}