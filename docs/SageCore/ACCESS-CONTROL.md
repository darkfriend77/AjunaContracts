# SageCore — Access Control

SageCore uses a single-owner access-control model. There are no roles or
multi-sig mechanisms — the `owner` address has exclusive access to all
administrative functions.

---

## Table of Contents

1. [Owner Management](#owner-management)
2. [Modifier](#modifier)
3. [Permissions Matrix](#permissions-matrix)
4. [Security Notes](#security-notes)

---

## Owner Management

### Initialization

The deployer (`msg.sender` in the constructor) is set as the initial owner.

```solidity
constructor() {
    owner = msg.sender;
    emit OwnershipTransferred(address(0), msg.sender);
}
```

### `transferOwnership(address newOwner)`

Transfer ownership to a new address. The new owner must not be `address(0)`
(use `renounceOwnership` for that).

**Reverts**: `NotContractOwner()`, `InvalidRecipient()`.

### `renounceOwnership()`

Irrevocably sets `owner = address(0)`. After this call, no address can execute
owner-only functions.

> **Warning**: Renouncing ownership is permanent. Fee collection, transition
> configuration, marketplace toggling, and admin minting will be permanently
> disabled.

---

## Modifier

```solidity
modifier onlyOwner() {
    if (msg.sender != owner) revert NotContractOwner();
    _;
}
```

All administrative functions are gated by `onlyOwner`.

---

## Permissions Matrix

### Owner-only functions

| Function | Purpose |
|----------|---------|
| `transferOwnership(address)` | Change owner |
| `renounceOwnership()` | Remove owner permanently |
| `configureTransition(...)` | Create/update transition configs |
| `setMaxAssetsPerTransitionGlobal(uint8)` | Set global transition asset cap |
| `setMarketplaceEnabled(bool)` | Enable/disable marketplace |
| `setMinListingPrice(uint256)` | Set minimum listing price |
| `setMintFee(uint256)` | Set per-mint fee |
| `setTierUpgradeFees(uint256[3])` | Set tier upgrade costs |
| `collectFees()` | Withdraw accumulated fees |
| `mintTo(address, ...)` | Admin mint (no fee) |

### Any user

| Function | Purpose |
|----------|---------|
| `mintAsset(...)` | Mint to self (charges `mintFee`) |
| `transferAsset(assetId, to)` | Transfer owned asset |
| `burnAsset(assetId)` | Burn owned asset |
| `batchTransfer(assetIds, to)` | Batch transfer |
| `batchBurn(assetIds)` | Batch burn |
| `executeTransition(...)` | Execute transition on owned assets |
| `listAsset(assetId, price)` | List asset on marketplace |
| `cancelListing(assetId)` | Cancel own listing |
| `buyAsset(assetId)` | Purchase listed asset |
| `withdraw()` | Withdraw pending balance |
| `upgradeStorageTier()` | Upgrade inventory tier |

### View functions (anyone)

| Function | Returns |
|----------|---------|
| `getAsset(assetId)` | Asset data |
| `getInventory(address)` | All asset IDs for account |
| `getInventoryCount(address)` | Count of assets |
| `isLocked(assetId)` | Lock status |
| `getStorageTierCapacity(tier)` | Slots for a tier |
| `getUpgradeCost(address)` | Cost for next tier |
| `getWithdrawableAmount(address)` | Pending withdrawal balance |
| `checkInventoryConsistency(address)` | Debug: inventory validity |
| `checkAssetConsistency(uint256)` | Debug: asset ↔ inventory |
| `owner` | Current owner address |
| `marketplaceEnabled` | Marketplace flag |
| `minListingPrice` | Current minimum price |
| `mintFee` | Current mint fee |
| `tierUpgradeFees(index)` | Individual tier fee |
| `collectedFees` | Uncollected fees |
| `maxAssetsPerTransitionGlobal` | Global transition cap |
| `transitionConfigs(id)` | Transition config |
| `listings(assetId)` | Listing details |
| `userContext(address)` | User tier + payload |
| `pendingWithdrawals(address)` | Pull-payment balance |

### Internal functions (child contracts only)

| Function | Purpose |
|----------|---------|
| `_mintAsset(...)` / `_mintAssetTo(...)` | Fee-free minting |
| `_burnAsset(assetId)` | Burn without ownership check |
| `_batchBurnAssets(assetIds)` | Batch burn (game logic) |
| `_lockAsset(assetId)` | Set lock flag |
| `_unlockAsset(assetId)` | Clear lock flag |
| `_updateAssetData(assetId, payload, level)` | Overwrite payload/level |
| `_transferAssetFrom(from, to, assetId)` | Internal transfer |
| `_getAsset(assetId)` | Get storage reference |
| `_updateUserPayload(user, payload)` | Set user context payload |

---

## Security Notes

1. **No multi-sig** — for production, consider wrapping the owner behind a
   Gnosis Safe or similar.
2. **Renounce is irreversible** — there is no mechanism to reclaim ownership.
3. **Owner can mint** — `mintTo` allows the owner to mint without any fee,
   which is useful for airdrops and game rewards but should be used carefully.
4. **Fee withdrawal** — `collectFees()` sends ETH to `owner`, so the owner
   address should be able to receive ETH (EOA or contract with `receive()`).
5. **Internal functions trust callers** — functions like `_burnAsset()` do not
   check `msg.sender` ownership. Child contracts must add their own
   access-control gates when exposing these externally.
