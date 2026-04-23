// File: /oxide/plugins/CompostSplitter.cs
using System;
using System.Collections.Generic;
using UnityEngine;
using Oxide.Core;

namespace Oxide.Plugins
{
    [Info("CompostSplitter", "xADROCx", "1.6.4")]
    [Description("Splits compostables evenly across open slots. Blocks when full. Persists composter stack layout across restarts.")]
    public class CompostSplitter : RustPlugin
    {
        private const string PermUse = "compostsplitter.use";
        private const string DataFileName = "CompostSplitter/composters";

        private readonly HashSet<ulong> _activeLooters = new HashSet<ulong>();
        private readonly HashSet<ulong> _busy = new HashSet<ulong>();
        private readonly HashSet<ulong> _restoring = new HashSet<ulong>();

        private class SaveData
        {
            public Dictionary<string, ComposterState> Composters = new Dictionary<string, ComposterState>();
        }

        private class ComposterState
        {
            public string Prefab;
            public string ItemShortname;
            public int Capacity;
            public List<int> SlotAmounts;
            public ulong OwnerId;
        }

        private SaveData _data;
        private bool _saveDirty;

        private void Init()
        {
            permission.RegisterPermission(PermUse, this);
            LoadData();
        }

        private void Unload()
        {
            _restoring.Clear();
            SaveDataNow();
        }

        private void OnServerSave()
        {
            if (_saveDirty)
                SaveDataNow();
        }

        private void OnServerInitialized()
        {
            timer.Once(8f, RestoreAllKnownComposters);
        }

        private void OnLootEntity(BasePlayer player, BaseEntity entity)
        {
            var comp = entity as StorageContainer;
            if (comp == null || comp.net == null) return;
            if (!IsComposter(comp)) return;
            if (!permission.UserHasPermission(player.UserIDString, PermUse)) return;

            _activeLooters.Add(NetId(comp));
        }

        private void OnLootEntityEnd(BasePlayer player, BaseEntity entity)
        {
            var comp = entity as StorageContainer;
            if (comp == null || comp.net == null) return;

            var id = NetId(comp);
            _activeLooters.Remove(id);
            _busy.Remove(id);
        }

        private void OnEntityKill(BaseNetworkable ent)
        {
            var comp = ent as StorageContainer;
            if (comp == null || comp.net == null) return;

            var id = NetId(comp);
            _activeLooters.Remove(id);
            _busy.Remove(id);
            if (IsComposter(comp))
                RemoveSaved(comp);
        }

        private void OnEntitySpawned(BaseNetworkable ent)
        {
            var comp = ent as StorageContainer;
            if (comp == null || comp.net == null) return;
            if (!IsComposter(comp)) return;

            timer.Once(2f, () => TryRestore(comp));
        }

        private object CanAcceptItem(ItemContainer container, Item item)
        {
            var comp = container?.entityOwner as StorageContainer;
            if (comp == null || comp.net == null) return null;
            if (!IsComposter(comp)) return null;
            if (!_activeLooters.Contains(NetId(comp))) return null;
            if (!IsCompostable(item.info)) return null;

            int empty = 0;
            for (int i = 0; i < container.capacity; i++)
                if (container.GetSlot(i) == null) empty++;

            return empty > 0 ? null : (object)false;
        }

        private void OnItemAddedToContainer(ItemContainer container, Item item)
        {
            var comp = container?.entityOwner as StorageContainer;
            if (comp == null || comp.net == null) return;
            if (!IsComposter(comp)) return;
            if (!_activeLooters.Contains(NetId(comp))) return;
            if (!IsCompostable(item.info)) return;

            var id = NetId(comp);
            if (_busy.Contains(id)) return;

            _busy.Add(id);
            SplitEvenly(container, item.info, comp);
            _busy.Remove(id);
        }

        private static bool IsCompostable(ItemDefinition def)
        {
            if (def == null) return false;
            string sn = def.shortname;
            return sn == "horsedung" || sn == "plantfiber" || sn == "food.scraps" || sn == "horsepoo" ||
                   def.GetComponent<ItemModCompostable>() != null;
        }

        private void SplitEvenly(ItemContainer container, ItemDefinition def, StorageContainer comp)
        {
            int cap = container.capacity;
            if (cap <= 0 || def.stackable <= 1) return;

            var existingOfType = new List<Item>();
            var emptySlots = new List<int>();
            int total = 0;

            for (int i = 0; i < cap; i++)
            {
                var it = container.GetSlot(i);
                if (it == null)
                {
                    emptySlots.Add(i);
                    continue;
                }
                if (it.info.shortname == def.shortname)
                {
                    existingOfType.Add(it);
                    total += it.amount;
                }
            }

            if (total == 0 || emptySlots.Count == 0) return;

            int openSlots = emptySlots.Count;
            int perSlot = total / openSlots;
            int extra = total % openSlots;

            foreach (var it in existingOfType) it.Remove();

            var slotAmounts = new int[cap];
            for (int i = 0; i < openSlots; i++)
            {
                int amt = perSlot + (i < extra ? 1 : 0);
                if (amt <= 0) continue;

                var newItem = ItemManager.Create(def, amt);
                if (newItem == null) continue;

                int slotIndex = emptySlots[i];
                newItem.MoveToContainer(container, slotIndex);
                slotAmounts[slotIndex] = amt;
            }

            container.MarkDirty();

            RecordState(comp, def, cap, slotAmounts);
            _saveDirty = true;
        }

