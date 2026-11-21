using System.Numerics;

namespace Demo;

internal sealed record Result(bool Won, int Rooms, int Ore, int Remaining, bool Danger,
    int Auto, int Manual, int KillGold, int MarketGold, int Buildings, int MaterialOutput);
internal sealed record Loot(LootKind Kind, Vector2 Position);

internal sealed class Run
{
    private readonly ProfileStore _profile;
    private readonly Guid _id = Guid.NewGuid();
    private bool _factoryQueued;
    private bool _upgradedAttack;
    private int _auto;
    private int _manual;
    private int _killGold;
    private int _marketGold;
    private int _buildings;
    private int _materialOutput;
    private int _mined;
    private int _roomGold;
    private int _noticeMs;
    private Cell _current = Board.Start;

    public Run(ProfileStore profile) => _profile = profile;

    public Board Board { get; } = new();
    public Fighter Fighter { get; } = new();
    public Wallet Wallet { get; } = new();
    public Phase Phase { get; private set; } = Phase.Preview;
    public int Remaining { get; private set; } = 600_000;
    public bool Danger { get; private set; }
    public string TimeoutEffect { get; private set; } = "";
    public Arena? Arena { get; private set; }
    public Cell Current => _current;
    public Room Room => Board.Rooms[Current];
    public bool CanTravel => Phase == Phase.Explore && Room.Completed;
    public HashSet<Cell> Surrounded { get; private set; } = [];
    public Result? Result { get; private set; }
    public bool Saved { get; private set; }
    public int Balance { get; private set; }
    public int SkillChoices { get; private set; }
    public string Notice { get; private set; } = "";
    public List<Loot> GroundLoot => Room.GroundLoot;

    public void Start()
    {
        if (Phase != Phase.Preview) return;
        Phase = Phase.Explore;
        Enter(Board.Start, null);
        Hint("落子入关。靠近门口按 E，按 Tab 查看棋盘。");
    }

    public void Hint(string message)
    {
        Notice = message;
        _noticeMs = 3400;
    }

    private void Enter(Cell cell, Cell? approach)
    {
        _current = cell;
        Room room = Room;
        bool surrounded = Surrounded.Contains(cell) && Board.HasReachableEntry(Board.Start, cell);
        if (!room.Completed && room.Type is RoomType.Resource or RoomType.Village or RoomType.Merchant)
            CompleteRoom();
        IReadOnlyList<EnemyKind> wave = room.Completed ? [] : MakeWave(room, Board.CompletedCount);
        Arena = new Arena(room, wave, Fighter, surrounded, Danger, approach, Arena);
        _roomGold = 0;
        if (surrounded && Room.Type != RoomType.Boss) _manual++;
        if (surrounded) Hint(Room.Type == RoomType.Boss ? "围局已成。本场攻击和防御增强。" :
            "自主探索 · 背水一战。双方强化，陶罐更易掉落技能球。");
    }

    private void CompleteRoom()
    {
        Room.Completed = true;
        Surrounded = Board.Surrounded();
    }

    internal static IReadOnlyList<EnemyKind> MakeWave(Room room, int completed)
    {
        if (room.Type == RoomType.Boss) return [EnemyKind.Marshal];
        Random random = Board.RoomRandom(room.Cell, 1);
        bool elite = room.Type == RoomType.Elite;
        int count = Math.Max(1, 5 + Rules.Ceil(completed, 2) + (elite ? 0 : random.Next(-2, 5)));
        List<EnemyKind> result = [];
        EnemyKind[] kinds = [EnemyKind.Thief, EnemyKind.Rebel, EnemyKind.Archer, EnemyKind.Heavy];
        int heavyCount = 0;
        for (int index = 0; index < count; index++)
        {
            EnemyKind kind = kinds[(index + room.Cell.X + room.Cell.Y * 2) % kinds.Length];
            if (kind == EnemyKind.Heavy && heavyCount++ >= 2) kind = EnemyKind.Rebel;
            result.Add(kind);
        }
        if (elite) result.Add(EnemyKind.Cavalry);
        return result;
    }

    public bool Walk(Cell target)
    {
        if (!CanTravel || !Board.Neighbors(Current).Contains(target)) return false;
        Cell approach = Current - target;
        // The final millisecond always belongs to the forced Boss transition.
        if (Remaining <= 5000)
        {
            AdvanceTime(Remaining);
            return true;
        }
        AdvanceTime(5000);
        if (target == Board.Boss) EnterBoss(false, approach);
        else Enter(target, approach);
        return true;
    }

    public bool Teleport(Cell target)
    {
        if (!CanTravel || Board.TeleportCost(Current, target) is not int cost || cost > Remaining) return false;
        AdvanceTime(cost);
        if (Phase == Phase.Boss) return true;
        if (target == Board.Boss) EnterBoss(false);
        else Enter(target, null);
        return true;
    }

