# SageCore — Data Model

This document describes every data structure used by SageCore.

---

## Table of Contents

1. [Asset](#asset)
2. [Inventory](#inventory)
3. [Storage Tiers](#storage-tiers)
4. [UserContext](#usercontext)
5. [TransitionConfig](#transitionconfig)
6. [Listing](#listing)

---

## Asset

Each asset occupies **two EVM storage slots** (64 bytes total).

### Struct definition

```solidity
struct Asset {
    // Slot 0 — SAGE core (32 bytes)
    address owner;      // 20 bytes — current owner
    uint8   flags;      // 1 byte  — bitfield (bit 0 = locked)
    uint16  kind;       // 2 bytes — asset type / category
    uint16  level;      // 2 bytes — level or rarity
    uint32  reserved0;  // 4 bytes — reserved for future core use
    uint16  reserved1;  // 2 bytes — reserved
    uint8   reserved2;  // 1 byte  — reserved
    // Total: 20 + 1 + 2 + 2 + 4 + 2 + 1 = 32 bytes

    // Slot 1 — Game payload (opaque to core)
    bytes32 payload;    // 32 bytes — DNA, stats, etc.
}
```

### Slot 0 — Core metadata

| Field | Size | Description |
|-------|------|-------------|
| `owner` | 20 B | Address that owns this asset. Zero address means the asset does not exist (has been burned or was never minted). |
| `flags` | 1 B | Bitfield. Only bit 0 is defined by the engine (`FLAG_LOCKED = 0x01`). Bits 1-7 are available for game use via the `SET_FLAGS` transition. The engine strips the lock bit when minting (`flags &= ~FLAG_LOCKED`). |
| `kind` | 2 B | Application-defined asset type (0–65 535). Semantics are up to the game. |
| `level` | 2 B | Generic level / rarity field (0–65 535). Incremented by the `INCREMENT_LEVEL` transition. |
| `reserved0` | 4 B | Reserved — always 0. |
| `reserved1` | 2 B | Reserved — always 0. |
| `reserved2` | 1 B | Reserved — always 0. |

### Slot 1 — Game payload

| Field | Size | Description |
|-------|------|-------------|
| `payload` | 32 B | Entirely opaque to the engine. Game contracts pack DNA, stats, cooldown timers, etc. into this field. Updated via `_updateAssetData()`. |

### Asset lifecycle

```
 mintAsset() / mintTo() / _mintAssetTo()
         │
         ▼
    ┌──────────┐    transferAsset()     ┌──────────┐
    │  ACTIVE  │ ──────────────────►    │  ACTIVE  │
    │ (owner A)│ ◄──────────────────    │ (owner B)│
    └────┬─────┘                        └──────────┘
         │
         │ listAsset()        ┌──────────────┐
         ├───────────────►    │ LISTED+LOCKED│
         │                    │  (locked)    │
         │                    └──┬───────────┘
         │    cancelListing()    │    buyAsset()
         │◄──────────────────────┤───────────────►  new owner (active)
         │
         │ burnAsset() / _burnAsset()
         ▼
    ┌──────────┐
    │  BURNED  │  (storage deleted)
    └──────────┘
```

### Flags detail

| Bit | Mask | Name | Managed by |
|-----|------|------|------------|
| 0 | `0x01` | `FLAG_LOCKED` | Engine only — `_lockAsset()` / `_unlockAsset()`. Cannot be set through minting or `SET_FLAGS`. |
| 1-7 | `0x02–0x80` | Game-defined | Set/cleared via `TRANSITION_SET_FLAGS`. |

---

## Inventory

```solidity
struct Inventory {
    uint32[] slots;  // dynamic array of asset IDs
}
```

Each account has a single `Inventory`. Asset IDs are stored as `uint32` values
in a dynamic Solidity array.

### Operations

| Operation | Gas complexity | Method |
|-----------|---------------|--------|
| **Add** | O(1) amortized | `slots.push(assetId)` |
| **Remove** | O(n) find + O(1) swap-and-pop | `_removeFromInventory()` |
| **Count** | O(1) | `slots.length` |
| **Capacity check** | O(1) | `slots.length < _getMaxSlots(account)` |

> **Swap-and-pop**: When an asset is removed, the last element in the array is
> moved into the vacated position and `pop()` is called. This avoids shifting
> the entire array but does **not** preserve ordering.

### Maximum capacity

Capacity is determined by the account's `StorageTier` (see below). The default
tier is `Tier25` (25 slots). Attempting to add an asset beyond capacity
reverts with `InventoryFull()` or `ReceiverInventoryFull()`.

---

## Storage Tiers

```solidity
enum StorageTier {
    Tier25,   // 0 — 25 slots (default)
    Tier50,   // 1 — 50 slots
    Tier75,   // 2 — 75 slots
    Tier100   // 3 — 100 slots (maximum)
}
```

| Tier | Enum value | Capacity | Default upgrade cost |
|------|-----------|----------|---------------------|
| Tier25 | 0 | 25 | — (starting tier) |
| Tier50 | 1 | 50 | 0.01 ETH |
| Tier75 | 2 | 75 | 0.025 ETH |
| Tier100 | 3 | 100 | 0.05 ETH |

Upgrade costs are **configurable** by the owner via `setTierUpgradeFees()`.

### Upgrade flow

```
User calls upgradeStorageTier{ value: cost }()
  │
  ├─ Already Tier100? → revert AlreadyAtMaxTier()
  ├─ msg.value < cost? → revert InsufficientPayment()
  │
  ├─ collectedFees += cost
  ├─ userContext[msg.sender].tier = newTier
  ├─ Excess value → pendingWithdrawals (pull-payment refund)
  │
  └─ emit StorageTierUpgraded(account, newTier, newCapacity)
```

### Querying

| Function | Returns |
|----------|---------|
| `getStorageTierCapacity(tier)` | Capacity for a given `StorageTier` enum value |
| `getUpgradeCost(account)` | Wei cost for the account's next tier (0 if already max) |
| `userContext(account)` | Returns `StorageTier` and `bytes31` game payload |

---

## UserContext

```solidity
struct UserContext {
    StorageTier tier;     // 1 byte
    bytes31     payload;  // 31 bytes — game-specific
}
```

Packed into a single 32-byte storage slot per account.

| Field | Description |
|-------|-------------|
| `tier` | The account's current storage tier. Governs inventory capacity. |
| `payload` | Opaque 31 bytes for game-specific per-user data (profiles, progression, cooldowns, etc.). Updated by child contracts via `_updateUserPayload(user, payload)`. |

---

## TransitionConfig

```solidity
struct TransitionConfig {
    bool  enabled;              // transition can be used
    bool  requireAllUnlocked;   // all assets must NOT be locked
    bool  requireAllLocked;     // all assets must be locked
    uint8 maxAssets;            // per-call asset cap (≤ 5)
}
```

Stored in `transitionConfigs[transitionId]`.

### Default configurations

| Transition ID | Name | enabled | requireAllUnlocked | requireAllLocked | maxAssets |
|--------------|------|---------|-------------------|-----------------|----------|
| 1 | NOOP | ✅ | ❌ | ❌ | 5 |
| 2 | INCREMENT_LEVEL | ✅ | ✅ | ❌ | 5 |
| 3 | SET_FLAGS | ✅ | ✅ | ❌ | 5 |

> `requireAllUnlocked` and `requireAllLocked` are mutually exclusive — setting
> both reverts with `InvalidLockConfig()`.

---

## Listing

```solidity
struct Listing {
    address seller;  // address that listed the asset
    uint256 price;   // price in wei
}
```

A listing is active when `seller != address(0)`. See
[MARKETPLACE.md](MARKETPLACE.md) for the full workflow.
