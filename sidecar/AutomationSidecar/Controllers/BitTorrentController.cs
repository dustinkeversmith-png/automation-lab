using System.Diagnostics;
using System.Text.Json;
using AutomationSidecar.Models;
using AutomationSidecar.Services;

namespace AutomationSidecar.Controllers;

public sealed class BitTorrentController : SidecarControllerBase
{
    private static readonly HashSet<string> SupportedMethods = new(StringComparer.OrdinalIgnoreCase)
    {
        "bittorrent.launch",
        "bittorrent.open",
        "bittorrent.focus",
        "bittorrent.pauseSelected",
        "bittorrent.resumeSelected",
        "bittorrent.removeSelected",
        "bittorrent.startSelected"
    };

    public BitTorrentController(
        UiAutomationService uiAutomation,
        JsonSerializerOptions jsonOptions)
        : base(uiAutomation, jsonOptions)
    {
    }

    public override bool CanHandle(string method) => SupportedMethods.Contains(method);

    public override async Task<object?> HandleAsync(CommandEnvelope cmd, CancellationToken cancellationToken = default)
    {
        return cmd.method switch
        {
            "bittorrent.launch" => await LaunchAsync(cmd, cancellationToken),
            "bittorrent.open" => await OpenAsync(cmd, cancellationToken),
            "bittorrent.focus" => Focus(cmd),
            "bittorrent.pauseSelected" => PauseSelected(cmd),
            "bittorrent.resumeSelected" => ResumeSelected(cmd),
            "bittorrent.removeSelected" => RemoveSelected(cmd),
            "bittorrent.startSelected" => StartSelected(cmd),
            _ => throw new InvalidOperationException($"Unsupported BitTorrent method: {cmd.method}")
        };
    }

    private Task<object> LaunchAsync(CommandEnvelope cmd, CancellationToken cancellationToken)
    {
        var exePath = GetRequiredString(cmd, "exePath");
        var args = GetOptionalStringArray(cmd, "args");
        var detached = GetOptionalBoolean(cmd, "detached", true);

        var startInfo = new ProcessStartInfo
        {
            FileName = exePath,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        foreach (var arg in args)
            startInfo.ArgumentList.Add(arg);

        var process = Process.Start(startInfo);
        if (process == null)
            throw new InvalidOperationException($"Failed to start BitTorrent: {exePath}");

        return Task.FromResult<object>(new
        {
            ok = true,
            processId = process.Id,
            exePath,
            args,
            detached
        });
    }

    private async Task<object> OpenAsync(CommandEnvelope cmd, CancellationToken cancellationToken)
    {
        var exePath = GetRequiredString(cmd, "exePath");
        var target = GetRequiredString(cmd, "target"); // torrent path, magnet link, or url
        var extraArgs = GetOptionalStringArray(cmd, "args");

        var startInfo = new ProcessStartInfo
        {
            FileName = exePath,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        foreach (var arg in extraArgs)
            startInfo.ArgumentList.Add(arg);

        startInfo.ArgumentList.Add(target);

        var process = Process.Start(startInfo);
        if (process == null)
            throw new InvalidOperationException($"Failed to start BitTorrent with target: {target}");

        await Task.Delay(1200, cancellationToken);

        return new
        {
            ok = true,
            processId = process.Id,
            exePath,
            target
        };
    }

    private object Focus(CommandEnvelope cmd)
    {
        var processId = GetRequiredInt32(cmd, "processId");
        WindowAutomation.RestoreAndFocusProcessWindow(processId);

        return new
        {
            ok = true,
            processId
        };
    }

    private object PauseSelected(CommandEnvelope cmd)
    {
        var processId = GetRequiredInt32(cmd, "processId");
        WindowAutomation.RestoreAndFocusProcessWindow(processId);

        SendShortcut("^p");

        return new
        {
            ok = true,
            processId,
            action = "pauseSelected"
        };
    }

    private object ResumeSelected(CommandEnvelope cmd)
    {
        var processId = GetRequiredInt32(cmd, "processId");
        WindowAutomation.RestoreAndFocusProcessWindow(processId);

        SendShortcut("^r");

        return new
        {
            ok = true,
            processId,
            action = "resumeSelected"
        };
    }

    private object RemoveSelected(CommandEnvelope cmd)
    {
        var processId = GetRequiredInt32(cmd, "processId");
        WindowAutomation.RestoreAndFocusProcessWindow(processId);

        SendShortcut("{DELETE}");

        return new
        {
            ok = true,
            processId,
            action = "removeSelected"
        };
    }

    private object StartSelected(CommandEnvelope cmd)
    {
        var processId = GetRequiredInt32(cmd, "processId");
        WindowAutomation.RestoreAndFocusProcessWindow(processId);

        SendShortcut("^s");

        return new
        {
            ok = true,
            processId,
            action = "startSelected"
        };
    }

    private static void SendShortcut(string keys)
    {
        System.Windows.Forms.SendKeys.SendWait(keys);
    }
}