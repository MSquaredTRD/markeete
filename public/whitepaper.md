# Markeete Protocol Whitepaper

Version 1.0 — 25 September 2026

## 1. Summary

Markeete is an immutable, non-custodial USDC escrow for a buyer, seller and courier. It runs on Base Mainnet. The contract holds funds during a deterministic delivery workflow, records wallet confirmations, applies deadlines, and credits settlement balances that participants claim later.

The protocol does not observe the physical world. It cannot inspect a product, identify a human or prove delivery. It converts signed transactions from assigned wallet roles and the passage of blockchain time into deterministic settlement outcomes.

## 2. Canonical deployment

- Network: Base Mainnet
- Chain ID: `8453`
- DeliveryEscrow V2: `0x642da3859deD225Cf42efd21346e317e8e26F58e`
- Native USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Treasury: `0xF4EDaee3C9cAcC28E9e2eBCbF60962A8e405992A`
- Guardian: `0xF4EDaee3C9cAcC28E9e2eBCbF60962A8e405992A`
- Explorer: https://basescan.org/address/0x642da3859deD225Cf42efd21346e317e8e26F58e
- Public ABI: https://markeete.online/abi/DeliveryEscrow.json
- Sourcify: exact creation and runtime bytecode match, verified 25 September 2026
- Sourcify record: https://sourcify.dev/server/v2/contract/8453/0x642da3859deD225Cf42efd21346e317e8e26F58e?fields=all

Addresses are part of the security model. A contract with the same name at another address is not this deployment. Sourcify and BaseScan verification are independent systems.

## 3. Fixed mainnet parameters

- Listing fee: `0.20 USDC`
- Purchase fee: `1.00 USDC`
- Action fee: `0.20 USDC`
- Courier-offer fee: `0.05 USDC`
- Configured product-price cap: none
- Configured aggregate-liability cap: none
- Courier bond: product price plus `15%`
- Inspection period after delivery: `3 days`
- Buyer-absent grace period: `1 day`
- Initial courier selection period: `3 days`
- Courier bond funding period: `1 day`
- Seller bond funding period: `1 day`
- Return-courier acceptance period: `3 days`
- Return pickup period: `3 days`
- Return delivery period: `30 days`
- Maximum voluntary-return matching process: `30 days`

USDC uses six decimals. `1 USDC` is passed to the contract as `1_000_000`.

## 4. Roles

### Seller

Lists a product, selects a forward courier, funds the seller delivery bond, co-signs pickup and receives the product price after the inspection period if no valid return completes.

### Buyer

Creates an order and funds product price, forward delivery and return reserve. The buyer confirms delivery or mismatch, may request a voluntary return during the three-day inspection period, selects a return courier and co-signs return pickup.

### Forward courier

Offers pickup and delivery periods, is selected by the seller, funds a product-value bond plus 15%, co-signs pickup, transports the item and reports delivery or mismatch.

### Return courier

For a voluntary buyer-choice return, offers return service, is selected by the buyer, funds a product-value bond plus 15%, co-signs return pickup and transports the item back to the seller. For seller-fault or buyer-absent paths, the forward courier performs the return.

### Guardian

May pause or resume only new listings, purchases and product reactivations. Existing orders, claims and timeout settlement remain available. The guardian cannot edit orders or transfer participant principal.

### Treasury

May withdraw only `accruedFees`. Contract accounting requires the USDC balance to remain at least `totalLiability + accruedFees`.

## 5. Product lifecycle

A seller calls `listProduct(price, metadataHash)`. The contract stores the seller, price, bytes32 metadata commitment and status. Human-readable descriptions and images are not stored by the current contract.

Product states are `None`, `Active`, `Reserved`, `Inactive`, `Sold` and `Lost`. A purchase reserves an active product. A pre-custody cancellation makes it active again. A completed sale makes it sold. A completed return makes it inactive. A courier default after custody makes it lost.

## 6. Purchase and forward delivery

1. Buyer calls `createOrder` and transfers price + forward delivery fee + return reserve, plus the purchase fee.
2. Any address other than buyer or seller may submit a courier offer for `0.05 USDC`.
3. Seller selects exactly one submitted offer with `approveCourier`.
4. Selected courier funds `price + 15%` plus the action fee.
5. Seller funds `forward delivery fee + return delivery fee` plus the action fee.
6. Seller and courier each call `confirmPickup`. Custody begins only after both confirmations.
7. Buyer and courier normally call `confirmDelivery`.
8. At delivery, buyer and courier may instead both call `confirmMismatch`, which starts a seller-fault return.
9. If the buyer authorized safe drop during purchase, the courier alone may call `confirmSafeDrop` before the deadline.

