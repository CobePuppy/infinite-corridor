using System.Numerics;

namespace Demo;

internal enum EnemyKind { Thief, Rebel, Heavy, Archer, Cavalry, Marshal }
internal enum MoveKind { Stab, Cleave, Slam, Sweep, Arrow, Charge, Volley, Ring, BossSlash }
internal enum WarningShape { Fan, Circle, Lane, Ring }

internal sealed record EnemySpec(string Name, int Health, int Defense, int Speed, int Radius, int Gold)
{
    public static EnemySpec For(EnemyKind kind) => kind switch
    {
        EnemyKind.Thief => new("小偷", 24, 1, 750, 35, 1),
        EnemyKind.Rebel => new("反贼", 36, 9, 400, 43, 2),
        EnemyKind.Heavy => new("重盔", 88, 17, 200, 58, 3),
        EnemyKind.Archer => new("弓手", 30, 5, 300, 38, 2),
        EnemyKind.Cavalry => new("骑兵", 150, 21, 600, 66, 8),
        _ => new("镇关棋帅", 600, 25, 250, 300, 0)
    };
}

internal sealed record MoveSpec(string Name, WarningShape Shape, int Windup, int Recovery, int Cooldown,
    int Reach, int Angle, int Power, int Stun = 0)
{
    public static MoveSpec For(MoveKind kind) => kind switch
    {
        MoveKind.Stab => new("匕首前刺", WarningShape.Fan, 350, 400, 2000, 100, 52, 11),
        MoveKind.Cleave => new("大刀挥砍", WarningShape.Fan, 650, 420, 2500, 140, 96, 15),
        MoveKind.Slam => new("圆砸 · 敌我皆中", WarningShape.Circle, 2000, 0, 1000, 150, 360, 24),
        MoveKind.Sweep => new("半圆横扫", WarningShape.Fan, 2000, 0, 1000, 250, 180, 26, 500),
        MoveKind.Arrow => new("瞄准射箭", WarningShape.Lane, 2000, 350, 2000, 1900, 0, 13),
        MoveKind.Charge => new("直线冲锋", WarningShape.Lane, 1000, 1000, 8000, 2000, 0, 32, 700),
        MoveKind.Volley => new("落子 · 连珠", WarningShape.Lane, 600, 600, 5000, 2000, 0, 21),
        MoveKind.Ring => new("棋盘 · 环射", WarningShape.Ring, 1500, 600, 6000, 460, 360, 18),
        _ => new("横斩", WarningShape.Fan, 1500, 600, 4000, 250, 120, 28, 500)
    };

    public static readonly MoveSpec CavalryStab = new("长枪刺击", WarningShape.Fan, 800, 600, 0, 185, 46, 19);
    public static readonly MoveSpec CavalrySweep = new("长枪横扫", WarningShape.Fan, 1500, 600, 4000, 250, 180, 22, 500);
}

internal sealed class Attack(MoveKind kind, MoveSpec spec, Vector2 facing, int shots)
{
    public MoveKind Kind { get; } = kind;
    public MoveSpec Spec { get; } = spec;
    public Vector2 Facing { get; set; } = facing;
    public int Shots { get; } = shots;
    public int Fired { get; set; }
    public int Elapsed { get; set; }
    public bool ChargeHit { get; set; }
}

internal sealed class Enemy(EnemyKind kind, Vector2 position, bool surrounded)
{
    public EnemyKind Kind { get; } = kind;
    public EnemySpec Spec { get; } = EnemySpec.For(kind);
    public Vector2 Position { get; set; } = position;
    public int Health { get; set; } = Rules.Percent(EnemySpec.For(kind).Health, surrounded ? 120 : 100);
    public bool Surrounded { get; } = surrounded;
    public int MaxHealth => Rules.Percent(Spec.Health, Surrounded ? 120 : 100);
    public int Defense => Spec.Defense + (Surrounded ? 1 : 0);
    public bool Rage => (Kind == EnemyKind.Marshal && Health * 2 < MaxHealth) ||
        (Kind == EnemyKind.Cavalry && Health * 10 < MaxHealth * 3);
    public int Speed => Rules.Percent(Spec.Speed, (Surrounded ? 120 : 100)) *
        (Rage ? Kind == EnemyKind.Cavalry ? 150 : 120 : 100) / 100;
    public int Recovery { get; set; } = kind == EnemyKind.Marshal ? 1000 : 350;
    public int Stabs { get; set; }
    public bool Sweeping { get; set; }
    public Dictionary<MoveKind, int> ReadyAt { get; } = [];
    public Attack? Attack { get; set; }

