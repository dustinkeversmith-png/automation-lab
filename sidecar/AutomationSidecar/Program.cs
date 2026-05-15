using System.Diagnostics;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;
using AutomationSidecar.Controllers;
using AutomationSidecar.Models;
using AutomationSidecar.Services;

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



var controllers = new ControllerRegistry()
    .Register(new BitTorrentController(uia, jsonOptions));

string? line;
while ((line = Console.ReadLine()) != null)
{
    CommandEnvelope? cmd = null;

    try
    {
        if (string.IsNullOrWhiteSpace(line))
            continue;

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

            _ => await controllers.DispatchAsync(cmd)
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

async Task<object?> DispatchToControllerAsync(CommandEnvelope cmd)
{
    var controller = controllers.FirstOrDefault(c => c.CanHandle(cmd.method));
    if (controller == null)
        throw new InvalidOperationException($"Unknown method: {cmd.method}");

    return await controller.HandleAsync(cmd);
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
        throw new InvalidOperationException($"Missing required param: {key}");

    return el.ValueKind switch
    {
        JsonValueKind.Number => el.GetInt32(),
        JsonValueKind.String when int.TryParse(el.GetString(), out var value) => value,
        _ => throw new InvalidOperationException($"Param '{key}' must be an integer")
    };
}

static string GetRequiredString(CommandEnvelope cmd, string key)
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

static bool GetOptionalBoolean(CommandEnvelope cmd, string key, bool defaultValue = false)
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

static string[] GetOptionalStringArray(CommandEnvelope cmd, string key)
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

static int? TryGetOptionalInt32(CommandEnvelope cmd, string key)
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
        startInfo.ArgumentList.Add(arg);

    var process = Process.Start(startInfo);
    if (process == null)
        throw new InvalidOperationException($"Failed to start process: {exePath}");

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

    return WindowAutomation.TransformWindow(
        processId,
        x,
        y,
        width,
        height,
        minimize,
        maximize,
        bringToFront
    );
}