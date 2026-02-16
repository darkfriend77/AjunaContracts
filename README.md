# InsecureRandomness

> ⚠️ **DO NOT USE IN PRODUCTION** for high-stake use-cases.

A Solidity port of Substrate's [`pallet_insecure_randomness_collective_flip`](https://docs.rs/pallet-insecure-randomness-collective-flip/latest/pallet_insecure_randomness_collective_flip/).

Generates **low-influence pseudo-random values** from recent block hashes — useful for testing, games, and other low-security scenarios where full VRF/oracle randomness is overkill.

## How It Works

The original Substrate pallet:
1. Stores the last **81 parent block hashes** in a ring buffer (written every block via `on_initialize`)
2. Mixes them with a subject-dependent hash using `triplet_mix` when `random()` is called

This contract replicates the same logic in Solidity:
1. Uses the EVM `blockhash()` opcode — which natively gives access to the last **256** block hashes with zero storage cost
2. Mixes them with XOR-accumulated `keccak256(index, subject, blockHash)`, mirroring `triplet_mix`

### Security Comparison

| Property | Solidity `blockhash` workarounds | This contract | Substrate pallet |
|---|---|---|---|
| Entropy source | Block metadata (known pre-execution) | 81 previous block hashes | 81 previous block hashes |
| Predictable by tx sender? | **Yes** | **No** | **No** |
| Predictable by block producer? | **Yes** | **Partially** (can influence, not choose) | **Partially** |
| Front-runnable? | **Yes** | **No** | **No** |
| Cost to bias | Free | Must sacrifice block production | Must sacrifice block production |
| Storage cost | None | None | 1 write/block |

**Bottom line**: Comparable security to the Substrate pallet, strictly better than naive Solidity `block.timestamp` workarounds, but not suitable for anything with significant economic value at stake.

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

---

## Local Testing — Step by Step

A complete walkthrough for deploying and interacting with the contract locally.

### 1. Install Dependencies

```bash
cd InsecureRandomness
npm install
```

### 2. Compile the Contract

```bash
npm run compile
```

You should see output like:
```
Compiled 1 Solidity file successfully
```

### 3. Run the Test Suite

```bash
npm test
```

This starts a temporary in-memory Hardhat EVM, deploys the contract, and runs all 26 tests. No external node needed.

### 4. Start a Persistent Local Node

To deploy and interact manually, start a Hardhat node in a separate terminal:

```bash
npx hardhat node
```

This starts an Ethereum JSON-RPC server at `http://127.0.0.1:8545` with 20 pre-funded accounts. Keep this terminal open — you'll see transaction logs here.

### 5. Deploy the Contract

In a **second terminal**, deploy to the running local node:

```bash
npx hardhat run scripts/deploy.ts --network localhost
```

You'll see output like:
```
Deploying with account: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
InsecureRandomness deployed to: 0x5FbDB2315678afecb367f032d93F642f64180aa3
RANDOM_MATERIAL_LEN: 81
Sample randomValue: 0xa1b2c3...
Sample dice roll [0-5]: 3
```

**Copy the deployed address** — you'll need it in the next steps.

### 6. Interact via Hardhat Console

```bash
npx hardhat console --network localhost
```

Then inside the console:

```javascript
// Attach to the deployed contract
const rng = await ethers.getContractAt(
  "InsecureRandomness",
  "0x5FbDB2315678afecb367f032d93F642f64180aa3"  // ← your address
);

// Get a random seed
const [seed, offset] = await rng.random(ethers.toUtf8Bytes("hello"));
console.log("Seed:", seed);
console.log("Block offset:", offset.toString());

// Get just the hash
const value = await rng.randomValue(ethers.toUtf8Bytes("my-dapp"));
console.log("Value:", value);

// Roll a number in [0, 6)
const roll = await rng.randomInRange(ethers.toUtf8Bytes("dice"), 6n);
console.log("Roll:", roll.toString());

// Same subject in the same block → same result
const a = await rng.randomValue(ethers.toUtf8Bytes("test"));
const b = await rng.randomValue(ethers.toUtf8Bytes("test"));
console.log("Same?", a === b);  // true

// Different subjects → different results
const x = await rng.randomValue(ethers.toUtf8Bytes("alpha"));
const y = await rng.randomValue(ethers.toUtf8Bytes("beta"));
console.log("Different?", x !== y);  // true
```

Press `Ctrl+D` to exit the console.

### 7. Test with the Web UI

A visual testing page is included at `public/index.html`.

1. Make sure the Hardhat node is still running (step 4).
2. Make sure the contract is deployed (step 5).
3. Open the HTML file in your browser:

   ```bash
   # Option A: direct file open
   xdg-open public/index.html        # Linux
   open public/index.html             # macOS

   # Option B: serve it (if you have a simple HTTP server)
   npx http-server public -p 3000 -o
   ```

4. In the UI:
   - **RPC URL**: `http://127.0.0.1:8545` (pre-filled)
   - **Contract Address**: paste your deployed address
   - Click **Connect** — the status dot turns green
5. Switch between the `random()`, `randomValue()`, and `randomInRange()` tabs
6. Enter a subject string (e.g. `"dice-roll"`) and click **Execute**
7. Results appear in the output box; every call is logged in the history panel

### 8. Test Against revive-dev-node (Polkadot)

If you have a [revive-dev-node](https://github.com/polkadot-fellow/revive-dev-node) running locally:

```bash
# Deploy
npx hardhat run scripts/deploy.ts --network local

# Run tests
npm run test:local
```

The `local` network is pre-configured in `hardhat.config.ts` with:
- RPC: `http://127.0.0.1:8545`
- Chain ID: `420420420`
- Alith dev account

### Summary of Commands

| Step | Command | What it does |
|------|---------|-------------|
| Install | `npm install` | Install dependencies |
| Compile | `npm run compile` | Compile the Solidity contract |
| Unit tests | `npm test` | Run all 26 tests (ephemeral EVM) |
| Start node | `npx hardhat node` | Launch persistent local JSON-RPC node |
| Deploy | `npx hardhat run scripts/deploy.ts --network localhost` | Deploy to local node |
| Console | `npx hardhat console --network localhost` | Interactive JS/TS REPL |
| Web UI | Open `public/index.html` in browser | Visual contract tester |
| Polkadot node | `npm run test:local` | Test against revive-dev-node |

## Usage

### Deploy

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

### Call from Another Contract

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
        // Use a unique subject per use-case to domain-separate randomness
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

### Call from Ethers.js / TypeScript

```typescript
import { ethers } from "ethers";

// Connect to deployed contract
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

## API Reference

### `random(bytes subject) → (bytes32 seed, uint256 blockOffset)`

Core function. Returns a pseudo-random seed mixed from the last 81 block hashes, domain-separated by `subject`. Also returns the oldest block number that contributed to the seed.

### `randomValue(bytes subject) → bytes32`

Convenience wrapper — returns just the seed.

### `randomInRange(bytes subject, uint256 max) → uint256`

Returns a pseudo-random `uint256` in `[0, max)`. Reverts if `max == 0`.

### `RANDOM_MATERIAL_LEN → uint256`

Constant `81` — the number of block hashes mixed, matching the Substrate pallet.

## When to Use This

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

## License

Apache-2.0
