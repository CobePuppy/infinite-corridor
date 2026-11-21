using System.Numerics;

namespace Demo;

internal static class Rules
{
    public static int Ceil(int value, int divisor) => value / divisor + (value % divisor == 0 ? 0 : 1);
    public static int Percent(int value, int percent) => Ceil(value * percent, 100);
    public static int EffectiveDefense(int defense, int flat, int magicPercent) =>
        Percent(Math.Max(0, defense - flat), 100 - Math.Clamp(magicPercent, 0, 100));

    public static int Damage(int attack, int defense, int flat = 0, int magicPercent = 0)
    {
        int difference = attack - EffectiveDefense(defense, flat, magicPercent);
        return difference > 0 ? difference : Percent(attack, 5);
    }

    public static Vector2 Unit(Vector2 vector) =>
        vector.LengthSquared() < 0.001f ? Vector2.Zero : Vector2.Normalize(vector);

    public static Vector2 Rotate(Vector2 vector, float radians)
    {
        float cos = MathF.Cos(radians);
        float sin = MathF.Sin(radians);
        return new(vector.X * cos - vector.Y * sin, vector.X * sin + vector.Y * cos);
    }

    public static float SegmentDistance(Vector2 point, Vector2 start, Vector2 end)
    {
        Vector2 delta = end - start;
        float length = delta.LengthSquared();
        if (length == 0) return Vector2.Distance(point, start);
        float t = Math.Clamp(Vector2.Dot(point - start, delta) / length, 0, 1);
        return Vector2.Distance(point, start + t * delta);
    }
}

internal enum RoomType { Resource, Ordinary, Elite, Merchant, Village, Boss }
internal enum Building { None, Market, Factory, Mine, Village }
internal enum Phase { Preview, Explore, Boss, Result }
internal enum LootKind { None, Gold, Heal, Skill }
internal readonly record struct Cell(int X, int Y)
{
    public static Cell operator +(Cell point, Cell delta) => new(point.X + delta.X, point.Y + delta.Y);
    public static Cell operator -(Cell point, Cell other) => new(point.X - other.X, point.Y - other.Y);
}

internal sealed class Room(Cell cell, RoomType type)
{
    public Cell Cell { get; } = cell;
    public RoomType Type { get; } = type;
    public bool Completed { get; set; }
    public Building Building { get; set; }
    public int Level { get; set; }
    public int Progress { get; set; }
    public int PotsBroken { get; set; }
    public List<Loot> GroundLoot { get; } = [];
}

internal sealed class Board
{
    public const int Seed = 20261120;
    public static readonly Cell Start = new(0, 0);
    public static readonly Cell Boss = new(5, 1);
    public static readonly Cell[] Directions = [new(1, 0), new(0, 1), new(-1, 0), new(0, -1)];
    public Dictionary<Cell, Room> Rooms { get; }

    public Board()
    {
        (int x, int y, RoomType type)[] layout =
        [
            (0,0,RoomType.Resource), (1,0,RoomType.Ordinary), (2,0,RoomType.Merchant), (4,0,RoomType.Ordinary),
            (0,1,RoomType.Ordinary), (1,1,RoomType.Ordinary), (2,1,RoomType.Ordinary), (3,1,RoomType.Resource),
            (4,1,RoomType.Ordinary), (5,1,RoomType.Boss),
            (0,2,RoomType.Resource), (1,2,RoomType.Ordinary), (2,2,RoomType.Elite),
            (3,2,RoomType.Ordinary), (4,2,RoomType.Village)
        ];
        Rooms = layout.ToDictionary(item => new Cell(item.x, item.y),
            item => new Room(new Cell(item.x, item.y), item.type));
    }

    public IEnumerable<Cell> Neighbors(Cell cell) => Directions.Select(direction => cell + direction).Where(Rooms.ContainsKey);

    public int CompletedCount => Rooms.Values.Count(room => room.Completed);

    private Dictionary<Cell, int> CompletedDistances(Cell start)
    {
        Dictionary<Cell, int> distances = [];
        if (!Rooms.TryGetValue(start, out Room? first) || !first.Completed) return distances;
        Queue<Cell> queue = new();
        distances.Add(start, 0);
        queue.Enqueue(start);
        while (queue.TryDequeue(out Cell cell))
        {
            foreach (Cell next in Neighbors(cell))
            {
                if (Rooms[next].Completed && distances.TryAdd(next, distances[cell] + 1))
                    queue.Enqueue(next);
            }
        }
        return distances;
    }

