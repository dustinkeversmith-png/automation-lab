using System.Diagnostics;
using System.Net.Http;
using System.Text.Json;
using AutomationSidecar.Models;
using AutomationSidecar.Services;
using System.Text.Json.Serialization;

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
            "launchChromiumDebuggerProcess" => LaunchChromiumDebuggerProcess(cmd),

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

static int GetOptionalInt32(CommandEnvelope cmd, string key, int defaultValue)
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
                using var doc = JsonDocument.Parse(body);

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
