# CasinoJam

> One-arm bandit (slot machine) game built on top of SageCore — players
> deposit ETH, spin slot machines, and withdraw winnings via a credit-based
> economy.

| Item | Detail |
|------|--------|
| **Source** | `contracts/CasinoJam/CasinoJam.sol` |
| **Library** | `contracts/CasinoJam/PayloadLib.sol` |
| **Compiler** | Solidity ^0.8.20 |
| **License** | MIT |
| **Inherits** | `SageCore` → `ReentrancyGuard` |
| **Dependency** | `InsecureRandomness` (on-chain RNG) |
| **Origin** | Ported from the C# SAGE CasinoJam reference implementation |

---

## Documentation Index

| Document | Description |
|----------|-------------|
| **[DATA-MODEL.md](DATA-MODEL.md)** | Asset types (Human, Tracker, Bandit, Seat), payload layouts, credit economy |
| **[API-REFERENCE.md](API-REFERENCE.md)** | Complete function reference — external, internal, and view helpers |
| **[GAME-FLOW.md](GAME-FLOW.md)** | End-to-end game lifecycle, step-by-step walkthrough |
| **[SPIN-ENGINE.md](SPIN-ENGINE.md)** | Slot machine mechanics, symbol weights, reward tables, payout formulas |
| **[SEAT-MANAGEMENT.md](SEAT-MANAGEMENT.md)** | Rent, reserve, release, kick, and return — the full seat lifecycle |
| **[EVENTS.md](EVENTS.md)** | Full event catalogue |
| **[ERRORS.md](ERRORS.md)** | Custom error reference |
| **[PAYLOADLIB.md](PAYLOADLIB.md)** | PayloadLib library — byte-level read/write helpers |

---

## Overview

CasinoJam is a fully on-chain slot machine game where every entity is a
SageCore asset:

1. **Players** create a Human + Tracker asset pair.
2. **Machine owners** create Bandit machines, fund them with credits, and
   rent out Seats.
3. **Players** reserve a Seat (paying a reservation fee), then **gamble** by
   spinning the slot machine's reels.
4. **Winnings** are transferred in credits; players can withdraw credits back
   to ETH at any time.

The game implements a two-sided economy: machine owners earn from play fees
and benefit from house edge, while players chase payouts.

---

## Architecture Diagram

```
    ┌─────────────────────────────────┐
    │          SageCore               │  (abstract base)
    │  ─────────────────────────────  │
    │  Assets + Inventories           │
    │  Transitions Engine             │
    │  Marketplace + Pull-Payment     │
    │  Owner / Access Control         │
    └──────────────┬──────────────────┘
                   │ inherits
    ┌──────────────▼──────────────────┐
    │         CasinoJam               │  (concrete game)
    │  ─────────────────────────────  │
    │  Player / Machine Creation      │
    │  Credit Economy (deposit/with.) │
    │  Seat Lifecycle (rent/reserve…) │
    │  Slot Machine Spin Engine       │
    │  Kick / Grace Period Mechanics  │
    └──────────────┬──────────────────┘
                   │ uses
    ┌──────────────▼──────────────────┐
    │      InsecureRandomness         │  (RNG provider)
    │   PayloadLib (bytes32 packing)  │  (library)
    └─────────────────────────────────┘
```

### Inheritance chain

```
ReentrancyGuard ← SageCore ← CasinoJam
```

---

## Asset Relationships

```
  ┌───────────┐   co-created   ┌──────────────┐
  │  Human    │───────────────▶│   Tracker    │
  │ KIND=0x11 │                │  KIND=0x12   │
  └─────┬─────┘                └──────────────┘
        │ occupies (SeatId)
        ▼
  ┌───────────┐   linked via   ┌──────────────┐
  │   Seat    │───────────────▶│   Bandit     │
  │ KIND=0x40 │  (MachineId)   │  KIND=0x21   │
  └───────────┘                └──────────────┘
```

- **Human ↔ Seat**: A Human's `SeatId` field points to the Seat it occupies.
  The Seat's `PlayerId` field points back to the Human.
