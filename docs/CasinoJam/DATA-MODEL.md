# CasinoJam — Data Model

Every game entity in CasinoJam is a SageCore asset. This document details
each asset type, its payload layout, and the internal credit economy.

---

## Table of Contents

1. [Asset Types](#asset-types)
2. [Human Asset (KIND_HUMAN = 0x11)](#human-asset)
3. [Tracker Asset (KIND_TRACKER = 0x12)](#tracker-asset)
4. [Bandit Asset (KIND_BANDIT = 0x21)](#bandit-asset)
5. [Seat Asset (KIND_SEAT = 0x40)](#seat-asset)
6. [Credit Balances](#credit-balances)
7. [Account Mappings](#account-mappings)

---

## Asset Types

CasinoJam defines four asset types via the `kind` field inherited from
SageCore's `Asset` struct:

| Kind | Hex | Name | Purpose | Per account |
|------|-----|------|---------|-------------|
| `KIND_HUMAN` | `0x11` | Human | Player avatar — holds seat link | 1 |
| `KIND_TRACKER` | `0x12` | Tracker | Stores last spin results | 1 |
| `KIND_BANDIT` | `0x21` | Bandit | Slot machine — holds configuration | 1 |
| `KIND_SEAT` | `0x40` | Seat | Links a player to a machine | Multiple |

The `kind` value encodes `(AssetType << 4) | SubType`:
- `0x11` = Player (1) + Human (1)
- `0x12` = Player (1) + Tracker (2)
- `0x21` = Machine (2) + Bandit (1)
- `0x40` = Seat (4) + None (0)

---

## Human Asset

The Human asset represents a player's on-chain identity. One per account.

### Payload layout (32 bytes)

| Byte(s) | Field | Type | Description |
|---------|-------|------|-------------|
| 0 | MatchType | `uint8` | Always `0x11` — identifies payload type |
| 1–27 | _reserved_ | — | Unused (zero) |
| 28–31 | SeatId | `uint32` (LE) | ID of the Seat the player currently occupies. `0` = not seated. |

### Key behaviours

- Created by `createPlayer()` alongside a Tracker.
- `SeatId` is set during `reserve()` and cleared during `release()` / `kick()`.
- Can hold a credit balance (`assetBalances[humanId]`).
- Must have sufficient credits to pay reservation fees and play fees.

---

## Tracker Asset

The Tracker asset stores the results of the player's last gamble. One per
account, always co-created with the Human.

### Payload layout (32 bytes)

| Byte(s) | Field | Type | Description |
|---------|-------|------|-------------|
| 0 | MatchType | `uint8` | Always `0x12` |
| 1–11 | _reserved_ | — | Unused |
| 12–15 | LastReward | `uint32` (LE) | Total reward from the last gamble |
| 16–18 | SpinSlot 0 | `bytes3` | Packed spin result for spin 0 |
| 19–21 | SpinSlot 1 | `bytes3` | Packed spin result for spin 1 |
| 22–24 | SpinSlot 2 | `bytes3` | Packed spin result for spin 2 |
| 25–27 | SpinSlot 3 | `bytes3` | Packed spin result for spin 3 |
| 28–31 | _unused_ | — | Unused |

### Packed spin result format (3 bytes per slot)

Each spin result is packed into 3 bytes:

| Byte | High nibble | Low nibble |
|------|------------|------------|
| 0 | Slot 1 (0–9) | Slot 2 (0–9) |
| 1 | Slot 3 (0–9) | 0 (padding) |
| 2 | Bonus 1 (0–9) | Bonus 2 (0–9) |

### Key behaviours

- Overwritten every gamble — all 4 spin slots are cleared first.
- `LastReward` is the sum of rewards across all spins in the gamble.
- Read by front-ends to display spin results without parsing events.

---

## Bandit Asset

The Bandit (slot machine) asset represents a configurable one-arm bandit.
One per account (machine owner).

### Payload layout (32 bytes)

| Byte(s) | Field | Type | Description |
|---------|-------|------|-------------|
| 0 | MatchType | `uint8` | Always `0x21` |
| 1–6 | _reserved_ | — | Unused |
| 7 high nibble | SeatLinked | `uint4` | Number of seats currently linked (0–15) |
| 7 low nibble | SeatLimit | `uint4` | Maximum number of seats allowed (1–15) |
| 8 high nibble | Value1Factor | `uint4` | Stake factor — `TokenType` enum (0–6) |
| 8 low nibble | Value1Multiplier | `uint4` | Stake multiplier — `MultiplierType` enum (0–9) |
| 9 high nibble | Value2Factor | `uint4` | Jackpot factor (reserved, currently 0) |
| 9 low nibble | Value2Multiplier | `uint4` | Jackpot multiplier (reserved, currently 0) |
| 10 high nibble | Value3Factor | `uint4` | Special factor (reserved, currently 0) |
| 10 low nibble | Value3Multiplier | `uint4` | Special multiplier (reserved, currently 0) |
| 11–14 | _reserved_ | — | Unused |
| 15 high nibble | _reserved_ | `uint4` | Unused |
| 15 low nibble | MaxSpins | `uint4` | Maximum spins per gamble (1–4) |
| 16–31 | _reserved_ | — | Unused |

### Stake calculation

The machine's per-spin stake (`SingleSpinStake`) is derived from the Value1
fields:

$$\text{Stake} = 10^{\text{Value1Factor}} \times \text{Value1Multiplier}$$

| TokenType enum | Value1Factor | Resulting base |
|---------------|-------------|----------------|
| `T_1` | 0 | 1 |
| `T_10` | 1 | 10 |
| `T_100` | 2 | 100 |
| `T_1000` | 3 | 1,000 |
| `T_10000` | 4 | 10,000 |
| `T_100000` | 5 | 100,000 |
| `T_1000000` | 6 | 1,000,000 |

**Default machine**: `Value1Factor=0, Value1Multiplier=1` → Stake = **1 credit**.

### Key behaviours

- Created by `createMachine()`.
- Configured via `configMachine()` (only when no seats are linked).
- Must hold enough credits to cover `maxMachineReward` for all linked seats.
- `SeatLinked` is incremented on `rent()` and decremented on `returnSeat()`.
- Cannot withdraw credits while any seat is linked.

---

## Seat Asset

The Seat links a player to a machine. Created by the machine owner via
`rent()`, occupied by a player via `reserve()`.

### Payload layout (32 bytes)

| Byte(s) | Field | Type | Description |
|---------|-------|------|-------------|
| 0 | MatchType | `uint8` | Always `0x40` |
| 1–4 | SeatCreationBlock | `uint32` (LE) | Block number when seat was rented |
| 5–6 | _reserved_ | — | Unused |
| 7 | RentDuration | `uint8` | `RentDuration` enum value (1–9) |
| 8–9 | PlayerFee | `uint16` (LE) | Per-reservation-unit fee charged to player |
| 10 | _reserved_ | — | Unused |
| 11 | PlayerGracePeriod | `uint8` | Grace period in blocks after last action |
| 12–15 | ReservationStartBlock | `uint32` (LE) | Block when current reservation started |
| 16 | ReservationDuration | `uint8` | `ReservationDuration` enum value (1–12) |
| 17–19 | _reserved_ | — | Unused |
| 20–21 | LastActionBlockOffset | `uint16` (LE) | Offset from `ReservationStartBlock` to last gamble |
| 22–23 | PlayerActionCount | `uint16` (LE) | Number of gambles executed in current reservation |
| 24–27 | PlayerId | `uint32` (LE) | Human asset ID of occupant. `0` = empty. |
| 28–31 | MachineId | `uint32` (LE) | Bandit asset ID this seat is attached to |

### Rent duration enum

| Value | Name | Days | Blocks |
|-------|------|------|--------|
| 1 | Day1 | 1 | 14,400 |
| 2 | Days2 | 2 | 28,800 |
| 3 | Days3 | 3 | 43,200 |
| 4 | Days5 | 5 | 72,000 |
| 5 | Days7 | 7 | 100,800 |
| 6 | Days14 | 14 | 201,600 |
| 7 | Days28 | 28 | 403,200 |
| 8 | Days56 | 56 | 806,400 |
| 9 | Days112 | 112 | 1,612,800 |

### Reservation duration enum

| Value | Name | Duration | Blocks |
|-------|------|----------|--------|
| 1 | Mins5 | 5 min | 50 |
| 2 | Mins10 | 10 min | 100 |
| 3 | Mins15 | 15 min | 150 |
| 4 | Mins30 | 30 min | 300 |
| 5 | Mins45 | 45 min | 450 |
| 6 | Hour1 | 1 hour | 600 |
| 7 | Hours2 | 2 hours | 1,200 |
| 8 | Hours3 | 3 hours | 1,800 |
| 9 | Hours4 | 4 hours | 2,400 |
| 10 | Hours6 | 6 hours | 3,600 |
| 11 | Hours8 | 8 hours | 4,800 |
| 12 | Hours12 | 12 hours | 7,200 |

### Key behaviours

- Owned by the machine owner (not the player).
- `PlayerId` is set on `reserve()`, cleared on `release()` / `kick()`.
- Destroyed on `returnSeat()` (must be empty first).
- Holds a credit balance from reservation fees; refunded on release, seized
  on kick.

---

## Credit Balances

Credits are tracked per-asset via `mapping(uint256 => uint256) assetBalances`.

| Asset type | Can hold credits? | Funded by | Used for |
|------------|-------------------|-----------|----------|
| Human | Yes | `deposit()` | Pay reservation fees, play fees |
| Bandit | Yes | `deposit()` | Cover rent fees, payout rewards |
| Seat | Yes | Reservation fees transferred in | Held as escrow, refunded or seized |
| Tracker | No | — | — |

### Credit flow

```
  ETH  ──deposit()──▶  assetBalances[human]
                            │
                   reserve()│  (reservation fee)
                            ▼
                      assetBalances[seat]
                            │
                   release() │  (refund minus 1% usage fee)
                            ▼
                      assetBalances[human]

  ETH  ──deposit()──▶  assetBalances[machine]
                            │
                     rent() │  (rent fee → collectedFees)
                            │
                   gamble() │  (play fee to machine; reward to human)
                            ▼
                      assetBalances[human]

  assetBalances[any] ──withdrawCredits()──▶ pendingWithdrawals ──withdraw()──▶ ETH
```

---

## Account Mappings

Each account is limited to one of each asset type:

| Mapping | Description |
|---------|-------------|
| `playerHumanId[address]` | Human asset ID (0 = not created) |
| `playerTrackerId[address]` | Tracker asset ID (0 = not created) |
| `playerMachineId[address]` | Bandit asset ID (0 = not created) |

A single account can be both a player (Human + Tracker) and a machine owner
(Bandit) simultaneously.
