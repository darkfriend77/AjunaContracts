# InsecureRandomness

> Solidity recreation of Substrate's `pallet_insecure_randomness_collective_flip`.

| Item | Detail |
|------|--------|
| **Source** | `contracts/InsecureRandomness/InsecureRandomness.sol` |
| **Compiler** | Solidity ^0.8.28 |
| **License** | Apache-2.0 |
| **Dependencies** | None |
| **Deployability** | Concrete (non-abstract) |

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [API Reference](#api-reference)
4. [Security Considerations](#security-considerations)
5. [Usage Examples](#usage-examples)
6. [Testing](#testing)
7. [Gas Considerations](#gas-considerations)
8. [Comparison with Substrate Pallet](#comparison-with-substrate-pallet)

---

## Overview

`InsecureRandomness` generates low-influence pseudo-random values on-chain by
mixing recent block hashes. It mirrors the behaviour of Substrate's
`pallet_insecure_randomness_collective_flip`, making it useful for porting
Substrate game logic that relied on that pallet.

### Key properties

- **Not predictable by callers** – the seed depends on block hashes that are
  unknown at the time a transaction is submitted.
- **Low influence** – block producers can omit or reorder transactions but
  cannot freely choose hashes.
- **Not suitable for high-value lotteries** – use Chainlink VRF or a commit-
  reveal scheme when significant value is at stake.

---

## Architecture

```
                ┌──────────────────────────────┐
                │      InsecureRandomness      │
                ├──────────────────────────────┤
                │  RANDOM_MATERIAL_LEN = 81    │
                ├──────────────────────────────┤
                │  random(subject)             │
                │  randomValue(subject)        │
                │  randomInRange(subject, max) │
                └──────────────────────────────┘
```

All three public entry-points ultimately call `random()`, which iterates over
up to 81 recent block hashes and XOR-accumulates
`keccak256(abi.encodePacked(i, subject, blockhash(blockNum)))` for each
iteration.

---

## API Reference

### Constants

| Name | Type | Value | Description |
|------|------|-------|-------------|
| `RANDOM_MATERIAL_LEN` | `uint256` | `81` | Number of block hashes mixed into the seed. Matches the Substrate pallet's ring buffer length. |

### Functions

#### `random(bytes memory subject) → (bytes32 seed, uint256 blockOffset)`

Core randomness generator.

| Parameter | Type | Description |
|-----------|------|-------------|
| `subject` | `bytes` | Domain-separation context (e.g. `"lottery"`, `"nft-mint"`). Different subjects produce independent streams. |

**Returns**

| Name | Type | Description |
|------|------|-------------|
| `seed` | `bytes32` | Mixed pseudo-random hash. |
| `blockOffset` | `uint256` | Oldest block number that contributed to the seed. |

**Behaviour**

1. If `block.number == 0` → returns `(bytes32(0), 0)`.
2. Determines `available = min(block.number, RANDOM_MATERIAL_LEN, 256)`.
3. For each `i` in `[0, available)`:
   - computes `bHash = blockhash(block.number - 1 - i)`
   - accumulates `seed ^= keccak256(abi.encodePacked(i, subject, bHash))`
4. Sets `blockOffset = max(block.number - RANDOM_MATERIAL_LEN, 0)`.

**Visibility**: `public view`

---

#### `randomValue(bytes memory subject) → bytes32`

Convenience wrapper that returns only the random hash, discarding the block
offset.

| Parameter | Type | Description |
|-----------|------|-------------|
| `subject` | `bytes` | Domain-separation context. |

**Visibility**: `external view`

---

#### `randomInRange(bytes memory subject, uint256 max) → uint256`

Returns a random unsigned integer in the half-open range `[0, max)`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `subject` | `bytes` | Domain-separation context. |
| `max` | `uint256` | Exclusive upper bound. Must be > 0 (reverts otherwise). |

**Reverts**: `"max must be > 0"` when `max == 0`.

**Visibility**: `external view`

> **Modulo bias note** – because `type(uint256).max` is astronomically larger
> than any practical `max`, the modulo bias is negligible for game use cases.

---

## Security Considerations

### ⚠️ DO NOT use for high-stake randomness

| Threat | Risk | Mitigation |
|--------|------|------------|
| **Block-producer influence** | A validator/sequencer can withhold or reorder transactions to nudge the outcome. | Low risk for low-value games; use VRF for lotteries. |
| **Same-block predictability** | Within a single block, all calls with the same `subject` return the same value. | Use unique subjects per call or include caller-specific data. |
| **Cross-call correlation** | Different subjects in the same block share the same underlying block hashes. | Acceptable for most game logic; avoid if outcomes must be fully independent. |
| **Genesis block** | `random()` returns zero when `block.number == 0`. | Not a practical concern on any live network. |

### Recommended alternatives for high-value use cases

- **Chainlink VRF v2.5** – verifiable random function backed by economic
  security.
- **Commit-reveal scheme** – two-phase protocol where participants commit a
  hash first, then reveal.
- **Randao + VDF** – post-merge Ethereum / L2 solutions.

---

## Usage Examples

### Solidity – using InsecureRandomness from another contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./InsecureRandomness.sol";

contract CoinFlip {
    InsecureRandomness private immutable rng;

    constructor(address rngAddress) {
        rng = InsecureRandomness(rngAddress);
    }

    function flip() external view returns (bool heads) {
        uint256 result = rng.randomInRange(
            abi.encodePacked("coin-flip", msg.sender, block.number),
            2
        );
        heads = result == 0;
    }
}
```

### TypeScript (ethers v6 – Hardhat test)

```typescript
import { ethers } from "hardhat";

async function main() {
  const rng = await ethers.deployContract("InsecureRandomness");
  await rng.waitForDeployment();

  const seed = await rng.randomValue(
    ethers.toUtf8Bytes("my-game")
  );
  console.log("Random seed:", seed);

  const roll = await rng.randomInRange(
    ethers.toUtf8Bytes("dice-roll"), 6
  );
  console.log("Dice roll (0-5):", roll.toString());
}
```

---

## Testing

Test file: `test/InsecureRandomness/InsecureRandomness.test.ts` (26 tests).

Run only InsecureRandomness tests:

```bash
npx hardhat test test/InsecureRandomness/InsecureRandomness.test.ts
```

---

## Gas Considerations

| Function | Approximate Gas | Notes |
|----------|----------------|-------|
| `random()` | ~85 000 – 130 000 | Depends on `available` (up to 81 iterations). Pure `view`, so no gas cost when called off-chain. |
| `randomValue()` | Same as `random()` | Thin wrapper. |
| `randomInRange()` | Same as `random()` + ~200 | Extra modulo operation. |

All functions are `view`, so they incur **zero gas** when called from
off-chain (e.g. `eth_call`). Gas is only spent when called internally by a
state-changing transaction.

---

## Comparison with Substrate Pallet

| Aspect | `pallet_insecure_randomness_collective_flip` | `InsecureRandomness.sol` |
|--------|----------------------------------------------|--------------------------|
| Block hash source | Stored in a 81-element ring buffer (`RandomMaterial`) | `blockhash()` opcode (last 256 blocks natively) |
| Storage | On-chain ring buffer updated every block | No storage — reads hashes directly |
| Mixing | `triplet_mix(index, subject, hash)` | `keccak256(abi.encodePacked(i, subject, bHash))` XOR-accumulated |
| Hash count | 81 | min(81, 256, block.number) |
| Trait | Implements `Randomness<T::Hash, BlockNumberFor<T>>` | Three public functions |
| Security | Equivalent (low-influence) | Equivalent (low-influence) |
