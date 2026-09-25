# How to Use Markeete

Step-by-step instructions for sellers, buyers and couriers

Version 1.0 — 25 September 2026

## 1. Verify the real protocol before using it

Use only these values:

```text
Website: https://markeete.online
Network: Base Mainnet
Chain ID: 8453
DeliveryEscrow V2: 0x642da3859deD225Cf42efd21346e317e8e26F58e
Native USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Verified source: https://basescan.org/address/0x642da3859deD225Cf42efd21346e317e8e26F58e#code
```

Do not use a contract or token merely because it has the same name. Check the full address in the wallet confirmation before signing.

## 2. What every participant needs

1. Install MetaMask, Rabby or Phantom with EVM support.
2. Select Base Mainnet. The website can request the network switch, but read the wallet prompt before approving it.
3. Keep a small amount of ETH on Base for network gas.
4. Keep enough native Base USDC for the required principal, bond and protocol fees.
5. Open `https://markeete.online` and press **Connect wallet**.
6. Never give the website, another user or a courier a seed phrase or private key. Markeete never needs either one.

An **Approve USDC** transaction gives the escrow permission to pull the displayed amount. It is not the escrow action itself. When an approval is required, the interface first asks for approval and then asks for the actual listing, purchase, bond or confirmation transaction. Both transactions need wallet confirmation and Base ETH for gas.

## 3. Important limitations of the current interface

- Markeete has no accounts, chat, identity verification, address book or backend database.
- Contact details, delivery addresses, product photos and physical meeting arrangements must be exchanged off-chain by the participants.
- Do not put a home address, phone number, passport data or another secret into an on-chain field.
- The contract stores a product price and a `bytes32` metadata commitment. The readable label entered in the current interface is stored only in that browser. A different device may display only `Product #N` unless the seller shares the description separately.
- Courier offers are recorded on-chain, but the current interface does not provide a complete applicant directory. A courier should send the seller or buyer the courier wallet address off-chain. The selecting party then enters that exact address.
- The blockchain cannot inspect an item or prove a physical handoff. It acts on the assigned wallets' signatures and deterministic deadlines.

## 4. Fixed protocol costs

| Action | Protocol cost |
| --- | ---: |
| Create a product listing | 0.20 USDC |
| Purchase a product | 1.00 USDC |
| Submit a forward or return courier offer | 0.05 USDC |
| Most confirmations, bond deposits and cancellations | 0.20 USDC |
| Claim released funds | up to 0.20 USDC, deducted from the claim |

Wallet gas is paid separately in Base ETH. Failed or rejected transactions do not complete the intended action, although a reverted on-chain transaction can still consume gas.

## 5. Seller instructions

### A. Create a listing

1. Connect the wallet that will be the seller for the entire deal.
2. Open **List product**.
3. Enter a label or an existing `bytes32` metadata hash.
4. Enter the product price in USDC.
5. Review the 0.20 USDC listing fee.
6. Press **List product**.
7. If requested, approve the exact USDC amount in the wallet.
8. Confirm the listing transaction.
9. Wait for both transactions to succeed.
10. Record the product ID and share the product description, photos, conditions and contact method with potential buyers off-chain.

The seller may update, deactivate or reactivate an available listing through direct contract calls, but those controls are not yet exposed as dedicated buttons in this first interface.

### B. Wait for a buyer and courier offers

1. When a buyer purchases the product, the product becomes reserved and an order ID is created.
2. Open **Orders** with the seller wallet.
3. Select the order or enter its ID.
4. Couriers may now submit offers containing their proposed pickup and delivery periods.
5. Obtain the applicant's wallet address and terms off-chain.
6. Independently check that the address submitted an active offer.
7. Enter the selected courier address and press **Approve courier**.

Courier selection does not itself charge the 0.20 USDC action fee. The selected courier then has one day to deposit the courier bond. If that courier fails, use the displayed timeout action after the deadline; the order may return to courier selection if time remains or cancel if the selection window has ended.

### C. Deposit the seller bond

After the selected courier deposits its bond:

1. The order changes to **Awaiting seller bond**.
2. The seller bond equals the forward delivery fee plus the return delivery fee.
3. Press **Fund bond** before the displayed deadline.
4. Approve the seller bond plus the 0.20 USDC action fee when requested.
5. Confirm the funding transaction.
6. Wait until the order displays **Ready for pickup**.

