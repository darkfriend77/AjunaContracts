# SageCore — Fee System

SageCore includes a configurable fee system for minting assets and upgrading
storage tiers. All fees accumulate in a `collectedFees` balance that the
contract owner can withdraw.

---

## Table of Contents

1. [Fee Sources](#fee-sources)
2. [Mint Fee](#mint-fee)
3. [Tier Upgrade Fees](#tier-upgrade-fees)
4. [Fee Collection](#fee-collection)
5. [Refund Handling](#refund-handling)
6. [Configuration Reference](#configuration-reference)

---

## Fee Sources

```
                ┌──────────────────┐
                │  collectedFees   │
                └───────┬──────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
   mintAsset()    upgradeStorageTier()  │
   (mintFee)      (tierUpgradeFees)    │
                                       │
                              collectFees() → owner
```

---

## Mint Fee

| Property | Default | Constraints |
|----------|---------|-------------|
| `mintFee` | `0` (free minting) | Any `uint256`, set by owner |

When a user calls `mintAsset()`, they must send at least `mintFee` wei.

```solidity
function mintAsset(...) external payable returns (uint256 assetId) {
    if (msg.value < mintFee) revert InsufficientPayment();
    collectedFees += mintFee;
    // ... mint logic ...
    // refund excess via pull-payment
}
```

**Key behaviour**:
- `mintTo()` (owner-only admin mint) is **free** — no fee charged.
- Internal `_mintAsset()` / `_mintAssetTo()` are also free — intended for
  game contract logic.
- Only the external `mintAsset()` charges a fee.

### Setting the mint fee

```solidity
// Owner sets mint fee to 0.001 ETH
contract.setMintFee(ethers.parseEther("0.001"));
```

Emits: `MintFeeChanged(oldFee, newFee)`.

---

## Tier Upgrade Fees

| Upgrade | Array index | Default |
|---------|-------------|---------|
| Tier25 → Tier50 | `tierUpgradeFees[0]` | 0.01 ETH |
| Tier50 → Tier75 | `tierUpgradeFees[1]` | 0.025 ETH |
| Tier75 → Tier100 | `tierUpgradeFees[2]` | 0.05 ETH |

When a user calls `upgradeStorageTier()`, they must send at least the fee for
their current-to-next tier transition.

```solidity
function upgradeStorageTier() external payable nonReentrant {
    // ... determine cost from tierUpgradeFees[currentTier] ...
    if (msg.value < cost) revert InsufficientPayment();
    collectedFees += cost;
    userContext[msg.sender].tier = newTier;
    // ... refund excess ...
}
```

### Setting upgrade fees

```solidity
// Owner sets all three upgrade fees
contract.setTierUpgradeFees([
    ethers.parseEther("0.005"),   // Tier25 → Tier50
    ethers.parseEther("0.015"),   // Tier50 → Tier75
    ethers.parseEther("0.03"),    // Tier75 → Tier100
]);
```

Emits: `TierUpgradeFeesChanged(oldFees, newFees)`.

> **Tip**: Set all fees to `0` for a fee-free game during development/testing.

---

## Fee Collection

### `collectFees()`

**Owner only.** Withdraws the entire `collectedFees` balance to the owner's
address.

```
1. amount = collectedFees
2. if (amount == 0) revert NoFeesToCollect()
3. collectedFees = 0                       ← CEI: clear before call
4. (success,) = owner.call{value: amount}("")
5. if (!success) { collectedFees = amount; revert FeeCollectionFailed() }
6. emit FeesCollected(owner, amount)
```

**Security**:
- Uses `nonReentrant` modifier.
- Follows CEI (Checks-Effects-Interactions) pattern.
- Restores `collectedFees` on transfer failure (restore-before-revert).

---

## Refund Handling

Both `mintAsset()` and `upgradeStorageTier()` handle overpayment via the
**pull-payment** pattern:

```solidity
if (msg.value > cost) {
    uint256 refund = msg.value - cost;
    pendingWithdrawals[msg.sender] += refund;
    emit WithdrawalDeposited(msg.sender, refund);
}
```

Users reclaim refunds by calling `withdraw()`.

---

## Configuration Reference

| Function | Visibility | Description |
|----------|-----------|-------------|
| `setMintFee(uint256 newFee)` | `external onlyOwner` | Set the per-mint fee |
| `setTierUpgradeFees(uint256[3] newFees)` | `external onlyOwner` | Set all tier upgrade fees |
| `collectFees()` | `external onlyOwner nonReentrant` | Withdraw accumulated fees |
| `mintFee` | `public` | Current mint fee (view) |
| `tierUpgradeFees` | `public` | Current tier fees array (view) |
| `collectedFees` | `public` | Current uncollected fee balance (view) |

### Events

| Event | Parameters |
|-------|-----------|
| `MintFeeChanged` | `(uint256 oldFee, uint256 newFee)` |
| `TierUpgradeFeesChanged` | `(uint256[3] oldFees, uint256[3] newFees)` |
| `FeesCollected` | `(address indexed recipient, uint256 amount)` |

### Errors

| Error | Trigger |
|-------|---------|
| `InsufficientPayment()` | `msg.value < required fee` |
| `NoFeesToCollect()` | `collectFees()` when `collectedFees == 0` |
| `FeeCollectionFailed()` | ETH transfer to owner fails |
