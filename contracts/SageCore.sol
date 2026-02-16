// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/**
 * @title SageCore
 * @notice SAGE Core Prototype – Assets & Transitions
 * @dev Abstract base contract for SAGE game contracts, focusing on:
 *      1. Assets with unique incremental IDs
 *      2. Per-account inventories (up to 100 assets per account via storage tiers)
 *      3. Minimal Transition entrypoint for future extension
 *      4. Marketplace with pull-payment pattern
 *
 *      Game contracts should inherit from this and implement game-specific logic.
 */
abstract contract SageCore is ReentrancyGuard {
  // Constants
  uint8 public constant DEFAULT_MAX_ITEMS = 25;
  uint8 public constant MAX_BATCH_SIZE = 20;
  uint8 public constant MAX_ASSETS_PER_TRANSITION = 5;

  // Flag constants
  uint8 internal constant FLAG_LOCKED = 1 << 0; // 0b00000001

  // Transition ID constants
  uint8 public constant TRANSITION_NOOP = 1;
  uint8 public constant TRANSITION_INCREMENT_LEVEL = 2;
  uint8 public constant TRANSITION_SET_FLAGS = 3;

  // State variables
  uint32 private _nextAssetId = 1;

  // === STORAGE TIERS ===

  enum StorageTier {
    Tier25, // 0 - Base tier (25 slots)
    Tier50, // 1 - First upgrade (50 slots)
    Tier75, // 2 - Second upgrade (75 slots)
    Tier100 // 3 - Maximum tier (100 slots)
  }

  // Data structures
  struct Asset {
    // Slot 0 – SAGE core (32 bytes total)
    address owner; // 20 bytes
    uint8 flags; // 1 byte
    uint16 kind; // 2 bytes (asset type)
    uint16 level; // 2 bytes (level / rarity)
    uint32 reserved0; // 4 bytes (future core use)
    uint16 reserved1; // 2 bytes (future core use)
    uint8 reserved2; // 1 byte  (future core use)
    // -> 20 + 1 + 2 + 2 + 4 + 2 + 1 = 32 bytes

    // Slot 1 – Game payload (opaque to SAGE core)
    bytes32 payload; // 32 bytes – DNA, stats, etc.
  }

  struct Inventory {
    uint32[] slots; // dynamic array of asset IDs owned by this account
  }

  struct TransitionConfig {
    bool enabled; // transition can be used if true
    bool requireAllUnlocked; // if true, all assets must NOT be locked
    bool requireAllLocked; // if true, all assets must be locked
    uint8 maxAssets; // per-call cap for this transition (<= MAX_ASSETS_PER_TRANSITION)
  }

  struct Listing {
    address seller; // address that listed the asset
    uint256 price; // price in wei
  }

  // Storage mappings
  struct UserContext {
    StorageTier tier; // 1 byte
    bytes31 payload; // 31 bytes (game specific data)
  }

  // Storage mappings
  mapping(uint256 => Asset) internal assets; // assetId -> Asset
  mapping(address => Inventory) internal inventories; // account -> inventory
  mapping(uint8 => TransitionConfig) public transitionConfigs; // transitionId -> config
  mapping(uint256 => Listing) public listings; // assetId -> Listing

  mapping(address => UserContext) public userContext; // account -> context (tier + payload)

  // Pull payment pattern for marketplace safety
  mapping(address => uint256) public pendingWithdrawals; // address -> wei amount

  // Owner and access control
  address public owner;

  // Global configuration parameters
  uint8 public maxAssetsPerTransitionGlobal;
  bool public marketplaceEnabled;
  uint256 public minListingPrice;

  // Fee configuration (configurable by owner)
  uint256 public mintFee;
  uint256[3] public tierUpgradeFees; // [Tier25→50, Tier50→75, Tier75→100]
  uint256 public collectedFees; // accumulated fees available for owner withdrawal

  // Events
  event AssetMinted(uint256 indexed assetId, address indexed owner, uint16 kind);
  event AssetTransferred(
    uint256 indexed assetId,
    address indexed from,
    address indexed to
  );
  event AssetBurned(uint256 indexed assetId, address indexed owner);
  event AssetLocked(uint256 indexed assetId, address indexed owner);
  event AssetUnlocked(uint256 indexed assetId, address indexed owner);
  event InventoryUpgraded(
    address indexed account,
    uint256 additionalSlots,
    uint256 cost
  );
  event StorageTierUpgraded(
    address indexed account,
    StorageTier newTier,
    uint16 newCapacity
  );
  event TransitionConfigured(
    uint8 indexed transitionId,
    bool enabled,
    bool requireAllUnlocked,
    bool requireAllLocked,
    uint8 maxAssets
  );
  event TransitionExecuted(
    uint8 indexed transitionId,
    address indexed caller,
    uint256[] assetIds
  );
  event AssetListed(
    uint256 indexed assetId,
    address indexed seller,
    uint256 price
  );
  event AssetDelisted(uint256 indexed assetId, address indexed seller);
  event AssetSold(
    uint256 indexed assetId,
    address indexed seller,
    address indexed buyer,
    uint256 price
  );
  event OwnershipTransferred(
    address indexed previousOwner,
    address indexed newOwner
  );
  event WithdrawalDeposited(address indexed recipient, uint256 amount);
  event WithdrawalCompleted(address indexed recipient, uint256 amount);
  event MaxAssetsPerTransitionChanged(uint8 oldMax, uint8 newMax);
  event MarketplaceEnabledChanged(bool enabled);
  event MinListingPriceChanged(uint256 oldPrice, uint256 newPrice);
  event MintFeeChanged(uint256 oldFee, uint256 newFee);
  event TierUpgradeFeesChanged(uint256[3] oldFees, uint256[3] newFees);
  event FeesCollected(address indexed recipient, uint256 amount);

  // Step 1: Game Internal API events
  event AssetDataUpdated(
    uint256 indexed assetId,
    bytes32 payload,
    uint16 level
  );
  event BatchBurn(uint256[] assetIds);

  // Custom errors
  error InventoryFull();
  error NotOwner();
  error ReceiverInventoryFull();
  error AssetNotFoundInInventory();
  error InvalidParameter();
  error AssetNotInInventory();
  error AssetDoesNotExist(uint256 assetId);
  error AssetIsLocked();
  error AssetAlreadyLocked();
  error AssetNotLocked();
  error InvalidRecipient();
  error EmptyBatch();
  error BatchTooLarge();
  error InvalidLockConfig();
  error MaxAssetsMustBePositive();
  error MaxAssetsTooLarge();
  error TransitionDisabled();
  error NoAssets();
  error TooManyAssets();
  error DataTooShort();
  error AssetNotListed();
  error AssetAlreadyListed();
  error NotSeller();
  error InsufficientPayment();
  error CannotBuyOwnAsset();
  error InvalidPrice();
  error OwnershipMismatch();
  error NotContractOwner();
  error DuplicateAssetId();
  error InvalidMaxAssetsPerTransition();
  error MarketplaceDisabled();
  error PriceBelowMinimum();
  error NoWithdrawableFunds();
  error WithdrawalFailed();
  error LevelAtMaximum();
  error NoFeesToCollect();
  error FeeCollectionFailed();

  // === MODIFIERS ===

  modifier onlyOwner() {
    if (msg.sender != owner) revert NotContractOwner();
    _;
  }

  /**
   * @notice Initialize the contract with default transition configurations
   */
  constructor() {
    // Initialize owner
    owner = msg.sender;
    emit OwnershipTransferred(address(0), msg.sender);

    // Initialize global configuration parameters
    maxAssetsPerTransitionGlobal = MAX_ASSETS_PER_TRANSITION;
    marketplaceEnabled = true;
    minListingPrice = 0;

    // Initialize fee configuration with sensible defaults
    mintFee = 0;
    tierUpgradeFees = [uint256(0.01 ether), uint256(0.025 ether), uint256(0.05 ether)];

    // NOOP: enabled, any lock state, up to 5 assets
    transitionConfigs[TRANSITION_NOOP] = TransitionConfig({
      enabled: true,
      requireAllUnlocked: false,
      requireAllLocked: false,
      maxAssets: MAX_ASSETS_PER_TRANSITION
    });

    // INCREMENT_LEVEL: requires assets unlocked, up to 5 assets
    transitionConfigs[TRANSITION_INCREMENT_LEVEL] = TransitionConfig({
      enabled: true,
      requireAllUnlocked: true,
      requireAllLocked: false,
      maxAssets: MAX_ASSETS_PER_TRANSITION
    });

    // SET_FLAGS: requires assets unlocked, up to 5 assets
    transitionConfigs[TRANSITION_SET_FLAGS] = TransitionConfig({
      enabled: true,
      requireAllUnlocked: true,
      requireAllLocked: false,
      maxAssets: MAX_ASSETS_PER_TRANSITION
    });
  }

  // === OWNER MANAGEMENT ===

  /**
   * @notice Transfer ownership of the contract to a new address
   * @param newOwner The address of the new owner
   */
  function transferOwnership(address newOwner) external onlyOwner {
    if (newOwner == address(0)) revert InvalidRecipient();
    address previousOwner = owner;
    owner = newOwner;
    emit OwnershipTransferred(previousOwner, newOwner);
  }

  /**
   * @notice Renounce ownership, leaving the contract without an owner
   */
  function renounceOwnership() external onlyOwner {
    address previousOwner = owner;
    owner = address(0);
    emit OwnershipTransferred(previousOwner, address(0));
  }

  // === CONFIGURATION MANAGEMENT ===

  /**
   * @notice Set the global maximum assets per transition
   * @param newMax The new maximum (must be > 0 and <= MAX_ASSETS_PER_TRANSITION)
   */
  function setMaxAssetsPerTransitionGlobal(uint8 newMax) external onlyOwner {
    if (newMax == 0 || newMax > MAX_ASSETS_PER_TRANSITION) {
      revert InvalidMaxAssetsPerTransition();
    }
    uint8 oldMax = maxAssetsPerTransitionGlobal;
    maxAssetsPerTransitionGlobal = newMax;
    emit MaxAssetsPerTransitionChanged(oldMax, newMax);
  }

  /**
   * @notice Enable or disable the marketplace
   * @param enabled Whether the marketplace should be enabled
   */
  function setMarketplaceEnabled(bool enabled) external onlyOwner {
    marketplaceEnabled = enabled;
    emit MarketplaceEnabledChanged(enabled);
  }

  /**
   * @notice Set the minimum listing price for the marketplace
   * @param newMinPrice The new minimum listing price in wei
   */
  function setMinListingPrice(uint256 newMinPrice) external onlyOwner {
    uint256 oldPrice = minListingPrice;
    minListingPrice = newMinPrice;
    emit MinListingPriceChanged(oldPrice, newMinPrice);
  }

  /**
   * @notice Set the fee charged for minting an asset
   * @param newFee The new mint fee in wei
   */
  function setMintFee(uint256 newFee) external onlyOwner {
    uint256 oldFee = mintFee;
    mintFee = newFee;
    emit MintFeeChanged(oldFee, newFee);
  }

  /**
   * @notice Set the tier upgrade fees [Tier25→50, Tier50→75, Tier75→100]
   * @param newFees Array of 3 fee values in wei
   */
  function setTierUpgradeFees(uint256[3] calldata newFees) external onlyOwner {
    uint256[3] memory oldFees = tierUpgradeFees;
    tierUpgradeFees = newFees;
    emit TierUpgradeFeesChanged(oldFees, newFees);
  }

  /**
   * @notice Withdraw accumulated fees to the owner
   * @dev Only callable by the contract owner
   */
  function collectFees() external onlyOwner nonReentrant {
    uint256 amount = collectedFees;
    if (amount == 0) revert NoFeesToCollect();

    // CEI: clear before transfer
    collectedFees = 0;

    (bool success, ) = owner.call{value: amount}('');
    if (!success) {
      collectedFees = amount;
      revert FeeCollectionFailed();
    }

    emit FeesCollected(owner, amount);
  }

  /**
   * @notice Internal helper that ensures an asset exists and returns a storage reference
   * @param assetId The ID of the asset to retrieve
   * @return a Storage reference to the existing asset
   */
  function _getExistingAsset(
    uint256 assetId
  ) internal view returns (Asset storage a) {
    a = assets[assetId];
    if (a.owner == address(0)) {
      revert AssetDoesNotExist(assetId);
    }
  }

  // === STEP 1: GAME INTERNAL API ===

  /**
   * @notice Alias for _getExistingAsset for Step 1 API consistency
   * @param assetId The asset ID to get
   * @return asset The asset storage reference
   */
  function _getAsset(
    uint256 assetId
  ) internal view returns (Asset storage asset) {
    return _getExistingAsset(assetId);
  }

  /**
   * @notice Core internal mint function that mints to any address
   * @dev This is the single core implementation all mint paths call
   */
  function _mintAssetInternal(
    address to,
    uint16 kind,
    uint8 flags,
    uint16 level,
    bytes32 payload
  ) internal returns (uint256 assetId) {
    // Recipient must not be zero
    if (to == address(0)) revert InvalidRecipient();

    // Inventory capacity check using dynamic slots
    Inventory storage inv = inventories[to];
    if (inv.slots.length >= _getMaxSlots(to)) {
      revert InventoryFull();
    }

    // Asset ID allocation with uint32 consistency
    assetId = _nextAssetId++;
    // Note: No overflow check needed since _nextAssetId is uint32
    // Solidity 0.8+ will automatically revert on uint32 overflow

    // Sanitize flags – strip reserved bits (lock)
    // Ensure engine, not caller, controls the lock bit
    flags &= ~FLAG_LOCKED;

    // Create and store asset
    assets[assetId] = Asset({
      owner: to,
      flags: flags,
      kind: kind,
      level: level,
      reserved0: 0,
      reserved1: 0,
      reserved2: 0,
      payload: payload
    });

    // Add to inventory using dynamic array
    inv.slots.push(uint32(assetId));

    // Emit AssetMinted
    emit AssetMinted(assetId, to, kind);
  }

  /**
   * @notice Game contract helper to mint asset to arbitrary address
   * @param to The address to mint the asset to
   * @param kind Type/category of the asset
   * @param flags Initial flags (lock bit will be stripped)
   * @param level Initial level of the asset
   * @param payload 32-byte payload containing game-specific data
   * @return assetId The ID of the newly minted asset
   */
  function _mintAssetTo(
    address to,
    uint16 kind,
    uint8 flags,
    uint16 level,
    bytes32 payload
  ) internal returns (uint256 assetId) {
    return _mintAssetInternal(to, kind, flags, level, payload);
  }

  /**
   * @notice Update asset data fields (for game contract use)
   * @param assetId The asset ID to update
   * @param payload New payload value
   * @param level New level value
   */
  function _updateAssetData(
    uint256 assetId,
    bytes32 payload,
    uint16 level
  ) internal {
    Asset storage asset = _getAsset(assetId);

    asset.payload = payload;
    asset.level = level;

    emit AssetDataUpdated(assetId, payload, level);
  }

  /**
   * @notice Internal burn function for use by game contracts
   * @param assetId The asset ID to burn
   */
  function _burnAsset(uint256 assetId) internal {
    Asset storage a = _getExistingAsset(assetId);

    // Validate asset is not locked
    if (_isLocked(a)) {
      revert AssetIsLocked();
    }

    // Store previous owner for event
    address assetOwner = a.owner;

    // Remove from owner's inventory
    _removeFromInventory(inventories[assetOwner], assetId);

    // Hard delete asset storage
    delete assets[assetId];

    emit AssetBurned(assetId, assetOwner);
  }

  /**
   * @notice Batch burn multiple assets (for game contract efficiency)
   * @param assetIds Array of asset IDs to burn
   */
  function _batchBurnAssets(uint256[] memory assetIds) internal {
    uint256 length = assetIds.length;
    for (uint256 i = 0; i < length; ++i) {
      _burnAsset(assetIds[i]);
    }
    emit BatchBurn(assetIds);
  }

  /**
   * @notice Internal helper to transfer an asset from one address to another
   * @param from The address to transfer from
   * @param to The address to transfer to
   * @param assetId The ID of the asset to transfer
   */
  function _transferAssetFrom(
    address from,
    address to,
    uint256 assetId
  ) internal {
    if (to == address(0)) revert InvalidRecipient();

    Asset storage asset = _getExistingAsset(assetId);

    // Check ownership
    if (asset.owner != from) {
      revert NotOwner();
    }

    // Check if asset is locked
    if (_isLocked(asset)) {
      revert AssetIsLocked();
    }

    Inventory storage toInventory = inventories[to];

    // Check if recipient's inventory is full using dynamic slots
    if (toInventory.slots.length >= _getMaxSlots(to)) {
      revert ReceiverInventoryFull();
    }

    // Remove from sender's inventory
    _removeFromInventory(inventories[from], assetId);

    // Add to recipient's inventory using dynamic array
    toInventory.slots.push(uint32(assetId));

    // Update asset owner
    asset.owner = to;

    emit AssetTransferred(assetId, from, to);
  }

  /**
   * @notice Configure a transition with its parameters
   * @param transitionId The ID of the transition to configure
   * @param enabled Whether the transition is enabled
   * @param requireAllUnlocked Whether all assets must be unlocked
   * @param requireAllLocked Whether all assets must be locked
   * @param maxAssets Maximum number of assets for this transition
   */
  function configureTransition(
    uint8 transitionId,
    bool enabled,
    bool requireAllUnlocked,
    bool requireAllLocked,
    uint8 maxAssets
  ) external onlyOwner {
    // Basic sanity checks
    if (maxAssets == 0) {
      revert MaxAssetsMustBePositive();
    }
    if (maxAssets > MAX_ASSETS_PER_TRANSITION) {
      revert MaxAssetsTooLarge();
    }
    if (requireAllUnlocked && requireAllLocked) {
      revert InvalidLockConfig();
    }

    // Set the config
    TransitionConfig storage cfg = transitionConfigs[transitionId];
    cfg.enabled = enabled;
    cfg.requireAllUnlocked = requireAllUnlocked;
    cfg.requireAllLocked = requireAllLocked;
    cfg.maxAssets = maxAssets;

    // Emit event
    emit TransitionConfigured(
      transitionId,
      enabled,
      requireAllUnlocked,
      requireAllLocked,
      maxAssets
    );
  }

  /**
   * @notice Internal mint function (mints to specified address)
   * @dev Wrapper around _mintAssetInternal for convenience
   */
  function _mintAsset(
    address to,
    uint16 kind,
    uint8 flags,
    uint16 level,
    bytes32 payload
  ) internal returns (uint256 assetId) {
    return _mintAssetInternal(to, kind, flags, level, payload);
  }

  /**
   * @notice Internal mint function (mints to msg.sender)
   * @dev Convenience overload for game contract patterns
   */
  function _mintAsset(
    uint16 kind,
    uint8 flags,
    uint16 level,
    bytes32 payload
  ) internal returns (uint256 assetId) {
    return _mintAssetInternal(msg.sender, kind, flags, level, payload);
  }

  /**
   * @notice Mint a new asset to caller's address (payable — charges mintFee)
   * @param kind Type/category of the asset
   * @param flags Initial flags (lock bit will be stripped)
   * @param level Initial level of the asset
   * @param payload 32-byte payload containing game-specific data
   * @return assetId The ID of the newly minted asset
   */
  function mintAsset(
    uint16 kind,
    uint8 flags,
    uint16 level,
    bytes32 payload
  ) external payable returns (uint256 assetId) {
    if (msg.value < mintFee) revert InsufficientPayment();
    collectedFees += mintFee;

    assetId = _mintAsset(msg.sender, kind, flags, level, payload);

    // Refund excess payment
    if (msg.value > mintFee) {
      uint256 refund = msg.value - mintFee;
      pendingWithdrawals[msg.sender] += refund;
      emit WithdrawalDeposited(msg.sender, refund);
    }
  }

  /**
   * @notice Admin function to mint asset to specific address (owner only, no fee)
   * @param to The address to mint the asset to
   * @param kind Type/category of the asset
   * @param flags Initial flags (lock bit will be stripped)
   * @param level Initial level of the asset
   * @param payload 32-byte payload containing game-specific data
   * @return assetId The ID of the newly minted asset
   */
  function mintTo(
    address to,
    uint16 kind,
    uint8 flags,
    uint16 level,
    bytes32 payload
  ) external onlyOwner returns (uint256 assetId) {
    assetId = _mintAsset(to, kind, flags, level, payload);
  }

  /**
   * @notice Transfer an asset from msg.sender to another address
   * @param assetId The ID of the asset to transfer
   * @param to The address to transfer the asset to
   */
  function transferAsset(uint256 assetId, address to) external {
    _transferAssetFrom(msg.sender, to, assetId);
  }

  /**
   * @notice Burn an asset, removing it from circulation
   * @param assetId The ID of the asset to burn
   */
  function burnAsset(uint256 assetId) external {
    Asset storage a = _getExistingAsset(assetId);
    if (a.owner != msg.sender) revert NotOwner();
    _burnAsset(assetId);
  }

  /**
   * @notice Execute a transition over a set of assets
   * @param transitionId The type of transition to execute
   * @param assetIds Array of asset IDs to include in the transition
   * @param data Additional data for the transition
   */
  function executeTransition(
    uint8 transitionId,
    uint256[] calldata assetIds,
    bytes calldata data
  ) external {
    _validateTransitionCommon(transitionId, assetIds);
    _validateTransitionSpecific(transitionId, assetIds, data);

    _applyTransition(transitionId, assetIds, data);

    emit TransitionExecuted(transitionId, msg.sender, assetIds);
  }

  /**
   * @notice Common validation for all transitions
   * @param transitionId The transition ID to validate
   * @param assetIds Array of asset IDs
   */
  function _validateTransitionCommon(
    uint8 transitionId,
    uint256[] calldata assetIds
  ) internal view {
    // Fetch config
    TransitionConfig storage cfg = transitionConfigs[transitionId];
    if (!cfg.enabled) {
      revert TransitionDisabled();
    }

    // Validate assetIds length
    uint256 len = assetIds.length;
    if (len == 0) {
      revert NoAssets();
    }
    if (len > cfg.maxAssets || len > maxAssetsPerTransitionGlobal) {
      revert TooManyAssets();
    }

    // Check for duplicate asset IDs (O(n²) is acceptable for max 5 assets)
    for (uint256 i = 0; i < len; ) {
      uint256 idI = assetIds[i];
      for (uint256 j = i + 1; j < len; ) {
        if (idI == assetIds[j]) {
          revert DuplicateAssetId();
        }
        unchecked {
          ++j;
        }
      }
      unchecked {
        ++i;
      }
    }

    // For each assetId, check existence first, then ownership and lock requirements
    for (uint256 i = 0; i < len; ) {
      uint256 id = assetIds[i];
      Asset storage a = _getExistingAsset(id);

      if (a.owner != msg.sender) {
        revert NotOwner();
      }

      if (cfg.requireAllUnlocked) {
        if (_isLocked(a)) {
          revert AssetIsLocked();
        }
      }
      if (cfg.requireAllLocked) {
        if (!_isLocked(a)) {
          revert AssetNotLocked();
        }
      }

      unchecked {
        ++i;
      }
    }
  }

  /**
   * @notice Transition-specific validation
   * @param transitionId The transition ID to validate
   * @param assetIds Array of asset IDs
   * @param data Additional data for validation
   */
  function _validateTransitionSpecific(
    uint8 transitionId,
    uint256[] calldata assetIds,
    bytes calldata data
  ) internal pure {
    if (transitionId == TRANSITION_NOOP) {
      // No additional validation
      return;
    }

    if (transitionId == TRANSITION_INCREMENT_LEVEL) {
      // Example: no extra checks for now,
      // but we could require certain max level or kinds later.
      return;
    }

    if (transitionId == TRANSITION_SET_FLAGS) {
      // data must be at least 1 byte describing which flags to set
      if (data.length < 1) {
        revert DataTooShort();
      }
      return;
    }

    // For custom transitions, allow them if they're properly configured.
    // The common validation already checked that the transition is enabled.
    // Custom transitions don't have specific validation by default.
  }

  /**
   * @notice Apply transition effects to assets
   * @param transitionId The transition ID to apply
   * @param assetIds Array of asset IDs
   * @param data Additional data for the transition
   */
  function _applyTransition(
    uint8 transitionId,
    uint256[] calldata assetIds,
    bytes calldata data
  ) internal {
    if (transitionId == TRANSITION_NOOP) {
      // Do nothing
      return;
    }

    if (transitionId == TRANSITION_INCREMENT_LEVEL) {
      // Increase level of each asset by 1
      uint256 len = assetIds.length;
      for (uint256 i = 0; i < len; ) {
        uint256 id = assetIds[i];
        Asset storage a = _getExistingAsset(id);

        // Prevent level overflow (uint16 max is 65535)
        if (a.level == type(uint16).max) {
          revert LevelAtMaximum();
        }
        a.level += 1;

        unchecked {
          ++i;
        }
      }
      return;
    }

    if (transitionId == TRANSITION_SET_FLAGS) {
      // Interpret data as a set of flag bits to OR into each asset's flags
      // For simplicity, treat first byte as flag mask
      if (data.length < 1) {
        revert DataTooShort();
      }
      uint8 mask = uint8(data[0]);

      // Strip reserved bits (lock bit) so transitions can't interfere with engine control
      mask &= ~FLAG_LOCKED;

      uint256 len = assetIds.length;
      for (uint256 i = 0; i < len; ) {
        uint256 id = assetIds[i];
        Asset storage a = _getExistingAsset(id);

        // Apply sanitized mask (reserved bits already stripped)
        a.flags |= mask;

        unchecked {
          ++i;
        }
      }
      return;
    }

    // For custom transitions, do nothing by default.
    // Custom transitions can be implemented by overriding this function
    // or by using the existing built-in transitions.
  }

  /**
   * @notice Internal function to lock an asset
   * @param assetId The ID of the asset to lock
   */
  function _lockAsset(uint256 assetId) internal {
    Asset storage a = _getExistingAsset(assetId);

    // Validate asset is not already locked
    if (_isLocked(a)) {
      revert AssetAlreadyLocked();
    }

    // Set lock flag
    a.flags |= FLAG_LOCKED;

    emit AssetLocked(assetId, a.owner);
  }

  /**
   * @notice Internal function to unlock an asset
   * @param assetId The ID of the asset to unlock
   */
  function _unlockAsset(uint256 assetId) internal {
    Asset storage a = _getExistingAsset(assetId);

    // Validate asset is currently locked
    if (!_isLocked(a)) {
      revert AssetNotLocked();
    }

    // Clear lock flag
    a.flags &= ~FLAG_LOCKED;

    emit AssetUnlocked(assetId, a.owner);
  }

  /**
   * @notice Transfer multiple assets in a single transaction
   * @param assetIds Array of asset IDs to transfer
   * @param to The address to transfer all assets to
   */
  function batchTransfer(uint256[] calldata assetIds, address to) external {
    if (to == address(0)) revert InvalidRecipient();

    uint256 len = assetIds.length;

    // Validate batch size
    if (len == 0) {
      revert EmptyBatch();
    }
    if (len > MAX_BATCH_SIZE) {
      revert BatchTooLarge();
    }

    // Validate receiver's capacity before making any changes
    Inventory storage toInv = inventories[to];
    if (toInv.slots.length + len > _getMaxSlots(to)) {
      revert ReceiverInventoryFull();
    }

    // First pass: validate all assets
    for (uint256 i = 0; i < len; ) {
      Asset storage a = _getExistingAsset(assetIds[i]);

      // Validate ownership
      if (a.owner != msg.sender) {
        revert NotOwner();
      }

      // Validate not locked
      if (_isLocked(a)) {
        revert AssetIsLocked();
      }

      unchecked {
        ++i;
      }
    }

    // Second pass: perform transfers
    for (uint256 i = 0; i < len; ) {
      uint256 assetId = assetIds[i];
      Asset storage a = assets[assetId];

      // Remove from sender's inventory
      _removeFromInventory(inventories[msg.sender], assetId);

      // Add to recipient's inventory using dynamic array
      toInv.slots.push(uint32(assetId));

      // Update asset owner
      a.owner = to;

      emit AssetTransferred(assetId, msg.sender, to);

      unchecked {
        ++i;
      }
    }
  }

  /**
   * @notice Burn multiple assets in a single transaction
   * @param assetIds Array of asset IDs to burn
   */
  function batchBurn(uint256[] calldata assetIds) external {
    uint256 len = assetIds.length;

    // Validate batch size
    if (len == 0) {
      revert EmptyBatch();
    }
    if (len > MAX_BATCH_SIZE) {
      revert BatchTooLarge();
    }

    // First pass: validate all assets
    for (uint256 i = 0; i < len; ) {
      Asset storage a = _getExistingAsset(assetIds[i]);

      // Validate ownership
      if (a.owner != msg.sender) {
        revert NotOwner();
      }

      // Validate not locked
      if (_isLocked(a)) {
        revert AssetIsLocked();
      }

      unchecked {
        ++i;
      }
    }

    // Second pass: perform burns
    for (uint256 i = 0; i < len; ) {
      uint256 assetId = assetIds[i];
      Asset storage a = assets[assetId];

      // Store owner for event
      address assetOwner = a.owner;

      // Remove from owner's inventory
      _removeFromInventory(inventories[assetOwner], assetId);

      // Hard delete asset storage
      delete assets[assetId];

      emit AssetBurned(assetId, assetOwner);

      unchecked {
        ++i;
      }
    }

    // Emit batch burn event
    emit BatchBurn(assetIds);
  }

  /**
   * @notice Get an asset by its ID
   * @param assetId The ID of the asset to retrieve
   * @return The asset data
   */
  function getAsset(uint256 assetId) external view returns (Asset memory) {
    Asset storage a = _getExistingAsset(assetId);
    return a;
  }

  // === INVENTORY MANAGEMENT ===

  /**
   * @notice Get maximum inventory slots for an account based on storage tier
   * @param account The account to check
   * @return Maximum slots available
   */
  function _getMaxSlots(address account) internal view returns (uint16) {
    StorageTier tier = userContext[account].tier;

    if (tier == StorageTier.Tier25) {
      return 25;
    } else if (tier == StorageTier.Tier50) {
      return 50;
    } else if (tier == StorageTier.Tier75) {
      return 75;
    } else {
      // Tier100
      return 100;
    }
  }

  /**
   * @notice Get storage tier capacity
   * @param tier The storage tier to check
   * @return Capacity for that tier
   */
  function getStorageTierCapacity(
    StorageTier tier
  ) external pure returns (uint16) {
    if (tier == StorageTier.Tier25) {
      return 25;
    } else if (tier == StorageTier.Tier50) {
      return 50;
    } else if (tier == StorageTier.Tier75) {
      return 75;
    } else {
      // Tier100
      return 100;
    }
  }

  /**
   * @notice Get all asset IDs owned by an address
   * @param account The address to query
   * @return assetIds Array of asset IDs owned by the address
   */
  function getInventory(
    address account
  ) external view returns (uint32[] memory assetIds) {
    Inventory storage inv = inventories[account];
    return inv.slots;
  }

  /**
   * @notice Get the number of assets owned by an address
   * @param account The address to query
   * @return count The number of assets owned
   */
  function getInventoryCount(
    address account
  ) external view returns (uint8 count) {
    return uint8(inventories[account].slots.length);
  }

  /**
   * @notice Check if an asset is locked
   * @param assetId The ID of the asset to check
   * @return True if the asset is locked
   */
  function isLocked(uint256 assetId) external view returns (bool) {
    Asset storage a = _getExistingAsset(assetId);
    return (a.flags & FLAG_LOCKED) != 0;
  }

  /**
   * @notice Upgrade storage tier to next level (25→50→75→100)
   * @dev Fees are configurable via setTierUpgradeFees()
   */
  function upgradeStorageTier() external payable nonReentrant {
    StorageTier currentTier = userContext[msg.sender].tier;

    // Check if already at maximum tier
    if (currentTier == StorageTier.Tier100) {
      revert InvalidParameter(); // Already at max tier
    }

    // Calculate upgrade cost from configurable fees
    uint256 cost;
    StorageTier newTier;

    if (currentTier == StorageTier.Tier25) {
      cost = tierUpgradeFees[0];
      newTier = StorageTier.Tier50;
    } else if (currentTier == StorageTier.Tier50) {
      cost = tierUpgradeFees[1];
      newTier = StorageTier.Tier75;
    } else {
      // Tier75
      cost = tierUpgradeFees[2];
      newTier = StorageTier.Tier100;
    }

    if (msg.value < cost) revert InsufficientPayment();

    // Collect the fee
    collectedFees += cost;

    // Upgrade the tier
    userContext[msg.sender].tier = newTier;

    // Get new capacity
    uint16 newCapacity = _getMaxSlots(msg.sender);

    // Refund excess payment via pull pattern
    if (msg.value > cost) {
      uint256 refund = msg.value - cost;
      pendingWithdrawals[msg.sender] += refund;
      emit WithdrawalDeposited(msg.sender, refund);
    }

    emit StorageTierUpgraded(msg.sender, newTier, newCapacity);
  }

  /**
   * @notice Get cost to upgrade to next storage tier
   * @param account The account to check upgrade cost for
   * @return Cost in wei (0 if already at max tier)
   */
  function getUpgradeCost(address account) external view returns (uint256) {
    StorageTier currentTier = userContext[account].tier;

    if (currentTier == StorageTier.Tier25) {
      return tierUpgradeFees[0];
    } else if (currentTier == StorageTier.Tier50) {
      return tierUpgradeFees[1];
    } else if (currentTier == StorageTier.Tier75) {
      return tierUpgradeFees[2];
    } else {
      // Tier100
      return 0; // Already at max
    }
  }

  /**
   * @notice Internal helper to check if an asset is locked
   * @param a The asset to check
   * @return True if the asset is locked
   */
  function _isLocked(Asset storage a) internal view returns (bool) {
    return (a.flags & FLAG_LOCKED) != 0;
  }

  /**
   * @notice Check if an asset is present in an account's inventory
   * @param account The account address to check
   * @param assetId The asset ID to look for
   * @return True if the asset is in the inventory
   */
  function _isAssetInInventory(
    address account,
    uint256 assetId
  ) internal view returns (bool) {
    Inventory storage inv = inventories[account];
    uint32 assetId32 = uint32(assetId);
    for (uint256 i = 0; i < inv.slots.length; ) {
      if (inv.slots[i] == assetId32) {
        return true;
      }
      unchecked {
        ++i;
      }
    }
    return false;
  }

  /**
   * @notice Check inventory consistency for a given account
   * @param account The address to check inventory consistency for
   * @return True if inventory is consistent
   */
  function _checkInventoryConsistency(
    address account
  ) internal view returns (bool) {
    Inventory storage inv = inventories[account];
    uint256 length = inv.slots.length;

    // 1. Length must be <= max allowed slots for this account
    if (length > _getMaxSlots(account)) {
      return false;
    }

    // 2. Each slot must refer to an asset whose owner is this address
    for (uint256 i = 0; i < length; ) {
      uint32 assetId = inv.slots[i];
      if (assetId == 0) {
        return false;
      }
      Asset storage a = assets[assetId];
      if (a.owner != account) {
        return false;
      }
      unchecked {
        ++i;
      }
    }

    return true;
  }

  /**
   * @notice Check asset-level consistency
   * @param assetId The asset ID to check
   * @return True if asset is consistent
   */
  function _checkAssetConsistency(
    uint256 assetId
  ) internal view returns (bool) {
    Asset storage a = assets[assetId];

    // If owner is zero, we treat the asset as non-existent/burned.
    // There is no inventory entry to check, so we consider this consistent
    // from the engine's point of view.
    if (a.owner == address(0)) {
      return true;
    }

    // Otherwise, the asset must appear exactly once in the owner's inventory.
    return _isAssetInInventory(a.owner, assetId);
  }

  /**
   * @notice Public function to check inventory consistency (for testing)
   * @param account The address to check inventory consistency for
   * @return True if inventory is consistent
   */
  function checkInventoryConsistency(
    address account
  ) external view returns (bool) {
    return _checkInventoryConsistency(account);
  }

  /**
   * @notice Public function to check asset consistency (for testing)
   * @param assetId The asset ID to check
   * @return True if asset is consistent
   */
  function checkAssetConsistency(uint256 assetId) external view returns (bool) {
    return _checkAssetConsistency(assetId);
  }

  /**
   * @notice Remove an asset from an inventory using swap-and-pop
   * @param inv The inventory to modify
   * @param assetId The asset ID to remove
   */
  function _removeFromInventory(
    Inventory storage inv,
    uint256 assetId
  ) internal {
    uint32 assetId32 = uint32(assetId);

    // Find the asset in the dynamic array
    for (uint256 i = 0; i < inv.slots.length; ) {
      if (inv.slots[i] == assetId32) {
        // Move the last element to this position and pop the last element
        inv.slots[i] = inv.slots[inv.slots.length - 1];
        inv.slots.pop();
        return;
      }
      unchecked {
        ++i;
      }
    }

    revert AssetNotFoundInInventory();
  }

  // ===== MARKETPLACE FUNCTIONS =====

  /**
   * @notice List an asset for sale at a fixed price
   * @param assetId The ID of the asset to list
   * @param price The price in wei to list the asset for
   */
  function listAsset(uint256 assetId, uint256 price) external nonReentrant {
    // Check if marketplace is enabled
    if (!marketplaceEnabled) {
      revert MarketplaceDisabled();
    }

    // Enforce non-zero price early
    if (price == 0) {
      revert InvalidPrice();
    }

    Asset storage asset = _getExistingAsset(assetId);

    // Check ownership first
    if (asset.owner != msg.sender) {
      revert NotOwner();
    }

    // Check if asset is already listed (before lock check)
    if (listings[assetId].seller != address(0)) {
      revert AssetAlreadyListed();
    }

    // Check if asset is locked (unlisted assets shouldn't be locked)
    if (_isLocked(asset)) {
      revert AssetIsLocked();
    }

    // Enforce minimum listing price
    if (price < minListingPrice) {
      revert PriceBelowMinimum();
    }

    // Lock the asset using helper
    _lockAsset(assetId);

    // Create the listing
    listings[assetId] = Listing({ seller: msg.sender, price: price });

    emit AssetListed(assetId, msg.sender, price);
  }

  /**
   * @notice Cancel a listing and unlock the asset
   * @param assetId The ID of the asset to cancel listing for
   */
  function cancelListing(uint256 assetId) external nonReentrant {
    Listing storage listing = listings[assetId];

    // Check if asset is listed
    if (listing.seller == address(0)) {
      revert AssetNotListed();
    }

    // Check if caller is the seller
    if (listing.seller != msg.sender) {
      revert NotSeller();
    }

    // Get the asset and perform ownership/lock checks
    Asset storage asset = _getExistingAsset(assetId);
    if (asset.owner != listing.seller) {
      revert OwnershipMismatch();
    }
    if (!_isLocked(asset)) {
      revert AssetNotLocked();
    }

    // Unlock the asset using helper
    _unlockAsset(assetId);

    // Clear the listing
    address seller = listing.seller;
    delete listings[assetId];

    emit AssetDelisted(assetId, seller);
  }

  /**
   * @notice Buy a listed asset by paying the specified price
   * @param assetId The ID of the asset to buy
   */
  function buyAsset(uint256 assetId) external payable nonReentrant {
    // Check if marketplace is enabled
    if (!marketplaceEnabled) {
      revert MarketplaceDisabled();
    }

    Listing storage listing = listings[assetId];

    // Check if asset is listed
    if (listing.seller == address(0)) {
      revert AssetNotListed();
    }

    // Check if caller is not the seller
    if (listing.seller == msg.sender) {
      revert CannotBuyOwnAsset();
    }

    // Check if payment is sufficient
    if (msg.value < listing.price) {
      revert InsufficientPayment();
    }

    address seller = listing.seller;
    uint256 price = listing.price;

    // Get the asset and perform ownership/lock checks
    Asset storage asset = _getExistingAsset(assetId);
    if (asset.owner != seller) {
      revert OwnershipMismatch();
    }
    if (!_isLocked(asset)) {
      revert AssetNotLocked();
    }

    // Clear the listing before transfer (CEI pattern)
    delete listings[assetId];

    // Unlock the asset using helper
    _unlockAsset(assetId);

    // Transfer the asset
    _transferAssetFrom(seller, msg.sender, assetId);

    // Use pull payment pattern - add to seller's withdrawable balance
    pendingWithdrawals[seller] += price;
    emit WithdrawalDeposited(seller, price);

    // Handle refund for excess payment using pull pattern
    if (msg.value > price) {
      uint256 refundAmount = msg.value - price;
      pendingWithdrawals[msg.sender] += refundAmount;
      emit WithdrawalDeposited(msg.sender, refundAmount);
    }

    emit AssetSold(assetId, seller, msg.sender, price);
  }

  /**
   * @notice Withdraw accumulated funds from marketplace sales and refunds
   * @dev Uses pull payment pattern for security against reentrancy
   */
  function withdraw() external nonReentrant {
    uint256 amount = pendingWithdrawals[msg.sender];
    if (amount == 0) {
      revert NoWithdrawableFunds();
    }

    // Clear the pending amount before external call (CEI pattern)
    pendingWithdrawals[msg.sender] = 0;

    // Transfer the funds (no gas limit - relying on nonReentrant modifier)
    // Note: Recipients using contracts should ensure their receive/fallback functions are efficient
    (bool success, ) = msg.sender.call{ value: amount }('');
    if (!success) {
      revert WithdrawalFailed();
    }

    emit WithdrawalCompleted(msg.sender, amount);
  }

  /**
   * @notice Check how much a user can withdraw
   * @param account The account to check
   * @return The amount of wei available for withdrawal
   */
  function getWithdrawableAmount(
    address account
  ) external view returns (uint256) {
    return pendingWithdrawals[account];
  }

  /**
   * @notice Update the user context payload (for child contracts)
   * @param user The user address to update
   * @param payload The new payload data
   */
  function _updateUserPayload(address user, bytes31 payload) internal {
    userContext[user].payload = payload;
  }
}