Do not hand over the item before the order is ready for pickup and the selected courier address matches the person receiving it.

### D. Hand the product to the selected courier

1. Meet the courier and verify the selected wallet address.
2. Inspect the order ID together.
3. Hand over the product only if the order is still **Ready for pickup** and the pickup deadline has not passed.
4. Seller presses **Confirm courier pickup** and pays the 0.20 USDC action fee.
5. Courier independently presses the same confirmation from the selected courier wallet.
6. The order enters **In transit** only after both signatures exist.

If only one party signs, the contract does not consider custody transferred. Never rely on a screenshot or spoken promise in place of the confirmed on-chain state.

### E. After delivery

- For a normal delivery, the buyer and courier confirm delivery. The product price remains locked during the three-day inspection period.
- If the buyer does not request a return before inspection ends, anyone may submit **Finalize after inspection**. The product price is then credited to the seller.
- If buyer and courier both confirm a material mismatch, the forward courier returns the product under the seller-fault path.
- For an ordinary buyer-choice return, a separately selected return courier may bring the product back.

### F. Receive a returned product

1. Confirm that the order is **Return in transit**.
2. Meet the assigned return courier and inspect the returned item.
3. Press **Confirm return delivery** from the seller wallet and pay the 0.20 USDC action fee.
4. The assigned return courier must also confirm return delivery.
5. Settlement happens after both signatures. If the courier reports the return and the seller remains silent, the return can be finalized after the deadline.

### G. Withdraw released seller funds

1. Open **Funds** using the seller wallet.
2. Read **Available to claim**.
3. Press **Claim**.
4. Confirm the transaction.
5. Up to 0.20 USDC is deducted from the credited amount as the claim fee. The remaining USDC is sent to that seller wallet.

Credits do not expire. No other wallet can force a seller claim.

## 6. Buyer instructions

### A. Check the product and seller off-chain

1. Obtain the product ID and description from the seller or marketplace displaying the listing.
2. Verify the seller wallet, item condition, authenticity, prohibited-item rules, delivery plan and return expectations.
3. Remember that the contract cannot verify those facts.
4. Open **Market** and locate the product ID.

### B. Purchase

1. Press **Buy** on the intended product.
2. Enter the forward delivery fee offered to the courier.
3. Enter the return delivery reserve.
4. Decide whether to enable **Allow courier safe drop at the delivery address**.
5. Review the complete amount:

```text
product price
+ forward delivery fee
+ return delivery reserve
+ 1.00 USDC purchase fee
```

6. Press **Pay in USDC**.
7. Approve the exact amount if requested.
8. Confirm the purchase transaction.
9. Record the new order ID.

Safe drop cannot be enabled later. If enabled, the selected courier can complete delivery without the buyer's delivery signature by calling the safe-drop function before the deadline.

The buyer chooses the forward and return delivery amounts at purchase. A courier may decide whether those amounts justify submitting an offer; the courier cannot change them in the current contract.

### C. Before a courier takes custody

- The seller selects the forward courier.
- The selected courier deposits the product price plus 15% as its bond.
- The seller deposits the two delivery amounts as the seller bond.
- Seller and courier must both confirm pickup.

While the order is still finding a courier, the buyer may press **Cancel order**. Cancellation charges the 0.20 USDC action fee; returned principal becomes claimable rather than being pushed automatically to the wallet. The original purchase fee is not refunded.

### D. Inspect and accept a delivery

1. Meet the assigned courier before the deadline.
2. Verify the order ID and courier wallet.
3. Inspect the item while the courier is present.
4. If the item is acceptable, press **Confirm delivery** and pay the 0.20 USDC action fee.
5. The courier separately confirms delivery.
6. After both confirmations, the courier's forward payment and bond are released, while the seller's product payment stays locked for the three-day inspection period.

Do not confirm delivery if the package is materially different from the agreed product.

### E. Reject a materially mismatched item at delivery

1. Keep the assigned courier present.
2. Buyer presses **Confirm mismatch** and pays the action fee.
3. Courier independently presses **Confirm mismatch**.
4. The forward courier keeps custody and returns the product to the seller.
5. Seller and courier confirm return delivery.
6. After successful return, the buyer's full locked principal is credited back. The forward courier is compensated under the seller-fault settlement.

