using System.Numerics;

namespace Demo;

internal static class Checks
{
    private static readonly Vector2 ArenaCenter = new(Arena.Width / 2, Arena.Height / 2);
    private static readonly ArenaInput Idle = new(Vector2.Zero, ArenaCenter, false, false, false);

    public static int Execute(string directory)
    {
        (string name, Action run)[] checks =
        [
            ("地图、围住正例和正交缺口", Map),
            ("围住自动和自主探索", () => Branches(directory)),
            ("伤害、穿甲与保底", Damage),
            ("贷款取整和建造产出", () => Economy(directory)),
            ("双槽、开大、扣血与盾", Ultimate),
            ("时钟、正常 Boss 和临界传送", () => Timing(directory)),
            ("五种敌人及棋帅普通、狂暴与超时弹量", () => Enemies(directory)),
            ("死亡优先、胜负结算、回读和失败重试", () => Settlement(directory))
        ];
        int failures = 0;
        foreach ((string name, Action run) in checks)
        {
            try { run(); Console.WriteLine("PASS " + name); }
            catch (Exception error)
            {
                failures++;
                Console.Error.WriteLine($"FAIL {name}: {error.Message}");
            }
        }
        Console.WriteLine($"{checks.Length - failures}/{checks.Length} passed.");
        return failures == 0 ? 0 : 1;
    }

    private static void Expect(bool condition, string label)
    {
        if (!condition) throw new InvalidOperationException(label);
    }

    private static void Map()
    {
        Board board = new();
        Expect(board.Rooms.Count == 15 && board.Rooms.Values.Count(room => room.Type == RoomType.Resource) == 3, "房型配额");
        Expect(board.Neighbors(Board.Start).Count() == 2 && board.Neighbors(Board.Boss).Count() == 1, "门图");
        foreach (Room room in board.Rooms.Values) room.Completed = true;
        Expect(board.TeleportCost(Board.Start, new Cell(4, 2)) is > 0, "村庄应连通");
        Cell center = new(1, 1);
        board.Rooms[center].Completed = false;
        Expect(board.Surrounded().Contains(center), "闭环正例");
        board.Rooms[new Cell(1, 0)].Completed = false;
        Expect(!board.Surrounded().Contains(center), "正交缺口泄漏");
        Cell[] walls = [new(0, 1), new(1, 0), new(2, 1), new(1, 2)];
        Expect(Board.Flood(walls, [center, .. walls]).Contains(center), "角点不泄漏");
        Expect(Board.Flood(walls, [center, .. walls]).Count == 1, "围住不含已完成墙");
    }

    private static Run PreparedRing(string directory)
    {
        Run run = new(new ProfileStore(directory));
        run.Start();
        foreach (Room room in run.Board.Rooms.Values)
            if (room.Cell.X <= 2 && room.Cell.Y <= 2 && room.Cell != new Cell(1, 1))
                room.Completed = true;
        // Enter a free resource room to refresh the production map via the public route:
        // consume the uncompleted third resource room, then return to an entry next to the center.
        Expect(run.Walk(new Cell(0, 1)), "到西侧入口");
        Expect(run.Teleport(new Cell(2, 1)), "沿外环传送");
        Expect(run.Walk(new Cell(3, 1)), "点亮资源房，刷新围住");
        Expect(run.Teleport(new Cell(2, 1)), "回到中心东门");
        return run;
    }

    private static void Branches(string directory)
    {
        Cell center = new(1, 1);
        Run auto = PreparedRing(directory);
        Expect(auto.AutoPrice(center) == 10 && auto.AutoPrice(Board.Boss) == 0, "只为可达普通房提供价格");
        Expect(!auto.AutoExplore(center), "余额不足不可自动");
        auto.Wallet.Earn(20);
        Expect(auto.AutoExplore(center) && auto.Board.Rooms[center].Completed && auto.Fighter.Battle == 0, "自动入账且没有命中能量");
        Expect(!auto.AutoExplore(center), "自动探索只能结算一次");

        Run manual = PreparedRing(directory);
        Expect(manual.Walk(center), "自主探索可进入");
        Expect(manual.Arena is { Surrounded: true } && manual.Arena.Enemies.All(enemy => enemy.Surrounded) &&
            !manual.CanTravel, "围住敌人强化、战中不可离开");
    }