    public bool Ready(MoveKind move, int clock) => clock >= ReadyAt.GetValueOrDefault(move);
}

internal sealed class Projectile(Vector2 position, Vector2 velocity, int damage, bool arrow)
{
    public Vector2 Position { get; set; } = position;
    public Vector2 Velocity { get; } = velocity;
    public int Damage { get; } = damage;
    public bool Arrow { get; } = arrow;
    public int Remaining { get; set; } = 5500;
}

internal sealed record StrikeVisual(Vector2 Origin, Vector2 Facing, int Reach, int Angle, int Remaining);
internal readonly record struct ArenaInput(Vector2 Move, Vector2 Aim, bool Strike, bool Skill, bool Dash);

internal sealed class Arena
{
    public const int Width = 1900;
    public const int Height = 1250;
    public const int PlayerRadius = 32;
    public const int PlayerSpeed = 500;
    private readonly Fighter _fighter;
    private readonly Random _random;
    private readonly bool _surrounded;
    private readonly bool _danger;
    private Vector2 _dashDirection;
    private int _clock;
    private int _dashMove;
    private int _actionMs;
    private int _strikeAt;
    private bool _skillAttack;
    private bool _hasHit;
    private Vector2 _attackFacing;

    public Vector2 Player { get; private set; }
    public Vector2 Facing { get; private set; } = new(0, -1);
    public List<Enemy> Enemies { get; } = [];
    public List<Projectile> Projectiles { get; } = [];
    public StrikeVisual? Strike { get; private set; }
    public int DashCooldown { get; private set; }
    public int Invincible { get; private set; }
    public int SkillCooldown { get; private set; }
    public int Stunned { get; private set; }
    public int HurtFlash { get; private set; }
    public int Gold { get; private set; }
    public bool HasBattle { get; }
    public bool DefeatedAll => HasBattle && Enemies.Count == 0;
    public bool Surrounded => _surrounded;
    public Vector2[] Pots { get; }
    public int BrokenPots { get; private set; }
    public Queue<int> NewlyBroken { get; } = [];

    public Arena(Room room, IReadOnlyList<EnemyKind> wave, Fighter fighter, bool surrounded, bool danger,
        Cell? approach, Arena? previous)
    {
        _fighter = fighter;
        _surrounded = surrounded;
        _danger = danger;
        _random = Board.RoomRandom(room.Cell, 2);
        HasBattle = wave.Count > 0;
        DashCooldown = previous?.DashCooldown ?? 0;
        SkillCooldown = previous?.SkillCooldown ?? 0;
        Player = approach is Cell entry ? Door(entry, 255) :
            room.Type == RoomType.Boss ? new(Width / 2, Height - 160) : new(Width / 2, Height / 2);
        Pots = room.Type == RoomType.Boss ? [] : [new(320, 275), new(Width - 325, Height - 275)];
        BrokenPots = room.PotsBroken;

        Vector2[] slots = Enumerable.Range(0, 24).Select(index =>
            new Vector2(220 + index % 6 * 285, 160 + index / 6 * 300)).Where(point =>
                Vector2.Distance(point, Player) > 430 && (Math.Abs(point.X - Width / 2) > 115 ||
                Math.Abs(point.Y - Height / 2) > 115)).OrderBy(_ => _random.Next()).ToArray();
        for (int index = 0; index < wave.Count; index++)
        {
            EnemyKind kind = wave[index];
            Vector2 point = kind == EnemyKind.Marshal ? new(Width / 2, 430) : slots[index];
            // Surrounded bosses grant the player the room bonus without inflating the boss's base stats.
            Enemies.Add(new Enemy(kind, point, surrounded && kind != EnemyKind.Marshal));
        }
    }

    public static Vector2 Door(Cell direction, int inset) => new(
        direction.X == 0 ? Width / 2 : direction.X > 0 ? Width - inset : inset,
        direction.Y == 0 ? Height / 2 : direction.Y > 0 ? inset : Height - inset);

    private static Vector2 Clamp(Vector2 point, int radius) => Vector2.Clamp(point,
        new Vector2(radius, radius), new Vector2(Width - radius, Height - radius));

    public void Tick(int ms, ArenaInput input)
    {
        _clock += ms;
        DashCooldown = Math.Max(0, DashCooldown - ms);
        SkillCooldown = Math.Max(0, SkillCooldown - ms);
        Stunned = Math.Max(0, Stunned - ms);
        Invincible = Math.Max(0, Invincible - ms);
        HurtFlash = Math.Max(0, HurtFlash - ms);
        if (Strike is { } flash) Strike = flash.Remaining <= ms ? null : flash with { Remaining = flash.Remaining - ms };
        MovePlayer(ms, input);
        UpdateStrike(ms, input);

        foreach (Enemy enemy in Enemies)
        {
            if (enemy.Health <= 0) continue;
            UpdateEnemy(enemy, ms);
        }
        UpdateProjectiles(ms);
        Enemies.RemoveAll(enemy => enemy.Health <= 0);
        if (DefeatedAll) Projectiles.Clear();
    }