    public int AutoPrice(Cell target)
    {
        if (!CanTravel || !Surrounded.Contains(target) || !Board.HasReachableEntry(Current, target)) return 0;
        return Board.Rooms[target].Type switch { RoomType.Ordinary => 10, RoomType.Elite => 18, _ => 0 };
    }

    public bool AutoExplore(Cell target)
    {
        int price = AutoPrice(target);
        if (price == 0 || !Wallet.Spend(price)) return false;
        Room room = Board.Rooms[target];
        int gold = MakeWave(room, Board.CompletedCount).Sum(kind => EnemySpec.For(kind).Gold);
        for (int index = 0; index < 2; index++)
        {
            if ((room.PotsBroken & (1 << index)) != 0) continue;
            switch (RollLoot(target, index, false))
            {
                case LootKind.Gold: gold += 3; break;
                case LootKind.Heal: Fighter.Heal(10); break;
                case LootKind.Skill: SkillChoices++; break;
            }
            room.PotsBroken |= 1 << index;
        }
        int earned = Wallet.Earn(gold);
        _killGold += earned;
        room.Completed = true;
        Surrounded = Board.Surrounded();
        _auto++;
        Hint($"自动探索完成。支付 {price} 金币，常规奖励入账 {earned} 金币。");
        return true;
    }

    private void EnterBoss(bool danger, Cell? approach = null)
    {
        if (Phase != Phase.Explore) return;
        Danger = danger;
        Phase = Phase.Boss;
        Enter(Board.Boss, approach);
        if (danger)
        {
            TimeoutEffect = Board.RoomRandom(Board.Boss, 7).Next(2) == 0 ? "金币获取少 10%" : "冲刺冷却多 1 秒";
            Hint("探索时间耗尽。棋帅伤害提高，环射多 2 发。");
        }
    }

    internal void AdvanceTime(int ms)
    {
        if (Phase != Phase.Explore) return;
        int elapsed = Math.Min(Remaining, ms);
        Remaining -= elapsed;
        Produce(elapsed);
        if (Remaining == 0) EnterBoss(true);
    }

    private void Produce(int ms)
    {
        int area = Board.CompletedCount / 3 * 10;
        foreach (Room room in Board.Rooms.Values)
        {
            int period = room.Building switch {
                Building.Market => 20_000, Building.Factory => _factoryQueued ? 25_000 : 0,
                Building.Mine => _mined < 6 ? 35_000 : 0, Building.Village => 5000, _ => 0
            };
            if (period == 0) continue;
            if (room.Level == 2) period = Rules.Percent(period, 75);
            room.Progress += ms;
            while (room.Progress >= period)
            {
                room.Progress -= period;
                switch (room.Building)
                {
                    case Building.Market:
                        _marketGold += Wallet.Earn(Rules.Percent(4, 100 + area));
                        break;
                    case Building.Factory:
                        Wallet.Materials++;
                        _materialOutput++;
                        _factoryQueued = false;
                        room.Progress = 0;
                        Hint("建材厂完工。建材 +1。");
                        break;
                    case Building.Mine:
                        Wallet.Ore++;
                        _mined++;
                        if (_mined >= 6) room.Progress = 0;
                        break;
                    case Building.Village:
                        Fighter.Atmosphere = Math.Min(100,
                            Fighter.Atmosphere + Rules.Ceil(20 * 115 * (100 + area), 10_000));
                        break;
                }
            }
        }
    }

    public bool Build(Building building)
    {
        if (!CanTravel || Wallet.Materials == 0 || Room.Building != Building.None) return false;
        bool factoryExists = Board.Rooms.Values.Any(room => room.Building == Building.Factory);
        bool mineExists = Board.Rooms.Values.Any(room => room.Building == Building.Mine);
        bool valid = Room.Type switch
        {
            RoomType.Village => building == Building.Village,
            RoomType.Resource => building == Building.Market || (building == Building.Factory && !factoryExists) ||
                (building == Building.Mine && !mineExists),
            _ => false
        };
        if (!valid) return false;
        Wallet.Materials--;
        Room.Building = building;
        Room.Level = 1;
        _buildings++;
        if (building == Building.Village) Hint("这一盏先点上。夜里回来，认这盏灯。");
        return true;
    }

    public bool Upgrade()
    {
        if (!CanTravel || Room.Level != 1 || Wallet.Materials == 0) return false;
        Wallet.Materials--;
        Room.Level = 2;
        return true;
    }

    public bool OrderMaterial()
    {
        if (!CanTravel || _factoryQueued || !Board.Rooms.Values.Any(room => room.Building == Building.Factory) ||
            !Wallet.Spend(8)) return false;
        _factoryQueued = true;
        Hint("建材厂已开工。可继续赶路。");
        return true;
    }

