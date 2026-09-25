# ProductMetadataRegistry V1 specification

Status: local contract implementation and tests complete; not deployed

Date: 25 September 2026

## 1. Problem being corrected

The current Markeete interface hashes the seller's readable label and writes only the resulting `bytes32` to DeliveryEscrow V2. The readable label is saved in that browser's `localStorage`. A buyer using another browser can therefore see the product ID, seller, price, status and metadata hash, but may see only `Product #N` instead of the title and cannot retrieve a description, delivery methods or shipping regions.

This is an architectural defect in the current catalog layer. It does not affect escrow accounting or custody, but it prevents the website from functioning as a complete shared marketplace catalog.

DeliveryEscrow V2 remains canonical and will not be redeployed. The correction is a separate, non-custodial metadata registry linked to the existing escrow.

## 2. Goals

- Keep DeliveryEscrow V2 unchanged at `0x642da3859deD225Cf42efd21346e317e8e26F58e`.
- Store public, human-readable product metadata on Base so every browser can retrieve it without Markeete operating a database.
- Cryptographically bind the published bytes to the product's existing `metadataHash`.
- Allow only the product seller recorded by DeliveryEscrow V2 to publish metadata for that product ID.
- Support title, description, shipping policy, destination countries and delivery-method notes.
- Let the interface perform hashing, validation, publishing and verification automatically.
- Allow existing active products, including Product #1, to be migrated through the interface.
- Keep the registry unable to move USDC, modify orders, select couriers or affect escrow settlement.

## 3. Non-goals

- The registry does not prove that a description is true.
- The registry does not verify a seller, courier, address or destination.
- Region matching is advisory in DeliveryEscrow V2. The escrow contract cannot enforce a country restriction.
- The registry does not store delivery addresses, phone numbers, names, tracking numbers or other private information.
- The registry is not an image host. A future version may support content-addressed image references after a separate review.
- The registry does not create a seller-side reject function. DeliveryEscrow V2 has no immediate seller rejection transition after purchase.

## 4. Trust model

The registry has:

- one immutable reference to DeliveryEscrow V2;
- no owner;
- no guardian;
- no treasury;
- no upgrade proxy;
- no token approvals or token transfers;
- no protocol fee;
- no method capable of changing escrow state.

Only the seller returned by `DeliveryEscrow.getProduct(productId)` may publish metadata. The registry also requires:

```text
keccak256(metadataBytes) == product.metadataHash
```

This makes the escrow hash the authoritative commitment. A registry response with different bytes is invalid.

## 5. Metadata document

The interface produces UTF-8 JSON with a fixed key order. It trims text fields, normalizes Unicode to NFC, uppercases country codes, removes duplicate country codes and sorts country codes alphabetically before encoding.

Version 1 shape:

```json
{
  "version": 1,
  "chainId": 8453,
  "escrow": "0x642da3859deD225Cf42efd21346e317e8e26F58e",
  "seller": "0x0000000000000000000000000000000000000000",
  "title": "Vacuum cleaner",
  "description": "New, sealed package.",
  "shippingPolicy": "allowlist",
  "shippingCountries": ["AE", "CA", "US"],
  "deliveryMethods": ["seller-employee", "verified-logistics-partner"]
}
```

The seller field is replaced with the connected seller address before encoding.

### Required validation

- `version`: exactly `1`.
- `chainId`: exactly `8453` for the production registry.
- `escrow`: exact canonical DeliveryEscrow V2 address.
- `seller`: exact connected seller address, checksummed when displayed and lowercase when encoded.
- `title`: 1 to 120 UTF-8 bytes after normalization.
- `description`: 1 to 1,500 UTF-8 bytes after normalization.
- `shippingPolicy`: one of `worldwide`, `allowlist`, `blocklist`, `pickup-only`.
- `shippingCountries`: zero to 64 unique ISO 3166-1 alpha-2 country codes.
- `deliveryMethods`: one to 8 values from the supported interface vocabulary.
- Complete encoded metadata: at most 4,096 bytes. The implementation phase must measure publication gas before the final cap is accepted.

