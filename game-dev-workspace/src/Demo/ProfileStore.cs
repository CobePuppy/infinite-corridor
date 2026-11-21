using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Demo;

internal sealed record Profile(int SchemaVersion, int OreBalance, HashSet<Guid> AppliedRuns);

internal sealed class ProfileStore(string directory)
{
    private string PathToSave => Path.Combine(directory, "profile.json");
    private string PathToBackup => Path.Combine(directory, "profile.previous.json");

    private static Profile Read(string file)
    {
        Profile? profile = JsonSerializer.Deserialize<Profile>(File.ReadAllText(file));
        if (profile is null || profile.SchemaVersion != 1 || profile.OreBalance < 0 || profile.AppliedRuns is null)
            throw new InvalidDataException("矿石档案结构无效。");
        return profile;
    }

    private Profile Load()
    {
        if (File.Exists(PathToSave))
        {
            // A corrupt primary must never silently reset the list of paid run IDs.
            return Read(PathToSave);
        }
        if (File.Exists(PathToBackup)) return Read(PathToBackup);
        return new Profile(1, 0, []);
    }

    public bool TryBalance(out int balance) => TryAccess(profile => profile, out balance);

    public bool TryDeposit(Guid runId, int ore, out int balance)
    {
        return TryAccess(profile =>
        {
            if (!profile.AppliedRuns.Add(runId)) return profile;
            profile = profile with { OreBalance = checked(profile.OreBalance + ore) };
            Directory.CreateDirectory(directory);
            string temporary = Path.Combine(directory, "profile.pending.json");
            using (FileStream stream = new(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                JsonSerializer.Serialize(stream, profile);
                stream.Flush(flushToDisk: true);
            }
            Profile candidate = Read(temporary);
            if (candidate.OreBalance != profile.OreBalance || !candidate.AppliedRuns.SetEquals(profile.AppliedRuns))
                throw new InvalidDataException("矿石档案写入核对失败。");
            if (File.Exists(PathToSave)) File.Replace(temporary, PathToSave, PathToBackup);
            else File.Move(temporary, PathToSave);
            return profile;
        }, out balance);
    }

    private bool TryAccess(Func<Profile, Profile> access, out int balance)
    {
        balance = 0;
        string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar).ToUpperInvariant())));
        using Mutex mutex = new(false, "DemoOre_" + hash);
        bool acquired;
        try { acquired = mutex.WaitOne(1000); }
        catch (AbandonedMutexException) { acquired = true; }
        if (!acquired) return false;
        try
        {
            balance = access(Load()).OreBalance;
            return true;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException or OverflowException)
        {
            return false;
        }
        finally
        {
            mutex.ReleaseMutex();
        }
    }
}
