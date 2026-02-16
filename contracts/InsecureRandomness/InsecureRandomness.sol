// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

/**
 * @title InsecureRandomness
 * @author Ajuna Network
 * @notice Solidity recreation of Substrate's `pallet_insecure_randomness_collective_flip`.
 *
 * ⚠️  DO NOT USE IN PRODUCTION for high-stake use-cases.
 *
 * Generates low-influence random values based on previous block hashes,
 * mirroring the pallet's approach:
 *   - The pallet uses the last 81 parent block hashes stored in a ring buffer.
 *   - This contract uses the EVM `blockhash()` opcode, which natively gives
 *     access to the last 256 block hashes — no storage required.
 *   - The mixing uses iterative hashing with an index + subject, similar to
 *     the pallet's `triplet_mix` approach.
 *
 * Security properties are comparable to the pallet:
 *   - Not predictable by the transaction sender at submission time.
 *   - Block producers have low (but non-zero) influence.
 *   - NOT suitable for high-value randomness (use VRF/oracle for that).
 */
contract InsecureRandomness {
    /// @notice Number of block hashes to mix (matches the pallet's 81).
    uint256 public constant RANDOM_MATERIAL_LEN = 81;

    /**
     * @notice Generate a pseudo-random value from recent block hashes.
     * @param subject Application-specific context bytes to domain-separate
     *                the randomness (e.g. "lottery", "nft-mint").
     * @return seed The mixed pseudo-random hash.
     * @return blockOffset The oldest block number contributing to the seed.
     *                     The randomness was influenced by blocks from
     *                     (current - RANDOM_MATERIAL_LEN) to (current - 1).
     */
    function random(
        bytes memory subject
    ) public view returns (bytes32 seed, uint256 blockOffset) {
        uint256 currentBlock = block.number;

        // We need at least 1 previous block
        if (currentBlock == 0) {
            return (bytes32(0), 0);
        }

        // Determine how many blocks we can actually use (capped at 81).
        // blockhash() only works for the last 256 blocks, and block hashes
        // start from block.number - 1 (the parent).
        uint256 available = currentBlock; // blocks 0..currentBlock-1 exist
        if (available > RANDOM_MATERIAL_LEN) {
            available = RANDOM_MATERIAL_LEN;
        }

        // Also cap to EVM's 256-block blockhash limit
        if (available > 256) {
            available = 256;
        }

        // Mix block hashes with index and subject, similar to the pallet's
        // triplet_mix which combines (index, subject, hash) per iteration.
        for (uint256 i = 0; i < available; i++) {
            uint256 blockNum = currentBlock - 1 - i;
            bytes32 bHash = blockhash(blockNum);

            // Replicate the pallet's approach: hash(index, subject, blockHash)
            // then XOR-accumulate (the pallet uses triplet_mix, which is
            // effectively an XOR-based mixing of hashed triples).
            seed ^= keccak256(abi.encodePacked(i, subject, bHash));
        }

        blockOffset = currentBlock > RANDOM_MATERIAL_LEN
            ? currentBlock - RANDOM_MATERIAL_LEN
            : 0;

        return (seed, blockOffset);
    }

    /**
     * @notice Convenience wrapper that returns just the random hash.
     * @param subject Domain separation context.
     * @return A pseudo-random bytes32 value.
     */
    function randomValue(
        bytes memory subject
    ) external view returns (bytes32) {
        (bytes32 value, ) = random(subject);
        return value;
    }

    /**
     * @notice Generate a random uint256 in a range [0, max).
     * @param subject Domain separation context.
     * @param max Upper bound (exclusive). Must be > 0.
     * @return A pseudo-random number in [0, max).
     */
    function randomInRange(
        bytes memory subject,
        uint256 max
    ) external view returns (uint256) {
        require(max > 0, "max must be > 0");
        (bytes32 value, ) = random(subject);
        return uint256(value) % max;
    }
}
