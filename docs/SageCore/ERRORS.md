# SageCore — Custom Errors

Complete reference of all custom errors defined in SageCore.

---

## Error Reference

### Asset Errors

| Error | Parameters | Trigger |
|-------|-----------|---------|
| `AssetDoesNotExist` | `uint256 assetId` | Accessing an asset whose `owner == address(0)` (never minted or burned) |
| `AssetIsLocked` | — | Attempting to transfer, burn, or use an asset in a transition that requires unlocked assets |
| `AssetAlreadyLocked` | — | Calling `_lockAsset()` on an already-locked asset |
| `AssetNotLocked` | — | Calling `_unlockAsset()` on an unlocked asset, or using in transition requiring locked assets |
| `AssetIdOverflow` | — | `_nextAssetId` would exceed `type(uint32).max` (4 294 967 295) |
| `AssetNotFoundInInventory` | — | `_removeFromInventory` cannot find the asset in the array (internal consistency error) |
| `LevelAtMaximum` | — | `INCREMENT_LEVEL` transition when `asset.level == 65535` |

### Ownership Errors

| Error | Parameters | Trigger |
|-------|-----------|---------|
| `NotOwner` | — | Caller does not own the asset they are trying to act on |
| `NotContractOwner` | — | Caller is not the contract `owner` (admin) |
| `OwnershipMismatch` | — | Asset's on-chain owner doesn't match listing seller during marketplace operations |

### Inventory Errors

| Error | Parameters | Trigger |
|-------|-----------|---------|
| `InventoryFull` | — | Minting to an account whose inventory is at capacity |
| `ReceiverInventoryFull` | — | Transferring to a recipient whose inventory is at capacity |
| `AlreadyAtMaxTier` | — | Calling `upgradeStorageTier()` when already at `Tier100` |

### Batch Errors

| Error | Parameters | Trigger |
|-------|-----------|---------|
| `EmptyBatch` | — | `batchTransfer` or `batchBurn` called with empty array |
| `BatchTooLarge` | — | Array length exceeds `MAX_BATCH_SIZE` (20) |
| `DuplicateAssetId` | — | Same asset ID appears more than once in batch or transition call |

### Transition Errors

| Error | Parameters | Trigger |
|-------|-----------|---------|
| `TransitionDisabled` | — | Transition config `enabled == false` |
| `NoAssets` | — | `executeTransition` with empty `assetIds` |
| `TooManyAssets` | — | `assetIds.length` exceeds per-transition or global cap |
| `DataTooShort` | — | `SET_FLAGS` with empty `data` (requires ≥ 1 byte) |
| `InvalidLockConfig` | — | Setting both `requireAllUnlocked` and `requireAllLocked` |
| `MaxAssetsMustBePositive` | — | `configureTransition` with `maxAssets == 0` |
| `MaxAssetsTooLarge` | — | `configureTransition` with `maxAssets > MAX_ASSETS_PER_TRANSITION` |
| `InvalidMaxAssetsPerTransition` | — | `setMaxAssetsPerTransitionGlobal` with 0 or > 5 |

### Marketplace Errors

| Error | Parameters | Trigger |
|-------|-----------|---------|
| `MarketplaceDisabled` | — | Listing or buying when `marketplaceEnabled == false` |
| `InvalidPrice` | — | Listing with `price == 0` |
| `PriceBelowMinimum` | — | Listing with `price < minListingPrice` |
| `AssetAlreadyListed` | — | Listing an asset that already has an active listing |
| `AssetNotListed` | — | Buying or cancelling a listing that doesn't exist |
| `NotSeller` | — | Cancelling a listing that belongs to another seller |
| `CannotBuyOwnAsset` | — | Buyer is the same address as the seller |
| `InsufficientPayment` | — | `msg.value < listing.price` or `msg.value < mintFee` |

### Recipient Errors

| Error | Parameters | Trigger |
|-------|-----------|---------|
| `InvalidRecipient` | — | Transfer or mint to `address(0)` |

### Withdrawal Errors

| Error | Parameters | Trigger |
|-------|-----------|---------|
| `NoWithdrawableFunds` | — | Calling `withdraw()` with zero balance |
| `WithdrawalFailed` | — | ETH transfer to recipient failed |

### Fee Errors

| Error | Parameters | Trigger |
|-------|-----------|---------|
| `NoFeesToCollect` | — | `collectFees()` when `collectedFees == 0` |
| `FeeCollectionFailed` | — | ETH transfer to owner during `collectFees()` failed |

---

## Error Selector Reference

Custom errors are ABI-encoded using a 4-byte selector. Below are the selectors
in case you need to decode raw revert data:

```
AssetDoesNotExist(uint256)     → 0x... (keccak256 first 4 bytes)
InventoryFull()                → bytes4(keccak256("InventoryFull()"))
NotOwner()                     → bytes4(keccak256("NotOwner()"))
...
```

Use `cast sig "ErrorName()"` (Foundry) or
`ethers.id("ErrorName()").slice(0, 10)` (ethers v6) to compute selectors.

---

## Gas Savings vs `require` Strings

Custom errors save gas compared to `require("string")`:
- **Deployment**: No string storage.
- **Revert**: Only 4 bytes selector + encoded parameters vs. entire string.

All SageCore errors follow this pattern for gas efficiency.
