// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PayloadLib
 * @notice Library for reading/writing packed data in bytes32 payloads.
 * @dev Uses little-endian encoding for multi-byte values to match
 *      the C# reference implementation (System.BitConverter on x86).
 *
 *      bytes32 indexing: byte 0 = leftmost (highest) byte.
 */
library PayloadLib {
  // ── Single byte ──────────────────────────────────────────────

  function readByte(bytes32 data, uint8 pos) internal pure returns (uint8) {
    return uint8(data[pos]);
  }

  function writeByte(
    bytes32 data,
    uint8 pos,
    uint8 val
  ) internal pure returns (bytes32) {
    uint256 shift = (31 - pos) * 8;
    uint256 mask = ~(uint256(0xFF) << shift);
    return bytes32((uint256(data) & mask) | (uint256(val) << shift));
  }

  // ── Nibbles ──────────────────────────────────────────────────

  function readHighNibble(
    bytes32 data,
    uint8 pos
  ) internal pure returns (uint8) {
    return uint8(data[pos]) >> 4;
  }

  function readLowNibble(
    bytes32 data,
    uint8 pos
  ) internal pure returns (uint8) {
    return uint8(data[pos]) & 0x0F;
  }

  function writeHighNibble(
    bytes32 data,
    uint8 pos,
    uint8 val
  ) internal pure returns (bytes32) {
    uint8 cur = uint8(data[pos]);
    return writeByte(data, pos, (val << 4) | (cur & 0x0F));
  }

  function writeLowNibble(
    bytes32 data,
    uint8 pos,
    uint8 val
  ) internal pure returns (bytes32) {
    uint8 cur = uint8(data[pos]);
    return writeByte(data, pos, (cur & 0xF0) | (val & 0x0F));
  }

  // ── Little-endian uint16 ─────────────────────────────────────

  function readUint16LE(
    bytes32 data,
    uint8 pos
  ) internal pure returns (uint16) {
    return uint16(uint8(data[pos])) | (uint16(uint8(data[pos + 1])) << 8);
  }

  function writeUint16LE(
    bytes32 data,
    uint8 pos,
    uint16 val
  ) internal pure returns (bytes32) {
    data = writeByte(data, pos, uint8(val & 0xFF));
    data = writeByte(data, pos + 1, uint8((val >> 8) & 0xFF));
    return data;
  }

  // ── Little-endian uint32 ─────────────────────────────────────

  function readUint32LE(
    bytes32 data,
    uint8 pos
  ) internal pure returns (uint32) {
    return
      uint32(uint8(data[pos])) |
      (uint32(uint8(data[pos + 1])) << 8) |
      (uint32(uint8(data[pos + 2])) << 16) |
      (uint32(uint8(data[pos + 3])) << 24);
  }

  function writeUint32LE(
    bytes32 data,
    uint8 pos,
    uint32 val
  ) internal pure returns (bytes32) {
    data = writeByte(data, pos, uint8(val & 0xFF));
    data = writeByte(data, pos + 1, uint8((val >> 8) & 0xFF));
    data = writeByte(data, pos + 2, uint8((val >> 16) & 0xFF));
    data = writeByte(data, pos + 3, uint8((val >> 24) & 0xFF));
    return data;
  }
}
