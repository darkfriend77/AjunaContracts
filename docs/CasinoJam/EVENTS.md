# CasinoJam — Events

Complete catalogue of all events emitted by CasinoJam.

> CasinoJam also inherits all events from
> [SageCore Events](../SageCore/EVENTS.md) (e.g. `AssetMinted`,
> `WithdrawalDeposited`, `WithdrawalCompleted`).

---

## Player & Machine Lifecycle

| Event | Parameters | Emitted by |
|-------|-----------|------------|
| `PlayerCreated` | `address indexed player, uint256 humanId, uint256 trackerId` | `createPlayer()` |
| `MachineCreated` | `address indexed machineOwner, uint256 machineId` | `createMachine()` |
| `MachineConfigured` | `uint256 indexed machineId` | `configMachine()` |

---

## Credit Economy

| Event | Parameters | Emitted by |
|-------|-----------|------------|
| `CreditsDeposited` | `uint256 indexed assetId, address indexed depositor, uint256 credits` | `deposit()` |
| `CreditsWithdrawn` | `uint256 indexed assetId, address indexed withdrawer, uint256 credits, uint256 weiAmount` | `withdrawCredits()` |

---

## Seat Lifecycle

| Event | Parameters | Emitted by |
|-------|-----------|------------|
| `SeatRented` | `uint256 indexed machineId, uint256 seatId, uint8 rentDuration` | `rent()` |
| `SeatReserved` | `uint256 indexed seatId, uint256 humanId, uint8 reservationDuration, uint256 reservationFee` | `reserve()` |
| `SeatReleased` | `uint256 indexed seatId, uint256 humanId, uint256 refund, uint256 usageFee` | `release()` |
| `PlayerKicked` | `uint256 indexed seatId, uint256 victimId, uint256 sniperId, uint256 bounty` | `kick()` |
| `SeatReturned` | `uint256 indexed machineId, uint256 seatId, uint256 remainingBalance` | `returnSeat()` |

---

## Gamble

| Event | Parameters | Emitted by |
|-------|-----------|------------|
| `SpinResult` | `uint256 indexed humanId, uint8 spinIndex, uint8 slot1, uint8 slot2, uint8 slot3, uint8 bonus1, uint8 bonus2, uint256 reward` | `_executeSpins()` (inside `gamble()`) |
| `GambleResult` | `uint256 indexed humanId, uint256 indexed machineId, uint8 spinCount, uint256 totalReward, uint256 playFee` | `gamble()` |

### SpinResult details

Emitted once per spin (up to 4 per gamble). Each symbol is a value 0–9:

| Symbol ID | Name |
|-----------|------|
| 0 | BLANK |
| 1 | CHERRY |
| 2 | LEMON |
| 3 | ORANGE |
| 4 | PLUM |
| 5 | WATERMELON |
| 6 | GRAPE |
| 7 | BELL |
| 8 | BAR |
| 9 | DIAMOND |

---

## Configuration

| Event | Parameters | Emitted by |
|-------|-----------|------------|
| `ExchangeRateChanged` | `uint256 oldRate, uint256 newRate` | `setExchangeRate()` |
| `RngContractChanged` | `address oldAddr, address newAddr` | `setRngContract()` |

---

## Inherited from SageCore

The following events are inherited and may be emitted during CasinoJam
operations:

| Event | When emitted in CasinoJam |
|-------|--------------------------|
| `AssetMinted` | `createPlayer()`, `createMachine()`, `rent()` — every asset creation |
| `AssetBurned` | `returnSeat()` — seat destruction |
| `WithdrawalDeposited` | `deposit()` (excess refund), `withdrawCredits()`, `returnSeat()` |
| `WithdrawalCompleted` | `withdraw()` — ETH sent to user |

---

## Event Flow Examples

### Full gamble session

```
1. PlayerCreated(player, humanId, trackerId)       ← createPlayer()
2. AssetMinted(humanId, player, 0x11)               ← internal
3. AssetMinted(trackerId, player, 0x12)              ← internal
4. CreditsDeposited(humanId, player, 1000)           ← deposit()
5. MachineCreated(machineOwner, machineId)           ← createMachine()
6. CreditsDeposited(machineId, machineOwner, 50000)  ← deposit()
7. SeatRented(machineId, seatId, 1)                  ← rent()
8. SeatReserved(seatId, humanId, 6, 6)               ← reserve()
9. SpinResult(humanId, 0, 7, 7, 7, 3, 5, 500)       ← gamble()
10. SpinResult(humanId, 1, 1, 4, 0, 2, 2, 2)
11. GambleResult(humanId, machineId, 2, 502, 2)
12. SeatReleased(seatId, humanId, 5, 1)              ← release()
13. SeatReturned(machineId, seatId, 0)               ← returnSeat()
14. CreditsWithdrawn(humanId, player, 500, 500e12)   ← withdrawCredits()
15. WithdrawalCompleted(player, 500e12)              ← withdraw()
```
