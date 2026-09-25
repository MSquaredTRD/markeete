// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal read-only surface used from the immutable DeliveryEscrow V2.
interface IDeliveryEscrowProducts {
    struct Product {
        address seller;
        uint128 price;
        bytes32 metadataHash;
        uint8 status;
    }

    function getProduct(uint256 productId) external view returns (Product memory);
}

/// @title ProductMetadataRegistry
/// @notice Stores public product metadata whose exact bytes are committed by DeliveryEscrow V2.
/// @dev This contract holds no funds and has no owner, upgrade path, fees or administrative writes.
contract ProductMetadataRegistry {
    uint256 public constant MAX_METADATA_LENGTH = 4_096;

    struct MetadataRecord {
        bytes metadata;
        bytes32 metadataHash;
        uint64 publishedAt;
        uint32 revision;
    }

    error ZeroAddress();
    error EscrowHasNoCode();
    error ProductNotFound();
    error Unauthorized();
    error InvalidMetadataLength();
    error MetadataHashMismatch();
    error MetadataUnchanged();

    event MetadataPublished(
        uint256 indexed productId,
        address indexed seller,
        bytes32 indexed metadataHash,
        uint32 revision,
        uint256 length
    );

    IDeliveryEscrowProducts public immutable escrow;

    mapping(uint256 productId => MetadataRecord record) private _records;

    constructor(IDeliveryEscrowProducts escrow_) {
        if (address(escrow_) == address(0)) revert ZeroAddress();
        if (address(escrow_).code.length == 0) revert EscrowHasNoCode();
        escrow = escrow_;
    }

    /// @notice Publishes the exact metadata bytes committed by the escrow product.
    /// @dev JSON interpretation and field validation belong to clients; this contract enforces authorship,
    ///      maximum size and byte-for-byte hash integrity.
    function publish(uint256 productId, bytes calldata metadata) external {
        uint256 length = metadata.length;
        if (length == 0 || length > MAX_METADATA_LENGTH) revert InvalidMetadataLength();

        IDeliveryEscrowProducts.Product memory product = escrow.getProduct(productId);
        if (product.seller == address(0)) revert ProductNotFound();
        if (msg.sender != product.seller) revert Unauthorized();

        bytes32 metadataHash = keccak256(metadata);
        if (metadataHash != product.metadataHash) revert MetadataHashMismatch();

        MetadataRecord storage record = _records[productId];
        if (record.revision != 0 && record.metadataHash == metadataHash) {
            revert MetadataUnchanged();
        }

        uint32 revision = record.revision + 1;
        record.metadata = metadata;
        record.metadataHash = metadataHash;
        // Safe until a Unix timestamp beyond the uint64 range (roughly 584 billion years).
        // forge-lint: disable-next-line(unsafe-typecast)
        record.publishedAt = uint64(block.timestamp);
        record.revision = revision;

        emit MetadataPublished(productId, msg.sender, metadataHash, revision, length);
    }

    function getMetadata(uint256 productId)
        external
        view
        returns (bytes memory metadata, bytes32 metadataHash, uint32 revision, uint64 publishedAt)
    {
        MetadataRecord storage record = _records[productId];
        return (record.metadata, record.metadataHash, record.revision, record.publishedAt);
    }

    /// @notice Reports whether the latest registry bytes still match the escrow's current commitment.
    function isCurrent(uint256 productId) external view returns (bool) {
        MetadataRecord storage record = _records[productId];
        if (record.revision == 0) return false;

        IDeliveryEscrowProducts.Product memory product = escrow.getProduct(productId);
        return product.seller != address(0) && record.metadataHash == product.metadataHash
            && keccak256(record.metadata) == product.metadataHash;
    }
}
