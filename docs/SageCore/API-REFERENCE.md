# SageCore — API Reference

Complete function reference for the SageCore abstract contract. Functions are
grouped by visibility and purpose.

---

## Table of Contents

1. [External / Public — Asset Operations](#external--public--asset-operations)
2. [External / Public — Batch Operations](#external--public--batch-operations)
3. [External / Public — Transitions](#external--public--transitions)
4. [External / Public — Marketplace](#external--public--marketplace)
5. [External / Public — Inventory & Queries](#external--public--inventory--queries)
6. [External / Public — Configuration (Owner)](#external--public--configuration-owner)
7. [External / Public — Ownership](#external--public--ownership)
8. [Internal — Game API](#internal--game-api)
9. [Internal — Helpers](#internal--helpers)

---

## External / Public — Asset Operations

### `mintAsset(uint16 kind, uint8 flags, uint16 level, bytes32 payload) → uint256`

Mint a new asset to `msg.sender`. **Payable** — charges `mintFee`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `kind` | `uint16` | Asset type / category |
| `flags` | `uint8` | Initial flags (lock bit is stripped) |
| `level` | `uint16` | Initial level |
| `payload` | `bytes32` | Game-specific data |

**Returns**: `assetId` — the newly assigned ID.

**Reverts**:
- `InsufficientPayment()` — `msg.value < mintFee`
- `InventoryFull()` — caller's inventory is at capacity
- `AssetIdOverflow()` — 4 294 967 295 assets already minted

**Side effects**: Excess ETH above `mintFee` is credited to
`pendingWithdrawals[msg.sender]`.

---

### `mintTo(address to, uint16 kind, uint8 flags, uint16 level, bytes32 payload) → uint256`

**Owner only.** Mint an asset to an arbitrary address. No fee charged.

| Parameter | Type | Description |
|-----------|------|-------------|
| `to` | `address` | Recipient (must not be zero) |
| `kind` | `uint16` | Asset type |
| `flags` | `uint8` | Initial flags (lock bit stripped) |
| `level` | `uint16` | Initial level |
| `payload` | `bytes32` | Game-specific data |

**Reverts**: `NotContractOwner()`, `InvalidRecipient()`, `InventoryFull()`,
`AssetIdOverflow()`.

---

### `transferAsset(uint256 assetId, address to)`

Transfer an owned, unlocked asset to another address.

**Reverts**: `NotOwner()`, `AssetIsLocked()`, `ReceiverInventoryFull()`,
`InvalidRecipient()`, `AssetDoesNotExist(assetId)`.

---

### `burnAsset(uint256 assetId)`

Burn an owned, unlocked asset. Storage is hard-deleted.

**Reverts**: `NotOwner()`, `AssetIsLocked()`, `AssetDoesNotExist(assetId)`.

---

### `getAsset(uint256 assetId) → Asset memory`

Read-only. Returns a copy of the asset data.

**Reverts**: `AssetDoesNotExist(assetId)`.

---

## External / Public — Batch Operations

### `batchTransfer(uint256[] assetIds, address to)`

Transfer multiple assets to a single recipient in one transaction. Validate-
then-execute pattern (two-pass).

| Parameter | Type | Description |
|-----------|------|-------------|
| `assetIds` | `uint256[]` | Array of asset IDs (max `MAX_BATCH_SIZE = 20`) |
| `to` | `address` | Recipient address |

**Reverts**: `EmptyBatch()`, `BatchTooLarge()`, `DuplicateAssetId()`,
`NotOwner()`, `AssetIsLocked()`, `ReceiverInventoryFull()`,
`InvalidRecipient()`.

---

### `batchBurn(uint256[] assetIds)`

Burn multiple owned, unlocked assets atomically.

**Reverts**: Same as `batchTransfer` (minus recipient errors).

**Emits**: Individual `AssetBurned` events + a single `BatchBurn(assetIds)`.

---

## External / Public — Transitions

### `executeTransition(uint8 transitionId, uint256[] assetIds, bytes data)`

Execute a configured transition on a set of assets.

| Parameter | Type | Description |
|-----------|------|-------------|
| `transitionId` | `uint8` | ID of the transition to execute |
| `assetIds` | `uint256[]` | Assets to act on (1–5, per config) |
| `data` | `bytes` | Transition-specific payload |

**Execution flow**:
1. `_validateTransitionCommon()` — checks config, length, duplicates,
   ownership, lock requirements.
2. `_validateTransitionSpecific()` — per-transition validation (virtual).
3. `_applyTransition()` — apply effects (virtual).
4. Emit `TransitionExecuted`.

See [TRANSITIONS.md](TRANSITIONS.md) for transition details.

---

### `configureTransition(uint8 transitionId, bool enabled, bool requireAllUnlocked, bool requireAllLocked, uint8 maxAssets)`

**Owner only.** Create or update a transition's configuration.

**Reverts**: `MaxAssetsMustBePositive()`, `MaxAssetsTooLarge()`,
`InvalidLockConfig()`.

---

## External / Public — Marketplace

### `listAsset(uint256 assetId, uint256 price)`

List an owned, unlocked asset for sale. Locks the asset.

**Reverts**: `MarketplaceDisabled()`, `InvalidPrice()`, `NotOwner()`,
`AssetAlreadyListed()`, `AssetIsLocked()`, `PriceBelowMinimum()`.

### `cancelListing(uint256 assetId)`

Cancel a listing and unlock the asset. Works even when marketplace is disabled
(so users can always recover their assets).

**Reverts**: `AssetNotListed()`, `NotSeller()`, `OwnershipMismatch()`,
`AssetNotLocked()`.

### `buyAsset(uint256 assetId)` _(payable)_

Purchase a listed asset. Payment goes to `pendingWithdrawals[seller]`.

**Reverts**: `MarketplaceDisabled()`, `AssetNotListed()`,
`CannotBuyOwnAsset()`, `InsufficientPayment()`, `OwnershipMismatch()`,
`AssetNotLocked()`.

### `withdraw()`

Withdraw accumulated funds (sale proceeds + refunds).

**Reverts**: `NoWithdrawableFunds()`, `WithdrawalFailed()`.

### `getWithdrawableAmount(address account) → uint256`

View function — returns pending balance.

See [MARKETPLACE.md](MARKETPLACE.md) for detailed flows.

---

## External / Public — Inventory & Queries

| Function | Returns | Description |
|----------|---------|-------------|
| `getInventory(address)` | `uint32[]` | All asset IDs owned by the account |
| `getInventoryCount(address)` | `uint8` | Number of assets owned |
| `isLocked(uint256 assetId)` | `bool` | Whether the asset's lock flag is set |
| `getStorageTierCapacity(StorageTier)` | `uint16` | Capacity for a tier enum value |
| `getUpgradeCost(address)` | `uint256` | Wei cost for next tier upgrade (0 at max) |
| `checkInventoryConsistency(address)` | `bool` | Debug: validates inventory ↔ asset ownership |
| `checkAssetConsistency(uint256)` | `bool` | Debug: validates asset appears in owner's inventory |
| `userContext(address)` | `(StorageTier, bytes31)` | Account's tier + game payload |

---

## External / Public — Configuration (Owner)

All functions below are `onlyOwner`.

| Function | Description |
|----------|-------------|
| `setMaxAssetsPerTransitionGlobal(uint8)` | Set global cap (1–5) |
| `setMarketplaceEnabled(bool)` | Enable/disable marketplace |
| `setMinListingPrice(uint256)` | Set minimum listing price |
| `setMintFee(uint256)` | Set per-mint fee |
| `setTierUpgradeFees(uint256[3])` | Set `[Tier25→50, Tier50→75, Tier75→100]` fees |
| `collectFees()` | Withdraw accumulated `collectedFees` to owner |
| `configureTransition(...)` | Create/update transition config |

See [FEE-SYSTEM.md](FEE-SYSTEM.md) and [ACCESS-CONTROL.md](ACCESS-CONTROL.md).

---

## Internal — Game API

These functions are `internal` — only accessible to contracts inheriting
SageCore.

### `_mintAsset(address to, uint16 kind, uint8 flags, uint16 level, bytes32 payload) → uint256`

Mint to a specific address. No fee charged.

### `_mintAsset(uint16 kind, uint8 flags, uint16 level, bytes32 payload) → uint256`

Mint to `msg.sender`. Overloaded convenience.

### `_mintAssetTo(address to, uint16 kind, uint8 flags, uint16 level, bytes32 payload) → uint256`

Alias for `_mintAsset(to, ...)`, named for Step 1 API clarity.

### `_burnAsset(uint256 assetId)`

Burn an asset. Does **not** check `msg.sender` ownership — the game contract
is responsible for access control.

### `_batchBurnAssets(uint256[] memory assetIds)`

Batch version of `_burnAsset`. Emits individual `AssetBurned` events plus
`BatchBurn`.

### `_updateAssetData(uint256 assetId, bytes32 payload, uint16 level)`

Overwrite an asset's `payload` and `level`. Emits `AssetDataUpdated`.

### `_lockAsset(uint256 assetId)`

Set the lock flag. Reverts `AssetAlreadyLocked()`.

### `_unlockAsset(uint256 assetId)`

Clear the lock flag. Reverts `AssetNotLocked()`.

### `_transferAssetFrom(address from, address to, uint256 assetId)`

Transfer logic shared by external transfer, marketplace, and batch.

### `_getAsset(uint256 assetId) → Asset storage`

Returns a storage reference to an existing asset. Reverts
`AssetDoesNotExist()`.

### `_updateUserPayload(address user, bytes31 payload)`

Set the game-specific bytes31 in `userContext`.

---

## Internal — Helpers

| Function | Description |
|----------|-------------|
| `_getExistingAsset(uint256)` | Returns storage ref; reverts if `owner == 0` |
| `_mintAssetInternal(...)` | Core mint implementation (all paths call this) |
| `_removeFromInventory(Inventory, uint256)` | Swap-and-pop removal |
| `_getMaxSlots(address)` | Returns capacity for account's tier |
| `_tierCapacity(StorageTier)` | Pure: tier enum → uint16 capacity |
| `_isLocked(Asset storage)` | `(flags & FLAG_LOCKED) != 0` |
| `_isAssetInInventory(address, uint256)` | Linear scan check |
| `_checkInventoryConsistency(address)` | Validates all slots point to valid owned assets |
| `_checkAssetConsistency(uint256)` | Validates asset appears in owner's inventory |
| `_validateTransitionCommon(uint8, uint256[])` | Config + ownership + lock checks |
| `_validateTransitionSpecific(uint8, uint256[], bytes)` | Virtual — per-transition validation |
| `_applyTransition(uint8, uint256[], bytes)` | Virtual — per-transition effects |
