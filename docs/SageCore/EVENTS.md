# SageCore — Events

Complete catalogue of all events emitted by SageCore.

---

## Asset Lifecycle

| Event | Parameters | Emitted by |
|-------|-----------|------------|
| `AssetMinted` | `uint256 indexed assetId, address indexed owner, uint16 kind` | `_mintAssetInternal` |
| `AssetTransferred` | `uint256 indexed assetId, address indexed from, address indexed to` | `_transferAssetFrom` |
| `AssetBurned` | `uint256 indexed assetId, address indexed owner` | `_burnAsset` |
| `AssetLocked` | `uint256 indexed assetId, address indexed owner` | `_lockAsset` |
| `AssetUnlocked` | `uint256 indexed assetId, address indexed owner` | `_unlockAsset` |

---

## Game Internal API

| Event | Parameters | Emitted by |
|-------|-----------|------------|
| `AssetDataUpdated` | `uint256 indexed assetId, bytes32 payload, uint16 level` | `_updateAssetData` |
| `BatchBurn` | `uint256[] assetIds` | `_batchBurnAssets`, `batchBurn` |

---

## Inventory & Storage

| Event | Parameters | Emitted by |
|-------|-----------|------------|
| `InventoryUpgraded` | `address indexed account, uint256 additionalSlots, uint256 cost` | _(legacy, defined but not currently emitted)_ |
| `StorageTierUpgraded` | `address indexed account, StorageTier newTier, uint16 newCapacity` | `upgradeStorageTier` |

---

## Transitions

| Event | Parameters | Emitted by |
|-------|-----------|------------|
| `TransitionConfigured` | `uint8 indexed transitionId, bool enabled, bool requireAllUnlocked, bool requireAllLocked, uint8 maxAssets` | `configureTransition` |
| `TransitionExecuted` | `uint8 indexed transitionId, address indexed caller, uint256[] assetIds` | `executeTransition` |

---

## Marketplace

| Event | Parameters | Emitted by |
|-------|-----------|------------|
| `AssetListed` | `uint256 indexed assetId, address indexed seller, uint256 price` | `listAsset` |
| `AssetDelisted` | `uint256 indexed assetId, address indexed seller` | `cancelListing` |
| `AssetSold` | `uint256 indexed assetId, address indexed seller, address indexed buyer, uint256 price` | `buyAsset` |

---

## Pull-Payment

| Event | Parameters | Emitted by |
|-------|-----------|------------|
| `WithdrawalDeposited` | `address indexed recipient, uint256 amount` | `buyAsset`, `mintAsset`, `upgradeStorageTier` |
| `WithdrawalCompleted` | `address indexed recipient, uint256 amount` | `withdraw` |

---

## Ownership

| Event | Parameters | Emitted by |
|-------|-----------|------------|
| `OwnershipTransferred` | `address indexed previousOwner, address indexed newOwner` | `constructor`, `transferOwnership`, `renounceOwnership` |

---

## Configuration

| Event | Parameters | Emitted by |
|-------|-----------|------------|
| `MaxAssetsPerTransitionChanged` | `uint8 oldMax, uint8 newMax` | `setMaxAssetsPerTransitionGlobal` |
| `MarketplaceEnabledChanged` | `bool enabled` | `setMarketplaceEnabled` |
| `MinListingPriceChanged` | `uint256 oldPrice, uint256 newPrice` | `setMinListingPrice` |
| `MintFeeChanged` | `uint256 oldFee, uint256 newFee` | `setMintFee` |
| `TierUpgradeFeesChanged` | `uint256[3] oldFees, uint256[3] newFees` | `setTierUpgradeFees` |
| `FeesCollected` | `address indexed recipient, uint256 amount` | `collectFees` |

---

## Indexed Parameters

The following parameters are `indexed` and can be used as topic filters in
`eth_getLogs`:

| Event | Indexed fields |
|-------|---------------|
| `AssetMinted` | `assetId`, `owner` |
| `AssetTransferred` | `assetId`, `from`, `to` |
| `AssetBurned` | `assetId`, `owner` |
| `AssetLocked` | `assetId`, `owner` |
| `AssetUnlocked` | `assetId`, `owner` |
| `AssetDataUpdated` | `assetId` |
| `AssetListed` | `assetId`, `seller` |
| `AssetDelisted` | `assetId`, `seller` |
| `AssetSold` | `assetId`, `seller`, `buyer` |
| `TransitionConfigured` | `transitionId` |
| `TransitionExecuted` | `transitionId`, `caller` |
| `OwnershipTransferred` | `previousOwner`, `newOwner` |
| `InventoryUpgraded` | `account` |
| `StorageTierUpgraded` | `account` |
| `WithdrawalDeposited` | `recipient` |
| `WithdrawalCompleted` | `recipient` |
| `FeesCollected` | `recipient` |
