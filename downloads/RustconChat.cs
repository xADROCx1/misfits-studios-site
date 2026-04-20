using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Oxide.Core;
using Oxide.Core.Libraries.Covalence;

namespace Oxide.Plugins
{
    [Info("RustconChat", "xADROCx", "1.0.1")]
    [Description("Stores recent chat and events in a ring buffer, served via RCON for RustCON app backfill.")]

    public class RustconChat : RustPlugin
    {
        #region Configuration

        private Configuration _config;

        private class Configuration
        {
            [JsonProperty("Max messages to store")]
            public int MaxMessages { get; set; } = 100;

            [JsonProperty("Log global chat")]
            public bool LogGlobal { get; set; } = true;

            [JsonProperty("Log team chat")]
            public bool LogTeam { get; set; } = true;

            [JsonProperty("Log player connections")]
            public bool LogConnections { get; set; } = true;

            [JsonProperty("Log player disconnections")]
            public bool LogDisconnections { get; set; } = true;
        }

        protected override void LoadDefaultConfig()
        {
            _config = new Configuration();
            SaveConfig();
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try
            {
                _config = Config.ReadObject<Configuration>();
                if (_config == null) throw new Exception();
            }
            catch
            {
                PrintWarning("Invalid config, creating default...");
                LoadDefaultConfig();
            }
        }

        protected override void SaveConfig() => Config.WriteObject(_config);

        #endregion

        #region Data Structures

        private class ChatEntry
        {
            public string type;
            public string name;
            public string steamid;
            public string message;
            public string time;
        }

        private ChatEntry[] _buffer;
        private int _head;
        private int _count;

        #endregion

        #region Lifecycle

        private void Init()
        {
            _buffer = new ChatEntry[_config.MaxMessages];
            _head = 0;
            _count = 0;
        }

        #endregion

        #region Hooks

        private void OnPlayerChat(BasePlayer player, string message, ConVar.Chat.ChatChannel channel)
        {
            if (player == null || string.IsNullOrEmpty(message)) return;

            switch (channel)
            {
                case ConVar.Chat.ChatChannel.Global:
                    if (!_config.LogGlobal) return;
                    AddEntry("global", player.displayName, player.UserIDString, message);
                    break;

                case ConVar.Chat.ChatChannel.Team:
                    if (!_config.LogTeam) return;
                    AddEntry("team", player.displayName, player.UserIDString, message);
                    break;
            }
        }

        private void OnPlayerConnected(BasePlayer player)
        {
            if (!_config.LogConnections || player == null) return;
            AddEntry("join", player.displayName, player.UserIDString, "");
        }

        private void OnPlayerDisconnected(BasePlayer player, string reason)
        {
            if (!_config.LogDisconnections || player == null) return;
            AddEntry("leave", player.displayName, player.UserIDString, reason ?? "");
        }

        #endregion

        #region Ring Buffer

        private void AddEntry(string type, string name, string steamid, string message)
        {
            var entry = new ChatEntry
            {
                type = type,
                name = name,
                steamid = steamid,
                message = message,
                time = DateTime.UtcNow.ToString("o")
            };

            _buffer[_head] = entry;
            _head = (_head + 1) % _buffer.Length;
            if (_count < _buffer.Length) _count++;
        }

        private List<ChatEntry> GetEntries(int requestedCount)
        {
            int count = Math.Min(requestedCount, _count);
            var list = new List<ChatEntry>(count);
            int start = (_head - _count + _buffer.Length) % _buffer.Length;
            int skip = _count - count;
            for (int i = 0; i < count; i++)
            {
                int idx = (start + skip + i) % _buffer.Length;
                list.Add(_buffer[idx]);
            }
            return list;
        }

        #endregion

        #region RCON Commands

        [ConsoleCommand("rustconchat")]
        private void CmdChatLog(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null) return;

            int count = _config.MaxMessages;
            if (arg.HasArgs(1))
            {
                int.TryParse(arg.GetString(0), out count);
                if (count <= 0) count = _config.MaxMessages;
            }

            var entries = GetEntries(count);

            var response = new Dictionary<string, object>
            {
                ["plugin"] = "RustconChat",
                ["version"] = "1.0.1",
                ["count"] = entries.Count,
                ["max"] = _config.MaxMessages,
                ["entries"] = entries
            };

            arg.ReplyWith(JsonConvert.SerializeObject(response));
        }

        [ConsoleCommand("rustconchat.ping")]
        private void CmdPing(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null) return;
            arg.ReplyWith("{\"plugin\":\"RustconChat\",\"status\":\"ok\",\"buffered\":" + _count + ",\"max\":" + _config.MaxMessages + "}");
        }

        [ConsoleCommand("rustconchat.clear")]
        private void CmdClear(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null) return;
            _count = 0;
            _head = 0;
            arg.ReplyWith("{\"plugin\":\"RustconChat\",\"cleared\":true}");
        }

        #endregion
    }
}
