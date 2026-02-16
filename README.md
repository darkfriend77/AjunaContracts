# Ajuna Contracts

A collection of Solidity smart contracts by [Ajuna Network](https://ajuna.io) — targeting EVM-compatible chains and the Polkadot ecosystem via [pallet-revive](https://github.com/nicetomeetyou1/pallet-revive).

## Contracts

| Contract | Description | Status |
|----------|-------------|--------|
| [InsecureRandomness](#insecurerandomness) | Low-influence on-chain pseudo-randomness from block hashes | ✅ Ready |
| [SageCore](#sagecore) | SAGE Core prototype — assets, inventories, transitions & marketplace | ✅ Ready |
| *More to come…* | | 🚧 |

## Quick Start

### Prerequisites

- Node.js ≥ 18
- npm or yarn

### Install

```bash
npm install
```

### Compile

```bash
npm run compile
```

### Test

Against a local Hardhat node (in-memory EVM):

```bash
npm test
```

Against a running `revive-dev-node`:

```bash
npm run test:local
```

### Start a Local Node

```bash
npx hardhat node
```

### Deploy

```bash
npx hardhat run scripts/deploy.ts --network localhost
```

### Web UI

A visual testing page is included at `public/index.html`. Start a local web server:

```bash
# Option A: Python (built-in, no install needed)
python3 -m http.server 8000 --directory public

# Option B: Node.js one-liner
npx http-server public -p 8000 -o
```

Then open **http://localhost:8000** in your browser.

### Summary of Commands

| Step | Command | What it does |
|------|---------|-------------|
| Install | `npm install` | Install dependencies |
| Compile | `npm run compile` | Compile all Solidity contracts |
| Unit tests | `npm test` | Run all tests (ephemeral EVM) |
| Start node | `npx hardhat node` | Launch persistent local JSON-RPC node |
| Deploy | `npx hardhat run scripts/deploy.ts --network localhost` | Deploy to local node |
| Console | `npx hardhat console --network localhost` | Interactive JS/TS REPL |
| Web UI | `python3 -m http.server 8000 --directory public` | Serve UI at http://localhost:8000 |
| Polkadot node | `npm run test:local` | Test against revive-dev-node |

---

## InsecureRandomness

> ⚠️ **DO NOT USE IN PRODUCTION** for high-stake use-cases.

A Solidity port of Substrate's [`pallet_insecure_randomness_collective_flip`](https://docs.rs/pallet-insecure-randomness-collective-flip/latest/pallet_insecure_randomness_collective_flip/).

Generates **low-influence pseudo-random values** from recent block hashes — useful for testing, games, and other low-security scenarios where full VRF/oracle randomness is overkill.

### How It Works

The original Substrate pallet:
1. Stores the last **81 parent block hashes** in a ring buffer (written every block via `on_initialize`)
2. Mixes them with a subject-dependent hash using `triplet_mix` when `random()` is called

This contract replicates the same logic in Solidity:
1. Uses the EVM `blockhash()` opcode — which natively gives access to the last **256** block hashes with zero storage cost
2. Mixes them with XOR-accumulated `keccak256(index, subject, blockHash)`, mirroring `triplet_mix`

#### Security Comparison

| Property | Solidity `blockhash` workarounds | This contract | Substrate pallet |
|---|---|---|---|
| Entropy source | Block metadata (known pre-execution) | 81 previous block hashes | 81 previous block hashes |
| Predictable by tx sender? | **Yes** | **No** | **No** |
| Predictable by block producer? | **Yes** | **Partially** (can influence, not choose) | **Partially** |
| Front-runnable? | **Yes** | **No** | **No** |
| Cost to bias | Free | Must sacrifice block production | Must sacrifice block production |
| Storage cost | None | None | 1 write/block |

**Bottom line**: Comparable security to the Substrate pallet, strictly better than naive Solidity `block.timestamp` workarounds, but not suitable for anything with significant economic value at stake.

### API Reference

#### `random(bytes subject) → (bytes32 seed, uint256 blockOffset)`

Core function. Returns a pseudo-random seed mixed from the last 81 block hashes, domain-separated by `subject`. Also returns the oldest block number that contributed to the seed.

#### `randomValue(bytes subject) → bytes32`

Convenience wrapper — returns just the seed.

#### `randomInRange(bytes subject, uint256 max) → uint256`

Returns a pseudo-random `uint256` in `[0, max)`. Reverts if `max == 0`.

#### `RANDOM_MATERIAL_LEN → uint256`

Constant `81` — the number of block hashes mixed, matching the Substrate pallet.

### Usage Examples

<details>
<summary>Deploy with Hardhat</summary>

```typescript
import { ethers } from "hardhat";

async function main() {
  const factory = await ethers.getContractFactory("InsecureRandomness");
  const randomness = await factory.deploy();
  await randomness.waitForDeployment();
  console.log("Deployed to:", await randomness.getAddress());
}

main();
```

</details>

<details>
<summary>Call from another contract</summary>

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "./InsecureRandomness.sol";

contract MyGame {
    InsecureRandomness public immutable rng;

    constructor(address _rng) {
        rng = InsecureRandomness(_rng);
    }

    /// Roll a dice (1-6)
    function rollDice() external view returns (uint256) {
        return rng.randomInRange(abi.encodePacked("dice-roll", msg.sender), 6) + 1;
    }

    /// Flip a coin
    function flipCoin() external view returns (bool) {
        bytes32 value = rng.randomValue(abi.encodePacked("coin-flip", msg.sender));
        return uint256(value) % 2 == 0;
    }

    /// Get full random seed with metadata
    function getRandomSeed() external view returns (bytes32 seed, uint256 oldestBlock) {
        return rng.random(abi.encodePacked("full-seed", block.number));
    }
}
```

</details>

<details>
<summary>Call from Ethers.js / TypeScript</summary>

```typescript
import { ethers } from "ethers";

const rng = new ethers.Contract(DEPLOYED_ADDRESS, [
  "function random(bytes) view returns (bytes32, uint256)",
  "function randomValue(bytes) view returns (bytes32)",
  "function randomInRange(bytes, uint256) view returns (uint256)",
], provider);

// Get a random bytes32
const seed = await rng.randomValue(ethers.toUtf8Bytes("my-context"));

// Get a random number 0-99
const roll = await rng.randomInRange(ethers.toUtf8Bytes("my-roll"), 100n);
```

</details>

### When to Use This

✅ **Good for:**
- Game mechanics (card draws, dice rolls, loot drops)
- Tiebreakers and ordering
- Testing and development
- Low-value NFT trait generation

❌ **Not suitable for:**
- Lotteries with significant prizes
- DeFi protocols
- Anything where an attacker could profitably exploit bias
- Use a VRF (e.g. Chainlink VRF) or commit-reveal scheme instead

---

## SageCore

**SAGE Core Prototype — Assets & Transitions**

A Solidity implementation of the first part of the SAGE (Strategic Asset Game Engine) framework, focusing on on-chain asset management, inventory systems, and composable game transitions.

### Features

- **Asset management** — Mint, transfer, burn, lock/unlock assets with unique incremental IDs
- **Inventory system** — Per-account inventories with upgradeable storage tiers (25 / 50 / 75 / 100 slots)
- **Transitions** — Configurable entrypoints for game logic (no-op, increment level, set flags)
- **Marketplace** — On-chain listing, buying, and delisting of assets with pull-payment pattern
- **Batch operations** — Batch minting and burning for gas efficiency
- **Access control** — Owner-managed configuration with reentrancy protection

### Key Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `DEFAULT_MAX_ITEMS` | 25 | Base inventory capacity |
| `MAX_BATCH_SIZE` | 20 | Maximum assets per batch operation |
| `MAX_ASSETS_PER_TRANSITION` | 5 | Maximum assets per transition call |

### Storage Tiers

| Tier | Slots | Description |
|------|-------|-------------|
| Tier25 | 25 | Base tier |
| Tier50 | 50 | First upgrade |
| Tier75 | 75 | Second upgrade |
| Tier100 | 100 | Maximum tier |

### Transitions

| ID | Name | Description |
|----|------|-------------|
| 1 | `TRANSITION_NOOP` | No-op (validation only) |
| 2 | `TRANSITION_INCREMENT_LEVEL` | Increment asset level |
| 3 | `TRANSITION_SET_FLAGS` | Set asset flags |

*More contracts coming soon…*

---

## License

Apache-2.0