    private void MovePlayer(int ms, ArenaInput input)
    {
        Vector2 moving = Rules.Unit(input.Move);
        Vector2 aim = Rules.Unit(input.Aim - Player);
        if (aim != Vector2.Zero) Facing = aim;
        if (input.Dash && DashCooldown == 0 && Stunned == 0)
        {
            _dashDirection = moving == Vector2.Zero ? Facing : moving;
            DashCooldown = 5000;
            Invincible = 1000;
            _dashMove = 210;
        }
        if (Stunned > 0) return;
        int dashing = Math.Min(ms, _dashMove);
        Vector2 travel = (_dashDirection * (dashing * 1375) + moving * ((ms - dashing) * PlayerSpeed)) / 1000f;
        _dashMove -= dashing;
        Vector2 next = Clamp(Player + travel, PlayerRadius);
        foreach (Enemy enemy in Enemies.Where(enemy => enemy.Kind == EnemyKind.Marshal && enemy.Health > 0))
        {
            Vector2 away = next - enemy.Position;
            int separation = enemy.Spec.Radius + PlayerRadius;
            if (away.LengthSquared() < separation * separation)
            {
                Vector2 direction = away == Vector2.Zero ? -Facing : Rules.Unit(away);
                next = Clamp(enemy.Position + direction * separation, PlayerRadius);
            }
        }
        Player = next;
    }

    private void UpdateStrike(int ms, ArenaInput input)
    {
        if (_actionMs > 0)
        {
            _actionMs = Math.Max(0, _actionMs - ms);
            if (!_hasHit && _actionMs <= _strikeAt)
            {
                _hasHit = true;
                if (Stunned == 0 && _fighter.Health > 0) ResolveStrike();
            }
        }
        if (Stunned > 0) return;
        if (input.Skill && SkillCooldown == 0 && (_actionMs == 0 || (!_skillAttack && _actionMs <= 200)))
        {
            SkillCooldown = 9000;
            StartStrike(true, 430, 250);
        }
        else if (input.Strike && _actionMs == 0)
        {
            StartStrike(false, 450, 150);
        }
    }

    private void StartStrike(bool skill, int duration, int windup)
    {
        _skillAttack = skill;
        _hasHit = false;
        _attackFacing = Facing;
        _actionMs = duration;
        _strikeAt = duration - windup;
    }

    private void ResolveStrike()
    {
        int reach = _skillAttack ? 260 : 200;
        int angle = _skillAttack ? 60 : 100;
        int power = Rules.Percent(24 + _fighter.Strength + _fighter.Boost, _surrounded ? 150 : 100);
        if (_skillAttack) power = Rules.Percent(power, 180);
        Strike = new StrikeVisual(Player, _attackFacing, reach, angle, 120);
        foreach (Enemy enemy in Enemies)
        {
            if (enemy.Health <= 0 || !InFan(Player, _attackFacing, enemy.Position, reach, angle, enemy.Spec.Radius)) continue;
            DamageEnemy(enemy, Rules.Damage(power, enemy.Defense, _skillAttack ? 0 : 4));
            _fighter.Battle = Math.Min(100, _fighter.Battle + 6);
            if (_skillAttack && enemy.Health == 0)
            {
                SkillCooldown = Math.Max(0, SkillCooldown - 1000);
                _fighter.Heal(Rules.Percent(_fighter.MaxHealth, 1));
            }
        }
        for (int index = 0; index < Pots.Length; index++)
        {
            if ((BrokenPots & (1 << index)) != 0 || !InFan(Player, _attackFacing, Pots[index], reach, angle, 24)) continue;
            BrokenPots |= 1 << index;
            NewlyBroken.Enqueue(index);
        }
    }

    private static bool InFan(Vector2 origin, Vector2 facing, Vector2 point, int reach, int angle, int targetRadius)
    {
        Vector2 delta = point - origin;
        float distance = delta.Length();
        return distance <= reach + targetRadius &&
            (angle >= 360 || distance <= targetRadius || Vector2.Dot(delta / distance, facing) >= MathF.Cos(angle * MathF.PI / 360));
    }

    private void DamageEnemy(Enemy enemy, int damage)
    {
        enemy.Health = Math.Max(0, enemy.Health - damage);
        if (enemy.Health == 0) Gold += enemy.Spec.Gold;
    }

