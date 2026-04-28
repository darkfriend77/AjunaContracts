# CasinoJam — Custom Errors

Complete reference of all custom errors defined in CasinoJam.

> CasinoJam also inherits all errors from
> [SageCore Errors](../SageCore/ERRORS.md) (e.g. `NotOwner`,
> `AssetDoesNotExist`, `InsufficientPayment`).

---

## Player & Machine Errors

| Error | Trigger |
|-------|---------|
| `PlayerAlreadyExists` | `createPlayer()` called by an account that already has a Human + Tracker pair |
| `MachineAlreadyExists` | `createMachine()` called by an account that already has a Bandit |

---

## Configuration Errors

| Error | Trigger |
|-------|---------|
| `InvalidExchangeRate` | `setExchangeRate()` called with `newRate == 0` |
| `InvalidRngContract` | Constructor or `setRngContract()` called with zero address |
| `InvalidParameter` | `configMachine()` with `seatLimit == 0` or `seatLimit > 15` |
| `InvalidSpinCount` | `configMachine()` with `maxSpins == 0` or `maxSpins > BANDIT_MAX_SPINS (4)`; or `gamble()` with `spinCount == 0` or `spinCount > machine.MaxSpins` |

---

## Credit / Balance Errors

| Error | Trigger |
|-------|---------|
| `ZeroCreditDeposit` | `deposit()` or `withdrawCredits()` called with `creditAmount == 0` |
| `InsufficientCredits` | Asset balance too low for the requested operation (play fee, reservation fee, rent fee, withdrawal) |
| `MachineCantCoverReward` | Machine's credit balance is insufficient to cover the worst-case payout (`stake × 8192 × maxSpins` per seat) |
| `WithdrawBlockedByLinkedSeats` | `withdrawCredits()` or `configMachine()` on a Bandit that has `SeatLinked > 0` |

---

## Seat Errors

| Error | Trigger |
|-------|---------|
| `NoSeatsAvailable` | `rent()` when `SeatLinked >= SeatLimit` on the machine |
| `SeatOccupied` | `reserve()` when the Seat's `PlayerId ≠ 0` |
| `AlreadySeated` | `reserve()` when the Human's `SeatId ≠ 0` |
| `SeatNotLinkedToMachine` | `gamble()` or `returnSeat()` when Seat's `MachineId` doesn't match the provided machine ID |
| `SeatExpiredForReservation` | `reserve()` when the seat's remaining rent duration is shorter than the requested reservation |
| `NotSeated` | `release()` or `kick()` when Human's `SeatId == 0` or Seat's `PlayerId == 0` |
| `SeatPlayerMismatch` | `release()`, `kick()`, or `gamble()` when the Human↔Seat ID cross-references don't match |
| `SeatNotEmpty` | `returnSeat()` when the Seat's `PlayerId ≠ 0` |
| `InvalidRentDuration` | `rent()` with value outside 1–9 |
| `InvalidReservationDuration` | `reserve()` with value outside 1–12 |

---

## Gamble Errors

| Error | Trigger |
|-------|---------|
| `CooldownNotExpired` | `gamble()` called before `GAMBLE_COOLDOWN` (1 block) has elapsed since last gamble |
| `InvalidSpinCount` | `gamble()` with `spinCount == 0` or exceeding machine's `MaxSpins` |

---

## Asset Type Errors

| Error | Trigger |
|-------|---------|
| `AssetTypeMismatch` | Any function that expects a specific asset kind (Human, Tracker, Bandit, or Seat) but receives a different kind |

---

## Inherited from SageCore

These errors may be encountered during CasinoJam operations:

| Error | CasinoJam context |
|-------|-------------------|
| `NotOwner` | Most functions — caller must own the asset they're acting on |
| `NotContractOwner` | `setExchangeRate()`, `setRngContract()` — admin-only functions |
| `AssetDoesNotExist` | Any operation on a burned or non-existent asset |
| `InsufficientPayment` | `deposit()` when `msg.value < creditAmount × exchangeRate` |
| `InventoryFull` | `createPlayer()`, `createMachine()`, `rent()` — if account inventory is full |

---

## Error by Function

Quick lookup — which errors can each function throw?

| Function | Possible Errors |
|----------|----------------|
| `createPlayer` | `PlayerAlreadyExists`, `InventoryFull`, `AssetIdOverflow` |
| `createMachine` | `MachineAlreadyExists`, `InventoryFull`, `AssetIdOverflow` |
| `configMachine` | `NotOwner`, `AssetTypeMismatch`, `WithdrawBlockedByLinkedSeats`, `InvalidParameter`, `InvalidSpinCount` |
| `deposit` | `ZeroCreditDeposit`, `NotOwner`, `AssetTypeMismatch`, `InsufficientPayment` |
| `withdrawCredits` | `ZeroCreditDeposit`, `NotOwner`, `AssetTypeMismatch`, `WithdrawBlockedByLinkedSeats`, `InsufficientCredits` |
| `rent` | `InvalidRentDuration`, `NotOwner`, `AssetTypeMismatch`, `NoSeatsAvailable`, `InsufficientCredits`, `MachineCantCoverReward` |
| `reserve` | `InvalidReservationDuration`, `NotOwner`, `AssetTypeMismatch`, `AlreadySeated`, `SeatOccupied`, `SeatExpiredForReservation`, `MachineCantCoverReward`, `InsufficientCredits` |
| `release` | `NotOwner`, `AssetTypeMismatch`, `NotSeated`, `SeatPlayerMismatch` |
| `kick` | `NotOwner`, `AssetTypeMismatch`, `NotSeated`, `SeatPlayerMismatch`, `ReservationStillProtected` |
| `returnSeat` | `NotOwner`, `AssetTypeMismatch`, `SeatNotLinkedToMachine`, `SeatNotEmpty` |
| `gamble` | `NotOwner`, `AssetTypeMismatch`, `NotSeated`, `SeatPlayerMismatch`, `SeatNotLinkedToMachine`, `InvalidSpinCount`, `CooldownNotExpired`, `InsufficientCredits`, `MachineCantCoverReward` |
| `setExchangeRate` | `InvalidExchangeRate`, `NotContractOwner` |
| `setRngContract` | `InvalidRngContract`, `NotContractOwner` |

---

## Kick-Specific Error

| Error | Trigger |
|-------|---------|
| `ReservationStillProtected` | `kick()` when **both** conditions hold: (1) reservation has not expired, and (2) grace period is still active |
