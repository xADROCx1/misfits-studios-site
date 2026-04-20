// NeighborhoodWatch - Discord Alert & Logging Plugin for Rust
// By: XADROCX / Misfit Plugins
// Version: 1.2.0
// Description: All-in-one server monitor — PvP kills, unauthorized looting/access,
//              and comprehensive raid tracking. Color-coded Discord embeds + server-side backup logs.
//
// Features:
//   - PvP kill tracking with weapon, distance, bodypart
//   - Unauthorized container looting (not authed on TC)
//   - Unauthorized door opening (not authed on TC)
//   - Unauthorized deployable access: furnaces, refineries, workbenches, etc.
//   - Raid tracking: C4, rockets, satchels, explosive ammo, fire, MLRS
//   - Ignores same-owner, team members, and optionally clan allies
//   - Tracks building grade of destroyed structures
//   - Map grid coordinates for all alerts
//   - Color-coded Discord embeds per alert type
//   - Server-side JSON data file backup with auto-rotation

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Oxide.Core;
using Oxide.Core.Libraries;
using Oxide.Core.Libraries.Covalence;
using Oxide.Core.Plugins;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("NeighborhoodWatch", "XADROCX", "1.2.0")]
    [Description("All-in-one server monitor: PvP kills, unauthorized looting/access, and comprehensive raid tracking to Discord.")]
    public class NeighborhoodWatch : RustPlugin
    {
        #region Plugin References

        [PluginReference]
        private readonly Plugin Clans;

        #endregion

        #region Constants

        private const int COLOR_PVP_KILL       = 0xFF0000; // Red
        private const int COLOR_UNAUTH_LOOT    = 0xFF9900; // Orange
        private const int COLOR_UNAUTH_DOOR    = 0xFFFF00; // Yellow
        private const int COLOR_RAID_EXPLOSIVE = 0x9900FF; // Purple
        private const int COLOR_RAID_FIRE      = 0xFF4500; // OrangeRed
        private const int COLOR_RAID_DESTROY   = 0xCC0000; // Dark Red
        private const int COLOR_INFO           = 0x00AAFF; // Blue
        private const int COLOR_UNAUTH_DEPLOY  = 0xFF6600; // Dark Orange

        // Prefabs to ignore for timed explosives
        private static readonly HashSet<string> IgnoredExplosives = new HashSet<string>
        {
            "firecrackers.deployed",
            "flare.deployed",
            "maincannonshell",
            "rocket_heli",
            "rocket_heli_napalm"
        };

        #endregion

        #region Configuration

        private Configuration _config;

        private class Configuration
        {
            [JsonProperty("Discord Webhook URL (PvP Kills)")]
            public string WebhookPvP { get; set; } = "";

            [JsonProperty("Discord Webhook URL (Unauthorized Access)")]
            public string WebhookUnauth { get; set; } = "";

            [JsonProperty("Discord Webhook URL (Raid Alerts)")]
            public string WebhookRaid { get; set; } = "";

            [JsonProperty("Use Single Webhook For All (overrides above if set)")]
            public string WebhookMaster { get; set; } = "";

            [JsonProperty("Bot Display Name")]
            public string BotName { get; set; } = "NeighborhoodWatch";

            [JsonProperty("Bot Avatar URL")]
            public string BotAvatar { get; set; } = "";

            [JsonProperty("Server Name (shown in footer)")]
            public string ServerName { get; set; } = "My Rust Server";

            // ─── Feature Toggles ───
            [JsonProperty("Enable PvP Kill Alerts")]
            public bool EnablePvPKills { get; set; } = true;

            [JsonProperty("Enable Unauthorized Loot Alerts")]
            public bool EnableUnauthLoot { get; set; } = true;

            [JsonProperty("Enable Unauthorized Door Alerts")]
            public bool EnableUnauthDoor { get; set; } = true;

            [JsonProperty("Enable Unauthorized Deployable Alerts (Furnace/Refinery/etc)")]
            public bool EnableUnauthDeployable { get; set; } = true;

            [JsonProperty("Enable Raid Alerts (Explosives/Fire on Structures)")]
            public bool EnableRaidAlerts { get; set; } = true;

            [JsonProperty("Enable Entity Destruction Alerts (structure destroyed)")]
            public bool EnableDestroyAlerts { get; set; } = true;

            // ─── Raid Filtering ───
            [JsonProperty("Raid - Ignore Same Owner")]
            public bool RaidIgnoreSameOwner { get; set; } = true;

            [JsonProperty("Raid - Ignore Team Members")]
            public bool RaidIgnoreTeamMembers { get; set; } = true;

            [JsonProperty("Raid - Ignore Clan Members/Allies (requires Clans plugin)")]
            public bool RaidIgnoreClanAllies { get; set; } = true;

            [JsonProperty("Raid - Track Fire/Incendiary Damage")]
            public bool RaidTrackFire { get; set; } = true;

            [JsonProperty("Raid - Track MLRS Rockets")]
            public bool RaidTrackMLRS { get; set; } = true;

            [JsonProperty("Raid - Minimum Damage To Alert")]
            public float RaidMinDamage { get; set; } = 1f;

            [JsonProperty("Raid - Ignore Twig Grade")]
            public bool RaidIgnoreTwig { get; set; } = true;

            // ─── General Settings ───
            [JsonProperty("Enable Server-Side Log File")]
            public bool EnableLogFile { get; set; } = true;

            [JsonProperty("Enable Debug Logging (verbose server console output)")]
            public bool EnableDebugLogging { get; set; } = false;

            [JsonProperty("Cooldown Between Duplicate Alerts (seconds)")]
            public float AlertCooldown { get; set; } = 10f;

            [JsonProperty("Raid Alert Cooldown Per Building (seconds)")]
            public float RaidCooldown { get; set; } = 30f;

            [JsonProperty("Log Max Entries Before Rotation")]
            public int LogMaxEntries { get; set; } = 10000;

            [JsonProperty("Custom Embed Colors (Decimal)")]
            public EmbedColors Colors { get; set; } = new EmbedColors();
        }

        private class EmbedColors
        {
            [JsonProperty("PvP Kill (Red)")]
            public int PvPKill { get; set; } = COLOR_PVP_KILL;

            [JsonProperty("Unauthorized Loot (Orange)")]
            public int UnauthLoot { get; set; } = COLOR_UNAUTH_LOOT;

            [JsonProperty("Unauthorized Door (Yellow)")]
            public int UnauthDoor { get; set; } = COLOR_UNAUTH_DOOR;

            [JsonProperty("Unauthorized Deployable (Dark Orange)")]
            public int UnauthDeployable { get; set; } = COLOR_UNAUTH_DEPLOY;

            [JsonProperty("Raid - Explosive (Purple)")]
            public int RaidExplosive { get; set; } = COLOR_RAID_EXPLOSIVE;

            [JsonProperty("Raid - Fire (OrangeRed)")]
            public int RaidFire { get; set; } = COLOR_RAID_FIRE;

            [JsonProperty("Raid - Structure Destroyed (Dark Red)")]
            public int RaidDestroy { get; set; } = COLOR_RAID_DESTROY;

            [JsonProperty("Info (Blue)")]
            public int Info { get; set; } = COLOR_INFO;
        }

        protected override void LoadDefaultConfig()
        {
            _config = new Configuration();
            SaveConfig();
            PrintWarning("Default configuration created. Set your Discord webhook URL(s) in the config!");
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try
            {
                _config = Config.ReadObject<Configuration>();
                if (_config == null)
                    throw new Exception();
            }
            catch
            {
                PrintError("Configuration file is corrupt or missing. Creating new default config.");
                LoadDefaultConfig();
            }
        }

        protected override void SaveConfig() => Config.WriteObject(_config, true);

        #endregion

        #region Data Storage

        private StoredData _storedData;

        private class StoredData
        {
            public List<LogEntry> Logs = new List<LogEntry>();
            public int TotalLogged = 0;
        }

        private class LogEntry
        {
            public string Timestamp;
            public string Type;
            public string AttackerName;
            public string AttackerSteamId;
            public string VictimName;
            public string VictimSteamId;
            public string GridLocation;
            public string Details;
            public string Weapon;
            public float Distance;
            public string BuildingGrade;
        }

        private void LoadData()
        {
            try
            {
                _storedData = Interface.Oxide.DataFileSystem.ReadObject<StoredData>("NeighborhoodWatch_Logs");
            }
            catch
            {
                PrintWarning("Data file is corrupt. Starting with fresh log data.");
            }
            if (_storedData == null)
                _storedData = new StoredData();
        }

        private void SaveData()
        {
            Interface.Oxide.DataFileSystem.WriteObject("NeighborhoodWatch_Logs", _storedData);
        }

        #endregion

        #region Runtime State

        private Dictionary<string, float> _alertCooldowns = new Dictionary<string, float>();
        private Dictionary<uint, float> _raidCooldowns = new Dictionary<uint, float>();
        private Dictionary<Vector3, ulong> _mlrsRocketOwners = new Dictionary<Vector3, ulong>();

        #endregion

        #region Cooldown Helpers

        private bool IsOnCooldown(string key, float cooldownSeconds)
        {
            float lastTime;
            if (_alertCooldowns.TryGetValue(key, out lastTime))
            {
                if (UnityEngine.Time.realtimeSinceStartup - lastTime < cooldownSeconds)
                    return true;
            }
            _alertCooldowns[key] = UnityEngine.Time.realtimeSinceStartup;
            return false;
        }

        private bool IsRaidOnCooldown(uint buildingId)
        {
            float lastTime;
            if (_raidCooldowns.TryGetValue(buildingId, out lastTime))
            {
                if (UnityEngine.Time.realtimeSinceStartup - lastTime < _config.RaidCooldown)
                    return true;
            }
            _raidCooldowns[buildingId] = UnityEngine.Time.realtimeSinceStartup;
            return false;
        }

        #endregion

        #region Oxide Hooks — Lifecycle

        private void Init()
        {
            LoadData();
            PrintStartupBanner();
        }

        private void PrintStartupBanner()
        {
            string master = string.IsNullOrEmpty(_config.WebhookMaster) ? "<not set>" : Redact(_config.WebhookMaster);
            string pvp    = string.IsNullOrEmpty(_config.WebhookPvP)    ? "<not set>" : Redact(_config.WebhookPvP);
            string unauth = string.IsNullOrEmpty(_config.WebhookUnauth) ? "<not set>" : Redact(_config.WebhookUnauth);
            string raid   = string.IsNullOrEmpty(_config.WebhookRaid)   ? "<not set>" : Redact(_config.WebhookRaid);

            Puts("============================================================");
            Puts("  NeighborhoodWatch v1.2.0 — Feature Toggle Status");
            Puts("============================================================");
            Puts($"  PvP Kill Alerts             : {OnOff(_config.EnablePvPKills)}   → {RouteFor("pvp")}");
            Puts($"  Unauthorized Loot Alerts    : {OnOff(_config.EnableUnauthLoot)}   → {RouteFor("unauth")}");
            Puts($"  Unauthorized Door Alerts    : {OnOff(_config.EnableUnauthDoor)}   → {RouteFor("unauth")}");
            Puts($"  Unauthorized Deployable     : {OnOff(_config.EnableUnauthDeployable)}   → {RouteFor("unauth")}");
            Puts($"  Raid Alerts (Explosive/Fire): {OnOff(_config.EnableRaidAlerts)}   → {RouteFor("raid")}");
            Puts($"  Structure Destroyed Alerts  : {OnOff(_config.EnableDestroyAlerts)}   → {RouteFor("raid")}");
            Puts("------------------------------------------------------------");
            Puts($"  Webhook (Master)  : {master}");
            Puts($"  Webhook (PvP)     : {pvp}");
            Puts($"  Webhook (Unauth)  : {unauth}");
            Puts($"  Webhook (Raid)    : {raid}");
            Puts($"  Debug Logging     : {OnOff(_config.EnableDebugLogging)}");
            Puts("------------------------------------------------------------");

            WarnIfEnabledButNoRoute("PvP Kills",              _config.EnablePvPKills,         "pvp");
            WarnIfEnabledButNoRoute("Unauth Loot",            _config.EnableUnauthLoot,       "unauth");
            WarnIfEnabledButNoRoute("Unauth Door",            _config.EnableUnauthDoor,       "unauth");
            WarnIfEnabledButNoRoute("Unauth Deployable",      _config.EnableUnauthDeployable, "unauth");
            WarnIfEnabledButNoRoute("Raid Alerts",            _config.EnableRaidAlerts,       "raid");
            WarnIfEnabledButNoRoute("Structure Destroyed",    _config.EnableDestroyAlerts,    "raid");

            Puts("============================================================");
        }

        private string OnOff(bool v) => v ? "ON " : "OFF";

        private string RouteFor(string type)
        {
            string url = GetWebhook(type);
            if (string.IsNullOrEmpty(url)) return "<no webhook — alerts will NOT be sent>";
            if (!string.IsNullOrEmpty(_config.WebhookMaster)) return "Master webhook";
            return type + " webhook";
        }

        private void WarnIfEnabledButNoRoute(string label, bool enabled, string type)
        {
            if (!enabled) return;
            if (!string.IsNullOrEmpty(GetWebhook(type))) return;
            PrintWarning($"[NeighborhoodWatch] '{label}' is ENABLED but no webhook is configured for it — alerts will be dropped. Set 'Use Single Webhook For All' or the per-category URL.");
        }

        private string Redact(string url)
        {
            if (string.IsNullOrEmpty(url) || url.Length < 24) return "<set>";
            return url.Substring(0, 40) + "...[redacted]";
        }

        private void DebugLog(string msg)
        {
            if (_config == null || !_config.EnableDebugLogging) return;
            Puts("[DEBUG] " + msg);
        }

        private void OnServerSave()
        {
            SaveData();
        }

        private void Unload()
        {
            SaveData();
            _alertCooldowns.Clear();
            _raidCooldowns.Clear();
            _mlrsRocketOwners.Clear();
        }

        private void OnNewSave(string filename)
        {
            _storedData = new StoredData();
            SaveData();
            Puts("[NeighborhoodWatch] Map wipe detected — log data reset.");
        }

        #endregion

        #region Oxide Hooks — PVP KILLS

        private void OnEntityDeath(BaseCombatEntity entity, HitInfo info)
        {
            if (entity == null || info == null) return;

            var victim = entity as BasePlayer;
            if (victim != null)
            {
                DebugLog($"OnEntityDeath: player victim={victim.displayName} enablePvP={_config.EnablePvPKills}");
                if (_config.EnablePvPKills)
                    HandlePvPKill(victim, info);
                return;
            }

            var decayEntity = entity as DecayEntity;
            if (decayEntity != null)
            {
                DebugLog($"OnEntityDeath: decay entity={decayEntity.ShortPrefabName} enableDestroy={_config.EnableDestroyAlerts}");
                if (_config.EnableDestroyAlerts)
                    HandleEntityDestroyed(decayEntity, info);
            }
        }

        private void HandlePvPKill(BasePlayer victim, HitInfo info)
        {
            if (victim.IsNpc || !victim.userID.IsSteamId()) return;

            var attacker = info.InitiatorPlayer;
            if (attacker == null || attacker.IsNpc || !attacker.userID.IsSteamId()) return;
            if (attacker.userID == victim.userID) return;

            string grid = GetGridPosition(victim.transform.position);
            string weapon = GetWeaponName(info);
            float distance = Vector3.Distance(attacker.transform.position, victim.transform.position);
            string distStr = distance.ToString("F1") + "m";

            string cooldownKey = $"pvp_{attacker.userID}_{victim.userID}";
            if (IsOnCooldown(cooldownKey, _config.AlertCooldown)) return;

            var logEntry = new LogEntry
            {
                Timestamp = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC"),
                Type = "PVP_KILL",
                AttackerName = CleanName(attacker.displayName),
                AttackerSteamId = attacker.UserIDString,
                VictimName = CleanName(victim.displayName),
                VictimSteamId = victim.UserIDString,
                GridLocation = grid,
                Details = $"Killed with {weapon} at {distStr}",
                Weapon = weapon,
                Distance = distance
            };
            WriteLog(logEntry);

            var fields = new List<EmbedField>
            {
                new EmbedField("Attacker", $"**{CleanName(attacker.displayName)}**\n`{attacker.UserIDString}`", true),
                new EmbedField("Victim", $"**{CleanName(victim.displayName)}**\n`{victim.UserIDString}`", true),
                new EmbedField("Location", $"Grid: **{grid}**", true),
                new EmbedField("Weapon", weapon, true),
                new EmbedField("Distance", distStr, true),
                new EmbedField("Bodypart", GetBoneNamePretty(info), true)
            };

            SendEmbed(GetWebhook("pvp"), "PVP Kill", _config.Colors.PvPKill, fields);
        }

        #endregion

        #region Oxide Hooks — RAID TRACKING (Damage Phase)

        private void OnEntityTakeDamage(BaseCombatEntity entity, HitInfo info)
        {
            if (!_config.EnableRaidAlerts) return;
            if (entity == null || info == null) return;

            if (!(entity is BuildingBlock || entity is Door || entity is SimpleBuildingBlock || entity is StorageContainer))
                return;

            DebugLog($"OnEntityTakeDamage: entity={entity.ShortPrefabName} total={info.damageTypes?.Total() ?? 0f}");

            bool isExplosive = IsExplosiveDamage(info);
            bool isFire = _config.RaidTrackFire && IsFireDamage(info);

            if (!isExplosive && !isFire) return;

            float totalDamage = info.damageTypes?.Total() ?? 0f;
            if (totalDamage < _config.RaidMinDamage) return;

            string attackerName = "Unknown";
            string attackerSteamId = "0";
            ulong attackerUid = 0;

            var attacker = info.InitiatorPlayer;
            if (attacker != null && attacker.userID.IsSteamId())
            {
                attackerName = CleanName(attacker.displayName);
                attackerSteamId = attacker.UserIDString;
                attackerUid = attacker.userID;
            }
            else if (info.Initiator != null)
            {
                ulong ownerId = info.Initiator.OwnerID;
                if (ownerId != 0)
                {
                    attackerSteamId = ownerId.ToString();
                    attackerUid = ownerId;
                    var ownerPlayer = BasePlayer.FindByID(ownerId) ?? BasePlayer.FindSleeping(ownerId);
                    attackerName = ownerPlayer != null ? CleanName(ownerPlayer.displayName) : $"Unknown ({ownerId})";
                }
            }

            if (_config.RaidIgnoreSameOwner && attackerUid != 0 && attackerUid == entity.OwnerID)
                return;

            if (_config.RaidIgnoreTeamMembers && attackerUid != 0 && attacker != null)
            {
                var team = attacker.Team;
                if (team != null && team.members.Contains(entity.OwnerID))
                    return;
            }

            if (_config.RaidIgnoreClanAllies && Clans != null && attackerUid != 0)
            {
                if (Convert.ToBoolean(Clans?.Call("IsMemberOrAlly", attackerUid.ToString(), entity.OwnerID.ToString())))
                    return;
            }

            var buildingBlock = entity as BuildingBlock;
            if (_config.RaidIgnoreTwig && buildingBlock != null && buildingBlock.grade == BuildingGrade.Enum.Twigs)
                return;

            uint buildingId = 0;
            if (buildingBlock != null && buildingBlock.buildingID != 0)
                buildingId = buildingBlock.buildingID;
            else
                buildingId = (uint)(entity.net?.ID.Value ?? 0);

            if (IsRaidOnCooldown(buildingId)) return;

            string grid = GetGridPosition(entity.transform.position);
            string entityName = GetEntityDisplayName(entity);
            string explosiveType = isExplosive ? GetExplosiveType(info) : "Fire / Incendiary";
            string ownerInfo = GetOwnerInfo(entity);
            string grade = buildingBlock != null ? buildingBlock.grade.ToString() : "N/A";

            int color = isExplosive ? _config.Colors.RaidExplosive : _config.Colors.RaidFire;

            var logEntry = new LogEntry
            {
                Timestamp = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC"),
                Type = isFire ? "RAID_FIRE" : "RAID_EXPLOSIVE",
                AttackerName = attackerName,
                AttackerSteamId = attackerSteamId,
                VictimName = ownerInfo,
                VictimSteamId = entity.OwnerID.ToString(),
                GridLocation = grid,
                Details = $"Raiding with {explosiveType} on {entityName} ({grade})",
                Weapon = explosiveType,
                BuildingGrade = grade
            };
            WriteLog(logEntry);

            var fields = new List<EmbedField>
            {
                new EmbedField("Raider", $"**{attackerName}**\n`{attackerSteamId}`", true),
                new EmbedField("Target", entityName, true),
                new EmbedField("Location", $"Grid: **{grid}**", true),
                new EmbedField("Method", explosiveType, true),
                new EmbedField("Building Grade", grade, true),
                new EmbedField("Owner", ownerInfo, true)
            };

            string title = isFire ? "FIRE RAID ALERT" : "RAID ALERT";
            SendEmbed(GetWebhook("raid"), title, color, fields);
        }

        #endregion

        #region Oxide Hooks — ENTITY DESTROYED (Raid Result)

        private void HandleEntityDestroyed(DecayEntity entity, HitInfo info)
        {
            if (entity == null || info == null) return;
            if (entity.OwnerID == 0) return;

            if (!(entity is BuildingBlock || entity is Door || entity is SimpleBuildingBlock))
                return;

            bool isExplosive = IsExplosiveDamage(info);
            bool isFire = _config.RaidTrackFire && IsFireDamage(info);
            if (!isExplosive && !isFire) return;

            string attackerName = "Unknown";
            string attackerSteamId = "0";
            ulong attackerUid = 0;

            var attacker = info.InitiatorPlayer;
            if (attacker != null && attacker.userID.IsSteamId())
            {
                attackerName = CleanName(attacker.displayName);
                attackerSteamId = attacker.UserIDString;
                attackerUid = attacker.userID;
            }
            else if (info.Initiator != null)
            {
                var initiator = info.Initiator;
                var creator = initiator.creatorEntity as BasePlayer;
                if (creator != null)
                {
                    attackerName = CleanName(creator.displayName);
                    attackerSteamId = creator.UserIDString;
                    attackerUid = creator.userID;
                }
                else if (initiator.OwnerID != 0)
                {
                    attackerUid = initiator.OwnerID;
                    attackerSteamId = attackerUid.ToString();
                    var ownerPlayer = BasePlayer.FindByID(attackerUid) ?? BasePlayer.FindSleeping(attackerUid);
                    attackerName = ownerPlayer != null ? CleanName(ownerPlayer.displayName) : $"Offline ({attackerUid})";
                }
            }

            if (_config.RaidIgnoreSameOwner && attackerUid != 0 && attackerUid == entity.OwnerID)
                return;

            if (_config.RaidIgnoreTeamMembers && attackerUid != 0)
            {
                var attackerPlayer = BasePlayer.FindByID(attackerUid);
                if (attackerPlayer?.Team != null && attackerPlayer.Team.members.Contains(entity.OwnerID))
                    return;
            }

            if (_config.RaidIgnoreClanAllies && Clans != null && attackerUid != 0)
            {
                if (Convert.ToBoolean(Clans?.Call("IsMemberOrAlly", attackerUid.ToString(), entity.OwnerID.ToString())))
                    return;
            }

            var buildingBlock = entity as BuildingBlock;
            if (_config.RaidIgnoreTwig && buildingBlock != null && buildingBlock.grade == BuildingGrade.Enum.Twigs)
                return;

            string grid = GetGridPosition(entity.transform.position);
            string entityName = GetEntityDisplayName(entity);
            string ownerInfo = GetOwnerInfo(entity);
            string grade = buildingBlock != null ? buildingBlock.grade.ToString() : "N/A";
            string weapon = isExplosive ? GetExplosiveType(info) : "Fire / Incendiary";

            string cooldownKey = $"destroy_{attackerUid}_{entity.net?.ID}";
            if (IsOnCooldown(cooldownKey, 5f)) return;

            var logEntry = new LogEntry
            {
                Timestamp = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC"),
                Type = "RAID_DESTROYED",
                AttackerName = attackerName,
                AttackerSteamId = attackerSteamId,
                VictimName = ownerInfo,
                VictimSteamId = entity.OwnerID.ToString(),
                GridLocation = grid,
                Details = $"DESTROYED {entityName} ({grade}) with {weapon}",
                Weapon = weapon,
                BuildingGrade = grade
            };
            WriteLog(logEntry);

            var fields = new List<EmbedField>
            {
                new EmbedField("Raider", $"**{attackerName}**\n`{attackerSteamId}`", true),
                new EmbedField("Destroyed", $"**{entityName}**", true),
                new EmbedField("Location", $"Grid: **{grid}**", true),
                new EmbedField("Weapon/Method", weapon, true),
                new EmbedField("Building Grade", grade, true),
                new EmbedField("Owner", ownerInfo, true)
            };

            SendEmbed(GetWebhook("raid"), "STRUCTURE DESTROYED", _config.Colors.RaidDestroy, fields);
        }

        #endregion

        #region Oxide Hooks — MLRS TRACKING

        private void OnMlrsFired(MLRS mlrs, BasePlayer driver)
        {
            if (!_config.RaidTrackMLRS || mlrs == null || driver == null) return;
            _mlrsRocketOwners[mlrs.transform.position] = driver.userID;
        }

        private void OnMlrsFiringEnded(MLRS mlrs)
        {
            if (mlrs != null)
                _mlrsRocketOwners.Remove(mlrs.transform.position);
        }

        private void OnEntitySpawned(TimedExplosive ent)
        {
            if (ent == null || IgnoredExplosives.Contains(ent.ShortPrefabName)) return;

            if (_config.RaidTrackMLRS && ent is MLRSRocket && _mlrsRocketOwners.Count > 0)
            {
                try
                {
                    Vector3 entPos = ent.transform.position;
                    float bestDist = float.MaxValue;
                    ulong bestOwner = 0;
                    foreach (var kvp in _mlrsRocketOwners)
                    {
                        float dist = Vector3.Distance(kvp.Key, entPos);
                        if (dist < bestDist)
                        {
                            bestDist = dist;
                            bestOwner = kvp.Value;
                        }
                    }
                    if (bestOwner != 0 && bestDist < 500f)
                    {
                        var mlrsOwner = BasePlayer.FindByID(bestOwner);
                        if (mlrsOwner != null)
                        {
                            ent.creatorEntity = mlrsOwner;
                            ent.OwnerID = mlrsOwner.userID;
                        }
                    }
                }
                catch { }
            }
        }

        #endregion

        #region Oxide Hooks — UNAUTHORIZED LOOT

        private void OnLootEntity(BasePlayer player, BaseEntity entity)
        {
            if (!_config.EnableUnauthLoot) return;
            if (player == null || entity == null) return;
            if (!player.userID.IsSteamId()) return;

            var container = entity as StorageContainer;
            if (container == null) return;

            DebugLog($"OnLootEntity: player={player.displayName} container={entity.ShortPrefabName}");

            if (entity is LootableCorpse || entity is DroppedItemContainer)
                return;

            if (IsDeployableWorkstation(container))
                return;

            if (IsPlayerAuthorized(player, entity))
                return;

            string grid = GetGridPosition(entity.transform.position);
            string entityName = GetEntityDisplayName(entity);
            string ownerInfo = GetOwnerInfo(entity);

            string cooldownKey = $"loot_{player.userID}_{entity.net?.ID}";
            if (IsOnCooldown(cooldownKey, _config.AlertCooldown)) return;

            var logEntry = new LogEntry
            {
                Timestamp = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC"),
                Type = "UNAUTH_LOOT",
                AttackerName = CleanName(player.displayName),
                AttackerSteamId = player.UserIDString,
                VictimName = ownerInfo,
                VictimSteamId = entity.OwnerID.ToString(),
                GridLocation = grid,
                Details = $"Opened {entityName} without building auth"
            };
            WriteLog(logEntry);

            var fields = new List<EmbedField>
            {
                new EmbedField("Player", $"**{CleanName(player.displayName)}**\n`{player.UserIDString}`", true),
                new EmbedField("Container", entityName, true),
                new EmbedField("Location", $"Grid: **{grid}**", true),
                new EmbedField("Owner", ownerInfo, true),
                new EmbedField("Status", "NOT AUTHORIZED ON TC", true)
            };

            SendEmbed(GetWebhook("unauth"), "Unauthorized Looting", _config.Colors.UnauthLoot, fields);
        }

        #endregion

        #region Oxide Hooks — UNAUTHORIZED DOOR

        private void OnDoorOpened(Door door, BasePlayer player)
        {
            if (!_config.EnableUnauthDoor) return;
            if (door == null || player == null) return;
            if (!player.userID.IsSteamId()) return;

            DebugLog($"OnDoorOpened: player={player.displayName} door={door.ShortPrefabName} pos={door.transform.position}");

            if (IsPlayerAuthorized(player, door))
            {
                DebugLog($"OnDoorOpened: {player.displayName} is authorized on {door.ShortPrefabName} — skipping alert");
                return;
            }

            string grid = GetGridPosition(door.transform.position);
            string ownerInfo = GetOwnerInfo(door);
            string doorType = GetEntityDisplayName(door);

            string cooldownKey = $"door_{player.userID}_{door.net?.ID}";
            if (IsOnCooldown(cooldownKey, _config.AlertCooldown)) return;

            var logEntry = new LogEntry
            {
                Timestamp = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC"),
                Type = "UNAUTH_DOOR",
                AttackerName = CleanName(player.displayName),
                AttackerSteamId = player.UserIDString,
                VictimName = ownerInfo,
                VictimSteamId = door.OwnerID.ToString(),
                GridLocation = grid,
                Details = $"Opened {doorType} without building auth"
            };
            WriteLog(logEntry);

            var fields = new List<EmbedField>
            {
                new EmbedField("Player", $"**{CleanName(player.displayName)}**\n`{player.UserIDString}`", true),
                new EmbedField("Door Type", doorType, true),
                new EmbedField("Location", $"Grid: **{grid}**", true),
                new EmbedField("Owner", ownerInfo, true),
                new EmbedField("Status", "NOT AUTHORIZED ON TC", true)
            };

            SendEmbed(GetWebhook("unauth"), "Unauthorized Door Access", _config.Colors.UnauthDoor, fields);
        }

        #endregion

        #region Oxide Hooks — UNAUTHORIZED DEPLOYABLE ACCESS

        private object CanLootEntity(BasePlayer player, StorageContainer container)
        {
            if (!_config.EnableUnauthDeployable) return null;
            if (player == null || container == null) return null;
            if (!player.userID.IsSteamId()) return null;

            if (!IsDeployableWorkstation(container)) return null;

            DebugLog($"CanLootEntity(deployable): player={player.displayName} deployable={container.ShortPrefabName}");

            if (IsPlayerAuthorized(player, container))
                return null;

            string grid = GetGridPosition(container.transform.position);
            string entityName = GetEntityDisplayName(container);
            string ownerInfo = GetOwnerInfo(container);

            string cooldownKey = $"deploy_{player.userID}_{container.net?.ID}";
            if (IsOnCooldown(cooldownKey, _config.AlertCooldown))
                return null;

            var logEntry = new LogEntry
            {
                Timestamp = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC"),
                Type = "UNAUTH_DEPLOY",
                AttackerName = CleanName(player.displayName),
                AttackerSteamId = player.UserIDString,
                VictimName = ownerInfo,
                VictimSteamId = container.OwnerID.ToString(),
                GridLocation = grid,
                Details = $"Accessed {entityName} without building auth"
            };
            WriteLog(logEntry);

            var fields = new List<EmbedField>
            {
                new EmbedField("Player", $"**{CleanName(player.displayName)}**\n`{player.UserIDString}`", true),
                new EmbedField("Deployable", entityName, true),
                new EmbedField("Location", $"Grid: **{grid}**", true),
                new EmbedField("Owner", ownerInfo, true),
                new EmbedField("Status", "NOT AUTHORIZED ON TC", true)
            };

            SendEmbed(GetWebhook("unauth"), "Unauthorized Deployable Access", _config.Colors.UnauthDeployable, fields);

            return null;
        }

        #endregion

        #region Helper — Grid Position

        private string GetGridPosition(Vector3 position)
        {
            return CalculateGrid(position);
        }

        private string CalculateGrid(Vector3 pos)
        {
            float worldSize = ConVar.Server.worldsize;
            float offset = worldSize / 2f;
            float gridSize = 150f;

            int gridX = Mathf.FloorToInt((pos.x + offset) / gridSize);
            int gridZ = Mathf.FloorToInt((pos.z + offset) / gridSize);

            int totalGrids = Mathf.CeilToInt(worldSize / gridSize);
            gridZ = totalGrids - 1 - gridZ;

            string letter = "";
            int col = gridX;
            while (col >= 0)
            {
                letter = (char)('A' + (col % 26)) + letter;
                col = col / 26 - 1;
            }

            return $"{letter}{gridZ}";
        }

        #endregion

        #region Helper — Authorization Check

        // Preferred: pass the entity so we can resolve its parent building → dominating TC.
        // This is far more reliable than OBB position probes (especially for doors/deployables
        // that sit on the edge of a TC's influence zone).
        private bool IsPlayerAuthorized(BasePlayer player, BaseEntity entity)
        {
            if (player == null) return false;
            if (entity == null) return IsPlayerAuthorizedAtPosition(player, Vector3.zero);

            // 1) Direct owner of the entity is always authorized
            if (entity.OwnerID != 0UL && entity.OwnerID == player.userID)
                return true;

            // 2) Resolve the building this entity belongs to, then the dominating TC
            var decay = entity as DecayEntity;
            if (decay != null)
            {
                var building = decay.GetBuilding();
                if (building != null)
                {
                    var tc = building.GetDominatingBuildingPrivilege();
                    if (tc != null)
                    {
                        bool authed = tc.IsAuthed(player);
                        DebugLog($"Auth via building TC: player={player.displayName} entity={entity.ShortPrefabName} authed={authed}");
                        return authed;
                    }
                }
            }

            // 3) Position-based fallback (covers containers placed outside building blocks)
            return IsPlayerAuthorizedAtPosition(player, entity.transform.position);
        }

        private bool IsPlayerAuthorizedAtPosition(BasePlayer player, Vector3 position)
        {
            if (player == null) return false;

            var privs = new List<BuildingPrivlidge>();
            Vis.Entities(position, 30f, privs);

            bool foundAny = false;
            foreach (var priv in privs)
            {
                if (priv == null) continue;
                foundAny = true;
                if (priv.IsAuthed(player))
                {
                    DebugLog($"Auth via nearby TC: player={player.displayName} pos={position} authed=true");
                    return true;
                }
            }

            // No TC in range at all → treat as unowned / authorized (don't spam alerts)
            if (!foundAny)
            {
                DebugLog($"Auth: no TC within 30m of {position} — treating as authorized (unowned)");
                return true;
            }

            DebugLog($"Auth via nearby TC: player={player.displayName} pos={position} authed=false");
            return false;
        }

        #endregion

        #region Helper — Entity Naming

        private static readonly Dictionary<string, string> FriendlyNames = new Dictionary<string, string>
        {
            {"box.wooden.large", "Large Wood Box"},
            {"box.wooden", "Small Wood Box"},
            {"woodbox_deployed", "Wood Storage Box"},
            {"coffin.storage", "Coffin"},
            {"fridge.deployed", "Fridge"},
            {"locker.deployed", "Locker"},
            {"furnace", "Furnace"},
            {"furnace.large", "Large Furnace"},
            {"refinery_small_deployed", "Small Oil Refinery"},
            {"campfire", "Camp Fire"},
            {"bbq.deployed", "BBQ"},
            {"fireplace.deployed", "Fireplace"},
            {"skull_fire_pit", "Skull Fire Pit"},
            {"mixingtable.deployed", "Mixing Table"},
            {"workbench1.deployed", "Workbench Level 1"},
            {"workbench2.deployed", "Workbench Level 2"},
            {"workbench3.deployed", "Workbench Level 3"},
            {"repairbench_deployed", "Repair Bench"},
            {"researchtable_deployed", "Research Table"},
            {"vendingmachine.deployed", "Vending Machine"},
            {"dropbox.deployed", "Drop Box"},
            {"mailbox.deployed", "Mailbox"},
            {"composter", "Composter"},
            {"water.purifier.deployed", "Water Purifier"},
            {"planter.large.deployed", "Large Planter"},
            {"planter.small.deployed", "Small Planter"},
            {"wall.frame.garagedoor", "Garage Door"},
            {"door.hinged.metal", "Metal Door"},
            {"door.hinged.toptier", "Armored Door"},
            {"door.hinged.wood", "Wood Door"},
            {"door.double.hinged.metal", "Double Metal Door"},
            {"door.double.hinged.toptier", "Double Armored Door"},
            {"door.double.hinged.wood", "Double Wood Door"},
            {"wall.frame.shopfront.metal", "Metal Shop Front"},
            {"wall.frame.cell.gate", "Prison Cell Gate"},
            {"mining.quarry", "Mining Quarry"},
            {"electric.furnace", "Electric Furnace"},
            {"small.oil.refinery", "Small Oil Refinery"},
            {"foundation", "Foundation"},
            {"foundation.triangle", "Triangle Foundation"},
            {"wall", "Wall"},
            {"wall.half", "Half Wall"},
            {"wall.low", "Low Wall"},
            {"wall.doorway", "Doorway"},
            {"wall.window", "Window Wall"},
            {"wall.frame", "Wall Frame"},
            {"floor", "Floor"},
            {"floor.triangle", "Triangle Floor"},
            {"roof", "Roof"},
            {"stairs.u", "U-Stairs"},
            {"stairs.l", "L-Stairs"},
            {"ramp", "Ramp"}
        };

        private string GetEntityDisplayName(BaseEntity entity)
        {
            if (entity == null) return "Unknown";

            string shortName = entity.ShortPrefabName ?? "Unknown";

            var bb = entity as BuildingBlock;
            if (bb != null)
            {
                string baseName;
                if (!FriendlyNames.TryGetValue(shortName, out baseName))
                    baseName = shortName.Replace("_", " ").Replace(".", " ").ToTitleCase();

                return $"{baseName} ({bb.grade})";
            }

            string displayName;
            if (FriendlyNames.TryGetValue(shortName, out displayName))
                return displayName;

            return shortName.Replace("_deployed", "").Replace(".", " ").Replace("_", " ").ToTitleCase();
        }

        #endregion

        #region Helper — Owner Info

        private string GetOwnerInfo(BaseEntity entity)
        {
            if (entity == null || entity.OwnerID == 0)
                return "No Owner / Decayed";

            ulong ownerId = entity.OwnerID;
            var owner = BasePlayer.FindByID(ownerId) ?? BasePlayer.FindSleeping(ownerId);

            if (owner != null)
                return $"**{CleanName(owner.displayName)}**\n`{ownerId}`";

            return $"Offline Player\n`{ownerId}`";
        }

        #endregion

        #region Helper — Weapon / Damage Info

        private string GetWeaponName(HitInfo info)
        {
            if (info == null) return "Unknown";

            var weapon = info.Weapon?.GetItem();
            if (weapon != null)
                return weapon.info.displayName.english ?? weapon.info.shortname;

            var weaponPrefab = info.WeaponPrefab;
            if (weaponPrefab != null)
            {
                string name = weaponPrefab.ShortPrefabName ?? "";
                if (!string.IsNullOrEmpty(name))
                    return name.Replace("_", " ").Replace(".", " ").ToTitleCase();
            }

            if (info.damageTypes?.GetMajorityDamageType() != null)
                return info.damageTypes.GetMajorityDamageType().ToString();

            return "Unknown";
        }

        private static readonly Dictionary<string, string> BoneNames = new Dictionary<string, string>
        {
            {"head", "Head"}, {"neck", "Neck"},
            {"spine1", "Chest"}, {"spine2", "Chest"},
            {"spine3", "Upper Back"}, {"spine4", "Lower Back"},
            {"pelvis", "Pelvis"},
            {"l_hand", "Left Hand"}, {"r_hand", "Right Hand"},
            {"l_forearm", "Left Arm"}, {"r_forearm", "Right Arm"},
            {"l_upperarm", "Left Arm"}, {"r_upperarm", "Right Arm"},
            {"l_knee", "Left Leg"}, {"r_knee", "Right Leg"},
            {"l_foot", "Left Foot"}, {"r_foot", "Right Foot"},
            {"l_hip", "Left Leg"}, {"r_hip", "Right Leg"}
        };

        private string GetBoneNamePretty(HitInfo info)
        {
            if (info == null) return "Unknown";

            string bone = info.boneName ?? "body";

            string pretty;
            if (BoneNames.TryGetValue(bone.ToLower(), out pretty))
                return pretty;

            return bone.Replace("_", " ").ToTitleCase();
        }

        private bool IsExplosiveDamage(HitInfo info)
        {
            if (info == null) return false;

            if (info.damageTypes.Has(Rust.DamageType.Explosion))
                return true;

            if (info.Initiator != null)
            {
                string prefab = info.Initiator.ShortPrefabName ?? "";
                if (prefab.Contains("explosive") || prefab.Contains("rocket") ||
                    prefab.Contains("c4") || prefab.Contains("satchel") ||
                    prefab.Contains("40mm_grenade_he") || prefab.Contains("mlrs"))
                    return true;
            }

            if (info.WeaponPrefab != null)
            {
                string weaponName = info.WeaponPrefab.ShortPrefabName ?? "";
                if (weaponName.Contains("explosive") && info.damageTypes.Total() > 0)
                    return true;
            }

            return false;
        }

        private bool IsFireDamage(HitInfo info)
        {
            if (info == null) return false;

            if (info.damageTypes.Has(Rust.DamageType.Heat))
                return true;

            if (info.Initiator is FireBall)
                return true;

            if (info.Initiator != null)
            {
                string prefab = info.Initiator.ShortPrefabName ?? "";
                if (prefab.Contains("fireball") || prefab.Contains("napalm") ||
                    prefab.Contains("incendiary") || prefab.Contains("molotov") ||
                    prefab.Contains("flame"))
                    return true;
            }

            return false;
        }

        private string GetExplosiveType(HitInfo info)
        {
            if (info?.Initiator != null)
            {
                string prefab = info.Initiator.ShortPrefabName ?? "";
                if (prefab.Contains("mlrs")) return "MLRS Rocket";
                if (prefab.Contains("rocket_hv")) return "High Velocity Rocket";
                if (prefab.Contains("rocket_basic")) return "Rocket";
                if (prefab.Contains("rocket_fire") || prefab.Contains("incendiary")) return "Incendiary Rocket";
                if (prefab.Contains("explosive.timed")) return "C4 (Timed Explosive)";
                if (prefab.Contains("explosive.satchel") || prefab.Contains("satchel")) return "Satchel Charge";
                if (prefab.Contains("40mm_grenade_he")) return "HE Grenade (40mm)";
                if (prefab.Contains("grenade.beancan")) return "Beancan Grenade";
                if (prefab.Contains("survey_charge")) return "Survey Charge";
                if (prefab.Contains("catapult")) return "Catapult Explosive";
            }

            if (info?.WeaponPrefab != null)
            {
                string weaponName = info.WeaponPrefab.ShortPrefabName ?? "";
                if (weaponName.Contains("explosive") || weaponName.Contains("ammo.rifle.explosive"))
                    return "Explosive Ammo";
            }

            return "Explosive (Unknown)";
        }

        #endregion

        #region Helper — Deployable Check

        private bool IsDeployableWorkstation(BaseEntity entity)
        {
            if (entity == null) return false;

            return entity is BaseOven
                || entity is ResearchTable
                || entity is RepairBench
                || entity is MixingTable
                || entity is Composter
                || entity is WaterPurifier
                || entity is PlanterBox;
        }

        #endregion

        #region Helper — String Cleaning

        private string CleanName(string name)
        {
            if (string.IsNullOrEmpty(name)) return "Unknown";
            return name.Replace("@", "").Replace("`", "").Replace("*", "")
                       .Replace("_", "").Replace("~", "").Replace(">", "").Replace("|", "");
        }

        #endregion

        #region Discord Webhook

        private class EmbedField
        {
            public string name;
            public string value;
            public bool inline;

            public EmbedField(string name, string value, bool inline = false)
            {
                this.name = name;
                this.value = value;
                this.inline = inline;
            }
        }

        private string GetWebhook(string type)
        {
            if (!string.IsNullOrEmpty(_config.WebhookMaster))
                return _config.WebhookMaster;

            switch (type)
            {
                case "pvp": return _config.WebhookPvP;
                case "unauth": return _config.WebhookUnauth;
                case "raid": return _config.WebhookRaid;
                default: return _config.WebhookPvP;
            }
        }

        private void SendEmbed(string webhookUrl, string title, int color, List<EmbedField> fields)
        {
            if (string.IsNullOrEmpty(webhookUrl))
            {
                PrintWarning($"[NeighborhoodWatch] No webhook URL configured for: {title}");
                return;
            }

            string emoji = "\U0001f6a8";
            if (title.Contains("PVP")) emoji = "\u2694\ufe0f";
            else if (title.Contains("Unauthorized")) emoji = "\u26a0\ufe0f";
            else if (title.Contains("RAID") || title.Contains("FIRE")) emoji = "\U0001f4a5";
            else if (title.Contains("DESTROYED")) emoji = "\U0001f525";

            var embed = new Dictionary<string, object>
            {
                ["title"] = $"{emoji} {title}",
                ["color"] = color,
                ["fields"] = fields.Select(f => new Dictionary<string, object>
                {
                    ["name"] = f.name,
                    ["value"] = f.value,
                    ["inline"] = f.inline
                }).ToList(),
                ["footer"] = new Dictionary<string, string>
                {
                    ["text"] = $"{_config.ServerName} | NeighborhoodWatch v1.2.0 | {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC"
                },
                ["timestamp"] = DateTime.UtcNow.ToString("o")
            };

            var payload = new Dictionary<string, object>
            {
                ["username"] = _config.BotName,
                ["embeds"] = new List<object> { embed }
            };

            if (!string.IsNullOrEmpty(_config.BotAvatar))
                payload["avatar_url"] = _config.BotAvatar;

            string json = JsonConvert.SerializeObject(payload);

            webrequest.Enqueue(webhookUrl, json, (code, response) =>
            {
                if (code != 200 && code != 204)
                    PrintWarning($"[NeighborhoodWatch] Discord returned code {code}: {response}");
            }, this, RequestMethod.POST, new Dictionary<string, string>
            {
                ["Content-Type"] = "application/json"
            });
        }

        #endregion

        #region Server-Side Log

        private void WriteLog(LogEntry entry)
        {
            if (!_config.EnableLogFile) return;

            _storedData.Logs.Add(entry);
            _storedData.TotalLogged++;

            if (_storedData.Logs.Count > _config.LogMaxEntries)
            {
                var archiveData = new StoredData
                {
                    Logs = new List<LogEntry>(_storedData.Logs),
                    TotalLogged = _storedData.TotalLogged
                };

                string archiveName = $"NeighborhoodWatch_Archive_{DateTime.UtcNow:yyyyMMdd_HHmmss}";
                Interface.Oxide.DataFileSystem.WriteObject(archiveName, archiveData);
                _storedData.Logs.Clear();
                PrintWarning($"[NeighborhoodWatch] Log rotated. Archived to {archiveName}.json");
            }

            if (_storedData.Logs.Count % 50 == 0)
                SaveData();
        }

        #endregion

        #region Chat / Console Commands

        [ChatCommand("nw.stats")]
        private void CmdStats(BasePlayer player, string command, string[] args)
        {
            if (!player.IsAdmin)
            {
                SendReply(player, "<color=#ff0000>[NeighborhoodWatch]</color> Admin only.");
                return;
            }

            int pvp = 0, loot = 0, door = 0, deploy = 0, raidExp = 0, raidFire = 0, destroyed = 0;
            foreach (var l in _storedData.Logs)
            {
                switch (l.Type)
                {
                    case "PVP_KILL": pvp++; break;
                    case "UNAUTH_LOOT": loot++; break;
                    case "UNAUTH_DOOR": door++; break;
                    case "UNAUTH_DEPLOY": deploy++; break;
                    case "RAID_EXPLOSIVE": raidExp++; break;
                    case "RAID_FIRE": raidFire++; break;
                    case "RAID_DESTROYED": destroyed++; break;
                }
            }

            var sb = new StringBuilder();
            sb.AppendLine("<color=#00aaff>========= NeighborhoodWatch Stats =========</color>");
            sb.AppendLine($"<color=#ff0000>PvP Kills:</color> {pvp}");
            sb.AppendLine($"<color=#ff9900>Unauthorized Loots:</color> {loot}");
            sb.AppendLine($"<color=#ffff00>Unauthorized Doors:</color> {door}");
            sb.AppendLine($"<color=#ff6600>Unauthorized Deployables:</color> {deploy}");
            sb.AppendLine($"<color=#9900ff>Raid Alerts (Explosive):</color> {raidExp}");
            sb.AppendLine($"<color=#ff4500>Raid Alerts (Fire):</color> {raidFire}");
            sb.AppendLine($"<color=#cc0000>Structures Destroyed:</color> {destroyed}");
            sb.AppendLine($"<color=#ffffff>Total Logged (All Time):</color> {_storedData.TotalLogged}");
            sb.AppendLine($"<color=#ffffff>Current Log Size:</color> {_storedData.Logs.Count}");

            SendReply(player, sb.ToString());
        }

        [ChatCommand("nw.lookup")]
        private void CmdLookup(BasePlayer player, string command, string[] args)
        {
            if (!player.IsAdmin)
            {
                SendReply(player, "<color=#ff0000>[NeighborhoodWatch]</color> Admin only.");
                return;
            }

            if (args.Length < 1)
            {
                SendReply(player, "<color=#00aaff>[NeighborhoodWatch]</color> Usage: /nw.lookup <steamid or partial name>");
                return;
            }

            string search = string.Join(" ", args).ToLower();

            var matches = _storedData.Logs.Where(l =>
                (l.AttackerName != null && l.AttackerName.ToLower().Contains(search)) ||
                (l.AttackerSteamId != null && l.AttackerSteamId.Contains(search)) ||
                (l.VictimName != null && l.VictimName.ToLower().Contains(search)) ||
                (l.VictimSteamId != null && l.VictimSteamId.Contains(search))
            ).OrderByDescending(l => l.Timestamp).Take(10).ToList();

            if (matches.Count == 0)
            {
                SendReply(player, $"<color=#ff9900>[NeighborhoodWatch]</color> No logs found for '{search}'.");
                return;
            }

            var sb = new StringBuilder();
            sb.AppendLine($"<color=#00aaff>== Logs for '{search}' (last {matches.Count}) ==</color>");

            foreach (var log in matches)
            {
                string color = "#ffffff";
                switch (log.Type)
                {
                    case "PVP_KILL": color = "#ff0000"; break;
                    case "UNAUTH_LOOT": color = "#ff9900"; break;
                    case "UNAUTH_DOOR": color = "#ffff00"; break;
                    case "UNAUTH_DEPLOY": color = "#ff6600"; break;
                    case "RAID_EXPLOSIVE": color = "#9900ff"; break;
                    case "RAID_FIRE": color = "#ff4500"; break;
                    case "RAID_DESTROYED": color = "#cc0000"; break;
                }

                sb.AppendLine($"<color={color}>[{log.Type}]</color> {log.Timestamp} | {log.GridLocation}");
                sb.AppendLine($"  {log.Details}");
            }

            SendReply(player, sb.ToString());
        }

        [ChatCommand("nw.grid")]
        private void CmdGrid(BasePlayer player, string command, string[] args)
        {
            if (!player.IsAdmin)
            {
                SendReply(player, "<color=#ff0000>[NeighborhoodWatch]</color> Admin only.");
                return;
            }

            if (args.Length < 1)
            {
                SendReply(player, "<color=#00aaff>[NeighborhoodWatch]</color> Usage: /nw.grid <grid like A1 or F12>");
                return;
            }

            string gridSearch = args[0].ToUpper();

            var matches = _storedData.Logs.Where(l =>
                l.GridLocation != null && l.GridLocation.ToUpper() == gridSearch
            ).OrderByDescending(l => l.Timestamp).Take(15).ToList();

            if (matches.Count == 0)
            {
                SendReply(player, $"<color=#ff9900>[NeighborhoodWatch]</color> No activity found at grid {gridSearch}.");
                return;
            }

            var sb = new StringBuilder();
            sb.AppendLine($"<color=#00aaff>== Activity at {gridSearch} (last {matches.Count}) ==</color>");

            foreach (var log in matches)
            {
                sb.AppendLine($"<color=#aaaaaa>[{log.Type}]</color> {log.Timestamp}");
                sb.AppendLine($"  {log.AttackerName} - {log.Details}");
            }

            SendReply(player, sb.ToString());
        }

        [ChatCommand("nw.clearlog")]
        private void CmdClearLog(BasePlayer player, string command, string[] args)
        {
            if (!player.IsAdmin)
            {
                SendReply(player, "<color=#ff0000>[NeighborhoodWatch]</color> Admin only.");
                return;
            }

            int count = _storedData.Logs.Count;
            _storedData.Logs.Clear();
            SaveData();
            SendReply(player, $"<color=#00aaff>[NeighborhoodWatch]</color> Cleared {count} log entries.");
        }

        [ConsoleCommand("nw.test")]
        private void CmdTestWebhook(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;

            var fields = new List<EmbedField>
            {
                new EmbedField("Test", "This is a test alert from NeighborhoodWatch.", false),
                new EmbedField("Status", "If you see this, your webhook is working!", false),
                new EmbedField("Version", "1.2.0", true),
                new EmbedField("Features", "PvP | Loot | Doors | Deployables | Raids | Fire | MLRS", true)
            };

            string webhook = GetWebhook("pvp");
            if (string.IsNullOrEmpty(webhook))
                webhook = GetWebhook("raid");
            if (string.IsNullOrEmpty(webhook))
                webhook = GetWebhook("unauth");

            if (string.IsNullOrEmpty(webhook))
            {
                Puts("[NeighborhoodWatch] No webhook URL configured! Set one in the config.");
                return;
            }

            SendEmbed(webhook, "TEST ALERT", _config.Colors.Info, fields);
            Puts("[NeighborhoodWatch] Test webhook sent!");
        }

        [ConsoleCommand("nw.stats")]
        private void CmdConsoleStats(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) return;

            int pvp = 0, loot = 0, door = 0, deploy = 0, raidExp = 0, raidFire = 0, destroyed = 0;
            foreach (var l in _storedData.Logs)
            {
                switch (l.Type)
                {
                    case "PVP_KILL": pvp++; break;
                    case "UNAUTH_LOOT": loot++; break;
                    case "UNAUTH_DOOR": door++; break;
                    case "UNAUTH_DEPLOY": deploy++; break;
                    case "RAID_EXPLOSIVE": raidExp++; break;
                    case "RAID_FIRE": raidFire++; break;
                    case "RAID_DESTROYED": destroyed++; break;
                }
            }

            Puts($"[NeighborhoodWatch] Current log: {_storedData.Logs.Count} entries | All time: {_storedData.TotalLogged}");
            Puts($"  PVP: {pvp}");
            Puts($"  Unauth Loot: {loot}");
            Puts($"  Unauth Door: {door}");
            Puts($"  Unauth Deploy: {deploy}");
            Puts($"  Raid (Explosive): {raidExp}");
            Puts($"  Raid (Fire): {raidFire}");
            Puts($"  Destroyed: {destroyed}");
        }

        #endregion
    }

    #region Extension Methods

    public static class StringExtensions
    {
        public static string ToTitleCase(this string str)
        {
            if (string.IsNullOrEmpty(str)) return str;
            return CultureInfo.CurrentCulture.TextInfo.ToTitleCase(str.ToLower());
        }
    }

    #endregion
}
