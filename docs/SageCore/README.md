# SageCore

> Abstract base contract for the SAGE game engine — assets, inventories,
> transitions, and a pull-payment marketplace.

| Item | Detail |
|------|--------|
| **Source** | `contracts/SageCore.sol` |
| **Compiler** | Solidity ^0.8.20 |
| **License** | MIT |
| **Dependencies** | OpenZeppelin `ReentrancyGuard` |
| **Deployability** | Abstract — must be inherited by a concrete game contract |

---

## Documentation Index

| Document | Description |
|----------|-------------|
| **[DATA-MODEL.md](DATA-MODEL.md)** | Asset struct, inventory system, storage tiers, user context |
| **[API-REFERENCE.md](API-REFERENCE.md)** | Complete function reference (external + internal) |
| **[TRANSITIONS.md](TRANSITIONS.md)** | Transition engine, built-in transitions, custom extensions |
| **[MARKETPLACE.md](MARKETPLACE.md)** | Listing, buying, pull-payment withdrawal |
| **[FEE-SYSTEM.md](FEE-SYSTEM.md)** | Mint fees, tier upgrade fees, fee collection |
| **[ACCESS-CONTROL.md](ACCESS-CONTROL.md)** | Ownership, modifiers, permissions matrix |
| **[EVENTS.md](EVENTS.md)** | Full event catalogue |
| **[ERRORS.md](ERRORS.md)** | Custom error reference |
| **[EXTENDING.md](EXTENDING.md)** | Guide to building a game on top of SageCore |

---

## Overview

SageCore provides the shared on-chain infrastructure every SAGE-based game
needs:

1. **Assets** with unique, auto-incrementing 32-bit IDs, a two-slot storage
   layout (32 B core metadata + 32 B game payload), and flag-based state.
2. **Inventories** tracking which assets each account owns, with
   upgrade-able storage tiers (25 → 50 → 75 → 100 slots).
3. **Transitions** — a configurable action system where the engine validates
   ownership/lock requirements and then delegates the mutation to built-in or
   game-specific logic.
4. **Marketplace** — a fixed-price listing system with lock-on-list and a
   pull-payment withdrawal pattern for safe fund handling.
5. **Fee System** — configurable mint fees and per-tier upgrade fees
   accumulated into a collector balance the owner can withdraw.

The contract is **abstract**. Game developers inherit it and:
- implement game-specific minting rules,
- override `_validateTransitionSpecific()` and `_applyTransition()` to add
  custom transitions,
- expose internal helpers (`_lockAsset`, `_burnAsset`, `_mintAssetTo`, …) via
  their own access-controlled external functions.

---

## Architecture Diagram

```
                          ┌──────────────────────┐
                          │      SageCore        │  (abstract)
                          │  ────────────────    │
                          │  Assets + Inventory  │
                          │  Transitions Engine  │
                          │  Marketplace + Fees  │
                          │  Owner / Access Ctrl │
                          └──────────┬───────────┘
                                     │ inherits
                          ┌──────────▼───────────┐
                          │    YourGame.sol       │  (concrete)
                          │  ────────────────     │
                          │  Custom transitions   │
                          │  Game mint rules      │
                          │  Expose lock/burn…    │
                          └──────────────────────┘
```

### Inheritance chain

```
ReentrancyGuard ← SageCore ← YourGame
```

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Compile

```bash
npx hardhat compile
```

### 3. Run tests

```bash
npx hardhat test                                   # all tests
npx hardhat test test/SageCore/SageCore.test.ts     # core tests (113)
npx hardhat test test/SageCore/SageCore.extended.test.ts  # extended (43)
```

### 4. Deploy

See the project root [README](../../README.md) for deployment instructions.

---

## Constants

| Name | Type | Value | Description |
|------|------|-------|-------------|
| `DEFAULT_MAX_ITEMS` | `uint8` | 25 | Base inventory capacity (Tier25) |
| `MAX_BATCH_SIZE` | `uint8` | 20 | Maximum assets in a batch transfer/burn |
| `MAX_ASSETS_PER_TRANSITION` | `uint8` | 5 | Maximum assets per transition call |
| `FLAG_LOCKED` | `uint8` | `0x01` | Bit mask for the lock flag (internal) |
| `TRANSITION_NOOP` | `uint8` | 1 | NOOP transition ID |
| `TRANSITION_INCREMENT_LEVEL` | `uint8` | 2 | Level-increment transition ID |
| `TRANSITION_SET_FLAGS` | `uint8` | 3 | Flag-set transition ID |

---

## Storage Layout (Simplified)

```
_nextAssetId         : uint256      — monotonic asset ID counter
assets               : mapping(uint256 => Asset)
inventories          : mapping(address => Inventory)
transitionConfigs    : mapping(uint8 => TransitionConfig)
listings             : mapping(uint256 => Listing)
userContext          : mapping(address => UserContext)
pendingWithdrawals   : mapping(address => uint256)
owner                : address
maxAssetsPerTransitionGlobal : uint8
marketplaceEnabled   : bool
minListingPrice      : uint256
mintFee              : uint256
tierUpgradeFees      : uint256[3]
collectedFees        : uint256
```

---

## Testing

The test suite is split into two files under `test/SageCore/`:

| File | Tests | Focus |
|------|-------|-------|
| `SageCore.test.ts` | 113 | Core functionality: mint, transfer, burn, batch, transitions, marketplace, fees, tiers, ownership |
| `SageCore.extended.test.ts` | 43 | Edge cases: events, burned-asset access, marketplace edge cases, batch atomicity, tier details, swap-and-pop, integration scenarios |

Total: **156 SageCore tests**.