    private void DamagePlayer(int attack, int stun)
    {
        if (Invincible > 0 || _fighter.Health == 0) return;
        _fighter.TakeDamage(Rules.Damage(attack, 5 + (_surrounded ? 5 : 0)));
        Stunned = Math.Max(Stunned, stun);
        HurtFlash = 175;
    }

    private void UpdateEnemy(Enemy enemy, int ms)
    {
        Vector2 toPlayer = Player - enemy.Position;
        float distance = toPlayer.Length();
        Vector2 facing = Rules.Unit(toPlayer);
        if (enemy.Attack is { } attack)
        {
            RunAttack(enemy, attack, facing, ms);
            return;
        }
        enemy.Recovery = Math.Max(0, enemy.Recovery - ms);
        if (enemy.Recovery > 0) return;
        MoveKind? move = ChooseMove(enemy, distance);
        if (move is MoveKind next)
        {
            MoveSpec spec = enemy.Kind == EnemyKind.Cavalry && next == MoveKind.Stab ? MoveSpec.CavalryStab :
                enemy.Kind == EnemyKind.Cavalry && next == MoveKind.Sweep ? MoveSpec.CavalrySweep : MoveSpec.For(next);
            int shots = next == MoveKind.Ring ? (enemy.Rage ? 16 : 12) + (_danger ? 2 : 0) :
                next == MoveKind.Volley ? enemy.Rage ? 4 : 3 : 1;
            enemy.Attack = new Attack(next, spec, facing == Vector2.Zero ? new(1, 0) : facing, shots);
            if (enemy.Kind == EnemyKind.Cavalry) enemy.Stabs = next == MoveKind.Stab ? enemy.Stabs + 1 : 0;
            return;
        }
        int desired = enemy.Kind switch
        {
            EnemyKind.Archer => 720, EnemyKind.Marshal => 420, EnemyKind.Heavy => 95, _ => 67
        };
        if (distance <= desired) return;
        Vector2 separation = Vector2.Zero;
        foreach (Enemy other in Enemies)
        {
            if (other == enemy || other.Health <= 0) continue;
            Vector2 offset = enemy.Position - other.Position;
            if (offset.LengthSquared() < 88 * 88) separation += Rules.Unit(offset) * 0.58f;
        }
        enemy.Position = Clamp(enemy.Position + Rules.Unit(facing + separation) * (enemy.Speed * ms / 1000f), enemy.Spec.Radius);
    }

    private MoveKind? ChooseMove(Enemy enemy, float distance)
    {
        bool Ready(MoveKind move) => enemy.Ready(move, _clock);
        switch (enemy.Kind)
        {
            case EnemyKind.Thief:
                return distance <= 132 && Invincible == 0 && Ready(MoveKind.Stab) ? MoveKind.Stab : null;
            case EnemyKind.Rebel:
                return distance <= 172 && Ready(MoveKind.Cleave) ? MoveKind.Cleave : null;
            case EnemyKind.Archer:
                return distance <= 800 && Ready(MoveKind.Arrow) ? MoveKind.Arrow : null;
            case EnemyKind.Heavy:
                MoveKind heavy = enemy.Sweeping ? MoveKind.Sweep : MoveKind.Slam;
                return distance <= MoveSpec.For(heavy).Reach && Ready(heavy) ? heavy : null;
            case EnemyKind.Cavalry:
                bool stab = distance <= 217 && enemy.Stabs < 4 && Ready(MoveKind.Stab);
                bool sweep = distance <= 282 && Ready(MoveKind.Sweep);
                bool charge = distance >= 400 && Ready(MoveKind.Charge);
                int weight = (stab ? 70 : 0) + (sweep ? 20 : 0) + (charge ? 10 : 0);
                if (weight == 0) return null;
                int pick = _random.Next(weight);
                if (stab && pick < 70) return MoveKind.Stab;
                if (stab) pick -= 70;
                return sweep && pick < 20 ? MoveKind.Sweep : MoveKind.Charge;
            default:
                if (distance <= enemy.Spec.Radius + 250 && Ready(MoveKind.BossSlash)) return MoveKind.BossSlash;
                if (Ready(MoveKind.Ring)) return MoveKind.Ring;
                return Ready(MoveKind.Volley) ? MoveKind.Volley : null;
        }
    }

    private int AttackPower(Enemy enemy, Attack attack)
    {
        int power = attack.Spec.Power;
        if (attack.Kind == MoveKind.Charge)
        {
            int speedPercent = Rules.Ceil(Rules.Percent(enemy.Speed, 150) * 100, enemy.Spec.Speed);
            power += Rules.Ceil(Math.Max(0, speedPercent - 100), 20);
        }
        if (enemy.Surrounded) power = Rules.Percent(power, 120);
        if (_danger && enemy.Kind == EnemyKind.Marshal) power = Rules.Percent(power, 120);
        return power;
    }