One mismatch signature is not enough. Both buyer and forward courier must sign while the order is in transit.

### F. Request a voluntary return after accepting delivery

1. Act before the displayed three-day inspection deadline.
2. Open the delivered order.
3. Press **Request return** and pay the 0.20 USDC action fee.
4. Return couriers may submit offers during the displayed acceptance window.
5. Obtain the intended return courier's wallet address off-chain.
6. Enter that address and press **Approve courier**.
7. Wait for the selected return courier to deposit the product price plus 15% bond.
8. Meet the return courier.
9. Buyer and return courier each press **Confirm return pickup** and each pays the action fee.
10. The seller and return courier later confirm return delivery.

For a voluntary return, the buyer bears the original forward delivery cost. The reserved return delivery amount pays the return courier after a completed return. If the voluntary-return process cannot obtain and fund a courier within its allowed retry horizon, the sale completes in favor of the seller and unused return reserve is credited back to the buyer.

### G. If the buyer does nothing

- A courier who timely reports delivery can use the courier-report finalization path after the grace period even without the buyer's signature.
- After delivery is finalized, the buyer has three days to request a voluntary return.
- After inspection expires, anyone may finalize the sale. The seller receives the product price and the unused return reserve is credited to the buyer.
- Deadlines do not trigger by themselves; someone must submit the corresponding timeout transaction.

### H. Withdraw released buyer funds

1. Open **Funds** with the buyer wallet.
2. Read **Available to claim**.
3. Press **Claim** and confirm.
4. Up to 0.20 USDC is deducted from that claim.

## 7. Courier instructions

The buyer and seller wallets for an order cannot act as its courier. A courier may perform forward delivery or may separately offer to perform a voluntary return.

### A. Submit a forward-delivery offer

1. Connect the wallet that will remain the courier wallet throughout the delivery.
2. Open **Courier**. No account, registration or administrator approval is required.
3. Find the order under **Forward deliveries** and press **Open and submit offer**. The buyer and seller wallets for that order are not eligible.
4. Confirm the order state is **Finding courier**. If the job is outside the latest 50 orders, open **Orders** and enter its order ID manually.
5. Enter the proposed pickup period and delivery period.
6. Press **Offer delivery**.
7. Approve and pay the 0.05 USDC courier-offer fee.
8. Send the same courier wallet address to the seller off-chain. The contract records the offer, but it does not publish an enumerable applicant list for the seller interface.

Submitting an offer does not lock a bond and does not guarantee selection. Multiple couriers may offer; only the seller selects the forward courier.

### B. Deposit the selected courier bond

If the seller selects the offer:

1. The order changes to **Awaiting courier bond**.
2. Verify that the selected courier address is your wallet.
3. The required bond is the product price plus 15%.
4. Press **Fund bond** before the one-day funding deadline.
5. Approve the bond plus the 0.20 USDC action fee.
6. Confirm the funding transaction.
7. Wait for the seller to fund its bond.

Example: a 100 USDC item requires a 115 USDC courier bond, plus the 0.20 USDC funding action fee.

### C. Collect the product

1. Wait until the order displays **Ready for pickup**.
2. Meet the seller and check the order ID.
3. Do not accept the package after the pickup deadline or from a different seller.
4. Seller and courier each press **Confirm courier pickup** from their assigned wallets.
5. Each confirmation costs 0.20 USDC.
6. Take custody only when both transactions are confirmed and the order displays **In transit**.

If the courier takes an item without both confirmed signatures, the contract may still treat the pickup as incomplete.

### D. Complete normal delivery

1. Meet the buyer before the delivery deadline.
2. Let the buyer inspect the product.
3. If accepted, buyer and courier each press **Confirm delivery** and pay their action fees.
4. When both signatures exist, the courier's forward delivery payment and courier bond are credited for withdrawal.

If only the courier reports delivery, the courier's timely report can be finalized after the contract's resolution time. Ratings or off-chain evidence are not evaluated by this version of the contract.

### E. Handle a mismatch

1. If the item is materially wrong, keep custody while the buyer inspects it.
2. Buyer and courier each press **Confirm mismatch**.
3. After both confirmations, the same forward courier becomes the return courier for this seller-fault return.
4. Return the item to the seller before the return deadline.
5. Courier and seller each press **Confirm return delivery**.
6. The courier's applicable compensation and bond are then credited.

