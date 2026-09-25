# Markeete Technical Reference

Version 1.0 — 25 September 2026

This document describes the two immutable contracts used by the Markeete interface. The deployed bytecode and current Base state are authoritative.

## 1. Canonical deployment

- Network: Base Mainnet
- Chain ID: `8453`
- DeliveryEscrow V2: `0x642da3859deD225Cf42efd21346e317e8e26F58e`
- ProductMetadataRegistry: `0xFC707ebB5A9987231e4e1FcA20bB40C2159B4016`
- Native Base USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Escrow ABI: https://markeete.online/abi/DeliveryEscrow.json
- Registry ABI: https://markeete.online/abi/ProductMetadataRegistry.json
- Verified escrow source: https://basescan.org/address/0x642da3859deD225Cf42efd21346e317e8e26F58e#code
- Verified registry source: https://basescan.org/address/0xFC707ebB5A9987231e4e1FcA20bB40C2159B4016#code

Always verify the chain ID and complete address. A similarly named contract is not part of this deployment.

## 2. Contract separation

`DeliveryEscrow V2` is the financial and state-machine contract. It holds USDC, records products and orders, assigns wallet roles, enforces deadlines and calculates settlement credits.

`ProductMetadataRegistry` is the public catalog contract. It stores the exact public metadata bytes committed by a product's `metadataHash` in DeliveryEscrow. It never holds USDC and cannot change escrow state.

This separation allowed the catalog to be added without replacing or modifying the immutable escrow. The registry's `escrow` address is immutable and permanently points to the canonical DeliveryEscrow V2 deployment.

## 3. ProductMetadataRegistry security properties

- No owner, administrator or guardian.
- No proxy or upgrade mechanism.
- No withdrawal, fee or token-transfer functions.
- Cannot list products, change prices, create orders or settle funds.
- Accepts at most 4,096 metadata bytes per product.
- Only the seller recorded by DeliveryEscrow for that product can publish.
- Published bytes must hash exactly to the product's current on-chain `metadataHash`.
- A repeated publication of the unchanged hash reverts.
- A seller may publish a later revision only after updating the product commitment in DeliveryEscrow.

Cryptographic integrity proves that the retrieved bytes are the exact bytes committed by the seller. It does not prove that the description, region, product condition or delivery claim is true.

## 4. Registry functions

### `escrow() -> address`

Returns the immutable DeliveryEscrow V2 address used for all seller and hash checks.

### `MAX_METADATA_LENGTH() -> uint256`

Returns `4096`, the maximum permitted metadata length in bytes.

### `publish(uint256 productId, bytes metadata)`

Publishes or revises a product's public metadata. The transaction succeeds only when:

1. `metadata` is between 1 and 4,096 bytes;
2. `DeliveryEscrow.getProduct(productId)` identifies an existing seller;
3. `msg.sender` is that exact seller wallet;
4. `keccak256(metadata)` equals the product's current `metadataHash`; and
5. the same hash is not already the current published revision.

On success it stores the bytes, hash, block timestamp and incremented revision, then emits `MetadataPublished`.

### `getMetadata(uint256 productId)`

Returns:

```text
metadata:      exact published bytes
metadataHash:  keccak256 hash stored with the record
revision:      0 when unpublished, otherwise an incrementing revision
publishedAt:   block timestamp of the current revision
```

Clients must still calculate `keccak256(metadata)` themselves and compare it with both returned `metadataHash` and `DeliveryEscrow.getProduct(productId).metadataHash`.

### `isCurrent(uint256 productId) -> bool`

Returns true only when a registry record exists and both its stored hash and recalculated byte hash equal the product's current escrow commitment. It is an integrity helper, not a truth or authenticity oracle.

## 5. Registry event

```solidity
event MetadataPublished(
    uint256 indexed productId,
    address indexed seller,
    bytes32 indexed metadataHash,
    uint32 revision,
    uint256 length
);
```

Indexers can use this event to discover catalog publications, but should read current contract state before displaying or acting on a record.

## 6. Listing and update transaction sequence

Publishing a complete listing requires two seller-signed Base transactions:

1. Call `DeliveryEscrow.listProduct(price, metadataHash)` for a new product, or `updateProduct(productId, price, metadataHash)` for an existing product.
2. Call `ProductMetadataRegistry.publish(productId, metadata)` with the exact bytes whose hash was committed in step 1.

The first transaction updates the financial product record and charges the configured escrow fee. The second stores public metadata, transfers no USDC and charges only Base network gas.

If the second transaction is interrupted, the product commitment still exists but catalog details are unavailable. The Markeete interface keeps a temporary recovery copy in the seller's browser and offers **Finish publishing**. Buyers cannot purchase through the interface until the registry bytes pass all integrity checks.

## 7. Markeete metadata document version 1

The official interface encodes canonical UTF-8 JSON with these fields:

```json
{
  "version": 1,
  "chainId": 8453,
  "escrow": "0x642da3859ded225cf42efd21346e317e8e26f58e",
  "seller": "0x...",
  "title": "Vacuum cleaner, sealed",
  "description": "New in sealed packaging. 1.5 kg, 10 litre parcel.",
  "shippingPolicy": "allowlist",
  "shippingCountries": ["AE", "US"],
  "deliveryMethods": ["verified-logistics-partner"]
}
```

Supported `shippingPolicy` values are `worldwide`, `allowlist`, `blocklist` and `pickup-only`. Supported delivery methods are `seller-employee`, `verified-logistics-partner`, `local-pickup` and `international-courier`.

Metadata is permanently public. Sellers must not publish names, delivery addresses, phone numbers, email addresses or other private information.

## 8. Client validation requirements

Before displaying a listing as verified, a client should:

1. require Base chain ID `8453` and the canonical contract addresses;
2. read the current product from DeliveryEscrow;
3. read the current record from ProductMetadataRegistry;
4. require a non-zero revision;
5. recalculate `keccak256(metadata)`;
6. require the recalculated hash, registry hash and escrow `metadataHash` to match;
7. decode the JSON and require `version = 1`, `chainId = 8453`, the canonical escrow address and the current product seller; and
8. treat all seller-authored text as untrusted content even after integrity verification.

The Markeete web interface performs these checks automatically.
