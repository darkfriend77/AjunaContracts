# CasinoJam — Seat Management

Complete specification of the Seat lifecycle: rent, reserve, release,
kick, and return.

---

## Table of Contents

1. [Overview](#overview)
2. [Seat Lifecycle Diagram](#seat-lifecycle-diagram)
3. [Rent — Creating a Seat](#rent--creating-a-seat)
4. [Reserve — Occupying a Seat](#reserve--occupying-a-seat)
5. [Gamble — Using a Seat](#gamble--using-a-seat)
6. [Release — Voluntary Exit](#release--voluntary-exit)
7. [Kick — Forced Eviction](#kick--forced-eviction)
8. [Return — Destroying a Seat](#return--destroying-a-seat)
9. [Fee Summary](#fee-summary)
10. [Protection Mechanics](#protection-mechanics)

---

## Overview

A **Seat** is the bridge between a player and a machine. It is:

- **Created** by the machine owner (`rent()`).
- **Occupied** by a player (`reserve()`).
- **Used** for gameplay (`gamble()`).
- **Vacated** voluntarily (`release()`) or forcefully (`kick()`).
- **Destroyed** by the machine owner (`returnSeat()`).

The Seat also acts as an escrow — holding the player's reservation fee
until they leave.

---

## Seat Lifecycle Diagram

```
                    rent()
  Machine Owner ────────────▶ SEAT CREATED (empty)
                                    │
                              reserve()
                  Player ───────────▶ SEAT OCCUPIED
                                    │
                              gamble() × N
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              release()        kick()          (seat still
              (voluntary)    (forced eviction)   occupied)
                    │               │               │
                    ▼               ▼               │
              SEAT EMPTY      SEAT EMPTY           │
                    │               │               │
                    ▼               ▼               │
              returnSeat()    returnSeat()          │
              (burn)          (burn)                 │
                                                    │
                                              reserve()
                                              (by another
                                               player)
```

---

## Rent — Creating a Seat

**Function**: `rent(uint256 machineId, uint8 rentDuration) → uint256 seatId`

### Who
Machine owner only.

### Prerequisites
- Machine exists and is owned by caller.
- `SeatLinked < SeatLimit` on the machine.
- Machine has credits for rent fee + worst-case reward for all seats.

### Fee
```
rentFee = BASE_RENT_FEE (10) × rentDuration
```

| RentDuration | Enum | Days | Fee (credits) |
|-------------|------|------|---------------|
| Day1 | 1 | 1 | 10 |
| Days2 | 2 | 2 | 20 |
| Days3 | 3 | 3 | 30 |
| Days5 | 4 | 5 | 40 |
| Days7 | 5 | 7 | 50 |
| Days14 | 6 | 14 | 60 |
| Days28 | 7 | 28 | 70 |
| Days56 | 8 | 56 | 80 |
| Days112 | 9 | 112 | 90 |

Rent fee is deducted from machine balance and added to `collectedFees`
(contract owner can withdraw).

### Solvency check

After paying the rent fee, the machine must still have enough credits to
cover the maximum possible reward for all linked seats:

$$\text{required} \geq \text{stake} \times 8192 \times \text{maxSpins} \times (\text{SeatLinked} + 1)$$

### Seat initialization

| Field | Value |
|-------|-------|
| MatchType | `0x40` |
| SeatCreationBlock | `block.number` |
| RentDuration | Caller-specified |
| PlayerFee | 1 (hardcoded) |
| PlayerGracePeriod | 30 blocks (~3 min) |
| MachineId | `machineId` |
| PlayerId | 0 (empty) |

---

## Reserve — Occupying a Seat

**Function**: `reserve(uint256 humanId, uint256 seatId, uint8 reservationDuration)`

### Who
Any player (must own the Human asset).

### Prerequisites
- Human is not already seated (`SeatId == 0`).
- Seat is empty (`PlayerId == 0`).
- Remaining rent time ≥ requested reservation time.
- Machine can cover max reward.
- Human has credits for the reservation fee.

### Fee

$$\text{reservationFee} = \text{PlayerFee} \times \text{reservationDuration}$$

With default `PlayerFee = 1`:

| ReservationDuration | Enum | Duration | Fee |
|-------------------|------|----------|-----|
| Mins5 | 1 | 5 min | 1 |
| Mins10 | 2 | 10 min | 2 |
| Mins15 | 3 | 15 min | 3 |
| Mins30 | 4 | 30 min | 4 |
| Mins45 | 5 | 45 min | 5 |
| Hour1 | 6 | 1 hour | 6 |
| Hours2 | 7 | 2 hours | 7 |
| Hours3 | 8 | 3 hours | 8 |
| Hours4 | 9 | 4 hours | 9 |
| Hours6 | 10 | 6 hours | 10 |
| Hours8 | 11 | 8 hours | 11 |
| Hours12 | 12 | 12 hours | 12 |

Credits are transferred from the Human's balance to the Seat's balance
(held as escrow).

### Rent expiry check

The seat's remaining rent time must be sufficient to cover the full
reservation:

```
seatEnd = SeatCreationBlock + rentDurationBlocks(RentDuration)
reservBlocks = reservationDurationBlocks(reservationDuration)

Require: block.number ≤ seatEnd − reservBlocks
```

### State changes

| Asset | Field | Change |
|-------|-------|--------|
| Human | SeatId | Set to `seatId` |
| Seat | PlayerId | Set to `humanId` |
| Seat | ReservationStartBlock | Set to `block.number` |
| Seat | ReservationDuration | Set to `reservationDuration` |
| Seat | LastActionBlockOffset | Reset to 0 |
| Seat | PlayerActionCount | Reset to 0 |

---

## Gamble — Using a Seat

While seated, the player can `gamble()`. Each gamble updates the seat's
tracking fields:

| Field | Update |
|-------|--------|
| PlayerActionCount | Incremented by 1 |
| LastActionBlockOffset | Set to `block.number − ReservationStartBlock` (capped at uint16 max) |

These fields are used by the kick protection system (see below).

---

## Release — Voluntary Exit

**Function**: `release(uint256 humanId, uint256 seatId)`

### Who
The player occupying the seat.

### Refund calculation

```
fullFee   = PlayerFee × ReservationDuration
usageFee  = 1% of fullFee   (SEAT_USAGE_FEE_PERC = 1)
refund    = fullFee − usageFee
refund    = min(refund, seatBalance)
```

The refund is transferred from the Seat's balance back to the Human's
balance. Any remainder stays in the Seat.

### State changes

| Asset | Field | Change |
|-------|-------|--------|
| Human | SeatId | Cleared to 0 |
| Seat | PlayerId | Cleared to 0 |
| Seat | ReservationStartBlock | Cleared to 0 |
| Seat | ReservationDuration | Cleared to 0 |
| Seat | LastActionBlockOffset | Cleared to 0 |
| Seat | PlayerActionCount | Cleared to 0 |

The seat is now available for another player to `reserve()`.

---

## Kick — Forced Eviction

**Function**: `kick(uint256 sniperHumanId, uint256 victimHumanId, uint256 seatId)`

### Who
Any player (the "sniper") — must own their Human asset.

### When is kick allowed?

A kick is **blocked** only when **both** of these conditions hold:

1. **Reservation is valid**: `ReservationStartBlock + reservationBlocks ≥ block.number`
2. **Grace period is active**: `lastActionBlock + PlayerGracePeriod ≥ block.number`

Where:
```
lastActionBlock = ReservationStartBlock + LastActionBlockOffset
```

If **either** condition fails, the kick succeeds:

| Reservation | Grace period | Kick allowed? |
|-------------|-------------|--------------|
| Valid | Active | **No** — `ReservationStillProtected` |
| Valid | Expired | **Yes** — player went idle |
| Expired | Active | **Yes** — reservation ran out |
| Expired | Expired | **Yes** — both expired |

### Bounty

The sniper receives the **entire Seat balance** as bounty:

```
bounty = assetBalances[seatId]
assetBalances[seatId] = 0
assetBalances[sniperHumanId] += bounty
```

### State changes

| Asset | Field | Change |
|-------|-------|--------|
| Victim Human | SeatId | Cleared to 0 |
| Seat | PlayerId | Cleared to 0 |
| Seat | ReservationStartBlock | Cleared to 0 |
| Seat | ReservationDuration | Cleared to 0 |
| Seat | LastActionBlockOffset | Cleared to 0 |
| Seat | PlayerActionCount | Cleared to 0 |

The seat is now empty and can be reserved by another player.

### Incentive design

- **For players**: Keep gambling regularly to reset the grace period timer.
  If you go idle for more than `PlayerGracePeriod` (30 blocks ≈ 3 min),
  anyone can kick you and take your deposit.
- **For snipers**: Monitor seats for expired/idle players. The bounty is
  the victim's entire reservation fee deposit.

---

## Return — Destroying a Seat

**Function**: `returnSeat(uint256 machineId, uint256 seatId)`

### Who
Machine owner only (must own both the Bandit and the Seat).

### Prerequisites
- Seat is linked to `machineId` (`MachineId == machineId`).
- Seat is empty (`PlayerId == 0`).
- Machine has at least 1 linked seat.

### Actions
1. Remaining seat balance converted to wei → `pendingWithdrawals[owner]`.
2. Machine's `SeatLinked` decremented by 1.
3. Seat asset is **burned** (permanently deleted).

### When to return seats
- After a player `release()`s or gets `kick()`ed, the seat becomes empty.
- The machine owner should `returnSeat()` to free up the seat slot and
  reclaim any remaining balance.
- Machine cannot be reconfigured or have credits withdrawn while seats
  are linked.

---

## Fee Summary

| Fee | Formula | Paid by | Received by |
|-----|---------|---------|-------------|
| Rent fee | `BASE_RENT_FEE × rentDuration` | Machine (credits) | `collectedFees` (contract owner) |
| Reservation fee | `PlayerFee × reservationDuration` | Human (credits) | Seat (escrow) |
| Usage fee on release | `1% of reservationFee` | Seat (retained) | Stays in seat balance |
| Play fee | `spinCount` (1 credit per spin) | Human (credits) | Machine (credits) |
| Kick bounty | Entire seat balance | Seat (credits) | Sniper Human (credits) |

---

## Protection Mechanics

### Grace period

- Default: **30 blocks** (~3 minutes at 6-sec blocks).
- Resets with each `gamble()` call (via `LastActionBlockOffset` update).
- If the player doesn't gamble within the grace period, they become
  vulnerable to kicks.

### Reservation expiry

- Based on `ReservationStartBlock + reservationDurationBlocks`.
- Once expired, player can be kicked regardless of grace period.

### Cooldown

- Between gambles: **1 block** (`GAMBLE_COOLDOWN`).
- Prevents same-block double-play (same randomness issue).

### Machine solvency

- Checked at `rent()`, `reserve()`, and `gamble()`.
- Machine must always hold enough credits to cover worst-case payout
  for all linked seats.
- Formula: `stake × 8192 × maxSpins × linkedSeatCount`