### F. Handle safe drop

Use **Confirm safe drop** only if:

1. the buyer enabled safe drop when purchasing;
2. the order is still in transit;
3. the delivery deadline has not passed; and
4. the courier actually followed the off-chain delivery arrangement.

The courier alone can complete the on-chain safe-drop path. The contract cannot verify the address or package location.

### G. Handle an absent buyer

1. Attempt the agreed delivery off-chain.
2. If the buyer is absent, wait until the delivery deadline.
3. During the next one-day reporting window, press **Report buyer absent** and pay the action fee.
4. Wait one additional day after the report.
5. If the buyer still has not completed delivery, press **Start absent-buyer return** and pay the action fee.
6. Return the product to the seller.
7. Courier and seller confirm return delivery.

Missing the on-chain reporting window can change the available settlement path. Read the live order deadlines rather than relying on calendar estimates.

### H. Work as a voluntary return courier

1. Connect a courier wallet, open **Courier** and find an order under **Return deliveries**. It must be in **Return requested** state.
2. Open the order and press **Offer return delivery**. For older orders, open **Orders** and enter the order ID manually.
3. Pay the 0.05 USDC offer fee.
4. Send the courier wallet address to the buyer off-chain.
5. If selected, deposit the product price plus 15% bond and the 0.20 USDC funding fee before the deadline.
6. Meet the buyer and inspect the order ID.
7. Buyer and return courier each press **Confirm return pickup**.
8. Deliver the product to the seller before the return deadline.
9. Seller and return courier each press **Confirm return delivery**.
10. Claim the released return delivery payment and courier bond from **Funds**.

### I. Withdraw courier funds

1. Open **Funds** with the exact courier wallet used by the order.
2. Read **Available to claim**.
3. Press **Claim**.
4. Confirm the transaction. Up to 0.20 USDC is deducted from the claim.

## 8. Timeouts and defaults

The contract never wakes itself up. After a deadline, a user or bot must submit the matching transaction. Depending on the current state, the interface may show actions such as:

- **Expire overdue stage**
- **Reset expired selection**
- **Finalize timeout**
- **Finalize courier report**
- **Finalize after inspection**
- **Expire unmatched return**
- **Declare courier default**

These functions cannot arbitrarily choose a winner. They read the stored state, signatures and deadline and apply the fixed settlement rule. They remain callable after the relevant deadline unless the order has already moved to another state.

If a courier takes custody and then fails to report delivery before the final resolution time, anyone may call the courier-default path. Buyer escrow is credited back to the buyer, and the seller receives its seller bond plus the active courier bond. The product is marked lost.

## 9. Complete 100 USDC example

Assume:

```text
Product price: 100.00 USDC
Forward delivery: 20.00 USDC
Return reserve: 20.00 USDC
```

- Buyer deposits 140.00 USDC principal and pays the 1.00 USDC purchase fee.
- Selected courier deposits a 115.00 USDC bond and pays the 0.20 USDC funding fee.
- Seller deposits a 40.00 USDC bond and pays the 0.20 USDC funding fee.
- Every fee-bearing confirmation costs another 0.20 USDC to the wallet making it.
- A courier offer costs 0.05 USDC whether or not that courier is selected.
- Released balances remain inside the escrow as claimable credit until each recipient calls **Claim**.

## 10. Final safety checklist

Before every signature:

1. Check Base Mainnet and chain ID 8453.
2. Check the full escrow address, not only the first and last characters.
3. Check the function, order ID and USDC amount in the Markeete notice and wallet prompt.
4. Re-read the current order state and deadline.
5. Verify the counterparty wallet off-chain.
6. Never sign both delivery and mismatch for the same role.
7. Never treat a screenshot as proof of an on-chain transaction; wait for confirmation.
8. Never reveal a seed phrase or private key.
9. Use only funds you can afford to lose.
10. Read the full risk disclosure: https://markeete.online/risk-disclosure.md

Markeete is experimental and has not received an independent professional audit. It is not a carrier, inspector, insurer, identity provider, marketplace arbiter, bank or custodian. The deployed contract and live on-chain state are authoritative.