For `worldwide` and `pickup-only`, `shippingCountries` must be empty. `allowlist` and `blocklist` require at least one country.

Initial delivery-method vocabulary:

- `seller-employee`
- `verified-logistics-partner`
- `local-pickup`
- `international-courier`

These are catalog statements only. DeliveryEscrow V2 still requires an eligible courier wallet for its existing physical-delivery workflow.

## 6. Proposed contract surface

```solidity
interface IProductMetadataRegistry {
    event MetadataPublished(
        uint256 indexed productId,
        address indexed seller,
        bytes32 indexed metadataHash,
        uint32 revision,
        uint256 length
    );

    function escrow() external view returns (address);
    function publish(uint256 productId, bytes calldata metadata) external;
    function getMetadata(uint256 productId)
        external
        view
        returns (
            bytes memory metadata,
            bytes32 metadataHash,
            uint32 revision,
            uint64 publishedAt
        );
    function isCurrent(uint256 productId) external view returns (bool);
}
```

The implementation uses ordinary contract storage. This is deliberately simpler than a
bytecode-storage pattern and keeps retrieval and revision behavior easy to inspect. Local gas
measurement showed 2,595 bytes of runtime code, 2,783 bytes of initcode and approximately 615,551
gas to deploy. The isolated `publish` call used approximately 104k gas for the representative short
JSON document and 458k gas for the maximum 4,096-byte payload. The 4,096-byte cap is therefore
retained.

### `publish` requirements

1. Read the product from the immutable escrow.
2. Revert if the product does not exist.
3. Revert unless `msg.sender` equals the recorded product seller.
4. Revert when metadata is empty or exceeds the final size limit.
5. Compute `keccak256(metadata)`.
6. Revert unless it equals the product's current `metadataHash`.
7. Store the exact bytes, hash, incremented revision and timestamp.
8. Emit `MetadataPublished`.

The registry does not need to understand JSON to enforce integrity. JSON validation is performed by the interface before the seller signs. Other clients may parse the public bytes independently.

## 7. Automatic seller experience

The seller never handles JSON or hashes manually.

### New listing

1. Seller enters title, description, shipping policy, countries and delivery methods.
2. Interface validates and canonicalizes the form.
3. Interface creates the exact JSON bytes and calculates `metadataHash`.
4. Interface submits `listProduct(price, metadataHash)` to DeliveryEscrow V2.
5. Interface waits for the receipt and reads `productId` from `ProductListed`.
6. Interface submits `publish(productId, metadataBytes)` to ProductMetadataRegistry.
7. The listing is shown as complete only after both transactions succeed.

USDC approval may still be a separate wallet confirmation. The registry publication uses Base ETH for gas but transfers no USDC.

If step 6 fails or is rejected, the escrow listing still exists. The seller can press **Finish publishing** later. The public Market view labels the listing `Metadata unavailable` and disables the normal Buy button until valid metadata is published.

### Updating an active product

1. Seller edits the form.
2. Interface creates new canonical bytes and hash.
3. Interface calls `updateProduct(productId, currentPrice, newHash)` on the escrow and includes the action fee.
4. After confirmation, interface calls `publish(productId, newMetadata)` on the registry.
5. Buyers display the new data only when the registry bytes match the escrow's current hash.

## 8. Automatic buyer verification

The buyer does not inspect JSON or compare hashes manually.

For every active product displayed by Market, the interface:

1. reads price, seller, status and `metadataHash` from DeliveryEscrow V2;
2. reads metadata bytes and stored hash from ProductMetadataRegistry;
3. calculates `keccak256(metadataBytes)` locally;
4. requires both the calculated hash and registry hash to equal the escrow hash;
5. parses the JSON only after the hash check;
6. validates chain ID, escrow address, seller, version and field limits;
7. displays the title, description, shipping policy and delivery methods;
8. disables the normal Buy action and shows a clear warning if any check fails.

