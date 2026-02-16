// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import './SageCore.sol';

/**
 * @title TestGame
 * @notice Minimal concrete contract extending SageCore for testing purposes
 * @dev Exposes internal functions as external calls for test coverage
 */
contract TestGame is SageCore {
  constructor() SageCore() {}

  /**
   * @notice Expose internal _lockAsset for testing
   */
  function lockAsset(uint256 assetId) external {
    Asset storage a = _getExistingAsset(assetId);
    if (a.owner != msg.sender) revert NotOwner();
    _lockAsset(assetId);
  }

  /**
   * @notice Expose internal _unlockAsset for testing
   */
  function unlockAsset(uint256 assetId) external {
    Asset storage a = _getExistingAsset(assetId);
    if (a.owner != msg.sender) revert NotOwner();
    _unlockAsset(assetId);
  }

  /**
   * @notice Expose internal _burnAsset for testing (game contract burn — no external ownership check)
   */
  function gameBurn(uint256 assetId) external onlyOwner {
    _burnAsset(assetId);
  }

  /**
   * @notice Expose internal _batchBurnAssets for testing
   */
  function gameBatchBurn(uint256[] calldata assetIds) external onlyOwner {
    _batchBurnAssets(assetIds);
  }

  /**
   * @notice Expose internal _updateAssetData for testing
   */
  function updateAssetData(
    uint256 assetId,
    bytes32 payload,
    uint16 level
  ) external onlyOwner {
    _updateAssetData(assetId, payload, level);
  }

  /**
   * @notice Expose internal _mintAssetTo for testing
   */
  function gameMintTo(
    address to,
    uint16 kind,
    uint8 flags,
    uint16 level,
    bytes32 payload
  ) external onlyOwner returns (uint256) {
    return _mintAssetTo(to, kind, flags, level, payload);
  }
}
