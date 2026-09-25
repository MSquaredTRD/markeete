import type { Abi, Address } from 'viem';

export const ESCROW_ADDRESS = '0x642da3859deD225Cf42efd21346e317e8e26F58e' as Address;
export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
export const TREASURY_ADDRESS = '0xF4EDaee3C9cAcC28E9e2eBCbF60962A8e405992A' as Address;
export const BASE_CHAIN_ID = 8453;
export const BASE_RPC_URL = 'https://mainnet.base.org';
export const BASE_READ_RPC_URLS = [
  'https://base-rpc.publicnode.com',
  BASE_RPC_URL,
  'https://1rpc.io/base',
  'https://base.gateway.tenderly.co',
] as const;
export const BASESCAN_URL = 'https://basescan.org';
export const VERIFIED_CONTRACT_URL = `${BASESCAN_URL}/address/${ESCROW_ADDRESS}#code`;
export const SOURCIFY_CONTRACT_URL = `https://sourcify.dev/server/v2/contract/${BASE_CHAIN_ID}/${ESCROW_ADDRESS}?fields=all`;

const productComponents = [
  { name: 'seller', type: 'address' },
  { name: 'price', type: 'uint128' },
  { name: 'metadataHash', type: 'bytes32' },
  { name: 'status', type: 'uint8' },
] as const;

const orderComponents = [
  { name: 'productId', type: 'uint256' },
  { name: 'seller', type: 'address' },
  { name: 'buyer', type: 'address' },
  { name: 'courier', type: 'address' },
  { name: 'returnCourier', type: 'address' },
  { name: 'price', type: 'uint128' },
  { name: 'forwardDeliveryFee', type: 'uint128' },
  { name: 'returnDeliveryFee', type: 'uint128' },
  { name: 'buyerEscrow', type: 'uint128' },
  { name: 'sellerBond', type: 'uint128' },
  { name: 'courierBond', type: 'uint128' },
  { name: 'returnCourierBond', type: 'uint128' },
  { name: 'courierAcceptDeadline', type: 'uint64' },
  { name: 'courierFundingDeadline', type: 'uint64' },
  { name: 'sellerFundingDeadline', type: 'uint64' },
  { name: 'pickupDeadline', type: 'uint64' },
  { name: 'deliveryDeadline', type: 'uint64' },
  { name: 'selectedPickupPeriod', type: 'uint64' },
  { name: 'selectedDeliveryPeriod', type: 'uint64' },
  { name: 'deliveredAt', type: 'uint64' },
  { name: 'inspectionEndsAt', type: 'uint64' },
  { name: 'absentReportedAt', type: 'uint64' },
  { name: 'returnAcceptDeadline', type: 'uint64' },
  { name: 'returnProcessDeadline', type: 'uint64' },
  { name: 'returnCourierFundingDeadline', type: 'uint64' },
  { name: 'returnPickupDeadline', type: 'uint64' },
  { name: 'returnDeliveryDeadline', type: 'uint64' },
  { name: 'pickupConfirmations', type: 'uint8' },
  { name: 'deliveryConfirmations', type: 'uint8' },
  { name: 'mismatchConfirmations', type: 'uint8' },
  { name: 'returnPickupConfirmations', type: 'uint8' },
  { name: 'returnDeliveryConfirmations', type: 'uint8' },
  { name: 'state', type: 'uint8' },
  { name: 'deliveryMode', type: 'uint8' },
  { name: 'returnReason', type: 'uint8' },
] as const;

const fn = (
  name: string,
  stateMutability: 'view' | 'nonpayable',
  inputs: readonly { name: string; type: string }[] = [],
  outputs: readonly { name: string; type: string; components?: readonly { name: string; type: string }[] }[] = [],
) => ({ type: 'function', name, stateMutability, inputs, outputs }) as const;

