using System.Text.Json.Serialization;

namespace AutomationSidecar.Models;

public class ResponseEnvelope
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("result")]
    public object? Result { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }
}