using System.Text.Json;

namespace Demo;

internal sealed class Palette
{
    private readonly Dictionary<string, Color> _colors = new(StringComparer.OrdinalIgnoreCase);

    public Color Background => Get("background", "#141E1F");
    public Color Panel => Get("panel", "#202B2B");
    public Color Field => Get("floor", "#303A37");
    public Color Line => Get("grid", "#51605A");
    public Color Paper => Get("paper", "#F0E4CB");
    public Color Muted => Get("muted", "#BDBEAD");
    public Color Vermilion => Get("player", "#BD392F");
    public Color Bronze => Get("interact", "#C68D4D");
    public Color Danger => Get("hazard", "#F4B24A");
    public Color Heal => Get("heal", "#6DC291");
    public Color Ore => Get("ore", "#DBE8E8");
    public Color Atmosphere => Get("atmosphere", "#AC91D8");
    public Color Shield => Get("friendly", "#8BCFD8");
    public Color Bullet => Get("bullet", "#FFF1C9");

    private Color Get(string key, string fallback) =>
        _colors.TryGetValue(key, out Color color) ? color : ColorTranslator.FromHtml(fallback);

    public static Palette Load(string directory)
    {
        Palette palette = new();
        string? repository = Directory.GetParent(directory)?.Parent?.FullName;
        if (repository is null) return palette;
        string file = Path.Combine(repository, "assets", "demo", "palette.json");
        try
        {
            using JsonDocument json = JsonDocument.Parse(File.ReadAllText(file));
            palette.Read(json.RootElement);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        {
            // The local graybox palette remains available when the art export is absent or invalid.
        }
        return palette;
    }

    private void Read(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object) return;
        foreach (JsonProperty property in element.EnumerateObject())
        {
            if (property.Value.ValueKind == JsonValueKind.Object) Read(property.Value);
            else if (property.Value.ValueKind == JsonValueKind.String && property.Value.GetString() is { Length: 7 } value &&
                value[0] == '#' && value.Skip(1).All(Uri.IsHexDigit))
                _colors.TryAdd(property.Name, ColorTranslator.FromHtml(value));
        }
    }
}