- **Seat → Bandit**: Every Seat stores its parent `MachineId`. The Bandit
  tracks how many seats are linked via `SeatLinked` / `SeatLimit`.
- **Human + Tracker**: Always created as a pair — one of each per account.

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
npx hardhat test test/CasinoJam/CasinoJam.test.ts
```

### 4. Deploy

```bash
npx hardhat run scripts/deploy.ts --network <network>
```

---

## Constants

| Name | Type | Value | Description |
|------|------|-------|-------------|
| `KIND_HUMAN` | `uint16` | `0x11` | Player avatar asset |
| `KIND_TRACKER` | `uint16` | `0x12` | Player spin-result tracker |
| `KIND_BANDIT` | `uint16` | `0x21` | Slot machine asset |
| `KIND_SEAT` | `uint16` | `0x40` | Links player to machine |
| `BLOCKS_PER_MINUTE` | `uint256` | `10` | Assumes 6-second blocks |
| `BLOCKS_PER_HOUR` | `uint256` | `600` | 10 × 60 |
| `BLOCKS_PER_DAY` | `uint256` | `14400` | 600 × 24 |
| `BASE_RESERVATION_TIME` | `uint256` | `50` | 5 min = 5 × 10 blocks |
| `BASE_RENT_FEE` | `uint256` | `10` | Base rent fee in credits |
| `SEAT_USAGE_FEE_PERC` | `uint256` | `1` | 1% usage fee on seat release |
| `BANDIT_MAX_SPINS` | `uint8` | `4` | Maximum reels per gamble |
| `SINGLE_SPIN_MAX_REWARD` | `uint256` | `8192` | Worst-case single-spin payout factor |
| `GAMBLE_COOLDOWN` | `uint256` | `1` | 1-block cooldown between gambles |

---

## State Variables

| Variable | Type | Description |
|----------|------|-------------|
| `rngContract` | `address` | Address of the `InsecureRandomness` contract |
| `exchangeRate` | `uint256` | Wei per credit (default: `1e12` = 1 szabo) |
| `assetBalances` | `mapping(uint256 ⇒ uint256)` | Per-asset credit balance |
| `playerHumanId` | `mapping(address ⇒ uint256)` | Account → Human asset ID |
| `playerTrackerId` | `mapping(address ⇒ uint256)` | Account → Tracker asset ID |
| `playerMachineId` | `mapping(address ⇒ uint256)` | Account → Bandit asset ID |

---

## Credit Economy

CasinoJam uses an internal credit system rather than raw ETH:

1. **Deposit**: Users send ETH and receive `creditAmount` credits.
   `ETH required = creditAmount × exchangeRate`.
2. **Withdraw**: Credits are converted back to wei and placed in
   `pendingWithdrawals` (pull-payment pattern inherited from SageCore).
3. All in-game transfers (play fees, rewards, reservation fees) operate in
   credits, never in raw ETH.

Default exchange rate: **1 credit = 1 szabo = 0.000001 ETH**.

---

## Testing

The CasinoJam test suite lives in `test/CasinoJam/CasinoJam.test.ts` and
covers:

| Area | Tests |
|------|-------|
| Deployment | RNG address, exchange rate, owner |
| Owner Configuration | Exchange rate, RNG contract updates |
| Player Creation | Human + Tracker pair, uniqueness |
| Machine Creation | Bandit defaults, uniqueness |
| Deposit / Withdraw | Credits, refunds, insufficient ETH |
| Rent | Seat creation, fee deduction, limits |
| Reserve | Player-seat linking, fee transfer |
| Gamble | Spins, rewards, cooldowns, balances |
| Release | Refunds, re-reservation |
| Kick | Expiry, bounty transfer |
| Return Seat | Burn, balance return |
| Config Machine | Parameters, validation |
| Spin Engine | Symbol range, credit conservation |
| Full Lifecycle | End-to-end integration |

```bash
npx hardhat test test/CasinoJam/CasinoJam.test.ts
```
