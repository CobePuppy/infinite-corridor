using System.Drawing.Drawing2D;
using System.Numerics;

namespace Demo;

internal sealed partial class GameWindow
{
    private readonly Dictionary<(int, bool), Font> _fonts = [];

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        _frames++;
        if (_smoke && _smokeStep >= 2 && _frames <= 40) _paintTimes.Add(_clock.Elapsed.TotalMilliseconds);
        _buttons.Clear();
        (float scale, float x, float y) = View();
        if (scale <= 0) return;
        Graphics g = e.Graphics;
        g.Clear(_palette.Background);
        g.TranslateTransform(x, y);
        g.ScaleTransform(scale, scale);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;

        switch (_screen)
        {
            case Screen.Menu: DrawMenu(g, false); break;
            case Screen.Character: DrawMenu(g, true); break;
            case Screen.Tech: DrawTechnology(g); break;
            case Screen.Play when Run.Phase == Phase.Preview: DrawMap(g, true); break;
            case Screen.Play when Run.Phase == Phase.Result: DrawResult(g); break;
            default:
                DrawRun(g);
                switch (_panel)
                {
                    case Panel.Map: DrawMap(g, false); break;
                    case Panel.Build: DrawBuild(g); break;
                    case Panel.Merchant: DrawMerchant(g); break;
                    case Panel.Skill: DrawSkill(g); break;
                    case Panel.Pause: DrawPause(g); break;
                }
                break;
        }
    }

    private void DrawMenu(Graphics g, bool character)
    {
        DrawBackdrop(g);
        TextAt(g, "关城", 88, 121, 102, _palette.Paper, true);
        TextAt(g, "M1  ·  首层灰盒", 100, 256, 19, _palette.Bronze);
        Line(g, _palette.Line, 1, 102, 309, 465, 309);
        if (!character)
        {
            TextAt(g, "清房点亮棋盘，围出一条路。", 99, 340, 27, _palette.Paper, true);
            TextAt(g, "建起村火，再去迎战镇关棋帅。", 100, 389, 17, _palette.Muted);
            Button(g, new(100, 432, 272, 56), "开始新局", () => _screen = Screen.Character, true);
            Button(g, new(100, 501, 272, 48), "科技树", ShowTechnology);
            Button(g, new(100, 560, 272, 48), "退出", Close);
            TextAt(g, "WASD 移动   ·   鼠标瞄准   ·   Tab 棋盘", 100, 711, 16, _palette.Muted);
            return;
        }
        TextAt(g, "角色一  /  朱衣刀客", 99, 344, 27, _palette.Paper, true);
        TextAt(g, "唐刀近战，清房额外回血，村庄氛围 +15%。", 100, 398, 17, _palette.Muted);
        Button(g, new(100, 466, 272, 54), "选定角色", NewRun, true);
        Button(g, new(100, 533, 272, 47), "返回主菜单", ShowMenu);
    }

    private void DrawBackdrop(Graphics g)
    {
        RectangleF board = new(610, 98, 566, 570);
        Fill(g, _palette.Panel, board);
        Outline(g, _palette.Line, 1, board);
        for (int index = 1; index <= 10; index++)
        {
            int step = index * 50;
            Line(g, _palette.Line, 1, 618 + step, 118, 618 + step, 648);
            Line(g, _palette.Line, 1, 630, 113 + step, 1155, 113 + step);
        }
        PointF[] light = [new(868, 263), new(918, 263), new(968, 263), new(868, 313),
            new(968, 313), new(868, 363), new(918, 363), new(968, 363)];
        foreach (PointF point in light)
        {
            Disc(g, _palette.Background, point.X + 3, point.Y + 4, 20);
            Disc(g, _palette.Paper, point.X, point.Y, 19);
            Circle(g, _palette.Muted, 1, point.X, point.Y, 15);
        }
        Disc(g, _palette.Vermilion, 918, 313, 23);
        Circle(g, _palette.Danger, 2, 918, 313, 29);
        TextAt(g, "外环合拢，中心即被围住", 676, 598, 19, _palette.Paper);
    }

    private void DrawTechnology(Graphics g)
    {
        TextAt(g, "科技树", 64, 53, 54, _palette.Paper, true);
        TextAt(g, _techRead ? $"苍白矿石  {_techBalance}" : "苍白矿石 · 档案暂不可读取", 66, 144, 25, _palette.Ore);
        string[] titles = ["角色", "开局效果", "局内事件"];
        string[] entries = ["角色解锁\n基础数值\n技能升级", "开局建材\n建筑效率\n探索时间", "棋帅分支\n结局线索"];
        for (int index = 0; index < 3; index++)
        {
            float left = 67 + index * 386;
            Card(g, new(left, 229, 352, 387));
            TextAt(g, titles[index], left + 24, 250, 27, _palette.Paper, true);
            string[] lines = entries[index].Split('\n');
            for (int row = 0; row < lines.Length; row++)
            {
                float y = 315 + 62 * row;
                Outline(g, _palette.Line, 1, new(left + 24, y, 304, 42));
                TextAt(g, lines[row], left + 37, y + 10, 16, _palette.Muted);
                TextAt(g, "锁定", left + 264, y + 10, 15, _palette.Bronze);
            }
            TextAt(g, "本版仅预览", left + 24, 559, 15, _palette.Muted);
        }
        Button(g, new(68, 667, 230, 52), "返回主菜单", ShowMenu);
    }

    private void DrawResult(Graphics g)
    {
        Result result = Run.Result!;
        TextAt(g, result.Won ? "此关已开" : "此局封盘", 87, 80, 68, _palette.Paper, true);
        TextAt(g, result.Danger ? "超时迎战 · 续层记录：" + Run.TimeoutEffect : $"余时 {TimeLabel(result.Remaining)}",
            92, 177, 24, _palette.Bronze);
        Card(g, new(91, 245, 704, 411));
        TextAt(g, $"已点亮  {result.Rooms} / 15", 121, 272, 29, _palette.Paper, true);
        TextAt(g, $"围住  ·  自主 {result.Manual}  /  自动 {result.Auto}", 123, 331, 20, _palette.Muted);
        TextAt(g, $"建成 {result.Buildings} 处  ·  制材 {result.MaterialOutput} 份", 123, 377, 20, _palette.Muted);
        TextAt(g, $"探索金币 {result.KillGold}  /  商场金币 {result.MarketGold}", 123, 423, 20, _palette.Muted);
        Line(g, _palette.Line, 1, 124, 483, 760, 483);
        TextAt(g, Run.Saved ? $"矿石到账  +{result.Ore}" : $"本局矿石 {result.Ore} 尚未入账",
            122, 505, 26, Run.Saved ? _palette.Ore : _palette.Danger, true);
        if (Run.Saved) TextAt(g, $"局外余额  {Run.Balance}", 123, 555, 19, _palette.Muted);
        TextAt(g, "金币、建材和本局强化已清零", 123, 601, 17, _palette.Muted);
        if (Run.Saved)
        {
            Button(g, new(837, 446, 318, 55), "再下一局   [Enter]", NewRun, true);
            Button(g, new(837, 514, 318, 55), "回到主菜单", ShowMenu);
        }
        else Button(g, new(837, 446, 318, 55), "重试保存   [Enter]", Run.RetrySave, true);
    }

    private void DrawRun(Graphics g)
    {
        Arena arena = Run.Arena!;
        Card(g, new(28, 24, 890, 66));
        Bar(g, 47, 49, 216, 13, Run.Fighter.Health, Run.Fighter.MaxHealth, _palette.Heal);
        TextAt(g, $"生命 {Run.Fighter.Health}/{Run.Fighter.MaxHealth}   盾 {Run.Fighter.Shield}",
            47, 66, 14, _palette.Paper);
        if (Run.Fighter.Shield > 0)
            Bar(g, 47, 38, 216, 6, Run.Fighter.Shield, Run.Fighter.MaxHealth, _palette.Shield);
        TextAt(g, TimeLabel(Run.Remaining), 361, 36, 30, _palette.Paper, true);
        TextAt(g, Run.Phase == Phase.Boss ? Run.Danger ? "超时迎战 · 停钟" : "棋帅战 · 停钟" : "探索余时",
            483, 47, 17, _palette.Bronze);
        string attack = Run.Fighter.BoostMs > 0 ? $"爆发 +{Run.Fighter.Boost}  ·  {Seconds(Run.Fighter.BoostMs)} 秒" : "";
        TextAt(g, attack, 702, 48, 16, _palette.Danger);
        DrawArena(g, arena);

        Card(g, new(940, 24, 312, 664));
        TextAt(g, RoomName(Run.Room.Type), 964, 46, 31, _palette.Paper, true);
        TextAt(g, $"{Run.Current.X},{Run.Current.Y}  ·  已点亮 {Run.Board.CompletedCount} / 15", 966, 94, 15, _palette.Muted);
        BoardDiagram(g, 969, 272, 44, 45, 13, false, false);
        Line(g, _palette.Line, 1, 963, 305, 1230, 305);
        TextAt(g, $"金币  {Run.Wallet.Gold}", 963, 321, 21, Run.Wallet.Gold < 0 ? _palette.Danger : _palette.Bronze, true);
        TextAt(g, $"建材  {Run.Wallet.Materials}     矿石  {Run.Wallet.Ore}", 963, 357, 18, _palette.Ore);
        if (Run.Wallet.Borrowed) TextAt(g, "贷款生效 · 金币收入 -20%", 964, 390, 14, _palette.Danger);
        if (Run.Room.Building != Building.None)
            TextAt(g, $"{BuildingName(Run.Room.Building)}  /  {Run.Room.Level} 级", 963, 425, 19, _palette.Bronze);
        if (Run.CanTravel)
        {
            if (Run.Room.Type is RoomType.Resource or RoomType.Village)
                Button(g, new(963, 468, 264, 41), "建造 / 升级   [B]", OpenBuild);
            if (Run.Room.Type == RoomType.Merchant)
                Button(g, new(963, 468, 264, 41), "与商人交易   [E]", () => _panel = Panel.Merchant);
            if (Run.Board.Rooms.Values.Any(room => room.Building == Building.Factory))
                Button(g, new(963, 520, 264, 41), "下单制材 · 8 金币   [F]",
                    () => { if (!Run.OrderMaterial()) Run.Hint("制材队列忙，或金币不足。"); });
        }
        if (Run.SkillChoices > 0)
            Button(g, new(963, 570, 264, 41), $"技能球 ×{Run.SkillChoices}   [V]", () => _panel = Panel.Skill);
        Button(g, new(963, 626, 264, 44), "打开棋盘   [Tab]", ToggleMap);

        Card(g, new(28, 701, 1224, 75));
        Energy(g, 47, 714, "氛围", Run.Fighter.Atmosphere, _palette.Atmosphere);
        Energy(g, 253, 714, "战斗", Run.Fighter.Battle, _palette.Bronze);
        TextAt(g, Run.Fighter.Atmosphere == 100 && Run.Fighter.Battle == 100 ? "[Q] 可开大" : "[Q] 双槽满可开大",
            460, 721, 17, Run.Fighter.Atmosphere == 100 && Run.Fighter.Battle == 100 ? _palette.Danger : _palette.Muted);
        TextAt(g, $"左键 普攻   ·   右键 小技能 {Ready(arena.SkillCooldown)}   ·   Space 冲刺 {Ready(arena.DashCooldown)}",
            663, 722, 15, _palette.Paper);
        TextAt(g, "WASD 移动     E 过门 / 交互     Esc 暂停", 663, 747, 14, _palette.Muted);
    }

    private void DrawArena(Graphics g, Arena arena)
    {
        GraphicsState state = g.Save();
        g.SetClip(Field);
        Fill(g, _palette.Field, Field);
        for (int x = 100; x < Arena.Width; x += 100)
        {
            PointF point = Position(new Vector2(x, 0));
            Line(g, Color.FromArgb(x % 500 == 0 ? 105 : 54, _palette.Line), 1, point.X, Field.Top, point.X, Field.Bottom);
        }
        for (int y = 100; y < Arena.Height; y += 100)
        {
            PointF point = Position(new Vector2(0, y));
            Line(g, Color.FromArgb(y % 500 == 0 ? 105 : 54, _palette.Line), 1, Field.Left, point.Y, Field.Right, point.Y);
        }
        foreach (Cell neighbor in Run.Board.Neighbors(Run.Current))
        {
            Cell direction = neighbor - Run.Current;
            PointF p = Position(Arena.Door(direction, 18));
            Color color = Run.CanTravel ? _palette.Bronze : _palette.Line;
            if (direction.X == 0)
                Line(g, color, 7, p.X - 36, p.Y, p.X + 36, p.Y);
            else Line(g, color, 7, p.X, p.Y - 36, p.X, p.Y + 36);
            PointF label = Position(Arena.Door(direction, 103));
            TextAt(g, Run.CanTravel ? "E" : "×", label.X - 5, label.Y - 11, 17, color, true);
        }

        for (int index = 0; index < arena.Pots.Length; index++)
        {
            if ((arena.BrokenPots & (1 << index)) != 0) continue;
            PointF pot = Position(arena.Pots[index]);
            Fill(g, _palette.Bronze, new(pot.X - 7, pot.Y - 2, 14, 15));
            Line(g, _palette.Paper, 2, pot.X - 6, pot.Y - 7, pot.X + 6, pot.Y - 7);
        }
        foreach (Loot loot in Run.GroundLoot)
        {
            PointF point = Position(loot.Position);
            Color accent = loot.Kind == LootKind.Skill ? _palette.Atmosphere : loot.Kind == LootKind.Gold ? _palette.Bronze : _palette.Heal;
            Disc(g, _palette.Background, point.X, point.Y, 11);
            Circle(g, accent, 2, point.X, point.Y, 9);
            TextAt(g, loot.Kind == LootKind.Heal ? "+" : loot.Kind == LootKind.Skill ? "◇" : "·",
                point.X - 8, point.Y - 12, 14, accent, true);
        }
        foreach (Enemy enemy in arena.Enemies) DrawWarning(g, enemy);
        if (arena.Strike is StrikeVisual strike)
            DrawFan(g, strike.Origin, strike.Facing, strike.Reach, strike.Angle, _palette.Paper, 62);
        foreach (Enemy enemy in arena.Enemies) DrawEnemy(g, enemy);
        foreach (Projectile projectile in arena.Projectiles)
        {
            PointF center = Position(projectile.Position);
            if (projectile.Arrow)
            {
                PointF tail = Position(projectile.Position - Rules.Unit(projectile.Velocity) * 48);
                Line(g, _palette.Background, 7, tail.X, tail.Y, center.X, center.Y);
                Line(g, _palette.Danger, 3, tail.X, tail.Y, center.X, center.Y);
            }
            else
            {
                Disc(g, _palette.Background, center.X, center.Y, 9);
                Disc(g, _palette.Danger, center.X, center.Y, 6);
                Disc(g, _palette.Bullet, center.X, center.Y, 3);
            }
        }

        PointF player = Position(arena.Player);
        Color playerColor = arena.HurtFlash > 0 ? _palette.Paper : _palette.Vermilion;
        Disc(g, _palette.Background, player.X + 3, player.Y + 5, 19);
        Disc(g, playerColor, player.X, player.Y, 15);
        Circle(g, _palette.Paper, 2, player.X, player.Y, 15);
        PointF tip = Position(arena.Player + arena.Facing * 75);
        Line(g, _palette.Paper, 4, player.X, player.Y, tip.X, tip.Y);
        if (arena.Invincible > 0) Circle(g, _palette.Paper, 2, player.X, player.Y, 23);
        if (Run.Fighter.Shield > 0) Circle(g, _palette.Shield, 3, player.X, player.Y, 28);
        if (arena.Stunned > 0) TextAt(g, "眩晕", player.X - 17, player.Y - 51, 16, _palette.Danger, true);
        if (Run.Phase == Phase.Boss && arena.Enemies.Count > 0)
        {
            Enemy boss = arena.Enemies[0];
            Fill(g, Color.FromArgb(225, _palette.Background), new(219, 114, 505, 61));
            TextAt(g, boss.Rage ? "镇关棋帅 · 狂暴" : "镇关棋帅", 235, 119, 18,
                boss.Rage ? _palette.Danger : _palette.Paper, true);
            TextAt(g, $"{boss.Health}/{boss.MaxHealth}", 608, 122, 15, _palette.Paper);
            Bar(g, 238, 151, 468, 10, boss.Health, boss.MaxHealth, _palette.Vermilion);
        }
        if (Run.Notice.Length > 0)
        {
            Fill(g, Color.FromArgb(233, _palette.Background), new(126, 632, 694, 36));
            TextAt(g, Run.Notice, 143, 639, 16, _palette.Paper);
        }
        g.Restore(state);
        Outline(g, _palette.Line, 2, Field);
    }

    private void DrawEnemy(Graphics g, Enemy enemy)
    {
        PointF pt = Position(enemy.Position);
        float radius = enemy.Spec.Radius * Field.Width / Arena.Width;
        Color color = enemy.Kind switch
        {
            EnemyKind.Thief => Color.FromArgb(173, 149, 123), EnemyKind.Rebel => Color.FromArgb(160, 100, 72),
            EnemyKind.Heavy => Color.FromArgb(127, 149, 154), EnemyKind.Archer => Color.FromArgb(56, 139, 127),
            EnemyKind.Cavalry => Color.FromArgb(151, 126, 188),
            _ => enemy.Rage ? _palette.Vermilion : Color.FromArgb(72, 83, 89)
        };
        Disc(g, _palette.Background, pt.X + 3, pt.Y + 4, radius + 3);
        if (enemy.Kind == EnemyKind.Heavy)
        {
            Fill(g, color, new(pt.X - radius, pt.Y - radius, radius * 2, radius * 2));
            Outline(g, _palette.Paper, 1, new(pt.X - radius, pt.Y - radius, radius * 2, radius * 2));
        }
        else if (enemy.Kind is EnemyKind.Thief or EnemyKind.Archer)
        {
            using SolidBrush brush = new(color);
            g.FillPolygon(brush, [new PointF(pt.X, pt.Y - radius), new PointF(pt.X + radius, pt.Y + radius),
                new PointF(pt.X - radius, pt.Y + radius)]);
            if (enemy.Kind == EnemyKind.Archer) Circle(g, _palette.Paper, 2, pt.X, pt.Y, radius + 2);
        }
        else
        {
            Disc(g, color, pt.X, pt.Y, radius);
            Circle(g, enemy.Rage ? _palette.Danger : _palette.Paper, 2, pt.X, pt.Y, radius);
            if (enemy.Kind == EnemyKind.Marshal)
            {
                Circle(g, _palette.Line, 8, pt.X, pt.Y, radius - 14);
                Outline(g, _palette.Line, 2, new(pt.X - 44, pt.Y - 44, 88, 88));
                TextAt(g, "帅", pt.X - 37, pt.Y - 45, 60, _palette.Paper, true);
            }
            else if (enemy.Kind == EnemyKind.Cavalry)
                Line(g, _palette.Paper, 4, pt.X - radius, pt.Y + radius / 2, pt.X + radius + 12, pt.Y - radius / 2);
        }
        if (enemy.Kind != EnemyKind.Marshal)
        {
            TextAt(g, enemy.Spec.Name, pt.X - radius, pt.Y - radius - 23, 13, _palette.Paper, true);
            Bar(g, pt.X - radius, pt.Y + radius + 6, radius * 2, 4, enemy.Health, enemy.MaxHealth, _palette.Paper);
        }
        if (enemy.Attack is { } attack)
        {
            string label = attack.Elapsed < attack.Spec.Windup ? attack.Spec.Name :
                attack.Kind == MoveKind.Volley ? $"{attack.Spec.Name}  {attack.Fired}/{attack.Shots}" : attack.Spec.Name;
            float top = enemy.Kind == EnemyKind.Marshal ? pt.Y + 30 : pt.Y + radius + 11;
            TextAt(g, label, pt.X - 44, top, 13, _palette.Danger, true);
        }
    }

    private void DrawWarning(Graphics g, Enemy enemy)
    {
        if (enemy.Attack is not Attack attack) return;
        MoveSpec move = attack.Spec;
        int opacity = 45 + Math.Min(70, attack.Elapsed * 70 / move.Windup);
        switch (move.Shape)
        {
            case WarningShape.Fan:
                int reach = move.Reach + (enemy.Kind == EnemyKind.Marshal ? enemy.Spec.Radius : 0);
                DrawFan(g, enemy.Position, attack.Facing, reach, move.Angle, _palette.Danger, opacity);
                break;
            case WarningShape.Circle:
                DrawFan(g, enemy.Position, attack.Facing, move.Reach, 360, _palette.Danger, opacity);
                break;
            case WarningShape.Ring:
                PointF center = Position(enemy.Position);
                float r = move.Reach * Field.Width / Arena.Width;
                Circle(g, _palette.Danger, 3, center.X, center.Y, r);
                Circle(g, Color.FromArgb(opacity, _palette.Danger), 3, center.X, center.Y,
                    r + (move.Windup - Math.Min(move.Windup, attack.Elapsed)) * 0.035f);
                for (int index = 0; index < attack.Shots; index++)
                {
                    Vector2 dir = Rules.Rotate(attack.Facing, index * MathF.Tau / attack.Shots);
                    PointF marker = Position(enemy.Position + dir * move.Reach);
                    Disc(g, _palette.Danger, marker.X, marker.Y, 4);
                }
                break;
            case WarningShape.Lane:
                bool charge = attack.Kind == MoveKind.Charge;
                int left = Math.Clamp(move.Windup + 720 - attack.Elapsed, 0, 720);
                int reachLeft = charge ? Rules.Ceil(Rules.Percent(enemy.Speed, 150) * left, 1000) : move.Reach;
                DrawLane(g, enemy.Position, attack.Facing, reachLeft, charge ? 100 : 17, opacity);
                break;
        }
    }

    private void DrawFan(Graphics g, Vector2 origin, Vector2 direction, int reach, int angle, Color color, int opacity)
    {
        PointF center = Position(origin);
        float radius = reach * Field.Width / Arena.Width;
        RectangleF bounds = new(center.X - radius, center.Y - radius, radius * 2, radius * 2);
        float start = MathF.Atan2(direction.Y, direction.X) * 180 / MathF.PI - angle / 2f;
        using HatchBrush brush = new(HatchStyle.ForwardDiagonal, Color.FromArgb(opacity, color), Color.FromArgb(opacity / 3, color));
        using Pen pen = new(color, 2);
        if (angle >= 360)
        {
            g.FillEllipse(brush, bounds);
            g.DrawEllipse(pen, bounds);
        }
        else
        {
            g.FillPie(brush, bounds.X, bounds.Y, bounds.Width, bounds.Height, start, angle);
            g.DrawPie(pen, bounds, start, angle);
        }
    }

    private void DrawLane(Graphics g, Vector2 origin, Vector2 direction, int reach, int halfWidth, int opacity)
    {
        Vector2 perpendicular = new(-direction.Y * halfWidth, direction.X * halfWidth);
        Vector2 end = origin + direction * reach;
        PointF[] corners = [Position(origin + perpendicular), Position(end + perpendicular),
            Position(end - perpendicular), Position(origin - perpendicular)];
        using HatchBrush brush = new(HatchStyle.ForwardDiagonal, Color.FromArgb(opacity, _palette.Danger), Color.Transparent);
        using Pen pen = new(_palette.Danger, 1.5f);
        g.FillPolygon(brush, corners);
        g.DrawPolygon(pen, corners);
    }

    private static PointF Position(Vector2 point) => new(Field.Left + point.X * Field.Width / Arena.Width,
        Field.Top + point.Y * Field.Height / Arena.Height);

    private void DrawMap(Graphics g, bool preview)
    {
        _buttons.Clear();
        Fill(g, preview ? _palette.Background : Color.FromArgb(240, _palette.Background), new(0, 0, 1280, 800));
        TextAt(g, preview ? "落子前看盘" : "关城棋盘", 63, 59, 54, _palette.Paper, true);
        TextAt(g, preview ? $"第一层 · 固定种子 {Board.Seed} · 确认后开始计时" :
            Run.Phase == Phase.Boss ? "棋帅战 · 只可查看" : $"探索钟 {TimeLabel(Run.Remaining)} · 选择房间查看走法",
            68, 141, 18, _palette.Muted);
        Card(g, new(69, 222, 785, 349));
        BoardDiagram(g, 140, 457, 126, 105, 28, preview, !preview);
        TextAt(g, "○ 未探索    ● 已点亮    ◎ 围住    ◇ 当前位置", 76, 600, 18, _palette.Paper);

        Card(g, new(883, 221, 332, 470));
        if (preview)
        {
            TextAt(g, "出生 · 资源房", 910, 250, 26, _palette.Paper, true);
            TextAt(g, "开局获得一份建材。", 913, 316, 17, _palette.Muted);
            TextAt(g, "沿相邻街巷清房点亮。", 913, 350, 17, _palette.Muted);
            TextAt(g, "用已点亮的外环围住战斗房。", 913, 384, 17, _palette.Muted);
            TextAt(g, "村庄供氛围，攻击供战斗值。", 913, 418, 17, _palette.Muted);
            Button(g, new(913, 588, 270, 55), "确认落子   [Enter]", Run.Start, true);
            Button(g, new(70, 658, 200, 48), "返回主菜单", ShowMenu);
            return;
        }
        if (_target is Cell cell)
        {
            Room room = Run.Board.Rooms[cell];
            TextAt(g, RoomName(room.Type), 910, 247, 27, _palette.Paper, true);
            TextAt(g, $"坐标 {cell.X},{cell.Y}   ·   {(room.Completed ? "已点亮" : Run.Surrounded.Contains(cell) ? "已围住" : "未探索")}",
                913, 297, 17, _palette.Muted);
            bool adjacent = Run.CanTravel && Run.Board.Neighbors(Run.Current).Contains(cell);
            int price = Run.AutoPrice(cell);
            if (adjacent)
                Button(g, new(913, 380, 269, 44), price > 0 ? "亲自迎战 · 5 秒" : "沿门进入 · 5 秒", () => Walk(cell), true);
            if (price > 0)
            {
                Button(g, new(913, 432, 269, 44), $"自动探索 · {price} 金币", () =>
                {
                    if (!Run.AutoExplore(cell)) Run.Hint("金币不足，仍可亲自迎战。");
                }, enabled: Run.Wallet.Gold >= price);
                TextAt(g, "自探可争取更稀有的掉落。", 914, 533, 15, _palette.Muted);
            }
            if (Run.CanTravel && Run.Board.TeleportCost(Run.Current, cell) is int cost)
            {
                Button(g, new(913, 484, 269, 44), $"传送 · {Seconds(cost)} 秒   [T]", () => Teleport(cell),
                    enabled: cost <= Run.Remaining);
                if (cost == Run.Remaining)
                    TextAt(g, "确认后立即进入超时棋帅战。", 914, 538, 15, _palette.Danger);
            }
            if (!adjacent && price == 0 && Run.Board.TeleportCost(Run.Current, cell) is null)
                TextAt(g, "请先点亮通往该房的相邻入口。", 913, 370, 16, _palette.Muted);
        }
        else TextAt(g, "点击棋盘上的房间", 914, 266, 22, _palette.Paper, true);
        if (Run.Notice.Length > 0 && Run.Notice.Length < 38)
            TextAt(g, Run.Notice, 74, 661, 16, _palette.Bronze);
        Button(g, new(913, 620, 269, 44), "返回当前房间   [Esc]", ToggleMap);
    }

    private void BoardDiagram(Graphics g, float x, float y, float dx, float dy, int radius, bool preview, bool interactive)
    {
        PointF At(Cell cell) => new(x + cell.X * dx, y - cell.Y * dy);
        foreach (Room room in Run.Board.Rooms.Values)
        {
            PointF a = At(room.Cell);
            foreach (Cell neighbor in Run.Board.Neighbors(room.Cell).Where(cell => cell.X > room.Cell.X || cell.Y > room.Cell.Y))
            {
                PointF b = At(neighbor);
                bool lit = room.Completed && Run.Board.Rooms[neighbor].Completed;
                Line(g, lit ? _palette.Bronze : _palette.Line, lit ? 3 : 1.5f, a.X, a.Y, b.X, b.Y);
            }
        }
        foreach (Room room in Run.Board.Rooms.Values)
        {
            PointF p = At(room.Cell);
            Color color = room.Type switch
            {
                RoomType.Boss => _palette.Danger, RoomType.Village => _palette.Atmosphere, RoomType.Merchant => _palette.Bronze,
                RoomType.Resource => _palette.Shield, _ => _palette.Paper
            };
            Disc(g, room.Completed ? color : _palette.Background, p.X, p.Y, radius);
            Circle(g, color, 2, p.X, p.Y, radius);
            if (Run.Surrounded.Contains(room.Cell)) Circle(g, _palette.Danger, 2, p.X, p.Y, radius + 5);
            if ((!preview && room.Cell == Run.Current) || (preview && room.Cell == Board.Start) ||
                (!preview && interactive && room.Cell == _target))
                Circle(g, _palette.Vermilion, 3, p.X, p.Y, radius + 9);
            string symbol = preview && room.Cell == Board.Start ? "始" : room.Type switch
            {
                RoomType.Resource => "材", RoomType.Boss => "帅", RoomType.Village => "村", RoomType.Merchant => "商",
                RoomType.Elite => "精", _ => "战"
            };
            TextAt(g, symbol, p.X - radius * 0.58f, p.Y - radius * 0.72f, (int)(radius * 1.07f),
                room.Completed ? _palette.Background : color, true);
            if (interactive)
            {
                Cell target = room.Cell;
                _buttons.Add(new(new RectangleF(p.X - radius - 8, p.Y - radius - 8, radius * 2 + 16, radius * 2 + 16),
                    () => _target = target));
            }
        }
    }

    private void Overlay(Graphics g, string title, string subtitle)
    {
        _buttons.Clear();
        Fill(g, Color.FromArgb(194, _palette.Background), new(0, 0, 1280, 800));
        Card(g, new(335, 168, 610, 469));
        TextAt(g, title, 373, 206, 41, _palette.Paper, true);
        TextAt(g, subtitle, 375, 278, 18, _palette.Muted);
        Button(g, new(375, 565, 529, 44), "返回当前房间   [Esc]", () => _panel = Panel.None);
    }

    private void DrawBuild(Graphics g)
    {
        Overlay(g, Run.Room.Type == RoomType.Village ? "点灯建村" : "建造", $"现有建材 {Run.Wallet.Materials} · 建造和升级各耗 1 建材");
        if (Run.Room.Building != Building.None)
        {
            string name = BuildingName(Run.Room.Building);
            Button(g, new(375, 338, 529, 46), Run.Room.Level == 1 ? $"升级{name} · 周期缩短四分之一" : $"{name} · 已到 2 级",
                () => { if (Run.Upgrade()) _panel = Panel.None; }, true, Run.Room.Level == 1 && Run.Wallet.Materials > 0);
            return;
        }
        if (Run.Room.Type == RoomType.Village)
        {
            Option(Building.Village, 338, "点亮村庄 · 持续提供氛围");
            return;
        }
        Option(Building.Market, 338, "商场 · 每 20 秒产金币");
        Option(Building.Factory, 393, "建材厂 · 花金币远程制作建材");
        Option(Building.Mine, 448, "苍白矿场 · 整局一座，最多 6 矿石");

        void Option(Building type, int top, string label)
        {
            bool uniqueTaken = (type is Building.Factory or Building.Mine) &&
                Run.Board.Rooms.Values.Any(room => room.Building == type);
            Button(g, new(375, top, 529, 46), uniqueTaken ? label + " · 已建" : label,
                () => { if (Run.Build(type)) _panel = Panel.None; }, enabled: Run.Wallet.Materials > 0 && !uniqueTaken);
        }
    }

    private void DrawMerchant(Graphics g)
    {
        Overlay(g, "行脚商人", $"金币 {Run.Wallet.Gold} · 建材 {Run.Wallet.Materials}");
        Button(g, new(375, 333, 529, 46), "购买 1 建材 · 12 金币", () => Run.BuyMaterial(), enabled: Run.Wallet.Gold >= 12);
        Button(g, new(375, 389, 529, 46), "唐刀强化 · 20 金币，攻击 +8", () =>
        {
            Run.Hint(Run.BuyAttack() ? "唐刀攻击 +8。" : "本局已强化唐刀，或金币不足。");
            _panel = Panel.None;
        }, enabled: Run.Wallet.Gold >= 20);
        Button(g, new(375, 445, 529, 46), Run.Wallet.Borrowed ? "本局已借贷" : "高利贷 · 建材 +1，债务与永久收入 -20%",
            () => { if (Run.Borrow()) _panel = Panel.None; }, enabled: !Run.Wallet.Borrowed);
    }

    private void DrawSkill(Graphics g)
    {
        Overlay(g, "技能球", $"余下 {Run.SkillChoices} 次选择 · 也可先返回继续战斗");
        Button(g, new(375, 338, 529, 51), "利刃 · 本局攻击 +2", () => UseSkill(true), true);
        Button(g, new(375, 401, 529, 51), "强体 · 最大生命 +10，并恢复 10", () => UseSkill(false));
    }

    private void UseSkill(bool attack)
    {
        Run.PickSkill(attack);
        if (Run.SkillChoices == 0) _panel = Panel.None;
    }

    private void DrawPause(Graphics g)
    {
        Overlay(g, "已暂停", "探索和战斗时间暂停。");
        Button(g, new(375, 344, 529, 49), "继续本局", () => _panel = Panel.None, true);
    }

    private void Button(Graphics g, RectangleF box, string label, Action onClick, bool primary = false, bool enabled = true)
    {
        Color fill = primary && enabled ? Color.FromArgb(132, 49, 39) : _palette.Panel;
        Fill(g, fill, box);
        Outline(g, enabled ? primary ? _palette.Bronze : _palette.Line : Color.FromArgb(90, _palette.Line), 1, box);
        TextAt(g, label, box.Left + 13, box.Top + (box.Height - 23) / 2, 17, enabled ? _palette.Paper : _palette.Muted);
        if (enabled) _buttons.Add(new(box, onClick));
    }

    private void Energy(Graphics g, float x, float y, string label, int value, Color color)
    {
        TextAt(g, $"{label}  {value}/100", x, y, 15, value == 100 ? color : _palette.Paper, value == 100);
        Bar(g, x, y + 30, 174, 11, value, 100, color);
    }

    private void Bar(Graphics g, float x, float y, float width, float height, int value, int max, Color color)
    {
        Fill(g, _palette.Background, new(x, y, width, height));
        Fill(g, color, new(x, y, width * Math.Clamp(value, 0, max) / max, height));
        Outline(g, _palette.Line, 0.8f, new(x, y, width, height));
    }

    private void Card(Graphics g, RectangleF box)
    {
        Fill(g, _palette.Panel, box);
        Outline(g, _palette.Line, 1, box);
    }

    private void TextAt(Graphics g, string label, float x, float y, int size, Color color, bool bold = false)
    {
        if (!_fonts.TryGetValue((size, bold), out Font? font))
        {
            font = new Font("Microsoft YaHei UI", size, bold ? FontStyle.Bold : FontStyle.Regular, GraphicsUnit.Pixel);
            _fonts.Add((size, bold), font);
        }
        using SolidBrush brush = new(color);
        g.DrawString(label, font, brush, x, y, StringFormat.GenericTypographic);
    }

    private static void Fill(Graphics g, Color color, RectangleF box)
    {
        using SolidBrush brush = new(color);
        g.FillRectangle(brush, box);
    }

    private static void Outline(Graphics g, Color color, float width, RectangleF box)
    {
        using Pen pen = new(color, width);
        g.DrawRectangle(pen, box);
    }

    private static void Disc(Graphics g, Color color, float x, float y, float radius)
    {
        using SolidBrush brush = new(color);
        g.FillEllipse(brush, x - radius, y - radius, radius * 2, radius * 2);
    }

    private static void Circle(Graphics g, Color color, float width, float x, float y, float radius)
    {
        using Pen pen = new(color, width);
        g.DrawEllipse(pen, x - radius, y - radius, radius * 2, radius * 2);
    }

    private static void Line(Graphics g, Color color, float width, float x, float y, float x2, float y2)
    {
        using Pen pen = new(color, width);
        g.DrawLine(pen, x, y, x2, y2);
    }

    private static int Seconds(int ms) => Rules.Ceil(ms, 1000);
    private static string Ready(int ms) => ms == 0 ? "就绪" : $"{Seconds(ms)} 秒";

    private static string TimeLabel(int ms)
    {
        int seconds = Seconds(ms);
        return $"{seconds / 60:00}:{seconds % 60:00}";
    }

    private static string BuildingName(Building type) => type switch
    {
        Building.Market => "商场", Building.Factory => "建材厂", Building.Mine => "苍白矿场",
        Building.Village => "村庄", _ => ""
    };

    private static string RoomName(RoomType type) => type switch
    {
        RoomType.Resource => "资源采集房", RoomType.Ordinary => "普通战斗房", RoomType.Elite => "精英战斗房",
        RoomType.Merchant => "商人房", RoomType.Village => "村庄", _ => "镇关棋帅"
    };
}
