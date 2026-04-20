using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Oxide.Core;
using Oxide.Core.Plugins;
using Oxide.Game.Rust.Cui;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("MisfitsUI", "Misfits Studios", "2.0.0")]
    [Description("Shared UI + image asset library for all Misfits Studios plugins. ImageLibrary integration, branded components, neon underground aesthetic.")]
    public class MisfitsUI : RustPlugin
    {
        [PluginReference] private Plugin ImageLibrary;

        private Configuration _config;

        // ══════════════════════════════════════════════════════════════════
        //  CONFIGURATION — image URLs for all brand assets
        // ══════════════════════════════════════════════════════════════════

        private class Configuration
        {
            [JsonProperty("Image URLs — replace with your hosted PNGs after generating from AI prompts")]
            public Dictionary<string, string> ImageUrls = new()
            {
                ["panel_bg"]        = "",
                ["header_bar"]      = "",
                ["frame_torn"]      = "",
                ["sidebar_bg"]      = "",
                ["btn_primary"]     = "",
                ["btn_success"]     = "",
                ["btn_danger"]      = "",
                ["btn_warning"]     = "",
                ["tab_active"]      = "",
                ["tab_inactive"]    = "",
                ["row_even"]        = "",
                ["row_odd"]         = "",
                ["skull_icon"]      = "",
                ["skull_icon_64"]   = "",
                ["logo_wordmark"]   = "",
                ["toast_success"]   = "",
                ["toast_error"]     = "",
                ["toast_warning"]   = "",
                ["toast_info"]      = "",
                ["grunge_texture"]  = "",
                ["neon_crack_bg"]   = "",
                ["misfits_logo"]    = ""
            };

            [JsonProperty("Use ImageLibrary for cached images (recommended, requires ImageLibrary plugin)")]
            public bool UseImageLibrary = true;

            [JsonProperty("Fallback to URL-based images if ImageLibrary is not installed")]
            public bool FallbackToUrl = true;
        }

        protected override void LoadDefaultConfig() => _config = new Configuration();
        protected override void SaveConfig() => Config.WriteObject(_config);
        protected override void LoadConfig()
        {
            base.LoadConfig();
            try { _config = Config.ReadObject<Configuration>() ?? new Configuration(); }
            catch { LoadDefaultConfig(); }
            SaveConfig();
        }

        // ══════════════════════════════════════════════════════════════════
        //  COLOR PALETTE — Neon Underground × Skull Punk
        // ══════════════════════════════════════════════════════════════════

        public static class C
        {
            // Backgrounds
            public const string Void      = "0.03 0.03 0.03 0.98";
            public const string Slab      = "0.07 0.07 0.07 0.97";
            public const string Gutter    = "0.10 0.10 0.10 0.95";
            public const string Alley     = "0.13 0.13 0.13 0.92";
            public const string Smoke     = "0.16 0.16 0.16 0.90";

            // Neon accents
            public const string Pink      = "1.0 0.08 0.58 1";
            public const string Green     = "0.22 1.0 0.08 1";
            public const string Orange    = "1.0 0.27 0.0 1";

            // Text
            public const string White     = "0.94 0.94 0.94 1";
            public const string Bone      = "0.80 0.80 0.80 1";
            public const string Ash       = "0.40 0.40 0.40 1";

            // Functional
            public const string Danger    = "1.0 0.13 0.13 1";
            public const string DangerBg  = "0.40 0.06 0.06 0.95";
            public const string SuccessBg = "0.05 0.24 0.03 0.95";
            public const string PrimaryBg = "0.40 0.03 0.22 0.95";
            public const string WarningBg = "0.40 0.12 0.0 0.95";
            public const string StarOn    = "1.0 0.08 0.58 1";
            public const string StarOff   = "0.27 0.27 0.27 1";
            public const string PinkGlow  = "1.0 0.08 0.58 0.25";
            public const string GreenGlow = "0.22 1.0 0.08 0.20";
            public const string None      = "0 0 0 0";
        }

        // ══════════════════════════════════════════════════════════════════
        //  BRAND STRINGS
        // ══════════════════════════════════════════════════════════════════

        public static class Brand
        {
            public const string HeaderLockup = "<color=#FF1493><b>MISFITS</b></color> <color=#39FF14><b>STUDIOS</b></color>";
            public const string Footer       = "<color=#666666><size=9>Misfits Studios</size></color>";

            public static string PluginHeader(string pluginName, string version)
                => $"{HeaderLockup}  <size=12><color=#CCCCCC>—  {pluginName.ToUpper()}  v{version}</color></size>";
        }

        // ══════════════════════════════════════════════════════════════════
        //  IMAGE LIBRARY INTEGRATION
        // ══════════════════════════════════════════════════════════════════

        private readonly Dictionary<string, string> _cachedPngs = new();
        private bool _imagesLoaded = false;
        private Timer _retryTimer;
        private int _retryCount = 0;

        private void OnServerInitialized(bool initial)
        {
            if (_config.UseImageLibrary && ImageLibrary != null)
            {
                ImportImagesWithCallback();
            }
            else if (_config.UseImageLibrary)
            {
                PrintWarning("MisfitsUI: ImageLibrary not found. Install it from umod.org, or set UseImageLibrary=false to use URL fallback.");
            }
        }

        /// <summary>
        /// Uses ImageLibrary's ImportImageList batch API with a completion callback.
        /// This is the recommended pattern — fires when all images are downloaded.
        /// </summary>
        private void ImportImagesWithCallback()
        {
            if (ImageLibrary == null) return;

            // Build the list: { "misfits_key" : "url" }
            var imageList = new Dictionary<string, object>();
            int count = 0;
            foreach (var kvp in _config.ImageUrls)
            {
                if (string.IsNullOrWhiteSpace(kvp.Value)) continue;
                imageList[$"misfits_{kvp.Key}"] = kvp.Value;
                count++;
            }

            if (count == 0)
            {
                PrintWarning("MisfitsUI: no image URLs in config — nothing to load.");
                return;
            }

            Puts($"MisfitsUI: importing {count} images into ImageLibrary...");

            // ImportImageList(title, dict, imageId=0, replace=true, callback)
            // Callback fires when all images finish downloading.
            ImageLibrary.Call("ImportImageList", "MisfitsUI", imageList, 0UL, true, new Action(OnImagesReady));

            // Safety fallback — if callback never fires (some ImageLibrary versions don't support it),
            // poll every 5 seconds up to 2 minutes to cache whatever's ready.
            SchedulePollRetry();
        }

        private void OnImagesReady()
        {
            Puts("MisfitsUI: ImportImageList completion callback fired.");
            CacheImages(logResult: true);
        }

        private void SchedulePollRetry()
        {
            _retryTimer?.Destroy();
            _retryCount = 0;
            _retryTimer = timer.Every(5f, () =>
            {
                _retryCount++;
                CacheImages(logResult: false);

                // Count how many have URLs configured
                int expected = 0;
                foreach (var kvp in _config.ImageUrls)
                    if (!string.IsNullOrWhiteSpace(kvp.Value)) expected++;

                // Stop when fully cached OR after 24 tries (2 min)
                if (_cachedPngs.Count >= expected || _retryCount >= 24)
                {
                    _retryTimer?.Destroy();
                    _retryTimer = null;
                    Puts($"MisfitsUI: cache finalized — {_cachedPngs.Count}/{expected} images loaded after {_retryCount * 5}s.");
                }
            });
        }

        private void CacheImages(bool logResult)
        {
            if (ImageLibrary == null) return;

            int before = _cachedPngs.Count;
            foreach (var kvp in _config.ImageUrls)
            {
                if (string.IsNullOrWhiteSpace(kvp.Value)) continue;
                if (_cachedPngs.ContainsKey(kvp.Key)) continue; // already cached

                string imgName = $"misfits_{kvp.Key}";
                bool has = false;
                try { has = (bool)(ImageLibrary.Call("HasImage", imgName, 0UL) ?? false); } catch { }

                if (has)
                {
                    var png = ImageLibrary.Call("GetImage", imgName, 0UL) as string;
                    if (!string.IsNullOrEmpty(png))
                        _cachedPngs[kvp.Key] = png;
                }
            }

            _imagesLoaded = _cachedPngs.Count > 0;

            if (logResult)
            {
                int expected = 0;
                foreach (var kvp in _config.ImageUrls)
                    if (!string.IsNullOrWhiteSpace(kvp.Value)) expected++;
                Puts($"MisfitsUI: cached {_cachedPngs.Count}/{expected} images (+{_cachedPngs.Count - before} new).");
            }
        }

        // Admin helper — reload images from config. Call via console: msfui.reloadimages
        [ConsoleCommand("msfui.reloadimages")]
        private void CmdReloadImages(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.Connection.authLevel.Equals(2)) return;
            Puts("MisfitsUI: manual image reload triggered.");
            _cachedPngs.Clear();
            _imagesLoaded = false;
            ImportImagesWithCallback();
        }

        // Admin helper — show cache status. Console: msfui.status
        [ConsoleCommand("msfui.status")]
        private void CmdStatus(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null && !arg.Connection.authLevel.Equals(2)) return;
            int expected = 0;
            foreach (var kvp in _config.ImageUrls)
                if (!string.IsNullOrWhiteSpace(kvp.Value)) expected++;
            Puts($"MisfitsUI: ImageLibrary={(ImageLibrary != null ? "loaded" : "MISSING")}, cached={_cachedPngs.Count}/{expected}, ready={_imagesLoaded}");

            // List which images are missing
            foreach (var kvp in _config.ImageUrls)
            {
                if (string.IsNullOrWhiteSpace(kvp.Value)) continue;
                if (!_cachedPngs.ContainsKey(kvp.Key)) Puts($"  NOT CACHED: {kvp.Key}");
            }
        }

        /// <summary>
        /// Gets the image for a given asset key. Returns a CuiRawImageComponent
        /// configured for either ImageLibrary (Png) or URL fallback.
        /// </summary>
        public CuiRawImageComponent GetImage(string key, string fallbackColor = "0 0 0 0")
        {
            // Try ImageLibrary cached PNG first
            if (_imagesLoaded && _cachedPngs.TryGetValue(key, out var png))
                return new CuiRawImageComponent { Png = png, Color = "1 1 1 1" };

            // Try URL fallback
            if (_config.FallbackToUrl && _config.ImageUrls.TryGetValue(key, out var url) && !string.IsNullOrWhiteSpace(url))
                return new CuiRawImageComponent { Url = url, Color = "1 1 1 1" };

            // No image available — return transparent or fallback color
            return new CuiRawImageComponent { Color = fallbackColor };
        }

        /// <summary>Checks if a specific image asset is available.</summary>
        public bool HasImage(string key)
        {
            if (_imagesLoaded && _cachedPngs.ContainsKey(key)) return true;
            if (_config.FallbackToUrl && _config.ImageUrls.TryGetValue(key, out var url) && !string.IsNullOrWhiteSpace(url)) return true;
            return false;
        }

        // ══════════════════════════════════════════════════════════════════
        //  PANEL BUILDER — image-backed branded panels
        // ══════════════════════════════════════════════════════════════════

        /// <summary>
        /// Creates a full branded panel with image backgrounds.
        /// Returns the main panel name for adding content into.
        /// </summary>
        public string CreatePanel(
            CuiElementContainer container,
            string panelName,
            string pluginName,
            string version,
            string closeCommand,
            bool cursorEnabled = true,
            string anchorMin = "0.12 0.08",
            string anchorMax = "0.88 0.92")
        {
            // Full-screen dim backdrop
            container.Add(new CuiPanel
            {
                Image = { Color = C.Void },
                RectTransform = { AnchorMin = "0 0", AnchorMax = "1 1" },
                CursorEnabled = cursorEnabled
            }, "Overall", panelName + ".Backdrop");

            // Main panel — image-backed if available
            if (HasImage("panel_bg"))
            {
                container.Add(new CuiElement
                {
                    Name = panelName,
                    Parent = panelName + ".Backdrop",
                    Components = {
                        GetImage("panel_bg", C.Slab),
                        new CuiRectTransformComponent { AnchorMin = anchorMin, AnchorMax = anchorMax }
                    }
                });
            }
            else
            {
                container.Add(new CuiPanel
                {
                    Image = { Color = C.Slab },
                    RectTransform = { AnchorMin = anchorMin, AnchorMax = anchorMax }
                }, panelName + ".Backdrop", panelName);
            }

            // Torn frame overlay (if available)
            if (HasImage("frame_torn"))
            {
                container.Add(new CuiElement
                {
                    Parent = panelName,
                    Components = {
                        GetImage("frame_torn"),
                        new CuiRectTransformComponent { AnchorMin = "0 0", AnchorMax = "1 1" }
                    }
                });
            }

            // Header bar — image-backed
            string headerName = panelName + ".Header";
            if (HasImage("header_bar"))
            {
                container.Add(new CuiElement
                {
                    Name = headerName,
                    Parent = panelName,
                    Components = {
                        GetImage("header_bar", C.Gutter),
                        new CuiRectTransformComponent { AnchorMin = "0 0.94", AnchorMax = "1 1" }
                    }
                });
            }
            else
            {
                container.Add(new CuiPanel
                {
                    Image = { Color = C.Gutter },
                    RectTransform = { AnchorMin = "0 0.94", AnchorMax = "1 1" }
                }, panelName, headerName);
            }

            // Skull icon in header (if available)
            if (HasImage("skull_icon_64"))
            {
                container.Add(new CuiElement
                {
                    Parent = headerName,
                    Components = {
                        GetImage("skull_icon_64"),
                        new CuiRectTransformComponent { AnchorMin = "0.01 0.1", AnchorMax = "0.05 0.9" }
                    }
                });
            }

            // Logo wordmark (if available, replaces text)
            if (HasImage("logo_wordmark"))
            {
                container.Add(new CuiElement
                {
                    Parent = headerName,
                    Components = {
                        GetImage("logo_wordmark"),
                        new CuiRectTransformComponent { AnchorMin = "0.2 0.15", AnchorMax = "0.8 0.85" }
                    }
                });
                // Plugin name below logo
                container.Add(new CuiLabel
                {
                    Text = { Text = $"<size=10><color=#666666>{pluginName.ToUpper()}  v{version}</color></size>",
                             FontSize = 10, Align = TextAnchor.MiddleCenter, Color = C.Ash },
                    RectTransform = { AnchorMin = "0.3 0", AnchorMax = "0.7 0.35" }
                }, headerName);
            }
            else
            {
                // Fallback: text header
                container.Add(new CuiLabel
                {
                    Text = { Text = Brand.PluginHeader(pluginName, version),
                             FontSize = 18, Align = TextAnchor.MiddleCenter, Color = C.White },
                    RectTransform = { AnchorMin = "0 0", AnchorMax = "1 1" }
                }, headerName);
            }

            // Close button
            container.Add(new CuiButton
            {
                Button = { Command = closeCommand, Color = C.DangerBg },
                RectTransform = { AnchorMin = "0.955 0.2", AnchorMax = "0.99 0.8" },
                Text = { Text = "✕", FontSize = 14, Align = TextAnchor.MiddleCenter, Color = C.Danger }
            }, headerName);

            // Footer
            container.Add(new CuiLabel
            {
                Text = { Text = Brand.Footer, FontSize = 9, Align = TextAnchor.MiddleCenter, Color = C.Ash },
                RectTransform = { AnchorMin = "0 0", AnchorMax = "1 0.035" }
            }, panelName);

            return panelName;
        }

        /// <summary>Adds image-backed tab bar.</summary>
        public void AddTabBar(
            CuiElementContainer container,
            string parent,
            string[][] tabs,
            string activeTab,
            string commandPrefix,
            float yMin = 0.89f,
            float yMax = 0.935f)
        {
            float tabWidth = Math.Min(0.19f, 0.76f / tabs.Length);
            float startX = 0.23f, gap = 0.005f;

            for (int i = 0; i < tabs.Length; i++)
            {
                string id = tabs[i][0], label = tabs[i][1];
                bool active = id == activeTab;
                float x0 = startX + i * (tabWidth + gap);

                string imgKey = active ? "tab_active" : "tab_inactive";
                if (HasImage(imgKey))
                {
                    container.Add(new CuiElement
                    {
                        Parent = parent,
                        Components = {
                            GetImage(imgKey, active ? C.PrimaryBg : C.Gutter),
                            new CuiRectTransformComponent { AnchorMin = $"{x0} {yMin}", AnchorMax = $"{x0 + tabWidth} {yMax}" }
                        }
                    });
                    // Clickable overlay
                    container.Add(new CuiButton
                    {
                        Button = { Command = $"{commandPrefix} {id}", Color = C.None },
                        RectTransform = { AnchorMin = $"{x0} {yMin}", AnchorMax = $"{x0 + tabWidth} {yMax}" },
                        Text = { Text = active ? $"<b>{label.ToUpper()}</b>" : label,
                                 FontSize = 11, Align = TextAnchor.MiddleCenter,
                                 Color = active ? C.Pink : C.Bone }
                    }, parent);
                }
                else
                {
                    container.Add(new CuiButton
                    {
                        Button = { Command = $"{commandPrefix} {id}", Color = active ? C.PrimaryBg : C.Gutter },
                        RectTransform = { AnchorMin = $"{x0} {yMin}", AnchorMax = $"{x0 + tabWidth} {yMax}" },
                        Text = { Text = active ? $"<b>{label.ToUpper()}</b>" : label,
                                 FontSize = 11, Align = TextAnchor.MiddleCenter,
                                 Color = active ? C.Pink : C.Bone }
                    }, parent);

                    if (active)
                        container.Add(new CuiPanel
                        {
                            Image = { Color = C.Pink },
                            RectTransform = { AnchorMin = $"{x0 + 0.01} {yMin}", AnchorMax = $"{x0 + tabWidth - 0.01} {yMin + 0.004}" }
                        }, parent);
                }
            }
        }

        /// <summary>Adds image-backed row background.</summary>
        public void AddRowBg(CuiElementContainer container, string parent, int index, string anchorMin, string anchorMax)
        {
            string imgKey = index % 2 == 0 ? "row_even" : "row_odd";
            string fallbackColor = index % 2 == 0 ? C.Alley : C.Smoke;

            if (HasImage(imgKey))
            {
                container.Add(new CuiElement
                {
                    Parent = parent,
                    Components = {
                        GetImage(imgKey, fallbackColor),
                        new CuiRectTransformComponent { AnchorMin = anchorMin, AnchorMax = anchorMax }
                    }
                });
            }
            else
            {
                container.Add(new CuiPanel
                {
                    Image = { Color = fallbackColor },
                    RectTransform = { AnchorMin = anchorMin, AnchorMax = anchorMax }
                }, parent);
            }
        }

        /// <summary>Adds image-backed sidebar.</summary>
        public void AddSidebarBg(CuiElementContainer container, string parent,
            string anchorMin = "0 0.04", string anchorMax = "0.215 0.88")
        {
            if (HasImage("sidebar_bg"))
            {
                container.Add(new CuiElement
                {
                    Parent = parent,
                    Components = {
                        GetImage("sidebar_bg", C.Gutter),
                        new CuiRectTransformComponent { AnchorMin = anchorMin, AnchorMax = anchorMax }
                    }
                });
            }
            else
            {
                container.Add(new CuiPanel
                {
                    Image = { Color = C.Gutter },
                    RectTransform = { AnchorMin = anchorMin, AnchorMax = anchorMax }
                }, parent);
            }
        }

        /// <summary>Shows a toast notification with image background.</summary>
        public void ShowToast(BasePlayer player, string message, string type = "info", float duration = 3f, Plugin caller = null)
        {
            string panelName = "MisfitsToast";
            CuiHelper.DestroyUi(player, panelName);

            string bgColor, textColor, imgKey;
            switch (type)
            {
                case "success": bgColor = C.SuccessBg; textColor = C.Green;  imgKey = "toast_success"; break;
                case "error":   bgColor = C.DangerBg;  textColor = C.Danger; imgKey = "toast_error";   break;
                case "warning": bgColor = C.WarningBg; textColor = C.Orange; imgKey = "toast_warning"; break;
                default:        bgColor = C.PrimaryBg; textColor = C.Pink;   imgKey = "toast_info";    break;
            }

            var c = new CuiElementContainer();

            if (HasImage(imgKey))
            {
                c.Add(new CuiElement
                {
                    Name = panelName,
                    Parent = "Overall",
                    Components = {
                        GetImage(imgKey, bgColor),
                        new CuiRectTransformComponent { AnchorMin = "0.30 0.88", AnchorMax = "0.70 0.93" }
                    }
                });
            }
            else
            {
                c.Add(new CuiPanel
                {
                    Image = { Color = bgColor, FadeIn = 0.2f },
                    RectTransform = { AnchorMin = "0.30 0.88", AnchorMax = "0.70 0.93" },
                    FadeOut = 0.5f
                }, "Overall", panelName);
            }

            c.Add(new CuiLabel
            {
                Text = { Text = $"<b>{message}</b>", FontSize = 13,
                         Align = TextAnchor.MiddleCenter, Color = textColor, FadeIn = 0.2f },
                RectTransform = { AnchorMin = "0.02 0", AnchorMax = "0.98 1" },
                FadeOut = 0.5f
            }, panelName);

            CuiHelper.AddUi(player, c);

            timer.Once(duration, () => {
                if (player != null && player.IsConnected)
                    CuiHelper.DestroyUi(player, panelName);
            });
        }

        /// <summary>Adds pagination.</summary>
        public void AddPagination(CuiElementContainer container, string parent,
            int page, int totalPages, int totalItems, string cmdPrefix,
            float y = 0.04f, float h = 0.035f)
        {
            container.Add(new CuiLabel
            {
                Text = { Text = $"<color=#FF1493>{page + 1}</color> / {totalPages}  <color=#666666>({totalItems} items)</color>",
                         FontSize = 11, Align = TextAnchor.MiddleCenter, Color = C.Bone },
                RectTransform = { AnchorMin = $"0.40 {y}", AnchorMax = $"0.60 {y + h}" }
            }, parent);

            if (page > 0)
                container.Add(new CuiButton
                {
                    Button = { Command = $"{cmdPrefix} {page - 1}", Color = C.Smoke },
                    RectTransform = { AnchorMin = $"0.25 {y}", AnchorMax = $"0.38 {y + h}" },
                    Text = { Text = "<b>◄ PREV</b>", FontSize = 11, Align = TextAnchor.MiddleCenter, Color = C.Pink }
                }, parent);

            if (page < totalPages - 1)
                container.Add(new CuiButton
                {
                    Button = { Command = $"{cmdPrefix} {page + 1}", Color = C.Smoke },
                    RectTransform = { AnchorMin = $"0.62 {y}", AnchorMax = $"0.75 {y + h}" },
                    Text = { Text = "<b>NEXT ►</b>", FontSize = 11, Align = TextAnchor.MiddleCenter, Color = C.Pink }
                }, parent);
        }

        /// <summary>Destroys the full panel + backdrop.</summary>
        public static void DestroyPanel(BasePlayer player, string panelName)
        {
            CuiHelper.DestroyUi(player, panelName + ".Backdrop");
            CuiHelper.DestroyUi(player, panelName);
        }

        // ══════════════════════════════════════════════════════════════════
        //  SUPPORTING TYPES
        // ══════════════════════════════════════════════════════════════════

        public class SidebarEntry
        {
            public string Id, Label;
            public int FontSize;
            public SidebarEntry(string id, string label, int fontSize = 9) { Id = id; Label = label; FontSize = fontSize; }
        }

        // ══════════════════════════════════════════════════════════════════
        //  CROSS-PLUGIN API — other plugins call these via .Call()
        // ══════════════════════════════════════════════════════════════════

        // MisfitsUI?.Call<string>("API_GetPng", "panel_bg") → PNG ID or ""
        private string API_GetPng(string key)
        {
            if (_cachedPngs.TryGetValue(key, out var png)) return png;
            return "";
        }

        // MisfitsUI?.Call<string>("API_GetUrl", "panel_bg") → URL or ""
        private string API_GetUrl(string key)
        {
            if (_config.ImageUrls.TryGetValue(key, out var url) && !string.IsNullOrWhiteSpace(url)) return url;
            return "";
        }

        // MisfitsUI?.Call<bool>("API_HasImage", "panel_bg") → true if any source available
        private bool API_HasImage(string key) => HasImage(key);

        // MisfitsUI?.Call<bool>("API_IsReady") → true if images are cached
        private bool API_IsReady() => _imagesLoaded;

        // ══════════════════════════════════════════════════════════════════
        //  LIFECYCLE
        // ══════════════════════════════════════════════════════════════════

        private void Loaded() => Puts("MisfitsUI v2.0 — neon underground × skull punk — loaded.");

        private void Unload() => _cachedPngs.Clear();
    }
}
