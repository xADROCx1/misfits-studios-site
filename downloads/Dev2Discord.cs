using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Oxide.Core;
using Oxide.Core.Libraries;

namespace Oxide.Plugins
{
    [Info("Dev2Discord", "Misfits Studios", "1.3.0")]
    [Description("Bridges the Rust devblog RSS feed to a Discord webhook. Server-to-Discord only — no in-game surface.")]
    public class Dev2Discord : RustPlugin
    {
        #region Fields

        private const string DefaultRssUrl = "https://rust.facepunch.com/rss/news";
        private const int MaxSeenGuids = 500;
        private const int DiscordDescMax = 2000;
        private const int DiscordContentMax = 1900;

        private Configuration _config;
        private StoredData _data;
        private Timer _pollTimer;
        private Timer _digestTimer;
        private bool _firstPollSinceLoad = true;

        private static readonly Regex ItemRegex = new Regex(
            @"<item\b[^>]*>(?<body>[\s\S]*?)</item>",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static readonly Regex FieldRegex = new Regex(
            @"<(?<tag>title|link|description|pubDate|guid|category)\b[^>]*>(?<val>[\s\S]*?)</\k<tag>>",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static readonly Regex CdataRegex = new Regex(
            @"^\s*<!\[CDATA\[(?<inner>[\s\S]*?)\]\]>\s*$",
            RegexOptions.Compiled);

        private static readonly Regex HtmlTagRegex = new Regex(@"<[^>]+>", RegexOptions.Compiled);
        private static readonly Regex ImgSrcRegex  = new Regex(@"<img[^>]+src=""(?<url>[^""]+)""", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex WhitespaceRegex = new Regex(@"\s+", RegexOptions.Compiled);

        #endregion

        #region Configuration

        private class Configuration
        {
            [JsonProperty("Config version")]
            public string Version = "1.3.0";

            [JsonProperty("RSS feed URL (default: official Rust devblog)")]
            public string RssUrl = DefaultRssUrl;

            [JsonProperty("Discord webhook URL (REQUIRED — get from Discord channel settings)")]
            public string WebhookUrl = "";

            [JsonProperty("Posting mode — 'individual' (one message per post, posted immediately) or 'digest' (one daily roundup at DigestPostTime)")]
            public string Mode = "individual";

            [JsonProperty("Digest: post time in 24h format, server local time (e.g. '12:00' = noon)")]
            public string DigestPostTime = "12:00";

            [JsonProperty("Digest: skip sending if no new posts that day (true = silent days, false = send 'no news' message)")]
            public bool DigestSkipEmpty = true;

            [JsonProperty("Digest: message prefix (placeholders: {date}, {count})")]
            public string DigestHeader = "📰 **Rust dev digest — {date}** ({count} new)";

            [JsonProperty("Poll interval (seconds) — how often to CHECK the feed (separate from when digests POST)")]
            public int PollIntervalSeconds = 600;

            [JsonProperty("On first install, mark current items as seen (skip backfill flood)")]
            public bool SkipBackfillOnFirstRun = true;

            [JsonProperty("Category filter — post ONLY if item contains any of these keywords (empty = post everything)")]
            public List<string> RequireKeywords = new();

            [JsonProperty("Blacklist — skip if item contains any of these keywords")]
            public List<string> BlockKeywords = new();

            [JsonProperty("Role to ping (paste as <@&ROLE_ID>, leave empty to disable)")]
            public string RolePing = "";

            [JsonProperty("Ping role ONLY when title contains any of these keywords (empty = ping on every post)")]
            public List<string> PingKeywords = new() { "wipe", "devblog", "force" };

            [JsonProperty("Embed color (decimal; 16753920 = orange)")]
            public int EmbedColor = 16753920;

            [JsonProperty("Custom username override for webhook (empty = use webhook default)")]
            public string WebhookUsername = "Rust Devblog";

            [JsonProperty("Custom avatar URL override (empty = use webhook default)")]
            public string WebhookAvatarUrl = "";

            [JsonProperty("Embed footer text")]
            public string FooterText = "Misfits Studios · Dev2Discord";
        }

        protected override void LoadDefaultConfig() => _config = new Configuration();
        protected override void SaveConfig() => Config.WriteObject(_config);
        protected override void LoadConfig()
        {
            base.LoadConfig();
            try
            {
                _config = Config.ReadObject<Configuration>();
                if (_config == null) throw new Exception("null config");
            }
            catch (Exception ex)
            {
                PrintError($"Config load failed ({ex.Message}). Regenerating defaults.");
                LoadDefaultConfig();
            }
            SaveConfig();
        }

        #endregion

        #region Data

        private class StoredData
        {
            public List<string> SeenGuids = new();
            public DateTime LastPollUtc = DateTime.MinValue;
            public DateTime LastDigestUtc = DateTime.MinValue;
            public int TotalPosted = 0;
            public List<FeedItem> PendingDigest = new();
        }

        private void LoadData() =>
            _data = Interface.Oxide.DataFileSystem.ReadObject<StoredData>(Name) ?? new StoredData();

        private void SaveData() =>
            Interface.Oxide.DataFileSystem.WriteObject(Name, _data);

        private bool MarkSeen(string guid)
        {
            if (string.IsNullOrEmpty(guid)) return false;
            if (_data.SeenGuids.Contains(guid)) return false;
            _data.SeenGuids.Add(guid);
            if (_data.SeenGuids.Count > MaxSeenGuids)
                _data.SeenGuids.RemoveRange(0, _data.SeenGuids.Count - MaxSeenGuids);
            return true;
        }

        #endregion

        #region Hooks

        private void Init() => LoadData();

        private void OnServerInitialized(bool initial)
        {
            bool hookOk  = !string.IsNullOrWhiteSpace(_config.WebhookUrl) && _config.WebhookUrl.StartsWith("https://");
            bool feedOk  = !string.IsNullOrWhiteSpace(_config.RssUrl);
            string mode  = IsDigestMode() ? "digest" : "individual";
            int pollSec  = Math.Max(60, _config.PollIntervalSeconds);

            Puts($"Dev2Discord v1.3.0 starting — mode: {mode} · poll: every {pollSec}s · webhook: {(hookOk ? "OK" : "MISSING/INVALID")} · feed: {(feedOk ? _config.RssUrl : "MISSING")}");
            Puts($"  state: {_data.SeenGuids.Count} seen GUIDs · {_data.PendingDigest.Count} pending in digest · {_data.TotalPosted} total posted ever");
            Puts($"  commands: dev2discord.test · dev2discord.poll · dev2discord.digest · dev2discord.status · dev2discord.reset");

            if (!hookOk)
                PrintWarning("Dev2Discord: webhook URL is blank or not https. Set it in oxide/config/Dev2Discord.json then 'oxide.reload Dev2Discord'. Plugin idle until then.");

            SchedulePoll();
            ScheduleDigest();
            // Fire one poll shortly after boot so admins see it work in server logs without waiting
            timer.Once(15f, () => Poll());
        }

        private void Unload()
        {
            _pollTimer?.Destroy();
            _digestTimer?.Destroy();
            SaveData();
        }

        private void OnServerSave() => SaveData();

        #endregion

        #region Console commands (diagnostics)

        [ConsoleCommand("dev2discord.test")]
        private void CmdTest(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) { arg.ReplyWith("Admin only."); return; }
            if (string.IsNullOrWhiteSpace(_config.WebhookUrl))
            {
                arg.ReplyWith("Dev2Discord: webhook URL not set. Edit oxide/config/Dev2Discord.json and reload.");
                return;
            }

            // Optional args: dev2discord.test "Title" "Body text with newlines allowed"
            string title = "Dev2Discord test post";
            string body  = "If you see this in your Discord channel, the webhook is wired up correctly.\n\nServer time: " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
            if (arg.HasArgs(1)) title = arg.GetString(0, title);
            if (arg.HasArgs(2)) body  = arg.GetString(1, body);

            var item = new FeedItem
            {
                Title       = title,
                Description = body,
                Link        = "https://rust.facepunch.com/",
                Guid        = "test-" + Guid.NewGuid().ToString("N"),
                PubDate     = DateTime.UtcNow.ToString("r")
            };
            PostToDiscord(item);
            arg.ReplyWith("Dev2Discord: test embed queued. Check Discord channel + server console for HTTP status.");
        }

        [ConsoleCommand("dev2discord.announce")]
        private void CmdAnnounce(ConsoleSystem.Arg arg)
        {
            // Same effect as dev2discord.test with args, but semantically "a real announcement" —
            // bumps TotalPosted and is clearly named for admin broadcasts.
            if (arg.Connection != null && !arg.IsAdmin) { arg.ReplyWith("Admin only."); return; }
            if (string.IsNullOrWhiteSpace(_config.WebhookUrl))
            {
                arg.ReplyWith("Dev2Discord: webhook URL not set.");
                return;
            }
            if (!arg.HasArgs(2))
            {
                arg.ReplyWith("Usage: dev2discord.announce \"Title\" \"Body text\"");
                return;
            }
            var item = new FeedItem
            {
                Title       = arg.GetString(0, ""),
                Description = arg.GetString(1, ""),
                Link        = "https://rust.facepunch.com/",
                Guid        = "announce-" + Guid.NewGuid().ToString("N"),
                PubDate     = DateTime.UtcNow.ToString("r")
            };
            PostToDiscord(item);
            _data.TotalPosted++;
            SaveData();
            arg.ReplyWith("Dev2Discord: announcement posted to Discord.");
        }

        [ConsoleCommand("dev2discord.poll")]
        private void CmdPoll(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) { arg.ReplyWith("Admin only."); return; }
            arg.ReplyWith("Dev2Discord: forcing immediate RSS poll — check console for results.");
            Poll();
        }

        [ConsoleCommand("dev2discord.digest")]
        private void CmdDigest(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) { arg.ReplyWith("Admin only."); return; }
            int count = _data.PendingDigest?.Count ?? 0;
            if (count == 0) { arg.ReplyWith("Dev2Discord: nothing pending in digest queue."); return; }
            arg.ReplyWith($"Dev2Discord: flushing {count} pending item(s) to Discord now.");
            SendDigest();
        }

