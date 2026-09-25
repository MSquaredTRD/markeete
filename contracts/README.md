# Product metadata registry

`ProductMetadataRegistry.sol` is deployed on Base Mainnet at
`0xFC707ebB5A9987231e4e1FcA20bB40C2159B4016`. It is a separate catalog registry and cannot change
the immutable DeliveryEscrow V2 contract.

The registry:

- is permanently linked to one escrow address at construction;
- accepts metadata only from the seller recorded by that escrow;
- requires an exact `keccak256` match with the product's current on-chain commitment;
- holds no USDC and has no owner, guardian, proxy or administrative write path;
- stores at most 4,096 bytes per product revision.

The local Foundry suite contains 22 registry tests, including 2,000-run fuzz cases and an
integration test using the real `DeliveryEscrow.getProduct` ABI. The entire project suite contains
90 passing tests plus four passing stateful invariants (65,536 invariant calls). Slither 0.11.6
reports zero findings for the registry source.

The approved design, metadata schema, measured gas and remaining deployment gates are documented
in [`../docs/product-metadata-registry-v1.md`](../docs/product-metadata-registry-v1.md).