    private static void Damage()
    {
        Expect(Rules.Damage(24, 25, 4) == 3, "物穿后伤害 3");
        Expect(Rules.Damage(20, 25) == 1, "保底 1");
        Expect(Rules.Damage(21, 25) == 2, "保底向上取整");
        Expect(Rules.EffectiveDefense(25, 4, 10) == 19, "先物穿，再计算法穿并进位");
        Expect(Rules.EffectiveDefense(2, 4, 10) == 0, "防御下限 0");
    }

    private static void Economy(string directory)
    {
        Wallet wallet = new();
        Expect(wallet.Borrow() && wallet.Gold == -15 && wallet.Materials == 2, "初始借贷");
        Expect(!wallet.Spend(1) && !wallet.Borrow(), "禁止负数消费及二次贷款");
        Expect(wallet.Earn(20) == 16 && wallet.Gold == 1, "贷后分笔入账");

        Run market = new(new ProfileStore(directory));
        market.Start();
        Expect(market.Build(Building.Market), "商场落地");
        market.AdvanceTime(20_000);
        Expect(market.Wallet.Gold == 4, "首轮商场");
        market.Wallet.Materials++;
        Expect(market.Upgrade(), "商场升级");
        market.AdvanceTime(15_000);
        Expect(market.Wallet.Gold == 8, "二级生产周期");

        Run industry = new(new ProfileStore(directory));
        industry.Start();
        Expect(industry.Build(Building.Factory), "建材厂落地");
        industry.Wallet.Earn(8);
        Expect(industry.OrderMaterial() && !industry.OrderMaterial(), "唯一队列");
        industry.AdvanceTime(25_000);
        Expect(industry.Wallet.Materials == 1, "建材产出");
        foreach (Room room in industry.Board.Rooms.Values)
            if (room.Type is not (RoomType.Boss or RoomType.Village) && room.Cell != new Cell(0, 2))
                room.Completed = true;
        Expect(industry.Walk(new Cell(0, 1)) && industry.Walk(new Cell(0, 2)), "矿场位置");
        Expect(industry.Build(Building.Mine), "矿场落地");
        industry.AdvanceTime(245_000);
        Expect(industry.Wallet.Ore == 6, "矿石上限");
        industry.Wallet.Materials++;
        Expect(industry.Teleport(new Cell(4, 1)) && industry.Walk(new Cell(4, 2)) &&
            industry.Build(Building.Village), "村庄落地");
        industry.AdvanceTime(5000);
        Expect(industry.Fighter.Atmosphere >= 23, "首层氛围和加成");
    }

    private static void Ultimate()
    {
        Fighter fighter = new() { Health = 40, Atmosphere = 99, Battle = 100 };
        Expect(!fighter.Ultimate() && fighter.Health == 40 && fighter.Battle == 100, "单槽不扣资源");
        fighter.Atmosphere = 100;
        Expect(fighter.Ultimate() && fighter.Health == 34 && fighter.Shield == 30 &&
            fighter.Boost == 20 && fighter.Atmosphere == 0 && fighter.Battle == 0, "双槽开大样例");
        fighter.Tick(1000);
        Expect(fighter.Shield == 29, "30% 临时盾每秒减 1");
        fighter.Tick(1000);
        Expect(fighter.Shield == 27, "跌过 30% 阈值每秒减 2");
        fighter.Health = 1;
        fighter.Atmosphere = fighter.Battle = 100;
        Expect(fighter.Ultimate() && fighter.Health == 1 && fighter.Boost == 20 && fighter.BoostMs == 10_000 &&
            fighter.Shield == 77, "1 HP 保命、叠盾、续期不叠攻");
    }

    private static Run ApproachingBoss(string directory)
    {
        Run run = new(new ProfileStore(directory));
        run.Start();
        foreach (Room room in run.Board.Rooms.Values)
            if (room.Type != RoomType.Boss) room.Completed = true;
        return run;
    }

