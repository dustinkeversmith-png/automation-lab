using System.Text.Json;
using AutomationSidecar.Models;
using AutomationSidecar.Services;

namespace AutomationSidecar.Controllers;

public abstract class SidecarControllerBase
{
    protected UiAutomationService UiAutomation { get; }
    protected JsonSerializerOptions JsonOptions { get; }

    protected SidecarControllerBase(
        UiAutomationService uiAutomation,
        JsonSerializerOptions jsonOptions)
    {
        UiAutomation = uiAutomation;
        JsonOptions = jsonOptions;
    }

    public abstract bool CanHandle(string method);

    public abstract Task<object?> HandleAsync(CommandEnvelope cmd, CancellationToken cancellationToken = default);

    protected static int GetRequiredInt32(CommandEnvelope cmd, string key)
    {
        if (cmd.Params is null || !cmd.Params.TryGetValue(key, out var el))
            throw new InvalidOperationException($"Missing required param: {key}");

        return el.ValueKind switch
        {
            JsonValueKind.Number => el.GetInt32(),
            JsonValueKind.String when int.TryParse(el.GetString(), out var value) => value,
            _ => throw new InvalidOperationException($"Param '{key}' must be an integer")
        };
    }

    protected static int? GetOptionalInt32(CommandEnvelope cmd, string key)
    {
        if (cmd.Params is null || !cmd.Params.TryGetValue(key, out var el))
            return null;

        return el.ValueKind switch
        {
            JsonValueKind.Number => el.GetInt32(),
            JsonValueKind.String when int.TryParse(el.GetString(), out var value) => value,
            JsonValueKind.Null => null,
            _ => throw new InvalidOperationException($"Param '{key}' must be an integer")
        };
    }

    protected static string GetRequiredString(CommandEnvelope cmd, string key)
    {
        if (cmd.Params is null || !cmd.Params.TryGetValue(key, out var el))
            throw new InvalidOperationException($"Missing required param: {key}");

        if (el.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException($"Param '{key}' must be a string");

        var value = el.GetString();
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException($"Param '{key}' must not be empty");

        return value;
    }

    protected static string? GetOptionalString(CommandEnvelope cmd, string key)
    {
        if (cmd.Params is null || !cmd.Params.TryGetValue(key, out var el))
            return null;

        if (el.ValueKind == JsonValueKind.Null)
            return null;

        if (el.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException($"Param '{key}' must be a string");

        var value = el.GetString();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    protected static bool GetOptionalBoolean(CommandEnvelope cmd, string key, bool defaultValue = false)
    {
        if (cmd.Params is null || !cmd.Params.TryGetValue(key, out var el))
            return defaultValue;

        return el.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(el.GetString(), out var value) => value,
            _ => defaultValue
        };
    }

    protected static string[] GetOptionalStringArray(CommandEnvelope cmd, string key)
    {
        if (cmd.Params is null || !cmd.Params.TryGetValue(key, out var el))
            return Array.Empty<string>();

        if (el.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException($"Param '{key}' must be an array of strings");

        var values = new List<string>();

        foreach (var item in el.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String)
                throw new InvalidOperationException($"Param '{key}' must contain only strings");

            var s = item.GetString();
            if (!string.IsNullOrWhiteSpace(s))
                values.Add(s);
        }

        return values.ToArray();
    }
}