    private void RunAttack(Enemy enemy, Attack attack, Vector2 facing, int ms)
    {
        int before = attack.Elapsed;
        attack.Elapsed += ms;
        int windup = attack.Spec.Windup;
        bool follows = attack.Kind is MoveKind.Arrow or MoveKind.Charge or MoveKind.Volley;
        if (follows && before < windup && facing != Vector2.Zero) attack.Facing = facing;
        if (attack.Elapsed < windup) return;
        int power = AttackPower(enemy, attack);
        if (attack.Kind == MoveKind.Charge)
        {
            int motion = Math.Min(720, attack.Elapsed - windup) - Math.Min(720, Math.Max(0, before - windup));
            Vector2 origin = enemy.Position;
            enemy.Position = Clamp(origin + attack.Facing * (Rules.Percent(enemy.Speed, 150) * motion / 1000f), enemy.Spec.Radius);
            if (!attack.ChargeHit && Rules.SegmentDistance(Player, origin, enemy.Position) <= 100 + PlayerRadius && Invincible == 0)
            {
                DamagePlayer(power, attack.Spec.Stun);
                attack.ChargeHit = true;
            }
            if (attack.Elapsed < windup + 720) return;
        }
        else if (attack.Kind == MoveKind.Volley)
        {
            while (attack.Fired < attack.Shots && attack.Elapsed >= windup + attack.Fired * 400)
            {
                Shoot(enemy, attack.Facing, 600, power, false);
                attack.Fired++;
            }
            if (attack.Fired < attack.Shots) return;
        }
        else
        {
            ResolveAttack(enemy, attack, power);
        }
        enemy.ReadyAt[attack.Kind] = _clock + attack.Spec.Cooldown;
        enemy.Recovery = attack.Spec.Recovery;
        enemy.Attack = null;
    }

    private void ResolveAttack(Enemy enemy, Attack attack, int power)
    {
        switch (attack.Kind)
        {
            case MoveKind.Arrow:
                Shoot(enemy, attack.Facing, 500, power, true);
                return;
            case MoveKind.Ring:
                for (int index = 0; index < attack.Shots; index++)
                    Shoot(enemy, Rules.Rotate(attack.Facing, index * MathF.Tau / attack.Shots), 300, power, false);
                return;
            case MoveKind.Slam:
                foreach (Enemy other in Enemies)
                {
                    if (other != enemy && other.Health > 0 && Vector2.Distance(other.Position, enemy.Position) <= attack.Spec.Reach + other.Spec.Radius)
                        DamageEnemy(other, Rules.Damage(power, other.Defense));
                }
                enemy.Sweeping = true;
                break;
            case MoveKind.Sweep when enemy.Kind == EnemyKind.Heavy:
                enemy.Sweeping = false;
                break;
        }

        int reach = attack.Spec.Reach + (enemy.Kind == EnemyKind.Marshal ? enemy.Spec.Radius : 0);
        if (InFan(enemy.Position, attack.Facing, Player, reach, attack.Spec.Angle, PlayerRadius))
            DamagePlayer(power, attack.Spec.Stun);
        if (enemy.Kind == EnemyKind.Heavy)
        {
            MoveKind next = enemy.Sweeping ? MoveKind.Sweep : MoveKind.Slam;
            enemy.ReadyAt[next] = _clock + 1000;
        }
    }

    private void Shoot(Enemy enemy, Vector2 direction, int speed, int damage, bool arrow)
    {
        Vector2 origin = enemy.Position + direction * (enemy.Spec.Radius + 8);
        Projectiles.Add(new Projectile(origin, direction * speed, damage, arrow));
    }

    private void UpdateProjectiles(int ms)
    {
        for (int index = Projectiles.Count - 1; index >= 0; index--)
        {
            Projectile projectile = Projectiles[index];
            Vector2 next = projectile.Position + projectile.Velocity * (ms / 1000f);
            projectile.Remaining -= ms;
            bool hit = Invincible == 0 && Rules.SegmentDistance(Player, projectile.Position, next) <= PlayerRadius + 11;
            if (hit) DamagePlayer(projectile.Damage, 0);
            if (hit || projectile.Remaining <= 0 || next.X < 0 || next.X > Width || next.Y < 0 || next.Y > Height)
                Projectiles.RemoveAt(index);
            else
                projectile.Position = next;
        }
    }
}
