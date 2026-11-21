using System.Diagnostics;
using System.Numerics;

namespace Demo;

internal enum Screen { Menu, Character, Play, Tech }
internal enum Panel { None, Map, Build, Merchant, Skill, Pause }

internal sealed partial class GameWindow : Form
{
    private const int CanvasWidth = 1280;
    private const int CanvasHeight = 800;
    private const int FixedStep = 10;
    private static readonly RectangleF Field = new(28, 103, 890, 585);
    private readonly ProfileStore _profile;
    private readonly Palette _palette;
    private readonly bool _smoke;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 15 };
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly HashSet<Keys> _held = [];
    private readonly List<HitBox> _buttons = [];
    private long _lastMs;
    private int _carry;
    private Screen _screen;
    private Panel _panel;
    private Run? _run;
    private Cell? _target;
    private PointF _pointer = new(650, 340);
    private bool _strike;
    private bool _skill;
    private bool _dash;
    private int _frames;
    private readonly List<double> _paintTimes = [];
    private int _smokeStep;
    private bool _smokeReachedBattle;
    private Vector2 _smokeOrigin;
    private int _techBalance;
    private bool _techRead;

    private sealed record HitBox(RectangleF Box, Action Action);
    private Run Run => _run ?? throw new InvalidOperationException("未开始新局。");
    public bool SmokePassed { get; private set; }
    public string SmokeReport { get; private set; } = "FAIL smoke: 窗体提前关闭。";

    public GameWindow(ProfileStore profile, string directory, bool smoke)
    {
        _profile = profile;
        _palette = Palette.Load(directory);
        _smoke = smoke;
        Text = "关城灰盒 · M1";
        ClientSize = new Size(1280, 800);
        MinimumSize = new Size(805, 525);
        StartPosition = FormStartPosition.CenterScreen;
        KeyPreview = true;
        DoubleBuffered = true;
        BackColor = _palette.Background;
        SetStyle(ControlStyles.ResizeRedraw, true);
        _timer.Tick += (_, _) => Frame();
        Shown += (_, _) =>
        {
            _lastMs = _clock.ElapsedMilliseconds;
            _timer.Start();
        };
        FormClosed += (_, _) =>
        {
            _timer.Dispose();
            foreach (Font font in _fonts.Values) font.Dispose();
        };
        Deactivate += (_, _) =>
        {
            ClearInput();
            if (!_smoke && _screen == Screen.Play && (_run?.Phase is Phase.Explore or Phase.Boss))
                _panel = Panel.Pause;
        };
    }

    private (float Scale, float X, float Y) View()
    {
        float scale = Math.Min(ClientSize.Width / (float)CanvasWidth, ClientSize.Height / (float)CanvasHeight);
        return (scale, (ClientSize.Width - CanvasWidth * scale) / 2,
            (ClientSize.Height - CanvasHeight * scale) / 2);
    }

    private PointF ToCanvas(Point location)
    {
        (float scale, float x, float y) = View();
        return new((location.X - x) / scale, (location.Y - y) / scale);
    }

    private void ClearInput()
    {
        _held.Clear();
        _strike = _skill = _dash = _clicked = false;
    }

    private void NewRun()
    {
        _run = new Run(_profile);
        _screen = Screen.Play;
        _panel = Panel.None;
        _target = null;
        ClearInput();
    }

    private void ShowMenu()
    {
        _screen = Screen.Menu;
        _panel = Panel.None;
        _run = null;
        ClearInput();
    }

    private void ShowTechnology()
    {
        _techRead = _profile.TryBalance(out _techBalance);
        _screen = Screen.Tech;
    }

    private void Frame()
    {
        long now = _clock.ElapsedMilliseconds;
        int elapsed = (int)Math.Min(120, now - _lastMs);
        _lastMs = now;
        if (_screen == Screen.Play && (Run.Phase is Phase.Explore or Phase.Boss) && _panel != Panel.Pause)
        {
            _carry += elapsed;
            if (_smoke && _smokeStep == 6 && _frames >= 40) _carry += 100;
            while (_carry >= FixedStep)
            {
                _carry -= FixedStep;
                Vector2 movement = new(Axis(Keys.D, Keys.A), Axis(Keys.S, Keys.W));
                Vector2 aim = new((_pointer.X - Field.Left) * Arena.Width / Field.Width,
                    (_pointer.Y - Field.Top) * Arena.Height / Field.Height);
                ArenaInput input = _panel == Panel.None ?
                    new ArenaInput(movement, aim, _strike || _clicked, _skill, _dash) : new ArenaInput(Vector2.Zero, aim, false, false, false);
                Phase phase = Run.Phase;
                Run.Tick(FixedStep, input);
                _clicked = _skill = _dash = false;
                if (phase != Run.Phase)
                {
                    _panel = Panel.None;
                    _target = null;
                    ClearInput();
                }
            }
        }
        else _carry = 0;
        Invalidate();
        if (_smoke) DriveSmoke();
    }

    private int Axis(Keys positive, Keys negative) =>
        (_held.Contains(positive) ? 1 : 0) - (_held.Contains(negative) ? 1 : 0);

    private bool Activate(float x, float y)
    {
        HitBox? hit = _buttons.LastOrDefault(item => item.Box.Contains(x, y));
        if (hit is null) return false;
        _buttons.Clear();
        hit.Action();
        Invalidate();
        return true;
    }

    private void DriveSmoke()
    {
        // Route through the actual painted buttons and keyboard input. No normal save directory is touched.
        if (_frames < 2) return;
        if (_smokeStep == 0 && Activate(170, 460)) _smokeStep++;
        else if (_smokeStep == 1 && _screen == Screen.Character && Activate(170, 492)) _smokeStep++;
        else if (_smokeStep == 2 && _screen == Screen.Play && Run.Phase == Phase.Preview && Activate(993, 617))
        {
            _smokeOrigin = Run.Arena!.Player;
            _held.Add(Keys.D);
            _smokeStep++;
        }
        else if (_smokeStep == 3 && Run.Arena!.Player.X > _smokeOrigin.X + 35)
        {
            ClearInput();
            ToggleMap();
            _smokeStep++;
        }
        else if (_smokeStep == 4 && _panel == Panel.Map && Activate(267, 457))
        {
            _smokeStep++;
        }
        else if (_smokeStep == 5 && _target == new Cell(1, 0) && Activate(997, 402))
        {
            _smokeStep++;
        }
        else if (_smokeStep == 6 && Run.Phase == Phase.Explore)
        {
            _smokeReachedBattle |= Run.Current == new Cell(1, 0) && Run.Arena!.Enemies.Count > 0;
        }
        else if (_smokeStep == 6 && Run.Result is { Won: false } && Run.Saved && Activate(980, 470))
        {
            _smokeStep++;
        }
        else if (_smokeStep == 7 && _smokeReachedBattle && Run.Phase == Phase.Preview && Run.Remaining == 600_000)
        {
            SmokePassed = true;
            double[] intervals = _paintTimes.Zip(_paintTimes.Skip(1), (a, b) => b - a).Order().ToArray();
            int p95 = (int)Math.Ceiling(intervals[Rules.Percent(intervals.Length, 95) - 1]);
            SmokeReport = $"PASS smoke: 菜单、选角、预览、移动、地图选房、进战斗房、死亡结算、重开，绘制 {_frames} 帧。"
                + $" 客户区 {ClientSize.Width}x{ClientSize.Height}、{DeviceDpi} DPI，短程绘制间隔 P95={p95} ms（{intervals.Length} 个样本）。";
            Close();
        }
        if (!SmokePassed && _clock.ElapsedMilliseconds > 15_000)
        {
            SmokeReport = $"FAIL smoke: stage={_smokeStep}, frames={_frames}, screen={_screen}, panel={_panel}, selected={_target}.";
            Close();
        }
    }

    protected override bool ProcessCmdKey(ref Message message, Keys keyData)
    {
        if (keyData == Keys.Tab && _screen == Screen.Play && (Run.Phase is Phase.Explore or Phase.Boss))
        {
            // Tab is normally intercepted by WinForms focus navigation.
            if ((message.LParam.ToInt64() & (1L << 30)) == 0) ToggleMap();
            return true;
        }
        return base.ProcessCmdKey(ref message, keyData);
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (!_held.Add(e.KeyCode)) return;
        if (_screen != Screen.Play)
        {
            if (e.KeyCode == Keys.Escape) ShowMenu();
            return;
        }
        if (Run.Phase == Phase.Preview)
        {
            if (e.KeyCode == Keys.Enter) Run.Start();
            if (e.KeyCode == Keys.Escape) ShowMenu();
            return;
        }
        if (Run.Phase == Phase.Result)
        {
            if (e.KeyCode == Keys.Enter) { if (Run.Saved) NewRun(); else Run.RetrySave(); }
            if (e.KeyCode == Keys.Escape && Run.Saved) ShowMenu();
            return;
        }
        if (e.KeyCode == Keys.Escape)
        {
            _panel = _panel == Panel.None ? Panel.Pause : Panel.None;
            _strike = false;
            return;
        }
        if (_panel == Panel.Map && e.KeyCode == Keys.T && _target is Cell selected)
        {
            Teleport(selected);
            return;
        }
        if (_panel != Panel.None) return;
        switch (e.KeyCode)
        {
            case Keys.Space: _dash = true; break;
            case Keys.Q: Run.Ultimate(); break;
            case Keys.E: Interact(); break;
            case Keys.B: OpenBuild(); break;
            case Keys.F:
                if (!Run.OrderMaterial()) Run.Hint("制材需建材厂空闲、8 金币，并在已点亮房间操作。");
                break;
            case Keys.V when Run.SkillChoices > 0: _panel = Panel.Skill; break;
        }
        e.Handled = true;
    }

    protected override void OnKeyUp(KeyEventArgs e)
    {
        _held.Remove(e.KeyCode);
        base.OnKeyUp(e);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        _pointer = ToCanvas(e.Location);
        base.OnMouseMove(e);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        _pointer = ToCanvas(e.Location);
        if (e.Button == MouseButtons.Left && Activate(_pointer.X, _pointer.Y)) return;
        if (_screen == Screen.Play && (Run.Phase is Phase.Explore or Phase.Boss) &&
            _panel == Panel.None && Field.Contains(_pointer))
        {
            if (e.Button == MouseButtons.Left)
            {
                _strike = true;
                // Keep a quick click until at least one simulation step has consumed it.
                _clicked = true;
            }
            if (e.Button == MouseButtons.Right) _skill = true;
        }
        base.OnMouseDown(e);
    }

    private bool _clicked;

    protected override void OnMouseUp(MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left) _strike = false;
        base.OnMouseUp(e);
    }

    private void ToggleMap()
    {
        if (_panel == Panel.Map) _panel = Panel.None;
        else if (_panel == Panel.None) _panel = Panel.Map;
        _strike = false;
    }

    private void Interact()
    {
        if (!Run.CanTravel || Run.Arena is null) return;
        foreach (Cell neighbor in Run.Board.Neighbors(Run.Current))
        {
            Vector2 door = Arena.Door(neighbor - Run.Current, 0);
            if (Vector2.Distance(Run.Arena.Player, door) > 215) continue;
            if (Run.AutoPrice(neighbor) > 0)
            {
                _target = neighbor;
                _panel = Panel.Map;
            }
            else Run.Walk(neighbor);
            return;
        }
        if (Run.Room.Type == RoomType.Merchant) _panel = Panel.Merchant;
        else if (Run.Room.Type is RoomType.Resource or RoomType.Village) _panel = Panel.Build;
        else Run.Hint("走近任一亮门，或按 Tab 在棋盘上选房。");
    }

    private void OpenBuild()
    {
        if (Run.CanTravel && (Run.Room.Type is RoomType.Resource or RoomType.Village)) _panel = Panel.Build;
        else Run.Hint("需要先到达已点亮的资源房或村庄。");
    }

    private void Walk(Cell target)
    {
        if (Run.Walk(target)) _panel = Panel.None;
        else Run.Hint("先沿已点亮房间前往相邻门口。");
    }

    private void Teleport(Cell target)
    {
        if (Run.Teleport(target)) _panel = Panel.None;
        else Run.Hint("目标未连通，或剩余时间不足。");
    }
}
