# CasinoJam — Game Flow

End-to-end lifecycle of a CasinoJam session, from account creation to
ETH withdrawal.

---

## Table of Contents

1. [High-Level Flow](#high-level-flow)
2. [Phase 1 — Setup](#phase-1--setup)
3. [Phase 2 — Machine Operation](#phase-2--machine-operation)
4. [Phase 3 — Gameplay](#phase-3--gameplay)
5. [Phase 4 — Exit](#phase-4--exit)
6. [Full Lifecycle Diagram](#full-lifecycle-diagram)
7. [Dual-Role Scenario](#dual-role-scenario)

---

## High-Level Flow

```
  Setup          Machine Ops       Gameplay          Exit
┌──────────┐   ┌────────────┐   ┌────────────┐   ┌──────────┐
│ Create   │──▶│ Create     │──▶│ Reserve    │──▶│ Release  │
│ Player   │   │ Machine    │   │ Seat       │   │ Seat     │
│          │   │            │   │            │   │          │
│ Deposit  │   │ Fund       │   │ Gamble ×N  │   │ Withdraw │
│ Credits  │   │ Machine    │   │ (spin)     │   │ Credits  │
│          │   │            │   │            │   │          │
│          │   │ Rent Seat  │   │            │   │ Withdraw │
│          │   │            │   │            │   │ ETH      │
└──────────┘   └────────────┘   └────────────┘   └──────────┘
```

---

## Phase 1 — Setup

### 1.1 Create a Player

```solidity
(uint256 humanId, uint256 trackerId) = casinoJam.createPlayer();
```

- Mints a **Human** (KIND_HUMAN = 0x11) and **Tracker** (KIND_TRACKER = 0x12).
- One per account — reverts with `PlayerAlreadyExists` on duplicate call.
- Both assets are stored in `playerHumanId[msg.sender]` and
  `playerTrackerId[msg.sender]`.

### 1.2 Deposit Credits

```solidity
uint256 credits = 1000;
uint256 cost = credits * casinoJam.exchangeRate();
casinoJam.deposit{value: cost}(humanId, credits);
```

- Converts ETH to credits at the current `exchangeRate`.
- Default: 1 credit = 1 szabo = 0.000001 ETH.
- Excess ETH is automatically refunded to `pendingWithdrawals`.

---

## Phase 2 — Machine Operation

The machine owner creates and manages slot machines. This can be a
different account from the player, or the same account.

### 2.1 Create a Machine

```solidity
uint256 machineId = casinoJam.createMachine();
```

- Mints a **Bandit** (KIND_BANDIT = 0x21) with default configuration:
  - `SeatLimit = 1`
  - `MaxSpins = 4`
  - `Stake = 1 credit` (Factor=0, Multiplier=1)
- One per account.

### 2.2 Configure Machine (Optional)

```solidity
casinoJam.configMachine(
    machineId,
    3,    // seatLimit — up to 3 concurrent players
    4,    // maxSpins — 4 spins per gamble
    2,    // value1Factor — TokenType T_100 (10^2 = 100)
    5     // value1Multiplier — MultiplierType V5
);
// Stake = 10^2 × 5 = 500 credits per spin
```

- Can only be called when **no seats are linked** (`SeatLinked == 0`).

### 2.3 Fund the Machine

```solidity
uint256 credits = 100000;
casinoJam.deposit{value: credits * exchangeRate}(machineId, credits);
```

- The machine must hold enough credits to cover the worst-case payout
  for all linked seats:
  `maxReward = stake × SINGLE_SPIN_MAX_REWARD (8192) × maxSpins × seatCount`

### 2.4 Rent a Seat

```solidity
uint256 seatId = casinoJam.rent(machineId, 1); // RentDuration.Day1
```

- Creates a **Seat** (KIND_SEAT = 0x40) linked to the machine.
- Deducts rent fee: `BASE_RENT_FEE (10) × rentDuration` from machine
  balance → `collectedFees`.
- Increments `SeatLinked` on the machine.
- Validates machine can cover max reward for all seats post-rent.

---

## Phase 3 — Gameplay

### 3.1 Reserve a Seat

```solidity
casinoJam.reserve(humanId, seatId, 6); // ReservationDuration.Hour1
```

- Links the player (Human) to the seat.
- Pays reservation fee: `PlayerFee × reservationDuration` credits,
  transferred from Human → Seat.
- Sets `SeatId` on Human and `PlayerId` on Seat.
- Verifies machine can still cover max reward.
- Checks that remaining rent time covers the reservation.

### 3.2 Gamble (Spin the Reels)

```solidity
casinoJam.gamble(humanId, trackerId, seatId, machineId, 4); // 4 spins
```

- Must wait `GAMBLE_COOLDOWN` (1 block) between gambles.
- For each spin:
  1. 5 random bytes → 5 reel symbols via weighted distribution.
  2. Reward calculated from three-of-a-kind, bonus pairs, and full-line matches.
  3. Result packed and stored in Tracker payload.
- **Play fee**: `spinCount` credits deducted from Human → Machine.
- **Reward**: total reward credits transferred from Machine → Human.
- Emits `SpinResult` per spin and `GambleResult` at the end.

### 3.3 Repeat

Players can gamble repeatedly as long as:
- The cooldown has elapsed (1 block between gambles).
- The reservation hasn't expired.
- Human has enough credits for the play fee.
- Machine has enough credits for the max potential payout.

---

## Phase 4 — Exit

### 4.1 Release Seat

```solidity
casinoJam.release(humanId, seatId);
```

- Voluntary exit from the seat.
- Refund = reservation fee − 1% usage fee (capped at seat balance).
- Clears `SeatId` on Human and `PlayerId` on Seat.
- The seat is now available for another player to reserve.

### 4.2 Alternative: Get Kicked

If a player's reservation expires or they go idle (grace period elapses),
another player can kick them:

```solidity
casinoJam.kick(sniperHumanId, victimHumanId, seatId);
```

- Sniper receives the **entire seat balance** as bounty.
- Victim loses their reservation fee.

### 4.3 Return Seat (Machine Owner)

```solidity
casinoJam.returnSeat(machineId, seatId);
```

- Burns an **empty** seat (no player seated).
- Remaining seat balance → owner's `pendingWithdrawals`.
- Decrements `SeatLinked` on the machine.

### 4.4 Withdraw Credits

```solidity
casinoJam.withdrawCredits(humanId, creditAmount);
// or
casinoJam.withdrawCredits(machineId, creditAmount);
```

- Converts credits back to wei → `pendingWithdrawals`.
- Machines: blocked while any seat is linked.

### 4.5 Withdraw ETH

```solidity
casinoJam.withdraw(); // inherited from SageCore pull-payment
```

- Sends accumulated `pendingWithdrawals[msg.sender]` to the caller.

---

## Full Lifecycle Diagram

```
  Player                    Machine Owner
  ──────                    ─────────────
    │                            │
    │                     createMachine()
    │                            │
    │                      deposit()
    │                      [fund credits]
    │                            │
    │                        rent()
    │                    [create seat]
    │                            │
  createPlayer()                 │
    │                            │
  deposit()                      │
  [fund credits]                 │
    │                            │
  reserve(humanId, seatId, dur)  │
  [pay reservation fee]         │
    │                            │
    ├──── gamble() ──────────────┤
    │   [spin → pay fee/reward]  │
    ├──── gamble() ──────────────┤
    │                            │
    ├──── gamble() ──────────────┤
    │                            │
  release(humanId, seatId)       │
  [receive refund]               │
    │                            │
  withdrawCredits()              │
    │                            │
  withdraw()                     │
  [receive ETH]           returnSeat()
                          [burn seat]
                                 │
                          withdrawCredits()
                                 │
                          withdraw()
                          [receive ETH]
```

---

## Dual-Role Scenario

A single account can be both a player and a machine owner simultaneously:

```solidity
// Same account does everything
casinoJam.createPlayer();
casinoJam.createMachine();

// Fund both
casinoJam.deposit{value: ...}(humanId, playerCredits);
casinoJam.deposit{value: ...}(machineId, machineCredits);

// Machine operations
casinoJam.rent(machineId, 1);

// Play on your own machine
casinoJam.reserve(humanId, seatId, 1);
casinoJam.gamble(humanId, trackerId, seatId, machineId, 4);
```

This is valid — the contract doesn't enforce role separation.