        private void RecordState(StorageContainer comp, ItemDefinition def, int capacity, int[] slotAmounts)
        {
            var key = MakeKey(comp);
            if (_data == null) _data = new SaveData();
            if (_data.Composters == null) _data.Composters = new Dictionary<string, ComposterState>();

            var slotList = new List<int>(slotAmounts.Length);
            for (int i = 0; i < slotAmounts.Length; i++)
                slotList.Add(slotAmounts[i]);

            _data.Composters[key] = new ComposterState
            {
                Prefab = comp.ShortPrefabName,
                ItemShortname = def.shortname,
                Capacity = capacity,
                SlotAmounts = slotList,
                OwnerId = comp.OwnerID
            };
        }

        private void RemoveSaved(StorageContainer comp)
        {
            if (_data?.Composters == null) return;
            var key = MakeKey(comp);
            if (_data.Composters.Remove(key))
                _saveDirty = true;
        }

        private void RestoreAllKnownComposters()
        {
            foreach (var bn in BaseNetworkable.serverEntities)
            {
                var comp = bn as StorageContainer;
                if (comp == null || comp.net == null) continue;
                if (!IsComposter(comp)) continue;
                TryRestore(comp);
            }
        }

        private void TryRestore(StorageContainer comp)
        {
            if (comp == null || comp.inventory == null || comp.net == null) return;
            if (_data?.Composters == null) return;

            var key = MakeKey(comp);
            if (!_data.Composters.TryGetValue(key, out var state)) return;
            if (state == null) return;
            if (state.Prefab != comp.ShortPrefabName) return;
            if (state.Capacity != comp.inventory.capacity) return;
            if (state.SlotAmounts == null || state.SlotAmounts.Count != comp.inventory.capacity) return;

            var def = ItemManager.FindItemDefinition(state.ItemShortname);
            if (def == null) return;

            int wantedTotal = 0;
            for (int i = 0; i < state.SlotAmounts.Count; i++)
                wantedTotal += state.SlotAmounts[i];

            int haveTotal = 0;
            for (int i = 0; i < comp.inventory.capacity; i++)
            {
                var it = comp.inventory.GetSlot(i);
                if (it != null && it.info != null && it.info.shortname == state.ItemShortname)
                    haveTotal += it.amount;
            }
            if (haveTotal <= 0) return;
            if (haveTotal != wantedTotal) return;

            for (int i = 0; i < comp.inventory.capacity; i++)
            {
                if (state.SlotAmounts[i] <= 0) continue;
                var slotItem = comp.inventory.GetSlot(i);
                if (slotItem != null && slotItem.info.shortname != state.ItemShortname)
                    return;
            }

            var id = NetId(comp);
            if (_restoring.Contains(id)) return;

            _restoring.Add(id);
            try
            {
                var toRemove = new List<Item>();
                for (int i = 0; i < comp.inventory.capacity; i++)
                {
                    var it = comp.inventory.GetSlot(i);
                    if (it != null && it.info.shortname == state.ItemShortname)
                        toRemove.Add(it);
                }
                foreach (var it in toRemove) it.Remove();

                for (int i = 0; i < comp.inventory.capacity; i++)
                {
                    int amt = state.SlotAmounts[i];
                    if (amt <= 0) continue;
                    var newItem = ItemManager.Create(def, amt);
                    if (newItem == null) continue;
                    newItem.MoveToContainer(comp.inventory, i);
                }

                comp.inventory.MarkDirty();
            }
            finally
            {
                _restoring.Remove(id);
            }
        }

        private string MakeKey(StorageContainer comp)
        {
            var p = comp.transform.position;
            int xi = Mathf.RoundToInt(p.x * 10f);
            int yi = Mathf.RoundToInt(p.y * 10f);
            int zi = Mathf.RoundToInt(p.z * 10f);
            return $"{comp.ShortPrefabName}@{xi},{yi},{zi}#{comp.OwnerID}";
        }

        private static ulong NetId(StorageContainer comp) =>
            comp != null && comp.net != null ? comp.net.ID.Value : 0UL;

        private bool IsComposter(StorageContainer comp) =>
            comp.ShortPrefabName != null && comp.ShortPrefabName.Contains("composter");

        private void LoadData()
        {
            try
            {
                _data = Interface.Oxide.DataFileSystem.ReadObject<SaveData>(DataFileName) ?? new SaveData();
                if (_data.Composters == null) _data.Composters = new Dictionary<string, ComposterState>();
            }
            catch
            {
                _data = new SaveData();
            }
        }

        private void SaveDataNow()
        {
            _saveDirty = false;
            try
            {
                Interface.Oxide.DataFileSystem.WriteObject(DataFileName, _data);
            }
            catch (Exception ex)
            {
                PrintError($"[CompostSplitter] Failed to save data: {ex.GetType().Name}: {ex.Message}");
            }
        }
    }
}
