using System.Text.Json;
using System.Text.Json.Serialization;

namespace AutomationSidecar.Models;

public class CommandEnvelope
{
    [JsonPropertyName("id")]
    public int id { get; set; }

    [JsonPropertyName("method")]
    public string method { get; set; } = "";

    [JsonPropertyName("params")]
    public Dictionary<string, JsonElement>? Params { get; set; }
}