This verification is automatic on every load. It is defense in depth: the registry contract already rejects mismatched bytes, while the browser verifies again before rendering them as trusted listing data.

## 9. Existing Product #1 migration

Product #1 currently commits to the old label-only hash rather than the new JSON document. Because it is active, the seller can migrate it without redeploying DeliveryEscrow V2:

1. Connect the original Product #1 seller wallet.
2. Open **Manage product** and enter the full metadata form.
3. Interface generates the JSON and new hash.
4. Interface calls `updateProduct(1, currentPrice, newHash)` and pays the existing 0.20 USDC action fee.
5. Interface calls `publish(1, metadataBytes)` on the registry.
6. Market verifies the registry record and begins showing the complete listing to every buyer.

The interface performs all encoding and verification. The seller only reviews the form and wallet prompts.

## 10. Regional matching

The shipping policy is interpreted as follows:

- `worldwide`: every selected destination country is supported.
- `allowlist`: only listed countries are supported.
- `blocklist`: every country except listed countries is supported.
- `pickup-only`: shipping-region matching is not applicable; the buyer must arrange the stated local pickup.

Display states:

- Green: destination is explicitly supported.
- Red: destination is explicitly unsupported; Buy is disabled in the Markeete interface.
- Amber: destination is unknown or metadata is unavailable; buyer must confirm delivery with the seller.

This is interface enforcement only. A user or bot can call DeliveryEscrow V2 directly. Seller and buyer must still confirm the real destination off-chain before payment.

## 11. Approximate location and privacy

IP geolocation is optional and advisory. The planned Cloudflare endpoint returns only a coarse ISO country code from the current request context. Markeete does not need to return, store or write the raw IP address into a cookie, database or blockchain.

The buyer can always select a different destination country because IP country may be wrong, may reflect a VPN or may differ from the shipping destination. The interface may remember only the manually selected ISO country code in local storage or a cookie.

No precise address is stored in registry metadata.

## 12. Security tests before deployment

Local implementation status: 22 tests pass, including 2,000-run fuzz tests. The suite also deploys
the real `DeliveryEscrow` implementation locally and confirms that the registry's minimal product
interface decodes its actual `getProduct` ABI correctly.

- [x] Constructor rejects zero or non-contract escrow address.
- [x] Only the recorded product seller can publish.
- [x] Unknown product IDs revert.
- [x] Empty and oversized metadata revert.
- [x] A one-byte metadata change causes a hash mismatch and reverts.
- [x] A stale document cannot be republished after the escrow hash changes.
- [x] Revisions increment exactly once per successful publish.
- [x] Failed publication leaves the previous record unchanged.
- [x] Existing registry records remain readable after later revisions.
- [x] Maximum length and maximum length plus one are tested.
- [x] Arbitrary callers and byte strings are fuzzed.
- [x] The real local `DeliveryEscrow.getProduct` ABI is tested.
- [x] Gas measurements cover 256, 1,024, 2,048 and 4,096-byte metadata documents.
- [ ] Fork test against the verified Base deployment.
- [ ] Frontend test that invalid bytes, invalid JSON, wrong seller, wrong chain and wrong hash disable Buy.

## 13. Deployment sequence

1. **Complete:** implement contract and tests locally.
2. **Complete:** review byte-storage choice and gas measurements.
3. Deploy to Base Sepolia.
4. Publish source and verify exact bytecode.
5. Integrate the testnet interface and migrate a test product.
6. Run seller, buyer and regional-display acceptance tests.
7. Obtain explicit approval before Base Mainnet deployment.
8. Deploy registry to Base Mainnet and verify it.
9. Pin the registry address in the website and documentation.
10. Migrate Product #1 through the seller interface.

No step changes or redeploys DeliveryEscrow V2.
