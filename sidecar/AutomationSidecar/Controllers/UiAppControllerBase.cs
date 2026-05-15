using System.Diagnostics;
using System.Windows.Forms;
using AutomationSidecar.Models;
using AutomationSidecar.Services;

namespace AutomationSidecar.Controllers;

public abstract class UiAppControllerBase : SidecarControllerBase
{
    protected UiAppControllerBase(
        UiAutomationService uiAutomation,
        System.Text.Json.JsonSerializerOptions jsonOptions)
        : base(uiAutomation, jsonOptions)
    {
    }

    protected virtual Task<object> LaunchProcessAsync(
        string exePath,
        IEnumerable<string>? args = null,
        bool detached = true,
        CancellationToken cancellationToken = default)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = exePath,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        if (args != null)
        {
            foreach (var arg in args)
                startInfo.ArgumentList.Add(arg);
        }

        var process = Process.Start(startInfo);
        if (process == null)
            throw new InvalidOperationException($"Failed to start process: {exePath}");

        return Task.FromResult<object>(new
        {
            ok = true,
            processId = process.Id,
            exePath,
            args = args?.ToArray() ?? Array.Empty<string>(),
            detached
        });
    }

    protected virtual async Task<object> OpenTargetAsync(
        string exePath,
        string target,
        IEnumerable<string>? args = null,
        CancellationToken cancellationToken = default)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = exePath,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        if (args != null)
        {
            foreach (var arg in args)
                startInfo.ArgumentList.Add(arg);
        }

        startInfo.ArgumentList.Add(target);

        var process = Process.Start(startInfo);
        if (process == null)
            throw new InvalidOperationException($"Failed to start process: {exePath}");

        await Task.Delay(1200, cancellationToken);

        return new
        {
            ok = true,
            processId = process.Id,
            exePath,
            target
        };
    }

    protected virtual object FocusWindow(int processId)
    {
        var hwnd = WindowAutomation.RestoreAndFocusProcessWindow(processId);
        return new
        {
            ok = true,
            processId,
            hwnd = hwnd.ToInt64()
        };
    }

    protected virtual object SendKeysToProcess(int processId, string keys, string action)
    {
        WindowAutomation.RestoreAndFocusProcessWindow(processId);
        SendKeys.SendWait(keys);

        return new
        {
            ok = true,
            processId,
            action,
            keys
        };
    }
}