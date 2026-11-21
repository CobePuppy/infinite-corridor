using System.Runtime.InteropServices;

namespace Demo;

internal static class Program
{
    [DllImport("kernel32.dll")]
    private static extern bool AttachConsole(int processId);

    [STAThread]
    private static int Main(string[] args)
    {
        bool selfTest = args.Contains("--self-test", StringComparer.Ordinal);
        bool smoke = args.Contains("--smoke-test", StringComparer.Ordinal);
        if (selfTest || smoke) AttachConsole(-1);
        try
        {
            string directory = LocateDemo();
            string local = Path.Combine(directory, ".local");
            if (selfTest) return Checks.Execute(TestDirectory(local, "rules"));
            ApplicationConfiguration.Initialize();
            if (smoke)
            {
                using GameWindow window = new(new ProfileStore(TestDirectory(local, "smoke")), directory, true);
                Application.Run(window);
                Console.WriteLine(window.SmokeReport);
                return window.SmokePassed ? 0 : 1;
            }
            Application.Run(new GameWindow(new ProfileStore(Path.Combine(local, "player")), directory, false));
            return 0;
        }
        catch (Exception error) when (selfTest || smoke)
        {
            Console.Error.WriteLine(error);
            return 1;
        }
    }

    private static string TestDirectory(string local, string label) =>
        Path.Combine(local, "checks", label + "-" + Guid.NewGuid().ToString("N"));

    private static string LocateDemo()
    {
        for (DirectoryInfo? folder = new(AppContext.BaseDirectory); folder is not null; folder = folder.Parent)
        {
            if (File.Exists(Path.Combine(folder.FullName, "Demo.csproj"))) return folder.FullName;
        }
        // An exported executable stays portable when copied away from the source checkout.
        return AppContext.BaseDirectory;
    }
}