    public bool BuyMaterial()
    {
        if (!CanTravel || Room.Type != RoomType.Merchant || !Wallet.Spend(12)) return false;
        Wallet.Materials++;
        return true;
    }

    public bool BuyAttack()
    {
        if (!CanTravel || Room.Type != RoomType.Merchant || _upgradedAttack || !Wallet.Spend(20)) return false;
        _upgradedAttack = true;
        Fighter.Strength += 8;
        return true;
    }

    public bool Borrow()
    {
        if (!CanTravel || Room.Type != RoomType.Merchant || !Wallet.Borrow()) return false;
        Hint("建材 +1。此后每笔金币收入按八成向上取整。");
        return true;
    }

    public void Ultimate()
    {
        if (Phase is not (Phase.Explore or Phase.Boss) || Arena is null || Arena.Stunned > 0) return;
        if (Fighter.Ultimate()) Hint("大招 · 已扣生命，进入 10 秒爆发。");
        else
        {
            string missing = Fighter.Atmosphere < 100 && Fighter.Battle < 100 ? "氛围值和战斗值" :
                Fighter.Atmosphere < 100 ? "氛围值" : "战斗值";
            Hint("大招还缺" + missing + "。");
        }
    }

    private static LootKind RollLoot(Cell cell, int pot, bool surrounded)
    {
        int roll = Board.RoomRandom(cell, 3 + pot).Next(100);
        if (roll < 1 || roll >= 60) return LootKind.None;
        if (roll < (surrounded ? 11 : 6)) return LootKind.Skill;
        return roll < 21 || (roll & 1) == 0 ? LootKind.Heal : LootKind.Gold;
    }

    public bool PickSkill(bool attack)
    {
        if (SkillChoices == 0 || Phase is not (Phase.Explore or Phase.Boss)) return false;
        SkillChoices--;
        if (attack) Fighter.Strength += 2;
        else
        {
            Fighter.MaxHealth += 10;
            Fighter.Heal(10);
        }
        return true;
    }

    public void Tick(int ms, ArenaInput input)
    {
        if (Phase is not (Phase.Explore or Phase.Boss) || Arena is null) return;
        _noticeMs = Math.Max(0, _noticeMs - ms);
        if (_noticeMs == 0) Notice = "";
        Arena previous = Arena;
        AdvanceTime(ms);
        if (previous != Arena) return;
        Fighter.Tick(ms);
        Arena.Tick(ms, input);
        while (Arena.NewlyBroken.TryDequeue(out int pot))
        {
            Room.PotsBroken = Arena.BrokenPots;
            LootKind kind = RollLoot(Current, pot, Arena.Surrounded);
            if (kind != LootKind.None) GroundLoot.Add(new(kind, Arena.Pots[pot]));
        }
        if (Fighter.Health == 0)
        {
            Finish(false);
            return;
        }
        PickUpLoot();
        if (!Arena.DefeatedAll || Room.Completed) return;
        if (Phase == Phase.Boss)
        {
            CompleteRoom();
            Finish(true);
            return;
        }
        _killGold += Wallet.Earn(Arena.Gold + _roomGold);
        _roomGold = 0;
        CompleteRoom();
        Fighter.Heal(Rules.Percent(Fighter.MaxHealth, 20));
        Hint("房间点亮。靠近亮门按 E，或打开棋盘。");
    }

    private void PickUpLoot()
    {
        if (Arena is null) return;
        for (int index = GroundLoot.Count - 1; index >= 0; index--)
        {
            Loot loot = GroundLoot[index];
            if (Vector2.Distance(Arena.Player, loot.Position) > 64) continue;
            GroundLoot.RemoveAt(index);
            switch (loot.Kind)
            {
                case LootKind.Gold when Room.Completed: _killGold += Wallet.Earn(3); break;
                case LootKind.Gold: _roomGold += 3; break;
                case LootKind.Heal: Fighter.Heal(10); break;
                case LootKind.Skill:
                    SkillChoices++;
                    Hint("获得技能球。按 V 选择，或继续战斗。");
                    break;
            }
        }
    }

    internal void Finish(bool won)
    {
        if (Phase is not (Phase.Explore or Phase.Boss)) return;
        Result = new Result(won, Board.CompletedCount, Wallet.Ore, Remaining, Danger,
            _auto, _manual, _killGold, _marketGold, _buildings, _materialOutput);
        Phase = Phase.Result;
        Wallet.Clear();
        Fighter.Atmosphere = Fighter.Battle = Fighter.Strength = Fighter.Shield = SkillChoices = 0;
        foreach (Room room in Board.Rooms.Values) room.GroundLoot.Clear();
        RetrySave();
    }

    public void RetrySave()
    {
        if (Result is null || Saved) return;
        Saved = _profile.TryDeposit(_id, Result.Ore, out int balance);
        if (Saved) Balance = balance;
    }
}