    public HashSet<Cell> Surrounded()
    {
        Dictionary<Cell, int> walls = CompletedDistances(Start);
        return Flood(walls.Keys, Rooms.Keys);
    }

    internal static HashSet<Cell> Flood(IEnumerable<Cell> walls, IEnumerable<Cell> candidates)
    {
        HashSet<Cell> blocked = walls.ToHashSet();
        Cell[] inside = candidates.ToArray();
        if (inside.Length == 0) return [];
        int left = inside.Min(cell => cell.X) - 1;
        int right = inside.Max(cell => cell.X) + 1;
        int bottom = inside.Min(cell => cell.Y) - 1;
        int top = inside.Max(cell => cell.Y) + 1;
        Cell origin = new(left, bottom);
        HashSet<Cell> outside = [origin];
        Queue<Cell> queue = new();
        queue.Enqueue(origin);
        while (queue.TryDequeue(out Cell cell))
        {
            foreach (Cell direction in Directions)
            {
                Cell next = cell + direction;
                if (next.X < left || next.X > right || next.Y < bottom || next.Y > top ||
                    blocked.Contains(next) || !outside.Add(next)) continue;
                queue.Enqueue(next);
            }
        }
        return inside.Where(cell => !blocked.Contains(cell) && !outside.Contains(cell)).ToHashSet();
    }

    public bool HasReachableEntry(Cell from, Cell target)
    {
        Dictionary<Cell, int> distances = CompletedDistances(from);
        return Neighbors(target).Any(distances.ContainsKey);
    }

    public int? TeleportCost(Cell from, Cell target)
    {
        if (target == from) return null;
        Dictionary<Cell, int> distances = CompletedDistances(from);
        if (target == Boss) return Neighbors(target).Any(distances.ContainsKey) ? 5000 : null;
        return distances.TryGetValue(target, out int distance) ? distance * 2000 : null;
    }

    public static Random RoomRandom(Cell cell, int stream) => new(Seed + cell.X * 4099 + cell.Y * 127 + stream * 84017);
}

internal sealed class Wallet
{
    public int Gold { get; private set; }
    public int Materials { get; set; } = 1;
    public int Ore { get; set; }
    public bool Borrowed { get; private set; }

    public int Earn(int gross)
    {
        int net = Borrowed ? Rules.Percent(gross, 80) : gross;
        Gold += net;
        return net;
    }

    public bool Spend(int amount)
    {
        if (Gold < amount) return false;
        Gold -= amount;
        return true;
    }

    public bool Borrow()
    {
        if (Borrowed) return false;
        Gold = Math.Min(Gold - 15, -1);
        Materials++;
        Borrowed = true;
        return true;
    }

    public void Clear()
    {
        Gold = Materials = Ore = 0;
    }
}

internal sealed class Fighter
{
    public int Health { get; set; } = 100;
    public int MaxHealth { get; set; } = 100;
    public int Shield { get; set; }
    public int Atmosphere { get; set; }
    public int Battle { get; set; }
    public int Strength { get; set; }
    public int Boost { get; private set; }
    public int BoostMs { get; private set; }
    private int _shieldMs;

    public bool Ultimate()
    {
        if (Atmosphere < 100 || Battle < 100 || Health <= 0) return false;
        int lost = MaxHealth - Health;
        Health = Math.Max(1, Health - Rules.Percent(Health, 15));
        if (Shield == 0) _shieldMs = 0;
        Shield += Rules.Percent(lost, 50);
        if (BoostMs == 0) Boost = 8 + Rules.Percent(lost, 20);
        BoostMs = 10_000;
        Atmosphere = Battle = 0;
        return true;
    }

    public void Tick(int ms)
    {
        BoostMs = Math.Max(0, BoostMs - ms);
        if (BoostMs == 0) Boost = 0;
        if (Shield == 0) return;
        _shieldMs += ms;
        while (_shieldMs >= 1000 && Shield > 0)
        {
            _shieldMs -= 1000;
            int percent = Shield * 100 / MaxHealth;
            int loss = percent < 10 ? 4 : percent < 20 ? 3 : percent < 30 ? 2 : 1;
            Shield = Math.Max(0, Shield - loss);
        }
    }

    public void Heal(int amount) => Health = Math.Min(MaxHealth, Health + amount);

    public void TakeDamage(int damage)
    {
        int absorbed = Math.Min(Shield, damage);
        Shield -= absorbed;
        Health = Math.Max(0, Health - (damage - absorbed));
    }
}
