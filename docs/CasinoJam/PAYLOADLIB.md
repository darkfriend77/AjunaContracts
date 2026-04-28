# CasinoJam — PayloadLib

Reference for the `PayloadLib` library used by CasinoJam to read and write
packed data within `bytes32` payloads.

---

## Table of Contents

1. [Overview](#overview)
2. [Encoding Convention](#encoding-convention)
3. [Byte Layout](#byte-layout)
4. [Single Byte Operations](#single-byte-operations)
5. [Nibble Operations](#nibble-operations)
6. [Little-Endian uint16](#little-endian-uint16)
7. [Little-Endian uint32](#little-endian-uint32)
8. [Usage Examples](#usage-examples)

---

## Overview

`PayloadLib` is a Solidity library that provides low-level read/write
access to individual bytes, nibbles (4-bit values), and multi-byte integers
within a `bytes32` word.

**Source**: `contracts/CasinoJam/PayloadLib.sol`

All CasinoJam asset payloads (Human, Tracker, Bandit, Seat) use this
library to pack and unpack their fields into the 32-byte payload slot
inherited from SageCore's `Asset` struct.

---

## Encoding Convention

### Byte indexing

`bytes32` byte 0 is the **leftmost** (highest/most-significant) byte:

```
bytes32:  [byte0][byte1][byte2] ... [byte30][byte31]
           MSB                              LSB
```

### Endianness

Multi-byte values (uint16, uint32) use **little-endian** encoding to match
the C# reference implementation (`System.BitConverter` on x86):

```
uint16 value = 0x1234
Written at position p:
  byte[p]   = 0x34  (low byte)
  byte[p+1] = 0x12  (high byte)
```

This is the **opposite** of Solidity's native big-endian encoding. The
library handles conversion transparently.

---

## Byte Layout

The 32-byte payload is addressed by position (0–31). Each asset type
defines its own layout over these positions. See
[DATA-MODEL.md](DATA-MODEL.md) for per-asset layouts.

---

## Single Byte Operations

### `readByte(bytes32 data, uint8 pos) → uint8`

Read a single byte at position `pos`.

```solidity
uint8 value = payload.readByte(7); // read byte at position 7
```

---

### `writeByte(bytes32 data, uint8 pos, uint8 val) → bytes32`

Write a single byte at position `pos`, returning the modified payload.

```solidity
payload = payload.writeByte(0, 0x11); // set byte 0 to 0x11
```

**Implementation**: Uses bit shifting and masking:
```
shift = (31 - pos) * 8
mask  = ~(0xFF << shift)
result = (data & mask) | (val << shift)
```

---

## Nibble Operations

A nibble is a 4-bit value (0–15). Each byte contains two nibbles:
- **High nibble**: bits 7–4 (upper half)
- **Low nibble**: bits 3–0 (lower half)

### `readHighNibble(bytes32 data, uint8 pos) → uint8`

Read the upper 4 bits of the byte at `pos`.

```solidity
uint8 seatLinked = payload.readHighNibble(7); // bits 7-4 of byte 7
```

---

### `readLowNibble(bytes32 data, uint8 pos) → uint8`

Read the lower 4 bits of the byte at `pos`.

```solidity
uint8 seatLimit = payload.readLowNibble(7); // bits 3-0 of byte 7
```

---

### `writeHighNibble(bytes32 data, uint8 pos, uint8 val) → bytes32`

Write the upper 4 bits of the byte at `pos`, preserving the low nibble.

```solidity
payload = payload.writeHighNibble(7, 3); // set high nibble of byte 7 to 3
// Byte 7: [3:lowNibble] → 0x3?
```

---

### `writeLowNibble(bytes32 data, uint8 pos, uint8 val) → bytes32`

Write the lower 4 bits of the byte at `pos`, preserving the high nibble.

```solidity
payload = payload.writeLowNibble(7, 5); // set low nibble of byte 7 to 5
// Byte 7: [highNibble:5] → 0x?5
```

---

## Little-Endian uint16

### `readUint16LE(bytes32 data, uint8 pos) → uint16`

Read a 2-byte little-endian unsigned integer starting at `pos`.

```solidity
uint16 playerFee = payload.readUint16LE(8);
// byte[8] = low byte, byte[9] = high byte
// value = byte[8] | (byte[9] << 8)
```

---

### `writeUint16LE(bytes32 data, uint8 pos, uint16 val) → bytes32`

Write a 2-byte little-endian unsigned integer starting at `pos`.

```solidity
payload = payload.writeUint16LE(8, 256);
// byte[8] = 0x00 (low byte of 256)
// byte[9] = 0x01 (high byte of 256)
```

---

## Little-Endian uint32

### `readUint32LE(bytes32 data, uint8 pos) → uint32`

Read a 4-byte little-endian unsigned integer starting at `pos`.

```solidity
uint32 machineId = payload.readUint32LE(28);
// byte[28] | (byte[29] << 8) | (byte[30] << 16) | (byte[31] << 24)
```

---

### `writeUint32LE(bytes32 data, uint8 pos, uint32 val) → bytes32`

Write a 4-byte little-endian unsigned integer starting at `pos`.

```solidity
payload = payload.writeUint32LE(28, uint32(machineId));
```

---

## Usage Examples

### Building a Human payload

```solidity
bytes32 payload = bytes32(0);
payload = payload.writeByte(0, 0x11);          // MatchType = Human
payload = payload.writeUint32LE(28, uint32(seatId)); // SeatId
```

### Building a Bandit payload

```solidity
bytes32 p = bytes32(0);
p = p.writeByte(0, 0x21);           // MatchType = Bandit
p = p.writeHighNibble(7, 0);        // SeatLinked = 0
p = p.writeLowNibble(7, 3);         // SeatLimit = 3
p = p.writeHighNibble(8, 2);        // Value1Factor = T_100
p = p.writeLowNibble(8, 5);         // Value1Multiplier = V5
p = p.writeLowNibble(15, 4);        // MaxSpins = 4
// Stake = 10^2 × 5 = 500
```

### Reading seat fields

```solidity
bytes32 sp = seat.payload;
uint32 creationBlock = sp.readUint32LE(1);
uint8  rentDuration  = sp.readByte(7);
uint16 playerFee     = sp.readUint16LE(8);
uint32 playerId      = sp.readUint32LE(24);
uint32 machineId     = sp.readUint32LE(28);
```

### Nibble packing pattern

Byte 7 of the Bandit payload packs two values into a single byte:

```
Byte 7:  [SeatLinked:4][SeatLimit:4]

Example: SeatLinked=2, SeatLimit=5
  → byte 7 = 0x25

Read:
  SeatLinked = readHighNibble(p, 7)  → 2
  SeatLimit  = readLowNibble(p, 7)   → 5

Write:
  p = writeHighNibble(p, 7, 2)  // set SeatLinked
  p = writeLowNibble(p, 7, 5)   // set SeatLimit
```