    private static void Timing(string directory)
    {
        Run preview = new(new ProfileStore(directory));
        preview.Tick(100_000, Idle);
        Expect(preview.Remaining == 600_000, "预览停钟");
        Run timed = ApproachingBoss(directory);
        timed.AdvanceTime(598_000);
        Expect(!timed.Teleport(new Cell(2, 0)) && timed.Remaining == 2000, "不够时间拒绝传送");
        Expect(timed.Teleport(new Cell(1, 0)) && timed.Phase == Phase.Boss &&
            timed.Danger && timed.Remaining == 0, "恰好归零强制进 Boss");
        Arena instance = timed.Arena!;
        Expect(!timed.Teleport(Board.Boss) && ReferenceEquals(instance, timed.Arena), "不重复转换");

        Run normal = ApproachingBoss(directory);
        Expect(normal.Teleport(new Cell(4, 1)) && normal.Walk(Board.Boss) && !normal.Danger, "步行正常见棋帅");
        int before = normal.Remaining;
        normal.Fighter.Health = 100_000;
        for (int index = 0; index < 1000; index++) normal.Tick(10, Idle);
        Expect(normal.Remaining == before, "Boss 十秒不扣探索钟");
    }

    private static void Enemies(string directory)
    {
        HashSet<EnemyKind> kinds = new Board().Rooms.Values
            .Where(room => room.Type is RoomType.Ordinary or RoomType.Elite)
            .SelectMany(room => Run.MakeWave(room, 4)).ToHashSet();
        Expect(kinds.Count == 5, "固定图保证五种敌人");
        foreach (EnemyKind kind in kinds)
        {
            Arena arena = new(new Room(Board.Start, RoomType.Ordinary), [kind], new Fighter(), false, false, null, null);
            string? warning = null;
            for (int index = 0; index < 700 && warning is null; index++)
            {
                arena.Tick(10, Idle);
                warning = arena.Enemies[0].Attack?.Spec.Name;
            }
            Expect(warning is { Length: > 0 }, $"{kind} 预警");
        }
        VerifyRing(false, false, 12);
        VerifyRing(true, false, 16);
        VerifyRing(true, true, 18);

        void VerifyRing(bool enraged, bool danger, int expected)
        {
            Run run = ApproachingBoss(directory);
            if (danger) run.AdvanceTime(600_000);
            else Expect(run.Teleport(Board.Boss), "传送到 Boss");
            Arena arena = run.Arena!;
            if (enraged) arena.Enemies[0].Health = 250;
            bool sawRing = false;
            for (int index = 0; index < 340 && arena.Projectiles.Count == 0; index++)
            {
                run.Tick(10, Idle);
                sawRing |= arena.Enemies[0].Attack?.Kind == MoveKind.Ring;
            }
            Expect(sawRing && arena.Projectiles.Count == expected, $"环射预警和 {expected} 发");
        }
    }

    private static void Settlement(string directory)
    {
        string blocked = Path.Combine(directory, "blocked-profile");
        Directory.CreateDirectory(directory);
        File.WriteAllText(blocked, "测试用文件，阻挡建档。");
        ProfileStore retryProfile = new(blocked);
        Run crossing = ApproachingBoss(blocked);
        Expect(crossing.Teleport(Board.Boss), "进入结算夹具");
        crossing.Arena!.Enemies[0].Health = 0;
        crossing.Fighter.Health = 0;
        crossing.Wallet.Ore = 3;
        crossing.Tick(10, Idle);
        Expect(crossing.Result is { Won: false, Ore: 3 } && !crossing.Saved && crossing.Wallet.Ore == 0, "死亡优先、写入失败与局内清零");
        File.Move(blocked, Path.Combine(directory, "blocker.txt"));
        crossing.RetrySave();
        crossing.RetrySave();
        Expect(crossing.Saved && retryProfile.TryBalance(out int oldBalance) && oldBalance == 3, "同局重试只入账 3");
        ProfileStore restarted = new(blocked);
        Expect(restarted.TryBalance(out int newBalance) && newBalance == 3, "新档案实例回读");
        Guid stable = Guid.NewGuid();
        Expect(restarted.TryDeposit(stable, 2, out int once) && once == 5 &&
            new ProfileStore(blocked).TryDeposit(stable, 2, out int twice) && twice == 5, "两个存档实例共享去重");

        Run win = ApproachingBoss(blocked);
        Expect(win.Teleport(Board.Boss), "胜利夹具入场");
        Arena arena = win.Arena!;
        Enemy boss = arena.Enemies[0];
        boss.Health = 1;
        for (int index = 0; index < 140 && win.Phase == Phase.Boss; index++)
        {
            Vector2 direction = Rules.Unit(boss.Position - arena.Player);
            win.Tick(10, new ArenaInput(direction, boss.Position, true, false, false));
        }
        Expect(win.Result is { Won: true } && win.Saved && !win.Walk(new Cell(4, 1)), "实际普攻击倒 Boss、胜利并封盘");
    }
}
