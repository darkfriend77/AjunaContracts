# SageCore — Building a Game

This guide walks through inheriting SageCore to build a concrete game
contract. The reference implementation is `TestGame.sol`.

---

## Table of Contents

1. [Minimal Skeleton](#minimal-skeleton)
2. [Exposing Internal Functions](#exposing-internal-functions)
3. [Custom Transitions](#custom-transitions)
4. [Custom Minting Rules](#custom-minting-rules)
5. [User Context Payload](#user-context-payload)
6. [Best Practices](#best-practices)
7. [Full Example](#full-example)

---

## Minimal Skeleton

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SageCore.sol";

contract MyGame is SageCore {
    constructor() SageCore() {
        // Optional: configure transitions, fees, etc.
    }
}
```

That's it. `MyGame` is deployable and inherits all of SageCore's functionality:
asset management, inventory, marketplace, transitions, and fees.

---

## Exposing Internal Functions

SageCore's game-facing API is `internal`. To let external callers (or your
game server) invoke these functions, wrap them in `external` functions with
appropriate access control.

### Lock / Unlock

```solidity
function lockAsset(uint256 assetId) external {
    Asset storage a = _getExistingAsset(assetId);
    if (a.owner != msg.sender) revert NotOwner();
    _lockAsset(assetId);
}

function unlockAsset(uint256 assetId) external {
    Asset storage a = _getExistingAsset(assetId);
    if (a.owner != msg.sender) revert NotOwner();
    _unlockAsset(assetId);
}
```

### Game Burn (owner/server only)

```solidity
function gameBurn(uint256 assetId) external onlyOwner {
    _burnAsset(assetId);
}
```

### Game Mint to Player

```solidity
function gameMintTo(
    address to,
    uint16 kind,
    uint8 flags,
    uint16 level,
    bytes32 payload
) external onlyOwner returns (uint256) {
    return _mintAssetTo(to, kind, flags, level, payload);
}
```

### Update Asset Data

```solidity
function updateAssetData(
    uint256 assetId,
    bytes32 payload,
    uint16 level
) external onlyOwner {
    _updateAssetData(assetId, payload, level);
}
```

---

## Custom Transitions

### 1. Register the transition in the constructor

```solidity
constructor() SageCore() {
    // ID 4: CRAFT — combine 2 unlocked assets into 1
    configureTransition(4, true, true, false, 2);

    // ID 5: ENCHANT — requires exactly 1 locked asset
    configureTransition(5, true, false, true, 1);
}
```

### 2. Override validation

```solidity
function _validateTransitionSpecific(
    uint8 transitionId,
    uint256[] calldata assetIds,
    bytes calldata data
) internal pure override {
    if (transitionId == 4) {
        // CRAFT: must have exactly 2 assets and a 32-byte recipe
        require(assetIds.length == 2, "CRAFT needs 2 assets");
        require(data.length == 32, "CRAFT needs recipe hash");
        return;
    }
    // delegate to built-in validation for IDs 1, 2, 3
    super._validateTransitionSpecific(transitionId, assetIds, data);
}
```

### 3. Override application

```solidity
function _applyTransition(
    uint8 transitionId,
    uint256[] calldata assetIds,
    bytes calldata data
) internal override {
    if (transitionId == 4) {
        // CRAFT: burn input assets, mint a new crafted asset
        Asset storage a = _getAsset(assetIds[0]);
        Asset storage b = _getAsset(assetIds[1]);

        bytes32 newPayload = keccak256(abi.encodePacked(
            a.payload, b.payload, data
        ));

        _burnAsset(assetIds[0]);
        _burnAsset(assetIds[1]);
        _mintAsset(msg.sender, 99, 0, a.level + b.level, newPayload);
        return;
    }
    super._applyTransition(transitionId, assetIds, data);
}
```

> **Always call `super`** for transition IDs you don't handle. Otherwise the
> built-in NOOP, INCREMENT_LEVEL, and SET_FLAGS transitions will silently stop
> working.

---

## Custom Minting Rules

Override the public `mintAsset` function or add a new externally-facing mint
function with game-specific rules:

```solidity
uint16 public constant WARRIOR = 1;
uint16 public constant MAGE = 2;

function mintWarrior() external payable returns (uint256) {
    if (msg.value < mintFee) revert InsufficientPayment();
    collectedFees += mintFee;

    bytes32 dna = keccak256(abi.encodePacked(
        msg.sender, block.number, _nextAssetId
    ));

    return _mintAsset(msg.sender, WARRIOR, 0, 1, dna);
}
```

---

## User Context Payload

SageCore provides 31 bytes of per-user storage in `userContext[address].payload`.

### Write (from game contract)

```solidity
function setPlayerName(bytes31 name) external {
    _updateUserPayload(msg.sender, name);
}
```

### Read

```solidity
function getPlayerName(address player) external view returns (bytes31) {
    return userContext[player].payload;
}
```

The payload is fully opaque to SageCore — use it for profiles, XP, cooldowns,
or any 31-byte-or-less data.

---

## Best Practices

### Access control

| Function type | Recommended gate |
|---------------|-----------------|
| Player-facing mints | `external payable` + fee check |
| Game burns / reward mints | `external onlyOwner` (or a dedicated `gameServer` role) |
| Lock / unlock | `external` + `msg.sender == asset.owner` |
| Data updates | `external onlyOwner` |

### Gas optimization

- Use `unchecked { ++i; }` in loops (already done in SageCore).
- Batch operations where possible instead of multiple single calls.
- Prefer `_mintAsset(to, ...)` over `mintTo(to, ...)` from internal game
  logic to save one `onlyOwner` check.

### Testing

Create a test contract (like `TestGame.sol`) that exposes internal functions
for comprehensive unit testing:

```solidity
contract TestMyGame is MyGame {
    function exposedBurn(uint256 id) external { _burnAsset(id); }
    // ...
}
```

### Upgradability

SageCore is **not** upgradable by default. If you need upgradability:
1. Use OpenZeppelin's UUPS or Transparent proxy pattern.
2. Replace the constructor with an `initializer` function.
3. Change `ReentrancyGuard` to `ReentrancyGuardUpgradeable`.

---

## Full Example

See the [TestGame.sol](../../contracts/TestGame.sol) contract for a complete
reference implementation that exposes all internal functions for testing.

```solidity
contract TestGame is SageCore {
    constructor() SageCore() {}

    function lockAsset(uint256 assetId) external { ... }
    function unlockAsset(uint256 assetId) external { ... }
    function gameBurn(uint256 assetId) external onlyOwner { ... }
    function gameBatchBurn(uint256[] calldata assetIds) external onlyOwner { ... }
    function updateAssetData(uint256 assetId, bytes32 payload, uint16 level) external onlyOwner { ... }
    function gameMintTo(address to, ...) external onlyOwner returns (uint256) { ... }
}
```

### Deployment (TypeScript)

```typescript
import { ethers } from "hardhat";

async function main() {
    const game = await ethers.deployContract("MyGame");
    await game.waitForDeployment();
    console.log("MyGame deployed to:", await game.getAddress());

    // Configure a custom transition
    await game.configureTransition(4, true, true, false, 2);

    // Set mint fee
    await game.setMintFee(ethers.parseEther("0.001"));
}

main().catch(console.error);
```