export const escrowAbi = [
  fn('getProduct', 'view', [{ name: 'productId', type: 'uint256' }], [{ name: '', type: 'tuple', components: productComponents }]),
  fn('getOrder', 'view', [{ name: 'orderId', type: 'uint256' }], [{ name: '', type: 'tuple', components: orderComponents }]),
  fn('nextProductId', 'view', [], [{ name: '', type: 'uint256' }]),
  fn('nextOrderId', 'view', [], [{ name: '', type: 'uint256' }]),
  fn('listingFee', 'view', [], [{ name: '', type: 'uint128' }]),
  fn('purchaseFee', 'view', [], [{ name: '', type: 'uint128' }]),
  fn('actionFee', 'view', [], [{ name: '', type: 'uint128' }]),
  fn('accruedFees', 'view', [], [{ name: '', type: 'uint256' }]),
  fn('totalLiability', 'view', [], [{ name: '', type: 'uint256' }]),
  fn('newActivityPaused', 'view', [], [{ name: '', type: 'bool' }]),
  fn('accountingInvariantHolds', 'view', [], [{ name: '', type: 'bool' }]),
  fn('claimable', 'view', [{ name: 'account', type: 'address' }], [{ name: 'amount', type: 'uint256' }]),
  fn('requiredCourierBond', 'view', [{ name: 'price', type: 'uint256' }], [{ name: '', type: 'uint256' }]),
  fn('listProduct', 'nonpayable', [{ name: 'price', type: 'uint128' }, { name: 'metadataHash', type: 'bytes32' }], [{ name: 'productId', type: 'uint256' }]),
  fn('updateProduct', 'nonpayable', [{ name: 'productId', type: 'uint256' }, { name: 'price', type: 'uint128' }, { name: 'metadataHash', type: 'bytes32' }]),
  fn('deactivateProduct', 'nonpayable', [{ name: 'productId', type: 'uint256' }]),
  fn('reactivateProduct', 'nonpayable', [{ name: 'productId', type: 'uint256' }]),
  fn('createOrder', 'nonpayable', [{ name: 'productId', type: 'uint256' }, { name: 'forwardDeliveryFee', type: 'uint128' }, { name: 'returnDeliveryFee', type: 'uint128' }, { name: 'deliveryMode', type: 'uint8' }], [{ name: 'orderId', type: 'uint256' }]),
  fn('cancelUnmatchedOrder', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('acceptCourier', 'nonpayable', [{ name: 'orderId', type: 'uint256' }, { name: 'pickupPeriod', type: 'uint64' }, { name: 'deliveryPeriod', type: 'uint64' }]),
  fn('approveCourier', 'nonpayable', [{ name: 'orderId', type: 'uint256' }, { name: 'courier_', type: 'address' }]),
  fn('fundCourierBond', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('fundSellerBond', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('confirmPickup', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('confirmDelivery', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('confirmSafeDrop', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('confirmMismatch', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('reportBuyerAbsent', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('beginBuyerAbsentReturn', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('requestReturn', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('acceptReturnCourier', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('approveReturnCourier', 'nonpayable', [{ name: 'orderId', type: 'uint256' }, { name: 'courier_', type: 'address' }]),
  fn('fundReturnCourierBond', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('confirmReturnPickup', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('confirmReturnDelivery', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('finalizeCourierReportedDelivery', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('finalizeCourierReportedReturn', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('finalizeInspection', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('expireOrderBeforePickup', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('expireUnmatchedReturn', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('declareCourierDefault', 'nonpayable', [{ name: 'orderId', type: 'uint256' }]),
  fn('claim', 'nonpayable', [], [{ name: 'netAmount', type: 'uint256' }]),
  fn('setNewActivityPaused', 'nonpayable', [{ name: 'paused', type: 'bool' }]),
  fn('withdrawFees', 'nonpayable', [{ name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }]),
] as const satisfies Abi;

export const usdcAbi = [
  fn('balanceOf', 'view', [{ name: 'account', type: 'address' }], [{ name: '', type: 'uint256' }]),
  fn('allowance', 'view', [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], [{ name: '', type: 'uint256' }]),
  fn('approve', 'nonpayable', [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], [{ name: '', type: 'bool' }]),
] as const satisfies Abi;

export const PRODUCT_STATES = ['Not found', 'Active', 'Reserved', 'Inactive', 'Sold', 'Lost'] as const;
export const ORDER_STATES = [
  'Not found', 'Finding courier', 'Awaiting courier bond', 'Awaiting seller bond',
  'Ready for pickup', 'In transit', 'Delivered — inspection', 'Return requested',
  'Awaiting return courier bond', 'Return courier accepted', 'Return in transit',
  'Completed', 'Cancelled', 'Refunded', 'Courier defaulted',
] as const;
