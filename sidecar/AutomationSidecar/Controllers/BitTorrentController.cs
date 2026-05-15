using System.Diagnostics;
using System.Text.Json;
using AutomationSidecar.Models;
using AutomationSidecar.Services;
using System.Windows.Forms;

namespace AutomationSidecar.Controllers;

public sealed class BitTorrentController : UiAppControllerBase
{
    public const string AppId = "bittorrent";

    private static readonly HashSet<string> SupportedMethods = new(StringComparer.OrdinalIgnoreCase)
    {
        "bittorrent.launch",
        "bittorrent.open",
        "bittorrent.focus",
        "bittorrent.pauseSelected",
        "bittorrent.resumeSelected",
        "bittorrent.startSelected",
        "bittorrent.removeSelected",
        "bittorrent.sendKeys"
    };

    public BitTorrentController(
        UiAutomationService uiAutomation,
        JsonSerializerOptions jsonOptions)
        : base(uiAutomation, jsonOptions)
    {
    }

    public override string ControllerId => AppId;

    public override bool CanHandle(string method)
        => SupportedMethods.Contains(method);

    public override async Task<object?> HandleAsync(
        CommandEnvelope cmd,
        CancellationToken cancellationToken = default)
    {
        return cmd.method switch
        {
            "bittorrent.launch" => await LaunchAsync(cmd, cancellationToken),
            "bittorrent.open" => await OpenAsync(cmd, cancellationToken),
            "bittorrent.focus" => Focus(cmd),
            "bittorrent.pauseSelected" => PauseSelected(cmd),
            "bittorrent.resumeSelected" => ResumeSelected(cmd),
            "bittorrent.startSelected" => StartSelected(cmd),
            "bittorrent.removeSelected" => RemoveSelected(cmd),
            "bittorrent.sendKeys" => SendKeysToApp(cmd),
            _ => throw new InvalidOperationException($"Unsupported BitTorrent method: {cmd.method}")
        };
    }

    private async Task<object> LaunchAsync(
        CommandEnvelope cmd,
        CancellationToken cancellationToken)
    {
        var exePath = GetRequiredString(cmd, "exePath");
        var args = GetOptionalStringArray(cmd, "args");
        var detached = GetOptionalBoolean(cmd, "detached", true);
        var focusAfterLaunch = GetOptionalBoolean(cmd, "focusAfterLaunch", true);
        var waitForWindowMs = GetOptionalInt32(cmd, "waitForWindowMs") ?? 5000;

        var process = StartProcess(exePath, args);

        if (focusAfterLaunch)
        {
            await WaitForMainWindowAsync(process.Id, waitForWindowMs, cancellationToken);
            FocusWindow(process.Id);
        }

        return new
        {
            ok = true,
            app = AppId,
            processId = process.Id,
            exePath,
            args,
            detached,
            focused = focusAfterLaunch
        };
    }

    private async Task<object> OpenAsync(
        CommandEnvelope cmd,
        CancellationToken cancellationToken)
    {
        var exePath = GetRequiredString(cmd, "exePath");
        var target = GetRequiredString(cmd, "target");
        var extraArgs = GetOptionalStringArray(cmd, "args");
        var focusAfterLaunch = GetOptionalBoolean(cmd, "focusAfterLaunch", true);
        var waitForWindowMs = GetOptionalInt32(cmd, "waitForWindowMs") ?? 7000;

        var args = new List<string>(extraArgs) { target };
        var process = StartProcess(exePath, args);

        if (focusAfterLaunch)
        {
            await WaitForMainWindowAsync(process.Id, waitForWindowMs, cancellationToken);
            FocusWindow(process.Id);
        }

        return new
        {
            ok = true,
            app = AppId,
            processId = process.Id,
            exePath,
            target,
            args = args.ToArray(),
            focused = focusAfterLaunch
        };
    }

    private object Focus(CommandEnvelope cmd)
    {
        var processId = GetRequiredInt32(cmd, "processId");
        FocusWindow(processId);

        return new
        {
            ok = true,
            app = AppId,
            processId,
            action = "focus"
        };
    }

    private object PauseSelected(CommandEnvelope cmd)
    {
        var processId = GetRequiredInt32(cmd, "processId");
        EnsureFocused(processId);

        // Replace here later with direct UIA invoke logic if you add it.
        SendWait("^P");

        return new
        {
            ok = true,
            app = AppId,
            processId,
            action = "pauseSelected"
        };
    }

    private object ResumeSelected(CommandEnvelope cmd)
    {
        var processId = GetRequiredInt32(cmd, "processId");
        EnsureFocused(processId);

        // Common placeholder shortcut path; adjust to your BitTorrent build if needed.
        SendWait("^R");

        return new
        {
            ok = true,
            app = AppId,
            processId,
            action = "resumeSelected"
        };
    }

    private object StartSelected(CommandEnvelope cmd)
    {
        var processId = GetRequiredInt32(cmd, "processId");
        EnsureFocused(processId);

        // Keep separate from resume in case you later distinguish queue/start behavior.
        SendWait("^S");

        return new
        {
            ok = true,
            app = AppId,
            processId,
            action = "startSelected"
        };
    }

    private object RemoveSelected(CommandEnvelope cmd)
    {
        var processId = GetRequiredInt32(cmd, "processId");
        var confirm = GetOptionalBoolean(cmd, "confirm", false);

        EnsureFocused(processId);
        SendWait("{DELETE}");

        if (confirm)
        {
            Thread.Sleep(250);
            SendWait("{ENTER}");
        }

        return new
        {
            ok = true,
            app = AppId,
            processId,
            action = "removeSelected",
            confirm
        };
    }

    private object SendKeysToApp(CommandEnvelope cmd)
    {
        var processId = GetRequiredInt32(cmd, "processId");
        var keys = GetRequiredString(cmd, "keys");

        EnsureFocused(processId);
        SendWait(keys);

        return new
        {
            ok = true,
            app = AppId,
            processId,
            action = "sendKeys",
            keys
        };
    }

    private static Process StartProcess(string exePath, IEnumerable<string> args)
    {
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

        return process;
    }

    private async Task WaitForMainWindowAsync(
        int processId,
        int timeoutMs,
        CancellationToken cancellationToken)
    {
        var sw = Stopwatch.StartNew();

        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var hwnd = WindowAutomation.FindMainWindowForProcess(processId);
            if (hwnd != IntPtr.Zero)
            {
                return;
            }

            await Task.Delay(200, cancellationToken);
        }

        throw new TimeoutException(
            $"Timed out waiting for BitTorrent main window for processId={processId}");
    }

    private static void FocusWindow(int processId)
    {
        WindowAutomation.RestoreAndFocusProcessWindow(processId);
    }

    private static void EnsureFocused(int processId)
    {
        FocusWindow(processId);
        Thread.Sleep(150);
    }

    private static void SendWait(string keys)
    {
        SendKeys.SendWait(keys);
        Thread.Sleep(100);
    }
}