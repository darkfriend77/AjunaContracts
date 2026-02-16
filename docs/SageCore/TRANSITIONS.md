# SageCore — Transitions

Transitions are the primary mechanism for mutating assets. The engine provides
a generic pipeline and three built-in transition types, while game contracts
can add custom transitions by overriding two `virtual` functions.

---

## Table of Contents

1. [Pipeline Overview](#pipeline-overview)
2. [Common Validation](#common-validation)
3. [Built-in Transitions](#built-in-transitions)
4. [Custom Transitions](#custom-transitions)
5. [Configuration](#configuration)
6. [Examples](#examples)

---

## Pipeline Overview

```
executeTransition(transitionId, assetIds, data)
  │
  ├─ 1. _validateTransitionCommon(transitionId, assetIds)
  │      ├─ Is transition enabled?
  │      ├─ assetIds.length > 0 and ≤ config.maxAssets / global cap?
  │      ├─ No duplicate IDs?
  │      └─ For each asset: exists? owned by caller? lock state OK?
  │
  ├─ 2. _validateTransitionSpecific(transitionId, assetIds, data)  ← virtual
  │      └─ Per-transition checks (e.g. data length for SET_FLAGS)
  │
  ├─ 3. _applyTransition(transitionId, assetIds, data)             ← virtual
  │      └─ Per-transition mutations (e.g. increment level)
  │
  └─ 4. emit TransitionExecuted(transitionId, msg.sender, assetIds)
```

Steps 2 and 3 are `internal virtual`, so game contracts can `override` them
to add custom transitions or modify built-in behaviour.

---

## Common Validation

`_validateTransitionCommon` performs these checks for **every** transition:

| Check | Error |
|-------|-------|
| `transitionConfigs[id].enabled == true` | `TransitionDisabled()` |
| `assetIds.length > 0` | `NoAssets()` |
| `assetIds.length ≤ config.maxAssets` and `≤ maxAssetsPerTransitionGlobal` | `TooManyAssets()` |
| No duplicate IDs in `assetIds` (O(n²), n ≤ 5) | `DuplicateAssetId()` |
| Each asset exists | `AssetDoesNotExist(id)` |
| Each asset owned by `msg.sender` | `NotOwner()` |
| If `requireAllUnlocked`: none locked | `AssetIsLocked()` |
| If `requireAllLocked`: all locked | `AssetNotLocked()` |

---

## Built-in Transitions

### 1. NOOP (ID = 1)

Does nothing. Useful for testing the pipeline or as a heartbeat.

| Property | Value |
|----------|-------|
| Default config | enabled, any lock state, maxAssets = 5 |
| Data | Ignored |
| Effects | None |

---

### 2. INCREMENT_LEVEL (ID = 2)

Increments the `level` field of each asset by 1.

| Property | Value |
|----------|-------|
| Default config | enabled, requireAllUnlocked, maxAssets = 5 |
| Data | Ignored |
| Effects | `asset.level += 1` for each asset |
| Revert | `LevelAtMaximum()` if any asset is at `type(uint16).max` (65 535) |

---

### 3. SET_FLAGS (ID = 3)

Sets and/or clears flag bits on each asset. The lock bit (`bit 0`) is
**always stripped** from both masks — only the engine can control locking.

| Property | Value |
|----------|-------|
| Default config | enabled, requireAllUnlocked, maxAssets = 5 |
| Data layout | `byte 0` = set mask (OR), `byte 1` = clear mask (AND-NOT) — optional |
| Effects | `asset.flags = (asset.flags \| setBits) & ~clearBits` |
| Revert | `DataTooShort()` if `data.length < 1` |

#### Data encoding

```
data[0] = setBits    — bits to turn ON   (after stripping bit 0)
data[1] = clearBits  — bits to turn OFF  (after stripping bit 0, optional)
```

**Example**: Set bit 1 and clear bit 2:
```
data = 0x0204
       │  └─ clearBits = 0x04 (bit 2)
       └──── setBits   = 0x02 (bit 1)
```

If only 1 byte is provided, `clearBits` defaults to `0x00` (no bits cleared).

---

## Custom Transitions

### Step 1 — Register the transition

Call `configureTransition()` from the owner to register a new transition ID
(e.g. `4`):

```solidity
configureTransition(
    4,      // transitionId
    true,   // enabled
    true,   // requireAllUnlocked
    false,  // requireAllLocked
    3       // maxAssets
);
```

### Step 2 — Override validation (optional)

```solidity
function _validateTransitionSpecific(
    uint8 transitionId,
    uint256[] calldata assetIds,
    bytes calldata data
) internal pure override {
    if (transitionId == 4) {
        // Custom validation
        if (data.length < 4) revert DataTooShort();
        return;
    }
    // Fall back to built-in validation
    super._validateTransitionSpecific(transitionId, assetIds, data);
}
```

### Step 3 — Override application

```solidity
function _applyTransition(
    uint8 transitionId,
    uint256[] calldata assetIds,
    bytes calldata data
) internal override {
    if (transitionId == 4) {
        // Custom logic — e.g. combine two assets
        Asset storage a = _getAsset(assetIds[0]);
        Asset storage b = _getAsset(assetIds[1]);
        // ... mutation logic ...
        return;
    }
    // Fall back to built-in transitions
    super._applyTransition(transitionId, assetIds, data);
}
```

> **Important**: Always call `super._validateTransitionSpecific()` /
> `super._applyTransition()` for transition IDs you don't handle, so built-in
> transitions continue to work.

---

## Configuration

### `configureTransition(uint8 transitionId, bool enabled, bool requireAllUnlocked, bool requireAllLocked, uint8 maxAssets)`

**Owner only.** Creates or updates a transition's parameters.

| Constraint | Error |
|------------|-------|
| `maxAssets > 0` | `MaxAssetsMustBePositive()` |
| `maxAssets ≤ MAX_ASSETS_PER_TRANSITION (5)` | `MaxAssetsTooLarge()` |
| Not both `requireAllUnlocked` and `requireAllLocked` | `InvalidLockConfig()` |

Emits: `TransitionConfigured(transitionId, enabled, requireAllUnlocked, requireAllLocked, maxAssets)`.

### `setMaxAssetsPerTransitionGlobal(uint8 newMax)`

**Owner only.** Sets a global cap that applies on top of per-transition
`maxAssets`. Must be in `[1, 5]`.

---

## Examples

### Increment level (TypeScript)

```typescript
const assetIds = [1, 2, 3];
await contract.executeTransition(
    2,          // TRANSITION_INCREMENT_LEVEL
    assetIds,
    "0x"        // no data needed
);
```

### Set flags (TypeScript)

```typescript
// Set bit 1, clear bit 2
const data = ethers.concat([
    Uint8Array.from([0x02]),  // setBits
    Uint8Array.from([0x04])   // clearBits
]);
await contract.executeTransition(3, [assetId], data);
```

### NOOP (TypeScript)

```typescript
await contract.executeTransition(1, [assetId], "0x");
```