Before custody, relevant timeouts return principal to credited parties and cancel the order. Seller claiming to have handed over an item is insufficient; both seller and courier signatures are required for pickup.

## 7. Delivery, silence and inspection

When delivery is established, the courier receives the forward fee and return of the courier bond. The seller's delivery bond is released. The product price stays in escrow for the three-day inspection period.

If the courier reports delivery but the buyer does not co-sign, anyone may finalize after the configured resolution time. This implements the rule that the bonded courier's timely report wins after grace. A buyer may request a return during inspection instead of remaining silent.

After inspection expires without a return, `finalizeInspection` credits the price to the seller and unused return reserve to the buyer.

## 8. Buyer absent

After the delivery deadline, the courier may report the buyer absent. After one additional grace period, the courier may begin returning the product. On completed return, the buyer is credited the product price, the courier is credited delivery funds and its bond, and the seller receives its bond back.

Safe drop is a different mode and must have been authorized by the buyer when the order was created.

## 9. Returns

### Buyer-choice return

During inspection, the buyer calls `requestReturn`. Couriers may offer the return; the buyer selects one. The selected return courier funds a product-value bond plus 15%. Buyer and return courier co-sign return pickup. Seller and return courier co-sign return delivery.

On successful return, the buyer receives the product price. The return courier receives the reserved return-delivery fee and its bond. The buyer bears the forward delivery cost.

If no return courier completes the process before the maximum matching window, the sale completes in favor of the seller and the unused return reserve is credited back to the buyer.

### Seller-fault mismatch

Buyer and forward courier must both confirm mismatch while the order is in transit. The forward courier returns the product. On confirmed return, the buyer is credited all buyer escrow and the courier is compensated from the seller bond while receiving its own bond back.

### Return recipient silence

If a courier timely reports return delivery and the seller does not co-sign, anyone may finalize after the return delivery deadline.

## 10. Courier default

If an in-transit courier has not reported delivery by the deterministic resolution time, anyone may call `declareCourierDefault`. Buyer escrow is credited back to the buyer. The seller is credited its seller bond plus the active courier bond. The product becomes `Lost`.

The contract does not find the package or punish a human. It only distributes funds already locked on-chain.

## 11. Pull payments

Settlement uses credits rather than sending USDC inside complex state transitions. `claimable(address)` is public. Only the credited wallet may call `claim()`. Credits do not expire and may be accumulated before claiming.

The action fee is deducted from the gross claim and capped at that claim amount. No third party can force an account to claim early or repeatedly charge it on small credits.

## 12. Accounting and token checks

The constructor requires a six-decimal token. The mainnet deployment script pins the official Base native USDC address. Every incoming transfer measures the contract balance before and after and reverts unless the exact amount arrived, rejecting fee-on-transfer behavior.

`accountingInvariantHolds()` reports whether contract USDC balance is at least liabilities plus accrued fees. There is no configured value cap; exact-transfer accounting and this solvency invariant apply at every scale.

## 13. Immutability and administrator limits

The contract is not upgradeable. There is no proxy administrator, arbitrary withdrawal function, order editor or key capable of signing for a buyer, seller or courier. Treasury and guardian addresses are immutable.

Immutability limits administrator abuse but also means a defect cannot be patched in place. A new version would require a separate deployment and voluntary migration for new deals.

## 14. Trust assumptions and limitations

The protocol assumes users protect wallet keys, inspect wallet prompts, choose counterparties and act before deadlines. It assumes Base continues operating and native USDC transfers as expected.

The protocol cannot establish identity, product authenticity, legal ownership, condition, delivery location, human intent or truthfulness. Bonds change incentives but do not eliminate fraud. Ratings can provide additional public history but cannot prove that different wallets represent different people.

## 15. Automation

No backend API is required. Bots read Base and call the escrow directly. Automation must pin chain ID and addresses, simulate transactions, re-read state immediately before signing, calculate six-decimal USDC amounts exactly and never handle user private keys.

See https://markeete.online/bot-guide.md for complete workflows and examples.

## 16. Status

The deployment is live and the interface is operational. The code has automated unit, fuzz and invariant tests but has not received an independent professional audit. This document describes intended and observed behavior; the deployed bytecode and current on-chain state are authoritative.
