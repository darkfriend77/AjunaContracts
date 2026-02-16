# SageCore — Marketplace

The marketplace allows asset owners to list, sell, and buy assets at fixed
prices. It uses a **lock-on-list** pattern (listed assets are locked to prevent
transfer/burn) and **pull-payment** withdrawals for safe fund handling.

---

## Table of Contents

1. [Overview](#overview)
2. [Listing Flow](#listing-flow)
3. [Buying Flow](#buying-flow)
4. [Cancellation](#cancellation)
5. [Withdrawal](#withdrawal)
6. [Configuration](#configuration)
7. [Security Design](#security-design)
8. [Examples](#examples)

---

## Overview

```
Seller                     Contract                    Buyer
  │                           │                          │
  │── listAsset(id, price) ──►│                          │
  │   [asset locked]          │                          │
  │                           │◄── buyAsset(id){value} ──│
  │                           │    [listing cleared]     │
  │                           │    [asset unlocked]      │
  │                           │    [asset → buyer]       │
  │                           │    [price → seller PW]   │
  │                           │    [excess → buyer PW]   │
  │                           │                          │
  │── withdraw() ────────────►│                          │
  │   [ETH sent to seller]    │                          │
```

**PW** = `pendingWithdrawals` (pull-payment balance).

---

## Listing Flow

### `listAsset(uint256 assetId, uint256 price)`

| Step | Action |
|------|--------|
| 1 | Check `marketplaceEnabled` |
| 2 | Check `price > 0` |
| 3 | Verify `msg.sender` owns the asset |
| 4 | Verify asset is **not** already listed |
| 5 | Verify asset is **not** locked |
| 6 | Verify `price >= minListingPrice` |
| 7 | Lock the asset (`_lockAsset`) |
| 8 | Store `Listing{ seller, price }` |
| 9 | Emit `AssetListed(assetId, seller, price)` |

**Reverts**:

| Error | Condition |
|-------|-----------|
| `MarketplaceDisabled()` | Marketplace is turned off |
| `InvalidPrice()` | `price == 0` |
| `NotOwner()` | Caller doesn't own the asset |
| `AssetAlreadyListed()` | Listing already exists |
| `AssetIsLocked()` | Asset is already locked (e.g. by game) |
| `PriceBelowMinimum()` | `price < minListingPrice` |

**Modifier**: `nonReentrant`.

---

## Buying Flow

### `buyAsset(uint256 assetId)` _(payable)_

| Step | Action |
|------|--------|
| 1 | Check `marketplaceEnabled` |
| 2 | Verify listing exists |
| 3 | Verify buyer ≠ seller |
| 4 | Verify `msg.value >= listing.price` |
| 5 | Verify asset ownership matches seller |
| 6 | Verify asset is locked |
| 7 | **Delete listing** (CEI pattern) |
| 8 | Unlock the asset |
| 9 | Transfer asset from seller to buyer |
| 10 | Credit `price` to `pendingWithdrawals[seller]` |
| 11 | Credit excess to `pendingWithdrawals[buyer]` |
| 12 | Emit `AssetSold(assetId, seller, buyer, price)` |

**Reverts**:

| Error | Condition |
|-------|-----------|
| `MarketplaceDisabled()` | Marketplace is turned off |
| `AssetNotListed()` | No listing for this asset |
| `CannotBuyOwnAsset()` | Buyer is the seller |
| `InsufficientPayment()` | `msg.value < price` |
| `OwnershipMismatch()` | Asset owner doesn't match listing seller |
| `AssetNotLocked()` | Asset was unexpectedly unlocked |

**Modifier**: `nonReentrant`.

---

## Cancellation

### `cancelListing(uint256 assetId)`

Cancels a listing and **unlocks** the asset.

> **Note**: `cancelListing` intentionally does **not** check
> `marketplaceEnabled`. This ensures users can always recover their locked
> assets even if the owner disables the marketplace.

| Step | Action |
|------|--------|
| 1 | Verify listing exists |
| 2 | Verify caller is the seller |
| 3 | Verify asset ownership matches listing |
| 4 | Verify asset is locked |
| 5 | Unlock the asset |
| 6 | Delete the listing |
| 7 | Emit `AssetDelisted(assetId, seller)` |

**Modifier**: `nonReentrant`.

---

## Withdrawal

### `withdraw()`

Withdraws the caller's full `pendingWithdrawals` balance.

```
1. amount = pendingWithdrawals[msg.sender]
2. if (amount == 0) revert NoWithdrawableFunds()
3. pendingWithdrawals[msg.sender] = 0     ← CEI: clear before call
4. (success,) = msg.sender.call{value: amount}("")
5. if (!success) revert WithdrawalFailed()
6. emit WithdrawalCompleted(msg.sender, amount)
```

**Modifier**: `nonReentrant`.

### `getWithdrawableAmount(address account) → uint256`

View function returning the current pending balance.

---

## Configuration

| Function | Description | Default |
|----------|-------------|---------|
| `setMarketplaceEnabled(bool)` | Enable/disable all listing + buying | `true` |
| `setMinListingPrice(uint256)` | Floor price for listings | `0` |

Both are **owner-only**.

---

## Security Design

### Pull-payment pattern

Funds are **never** pushed to the seller during `buyAsset`. Instead they are
credited to `pendingWithdrawals` and the seller calls `withdraw()` later.
This prevents:
- **Reentrancy attacks** from malicious fallback functions.
- **Denial-of-service** where a reverting recipient blocks the entire sale.

### Lock-on-list

When an asset is listed, it is automatically locked (`FLAG_LOCKED`). This
prevents the seller from transferring, burning, or using the asset in a
transition that requires unlocked assets while it is for sale.

### CEI pattern

All state-changing marketplace functions follow
Checks → Effects → Interactions ordering. The listing is deleted and the
asset unlocked **before** any external calls or balance credits.

### `nonReentrant`

All marketplace functions (`listAsset`, `cancelListing`, `buyAsset`,
`withdraw`) use OpenZeppelin's `nonReentrant` modifier.

### Cancel always available

`cancelListing` does not check `marketplaceEnabled`, ensuring users can
always unlock/recover their assets.

---

## Examples

### List and buy (TypeScript / ethers v6)

```typescript
import { ethers } from "hardhat";

// Seller lists asset 1 for 0.5 ETH
await contract.connect(seller).listAsset(1, ethers.parseEther("0.5"));

// Buyer purchases asset 1
await contract.connect(buyer).buyAsset(1, {
    value: ethers.parseEther("0.5"),
});

// Seller withdraws proceeds
await contract.connect(seller).withdraw();
```

### Cancel listing

```typescript
await contract.connect(seller).cancelListing(1);
// Asset 1 is now unlocked and can be transferred/used again
```

### Overpayment refund

```typescript
// Pay 1 ETH for a 0.5 ETH listing
await contract.connect(buyer).buyAsset(1, {
    value: ethers.parseEther("1.0"),
});

// 0.5 ETH from excess is in buyer's pending withdrawals
const refund = await contract.getWithdrawableAmount(buyer.address);
// refund == 0.5 ETH

await contract.connect(buyer).withdraw();
```