        [ConsoleCommand("dev2discord.status")]
        private void CmdStatus(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) { arg.ReplyWith("Admin only."); return; }
            string mode   = IsDigestMode() ? "digest" : "individual";
            string hookOk = !string.IsNullOrWhiteSpace(_config.WebhookUrl) ? "configured" : "MISSING";
            string last   = _data.LastPollUtc == DateTime.MinValue ? "never" : _data.LastPollUtc.ToString("u");
            string nextD  = IsDigestMode() ? $"in {Math.Round(SecondsUntilNextDigest() / 60.0, 1)} min" : "n/a";
            arg.ReplyWith(
                $"Dev2Discord status:\n" +
                $"  mode:         {mode}\n" +
                $"  webhook:      {hookOk}\n" +
                $"  feed:         {_config.RssUrl}\n" +
                $"  poll every:   {Math.Max(60, _config.PollIntervalSeconds)}s\n" +
                $"  last poll:    {last}\n" +
                $"  seen GUIDs:   {_data.SeenGuids.Count}\n" +
                $"  pending:      {_data.PendingDigest.Count}\n" +
                $"  next digest:  {nextD}\n" +
                $"  total posted: {_data.TotalPosted}");
        }

        [ConsoleCommand("dev2discord.reset")]
        private void CmdReset(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.IsAdmin) { arg.ReplyWith("Admin only."); return; }
            int before = _data.SeenGuids.Count;
            _data.SeenGuids.Clear();
            _firstPollSinceLoad = true;
            SaveData();
            arg.ReplyWith($"Dev2Discord: cleared {before} seen GUIDs. Next poll will treat all feed items as new (may flood if SkipBackfillOnFirstRun=false). Running poll now…");
            Poll();
        }

        #endregion

        #region Polling

        private void SchedulePoll()
        {
            int interval = Math.Max(60, _config.PollIntervalSeconds);
            _pollTimer = timer.Every(interval, () => Poll());
        }

        private bool IsDigestMode() =>
            !string.Equals(_config.Mode, "individual", StringComparison.OrdinalIgnoreCase);

        private void ScheduleDigest()
        {
            _digestTimer?.Destroy();
            if (!IsDigestMode()) return;

            double secondsUntil = SecondsUntilNextDigest();
            Puts($"Dev2Discord: next digest in {Math.Round(secondsUntil / 60.0, 1)} min " +
                 $"(server local time target: {_config.DigestPostTime}).");

            _digestTimer = timer.Once((float)secondsUntil, () =>
            {
                SendDigest();
                ScheduleDigest();
            });
        }

        private double SecondsUntilNextDigest()
        {
            if (!TryParseHourMinute(_config.DigestPostTime, out int hh, out int mm))
            {
                PrintWarning($"DigestPostTime '{_config.DigestPostTime}' invalid, defaulting to 12:00.");
                hh = 12; mm = 0;
            }

            var now = DateTime.Now;
            var target = new DateTime(now.Year, now.Month, now.Day, hh, mm, 0, DateTimeKind.Local);
            if (target <= now) target = target.AddDays(1);
            return (target - now).TotalSeconds;
        }

        private static bool TryParseHourMinute(string s, out int h, out int m)
        {
            h = m = 0;
            if (string.IsNullOrWhiteSpace(s)) return false;
            var parts = s.Split(':');
            if (parts.Length != 2) return false;
            return int.TryParse(parts[0], out h) && int.TryParse(parts[1], out m)
                && h >= 0 && h < 24 && m >= 0 && m < 60;
        }

        private void Poll()
        {
            if (string.IsNullOrWhiteSpace(_config.RssUrl))
            {
                PrintWarning("Dev2Discord: RSS URL is blank — nothing to poll.");
                return;
            }

            webrequest.Enqueue(_config.RssUrl, null, (code, body) =>
            {
                _data.LastPollUtc = DateTime.UtcNow;

                if (code != 200 || string.IsNullOrEmpty(body))
                {
                    PrintWarning($"Dev2Discord: RSS fetch failed — HTTP {code} from {_config.RssUrl}");
                    return;
                }

                var items = ParseRss(body);
                if (items.Count == 0)
                {
                    PrintWarning($"Dev2Discord: fetched {body.Length} bytes from RSS but found 0 <item> tags. Feed format may have changed.");
                    return;
                }

                if (_firstPollSinceLoad && _data.SeenGuids.Count == 0 && _config.SkipBackfillOnFirstRun)
                {
                    foreach (var it in items) MarkSeen(it.Guid);
                    SaveData();
                    _firstPollSinceLoad = false;
                    Puts($"First run — marked {items.Count} existing items as seen (backfill skipped).");
                    return;
                }
                _firstPollSinceLoad = false;

                var newItems = new List<FeedItem>();
                foreach (var it in items)
                    if (!_data.SeenGuids.Contains(it.Guid))
                        newItems.Add(it);

                newItems.Reverse(); // RSS is newest-first; invert for chronological posting

                if (newItems.Count == 0)
                {
                    SaveData();
                    return;
                }

                bool digestMode = IsDigestMode();
                Puts($"Dev2Discord: {newItems.Count} new item(s) detected (mode: {(digestMode ? "digest" : "individual")}).");

                foreach (var it in newItems)
                {
                    if (!PassesFilters(it)) { MarkSeen(it.Guid); continue; }

                    if (digestMode)
                    {
                        _data.PendingDigest.Add(it);
                    }
                    else
                    {
                        PostToDiscord(it);
                        _data.TotalPosted++;
                    }
                    MarkSeen(it.Guid);
                }

                SaveData();
            }, this, RequestMethod.GET, new Dictionary<string, string>
            {
                ["User-Agent"] = "Dev2Discord/1.2 (MisfitsStudios; +https://rust.facepunch.com)"
            }, 15f);
        }

        #endregion

        #region Digest composition

        private void SendDigest()
        {
            if (string.IsNullOrWhiteSpace(_config.WebhookUrl)) return;

            int count = _data.PendingDigest?.Count ?? 0;
            _data.LastDigestUtc = DateTime.UtcNow;

            if (count == 0)
            {
                if (_config.DigestSkipEmpty) { SaveData(); return; }
                SendEmptyDigest();
                SaveData();
                return;
            }

            var items = _data.PendingDigest;
            string dateStr = DateTime.Now.ToString("yyyy-MM-dd");
            string header = _config.DigestHeader
                .Replace("{date}", dateStr)
                .Replace("{count}", count.ToString());

            string pingPrefix = AnyShouldPing(items) ? _config.RolePing : "";
            string content = string.IsNullOrEmpty(pingPrefix) ? header : $"{pingPrefix}\n{header}";

            const int embedsPerMessage = 10;
            int totalMessages = (count + embedsPerMessage - 1) / embedsPerMessage;

            for (int msgIdx = 0; msgIdx < totalMessages; msgIdx++)
            {
                var slice = new List<FeedItem>();
                for (int i = msgIdx * embedsPerMessage; i < Math.Min(count, (msgIdx + 1) * embedsPerMessage); i++)
                    slice.Add(items[i]);

                var embeds = new List<Dictionary<string, object>>();
                foreach (var it in slice) embeds.Add(BuildEmbed(it));

                var payload = new Dictionary<string, object> { ["embeds"] = embeds };
                if (msgIdx == 0 && !string.IsNullOrEmpty(content))
                    payload["content"] = content;
                if (!string.IsNullOrEmpty(_config.WebhookUsername)) payload["username"] = _config.WebhookUsername;
                if (!string.IsNullOrEmpty(_config.WebhookAvatarUrl)) payload["avatar_url"] = _config.WebhookAvatarUrl;

                PostPayload(payload, $"digest msg {msgIdx + 1}/{totalMessages} ({slice.Count} items)");
                _data.TotalPosted += slice.Count;
            }

            _data.PendingDigest.Clear();
            SaveData();
        }

        private void SendEmptyDigest()
        {
            string dateStr = DateTime.Now.ToString("yyyy-MM-dd");
            string header = _config.DigestHeader
                .Replace("{date}", dateStr)
                .Replace("{count}", "0");
            var payload = new Dictionary<string, object>
            {
                ["content"] = $"{header}\n_No new devblogs today._"
            };
            if (!string.IsNullOrEmpty(_config.WebhookUsername)) payload["username"] = _config.WebhookUsername;
            if (!string.IsNullOrEmpty(_config.WebhookAvatarUrl)) payload["avatar_url"] = _config.WebhookAvatarUrl;
            PostPayload(payload, "empty digest");
        }

        private bool AnyShouldPing(List<FeedItem> items)
        {
            if (string.IsNullOrWhiteSpace(_config.RolePing)) return false;
            if (_config.PingKeywords == null || _config.PingKeywords.Count == 0) return true;
            foreach (var it in items) if (ShouldPing(it)) return true;
            return false;
        }

        #endregion

        #region RSS parsing

        private class FeedItem
        {
            public string Title = "";
            public string Link = "";
            public string Description = "";
            public string PubDate = "";
            public string Guid = "";
            public string ImageUrl = "";
        }

        private static List<FeedItem> ParseRss(string body)
        {
            var list = new List<FeedItem>();
            foreach (Match m in ItemRegex.Matches(body))
            {
                var item = new FeedItem();
                foreach (Match f in FieldRegex.Matches(m.Groups["body"].Value))
                {
                    string tag = f.Groups["tag"].Value.ToLower();
                    string val = Unwrap(f.Groups["val"].Value);
                    switch (tag)
                    {
                        case "title":       item.Title       = HtmlDecode(val); break;
                        case "link":        item.Link        = val.Trim();     break;
                        case "description": item.Description = val;            break;
                        case "pubdate":     item.PubDate     = val.Trim();     break;
                        case "guid":        item.Guid        = val.Trim();     break;
                    }
                }
                if (string.IsNullOrEmpty(item.Guid)) item.Guid = item.Link;

                var img = ImgSrcRegex.Match(item.Description);
                if (img.Success) item.ImageUrl = img.Groups["url"].Value;

                if (!string.IsNullOrEmpty(item.Guid))
                    list.Add(item);
            }
            return list;
        }

        private static string Unwrap(string raw)
        {
            var m = CdataRegex.Match(raw);
            return m.Success ? m.Groups["inner"].Value : raw;
        }

        private static string HtmlDecode(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("&amp;", "&").Replace("&lt;", "<").Replace("&gt;", ">")
                    .Replace("&quot;", "\"").Replace("&#39;", "'").Replace("&nbsp;", " ");
        }

        private static string StripHtml(string s, int max = DiscordDescMax)
        {
            if (string.IsNullOrEmpty(s)) return "";
            string plain = HtmlTagRegex.Replace(s, " ");
            plain = HtmlDecode(plain);
            plain = WhitespaceRegex.Replace(plain, " ").Trim();
            if (plain.Length > max) plain = plain.Substring(0, max - 3) + "...";
            return plain;
        }

        #endregion

        #region Filters

        private bool PassesFilters(FeedItem item)
        {
            string haystack = ((item.Title ?? "") + " " + (item.Link ?? "") + " " + (item.Description ?? "")).ToLower();

            if (_config.BlockKeywords != null)
                foreach (var kw in _config.BlockKeywords)
                    if (!string.IsNullOrEmpty(kw) && haystack.Contains(kw.ToLower()))
                        return false;

            if (_config.RequireKeywords != null && _config.RequireKeywords.Count > 0)
            {
                bool match = false;
                foreach (var kw in _config.RequireKeywords)
                    if (!string.IsNullOrEmpty(kw) && haystack.Contains(kw.ToLower())) { match = true; break; }
                if (!match) return false;
            }

            return true;
        }

        private bool ShouldPing(FeedItem item)
        {
            if (string.IsNullOrWhiteSpace(_config.RolePing)) return false;
            if (_config.PingKeywords == null || _config.PingKeywords.Count == 0) return true;
            string hay = (item.Title ?? "").ToLower();
            foreach (var kw in _config.PingKeywords)
                if (!string.IsNullOrEmpty(kw) && hay.Contains(kw.ToLower())) return true;
            return false;
        }

        #endregion

        #region Discord

        private Dictionary<string, object> BuildEmbed(FeedItem item)
        {
            var embed = new Dictionary<string, object>
            {
                ["title"] = Truncate(item.Title, 256),
                ["url"] = item.Link,
                ["description"] = StripHtml(item.Description, DiscordDescMax),
                ["color"] = _config.EmbedColor,
                ["footer"] = new Dictionary<string, object> { ["text"] = _config.FooterText }
            };

            if (TryParseRfc822(item.PubDate, out var dt))
                embed["timestamp"] = dt.ToUniversalTime().ToString("o");

            if (!string.IsNullOrEmpty(item.ImageUrl))
                embed["image"] = new Dictionary<string, object> { ["url"] = item.ImageUrl };

            return embed;
        }

        private void PostToDiscord(FeedItem item)
        {
            if (string.IsNullOrWhiteSpace(_config.WebhookUrl)) return;

            string content = ShouldPing(item) ? _config.RolePing : "";
            if (content.Length > DiscordContentMax)
                content = content.Substring(0, DiscordContentMax);

            var payload = new Dictionary<string, object>
            {
                ["embeds"] = new[] { BuildEmbed(item) }
            };

            if (!string.IsNullOrEmpty(content)) payload["content"] = content;
            if (!string.IsNullOrEmpty(_config.WebhookUsername)) payload["username"] = _config.WebhookUsername;
            if (!string.IsNullOrEmpty(_config.WebhookAvatarUrl)) payload["avatar_url"] = _config.WebhookAvatarUrl;

            PostPayload(payload, item.Title);
        }

        private void PostPayload(Dictionary<string, object> payload, string label)
        {
            if (string.IsNullOrWhiteSpace(_config.WebhookUrl)) return;

            string json = JsonConvert.SerializeObject(payload);

            webrequest.Enqueue(_config.WebhookUrl, json, (code, body) =>
            {
                if (code >= 200 && code < 300)
                    Puts($"Posted to Discord: {label}");
                else
                    PrintWarning($"Discord webhook failed ({label}): HTTP {code} — {body}");
            }, this, RequestMethod.POST, new Dictionary<string, string>
            {
                ["Content-Type"] = "application/json"
            }, 15f);
        }

        private static string Truncate(string s, int max)
            => string.IsNullOrEmpty(s) ? "" : (s.Length <= max ? s : s.Substring(0, max - 3) + "...");

        private static bool TryParseRfc822(string s, out DateTime result)
        {
            return DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                out result);
        }

        #endregion

        #region API (for other plugins)

        // Other Misfits plugins can reuse this webhook to post custom messages.
        // Example:
        //   [PluginReference] private Plugin Dev2Discord;
        //   Dev2Discord?.Call("PostCustom", "Raid alert", "Base at K12 under attack", "", 16711680);
        private void PostCustom(string title, string description, string url, int color)
        {
            var item = new FeedItem
            {
                Title = title ?? "",
                Description = description ?? "",
                Link = string.IsNullOrEmpty(url) ? "https://rust.facepunch.com/" : url,
                Guid = "custom-" + Guid.NewGuid().ToString("N"),
                PubDate = DateTime.UtcNow.ToString("r")
            };
            int original = _config.EmbedColor;
            _config.EmbedColor = color == 0 ? original : color;
            PostToDiscord(item);
            _config.EmbedColor = original;
        }

        #endregion
    }
}
