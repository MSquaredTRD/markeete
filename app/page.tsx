'use client';

import {
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  formatUnits,
  http,
  isAddress,
  isHex,
  keccak256,
  parseUnits,
  stringToHex,
  zeroAddress,
  type Address,
  type EIP1193Provider,
  type Hash,
} from 'viem';
import { base } from 'viem/chains';
import { useCallback, useEffect, useMemo, useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  BASESCAN_URL,
  BASE_CHAIN_ID,
  BASE_READ_RPC_URLS,
  BASE_RPC_URL,
  ESCROW_ADDRESS,
  ORDER_STATES,
  SOURCIFY_CONTRACT_URL,
  TREASURY_ADDRESS,
  USDC_ADDRESS,
  VERIFIED_CONTRACT_URL,
  escrowAbi,
  usdcAbi,
} from '@/lib/contract';

const publicClient = createPublicClient({
  chain: base,
  batch: { multicall: { batchSize: 64_000, wait: 10 } },
  transport: fallback(
    BASE_READ_RPC_URLS.map((url) => http(url, {
      batch: { batchSize: 50, wait: 10 },
      timeout: 8_000,
    })),
    { retryCount: 1, retryDelay: 250 },
  ),
});

type Product = { seller: Address; price: bigint; metadataHash: Hash; status: number };
type Order = {
  productId: bigint; seller: Address; buyer: Address; courier: Address; returnCourier: Address;
  price: bigint; forwardDeliveryFee: bigint; returnDeliveryFee: bigint; buyerEscrow: bigint;
  sellerBond: bigint; courierBond: bigint; returnCourierBond: bigint; courierAcceptDeadline: bigint;
  courierFundingDeadline: bigint; sellerFundingDeadline: bigint; pickupDeadline: bigint;
  deliveryDeadline: bigint; selectedPickupPeriod: bigint; selectedDeliveryPeriod: bigint;
  deliveredAt: bigint; inspectionEndsAt: bigint; absentReportedAt: bigint; returnAcceptDeadline: bigint;
  returnProcessDeadline: bigint; returnCourierFundingDeadline: bigint; returnPickupDeadline: bigint;
  returnDeliveryDeadline: bigint; pickupConfirmations: number; deliveryConfirmations: number;
  mismatchConfirmations: number; returnPickupConfirmations: number; returnDeliveryConfirmations: number;
  state: number; deliveryMode: number; returnReason: number;
};
type WalletInfo = { key: string; name: string; icon?: string; provider: EIP1193Provider };
type Fees = { listing: bigint; purchase: bigint; action: bigint; offer: bigint };
type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute(input: unknown): unknown;
};

const EMPTY_FEES: Fees = { listing: 200_000n, purchase: 1_000_000n, action: 200_000n, offer: 50_000n };
const TABS = ['Market', 'Orders', 'List product', 'Funds', 'Protocol', 'Docs'] as const;
type Tab = (typeof TABS)[number];

declare global {
  interface Window { ethereum?: EIP1193Provider }
  interface Document {
    modelContext?: { registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): void | Promise<void> };
  }
}

function sameAddress(a?: string, b?: string) { return Boolean(a && b && a.toLowerCase() === b.toLowerCase()); }
function shortAddress(value?: string) { return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—'; }
function usd(value: bigint | undefined) {
  if (value === undefined) return '—';
  const [whole, fraction = ''] = formatUnits(value, 6).split('.');
  const decimals = fraction.slice(0, 2).replace(/0+$/, '');
  return `$${whole}${decimals ? `.${decimals}` : ''}`;
}
function deadline(value: bigint) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(Number(value) * 1000);
}
function toUsdc(value: string) {
  if (!value.trim()) throw new Error('Enter an amount');
  const parsed = parseUnits(value.trim(), 6);
  if (parsed <= 0n) throw new Error('Amount must be greater than zero');
  return parsed;
}
function toPeriod(value: string) {
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0 || days > 365) throw new Error('Period must be between 1 and 365 days');
  return BigInt(Math.round(days * 86_400));
}
function errorText(error: unknown) {
  if (error instanceof Error) {
    const first = error.message.split('\n')[0];
    if (first.toLowerCase().includes('user rejected')) return 'Transaction rejected in wallet';
    return first.replace('ContractFunctionExecutionError: ', '');
  }
  return 'Unknown error';
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function Stat({ label, value }: { label: string; value: ReactNode }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;
}
function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }

export default function Home() {
  const [tab, setTab] = useState<Tab>('Market');
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [walletPicker, setWalletPicker] = useState(false);
  const [provider, setProvider] = useState<EIP1193Provider>();
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [products, setProducts] = useState<Array<Product & { id: bigint }>>([]);
  const [orders, setOrders] = useState<Array<Order & { id: bigint }>>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [balance, setBalance] = useState(0n);
  const [claimable, setClaimable] = useState(0n);
  const [fees, setFees] = useState<Fees>(EMPTY_FEES);
  const [accruedFees, setAccruedFees] = useState(0n);
  const [totalLiability, setTotalLiability] = useState(0n);
  const [paused, setPaused] = useState(false);
  const [solvent, setSolvent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [txHash, setTxHash] = useState<Hash>();
  const [labels, setLabels] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem('markeete-product-labels') || '{}'); } catch { return {}; }
  });
  const [listingTitle, setListingTitle] = useState('');
  const [listingPrice, setListingPrice] = useState('');
  const [buyProduct, setBuyProduct] = useState<Product & { id: bigint }>();
  const [forwardFee, setForwardFee] = useState('');
  const [returnFee, setReturnFee] = useState('');
  const [safeDrop, setSafeDrop] = useState(false);
  const [pickupDays, setPickupDays] = useState('3');
  const [deliveryDays, setDeliveryDays] = useState('14');
  const [courierAddress, setCourierAddress] = useState('');
  const [returnCourierAddress, setReturnCourierAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawRecipient, setWithdrawRecipient] = useState<string>(TREASURY_ADDRESS);

  const selectedOrder = useMemo(() => orders.find((item) => item.id.toString() === selectedOrderId), [orders, selectedOrderId]);

  useEffect(() => {
    const discovered = new Map<string, WalletInfo>();
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<{ info: { uuid: string; name: string; icon: string }; provider: EIP1193Provider }>).detail;
      if (!detail?.provider) return;
      discovered.set(detail.info.uuid, { key: detail.info.uuid, name: detail.info.name, icon: detail.info.icon, provider: detail.provider });
      setWallets([...discovered.values()]);
    };
    window.addEventListener('eip6963:announceProvider', announce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const fallbackTimer = window.setTimeout(() => {
      if (window.ethereum && discovered.size === 0) setWallets([{ key: 'injected', name: 'Browser wallet', provider: window.ethereum }]);
    }, 350);
    return () => { window.removeEventListener('eip6963:announceProvider', announce); window.clearTimeout(fallbackTimer); };
  }, []);

  const refresh = useCallback(async (activeAccount?: Address) => {
    setLoading(true);
    try {
      const [nextProductId, nextOrderId, listing, purchase, action, accrued, liability, isPaused, invariant] = await Promise.all([
        publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'nextProductId' }),
        publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'nextOrderId' }),
        publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'listingFee' }),
        publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'purchaseFee' }),
        publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'actionFee' }),
        publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'accruedFees' }),
        publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'totalLiability' }),
        publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'newActivityPaused' }),
        publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'accountingInvariantHolds' }),
      ]);
      const productStart = nextProductId > 50n ? nextProductId - 50n : 1n;
      const orderStart = nextOrderId > 50n ? nextOrderId - 50n : 1n;
      const productIds = Array.from({ length: Number(nextProductId - productStart) }, (_, i) => productStart + BigInt(i));
      const orderIds = Array.from({ length: Number(nextOrderId - orderStart) }, (_, i) => orderStart + BigInt(i));
      const [productRows, orderRows] = await Promise.all([
        Promise.all(productIds.map(async (id) => ({ id, ...await publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'getProduct', args: [id] }) as Product }))),
        Promise.all(orderIds.map(async (id) => ({ id, ...await publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'getOrder', args: [id] }) as Order }))),
      ]);
      setProducts(productRows.reverse()); setOrders(orderRows.reverse());
      setFees({ listing, purchase, action, offer: 50_000n }); setAccruedFees(accrued); setTotalLiability(liability);
      setPaused(isPaused); setSolvent(invariant);
      if (activeAccount) {
        const [walletBalance, available] = await Promise.all([
          publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'balanceOf', args: [activeAccount] }),
          publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'claimable', args: [activeAccount] }),
        ]);
        setBalance(walletBalance); setClaimable(available);
      }
    } catch (error) { setNotice(`Could not read Base from any configured RPC. Your on-chain funds and listings are unaffected. ${errorText(error)}`); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { queueMicrotask(() => void refresh(account)); }, [account, refresh]);
  useEffect(() => {
    if (!provider) return;
    const onAccounts = (...args: unknown[]) => { const accounts = args[0] as Address[]; setAccount(accounts[0]); if (!accounts[0]) setProvider(undefined); };
    const onChain = (...args: unknown[]) => setChainId(Number.parseInt(args[0] as string, 16));
    provider.on?.('accountsChanged', onAccounts); provider.on?.('chainChanged', onChain);
    return () => { provider.removeListener?.('accountsChanged', onAccounts); provider.removeListener?.('chainChanged', onChain); };
  }, [provider]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const report = (error: unknown) => setNotice(`WebMCP: ${errorText(error)}`);
    const tools: WebMcpTool[] = [
      {
        name: 'open_order',
        title: 'Open order',
        description: 'Opens an order with the given numeric ID in Markeete without sending a transaction.',
        inputSchema: { type: 'object', properties: { orderId: { type: 'integer', minimum: 1 } }, required: ['orderId'], additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute(input) {
          const orderId = Number((input as { orderId?: unknown })?.orderId);
          if (!Number.isSafeInteger(orderId) || orderId < 1) throw new Error('orderId must be a positive integer');
          setSelectedOrderId(String(orderId)); setTab('Orders');
          return { opened: true, orderId };
        },
      },
      {
        name: 'start_product_listing',
        title: 'Start product listing',
        description: 'Opens the new product form. It does not publish anything or request a wallet signature.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute() { setTab('List product'); return { opened: true, view: 'product-listing' }; },
      },
    ];
    for (const tool of tools) {
      try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(report); } catch (error) { report(error); }
    }
    return () => lifecycle.abort();
  }, []);

  async function ensureBase(target: EIP1193Provider) {
    const current = await target.request({ method: 'eth_chainId' }) as string;
    if (Number.parseInt(current, 16) === BASE_CHAIN_ID) { setChainId(BASE_CHAIN_ID); return; }
    try { await target.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }); }
    catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await target.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [BASE_RPC_URL], blockExplorerUrls: [BASESCAN_URL] }] });
    }
    setChainId(BASE_CHAIN_ID);
  }

  async function connect(wallet: WalletInfo) {
    setBusy(true); setNotice('');
    try {
      const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' }) as Address[];
      if (!accounts[0]) throw new Error('Wallet did not return an address');
      await ensureBase(wallet.provider); setProvider(wallet.provider); setAccount(accounts[0]); setWalletPicker(false);
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  }

  async function transact(label: string, functionName: string, args: readonly unknown[] = [], requiredUsdc = 0n) {
    if (!account || !provider) { setWalletPicker(true); throw new Error('Connect a wallet first'); }
    setBusy(true); setNotice(`${label}: preparing…`); setTxHash(undefined);
    try {
      await ensureBase(provider);
      const walletClient = createWalletClient({ account, chain: base, transport: custom(provider) });
      if (requiredUsdc > 0n) {
        const allowance = await publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'allowance', args: [account, ESCROW_ADDRESS] });
        if (allowance < requiredUsdc) {
          setNotice(`${label}: allow the contract to spend ${usd(requiredUsdc)} USDC`);
          const approveHash = await walletClient.writeContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'approve', args: [ESCROW_ADDRESS, requiredUsdc] });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }
      setNotice(`${label}: confirm the transaction`);
      const simulation = await publicClient.simulateContract({ account, address: ESCROW_ADDRESS, abi: escrowAbi, functionName: functionName as never, args: args as never });
      const hash = await walletClient.writeContract(simulation.request);
      setTxHash(hash); setNotice(`${label}: waiting for Base…`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction failed');
      setNotice(`${label}: done`); await refresh(account); return hash;
    } catch (error) { setNotice(`${label}: ${errorText(error)}`); throw error; }
    finally { setBusy(false); }
  }

  async function submitListing(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); const price = toUsdc(listingPrice); const trimmed = listingTitle.trim();
    if (!trimmed) return setNotice('Enter a product label or bytes32 hash');
    const metadataHash = (isHex(trimmed) && trimmed.length === 66 ? trimmed : keccak256(stringToHex(trimmed))) as Hash;
    try {
      await transact('Listing product', 'listProduct', [price, metadataHash], fees.listing);
      const nextLabels = { ...labels, [metadataHash.toLowerCase()]: trimmed }; setLabels(nextLabels);
      localStorage.setItem('markeete-product-labels', JSON.stringify(nextLabels)); setListingTitle(''); setListingPrice(''); setTab('Market');
    } catch { /* notice is already set */ }
  }
  async function submitPurchase(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); if (!buyProduct) return;
    try {
      const forward = toUsdc(forwardFee); const returning = toUsdc(returnFee);
      await transact('Purchase', 'createOrder', [buyProduct.id, forward, returning, safeDrop ? 1 : 0], buyProduct.price + forward + returning + fees.purchase);
      setBuyProduct(undefined); setForwardFee(''); setReturnFee(''); setTab('Orders');
    } catch { /* notice is already set */ }
  }
  async function simple(label: string, name: string, args: readonly unknown[] = [], cost = 0n) {
    try { await transact(label, name, args, cost); } catch { /* notice is already set */ }
  }

  const myOrders = account ? orders.filter((order) => sameAddress(account, order.buyer) || sameAddress(account, order.seller) || sameAddress(account, order.courier) || sameAddress(account, order.returnCourier)) : orders;
  const role = selectedOrder && account ? [sameAddress(account, selectedOrder.buyer) && 'buyer', sameAddress(account, selectedOrder.seller) && 'seller', sameAddress(account, selectedOrder.courier) && 'courier', sameAddress(account, selectedOrder.returnCourier) && 'return courier'].filter(Boolean).join(', ') || 'observer' : '—';

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => setTab('Market')} aria-label="Markeete — home">markeete</button>
        <nav aria-label="Primary navigation">{TABS.map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</nav>
        <button className="wallet-button" onClick={() => setWalletPicker(true)}>{account ? shortAddress(account) : 'Connect wallet'}</button>
      </header>
      <div className="network-strip"><span><i className={paused ? 'dot warn' : 'dot'} /> Base Mainnet</span><span>Contract {shortAddress(ESCROW_ADDRESS)}</span>{account && <span>{usd(balance)} USDC</span>}{chainId && chainId !== BASE_CHAIN_ID && <span className="wrong-network">Wrong network</span>}</div>

      {tab === 'Market' && <section className="page">
        <div className="hero"><p className="eyebrow">Non-custodial escrow on Base</p><h1>Buy, deliver and return<br />without a key-holding middleman.</h1><p>USDC stays in an immutable smart contract. Funds move only under the deal rules and participant signatures.</p><div className="hero-actions"><button className="primary" onClick={() => account ? setTab('List product') : setWalletPicker(true)}>List a product</button><a className="secondary" href={VERIFIED_CONTRACT_URL} target="_blank" rel="noreferrer">Verified contract ↗</a></div><p className="hero-disclosure">Experimental, unaudited software. Markeete does not verify people, products, delivery, legality or off-chain facts. Read the risk disclosure before using real funds.</p></div>
        <div className="section-head"><div><p className="eyebrow">Latest 50</p><h2>Products</h2></div><button className="text-button" onClick={() => void refresh(account)} disabled={loading}>Refresh</button></div>
        {loading ? <Empty>Reading Base…</Empty> : products.filter((p) => p.status === 1).length === 0 ? <Empty>No active products yet. The first listing costs {usd(fees.listing)}.</Empty> : <div className="product-grid">{products.filter((product) => product.status === 1).map((product) => <article className="product-card" key={product.id.toString()}><div className="product-index">#{product.id.toString()}</div><h3>{labels[product.metadataHash.toLowerCase()] || `Product ${product.id.toString()}`}</h3><p className="mono">{product.metadataHash.slice(0, 18)}…</p><div className="seller">Seller <a href={`${BASESCAN_URL}/address/${product.seller}`} target="_blank" rel="noreferrer">{shortAddress(product.seller)}</a></div><div className="product-bottom"><strong>{usd(product.price)}</strong><button onClick={() => setBuyProduct(product)}>Buy</button></div></article>)}</div>}
      </section>}

      {tab === 'List product' && <section className="page narrow"><p className="eyebrow">Seller</p><h1 className="page-title">New product</h1><p className="lede">The contract stores the price, your address and an irreversible bytes32 metadata hash. The readable label stays only in this browser.</p><form className="panel form" onSubmit={submitListing}><Field label="Label or existing bytes32 hash" hint="For this first release, the label is hashed in your browser. Do not enter private information."><input value={listingTitle} onChange={(e) => setListingTitle(e.target.value)} placeholder="Example: Vacuum cleaner, sealed" required /></Field><Field label="Product price, USDC"><input inputMode="decimal" value={listingPrice} onChange={(e) => setListingPrice(e.target.value)} placeholder="100.00" required /></Field><div className="fee-line"><span>Listing fee</span><strong>{usd(fees.listing)}</strong></div><p className="transaction-disclosure">You are solely responsible for the listing, product legality, description, taxes, export rules and delivery arrangements. On-chain fees are not refundable.</p><button className="primary full" disabled={busy || paused}>{paused ? 'New activity is paused' : 'List product'}</button></form></section>}

      {tab === 'Orders' && <section className="page"><div className="section-head"><div><p className="eyebrow">Roles are determined by wallet address</p><h1 className="page-title">Orders</h1></div><button className="text-button" onClick={() => void refresh(account)} disabled={loading}>Refresh</button></div><div className="orders-layout"><aside className="order-list">{!account && <div className="connect-note">Connect a wallet to filter your deals.</div>}{myOrders.length === 0 ? <Empty>No orders yet.</Empty> : myOrders.map((order) => <button key={order.id.toString()} onClick={() => setSelectedOrderId(order.id.toString())} className={selectedOrderId === order.id.toString() ? 'order-row selected' : 'order-row'}><span><strong>Order #{order.id.toString()}</strong><small>Product #{order.productId.toString()}</small></span><em>{ORDER_STATES[order.state] || `State ${order.state}`}</em></button>)}<Field label="Open order by ID"><div className="inline"><input inputMode="numeric" value={selectedOrderId} onChange={(e) => setSelectedOrderId(e.target.value.replace(/\D/g, ''))} placeholder="1" /><button className="secondary" type="button" onClick={() => void refresh(account)}>Open</button></div></Field></aside><div className="order-detail">{!selectedOrder ? <Empty>Choose an order on the left.</Empty> : <OrderDetail order={selectedOrder} role={role} actionFee={fees.action} offerFee={fees.offer} pickupDays={pickupDays} setPickupDays={setPickupDays} deliveryDays={deliveryDays} setDeliveryDays={setDeliveryDays} courierAddress={courierAddress} setCourierAddress={setCourierAddress} returnCourierAddress={returnCourierAddress} setReturnCourierAddress={setReturnCourierAddress} account={account} busy={busy} simple={simple} />}</div></div></section>}

      {tab === 'Funds' && <section className="page narrow"><p className="eyebrow">Pull payments</p><h1 className="page-title">Funds</h1><div className="stats-grid"><Stat label="Wallet balance" value={`${usd(balance)} USDC`} /><Stat label="Available to claim" value={`${usd(claimable)} USDC`} /></div><div className="panel stack"><h2>Claim released funds</h2><p>Only this credited wallet can claim its USDC. Released amounts may be accumulated and claimed later; the fixed claim fee is deducted once per claim: {usd(fees.action)}.</p><button className="primary" disabled={busy || claimable === 0n} onClick={() => simple('Claiming funds', 'claim')}>Claim {usd(claimable)}</button></div>{sameAddress(account, TREASURY_ADDRESS) && <div className="panel stack treasury"><h2>Treasury</h2><p>Accrued fees: {usd(accruedFees)}. Only the treasury wallet can call this.</p><Field label="Recipient"><input value={withdrawRecipient} onChange={(e) => setWithdrawRecipient(e.target.value)} /></Field><Field label="Amount, USDC"><input inputMode="decimal" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} placeholder="1.00" /></Field><button className="primary" disabled={busy || !isAddress(withdrawRecipient)} onClick={() => simple('Withdrawing fees', 'withdrawFees', [withdrawRecipient as Address, toUsdc(withdrawAmount)])}>Withdraw fees</button></div>}</section>}

      {tab === 'Protocol' && <section className="page narrow"><p className="eyebrow">Base Mainnet · immutable</p><h1 className="page-title">Protocol</h1><div className="panel contract-block"><span>DeliveryEscrow V2 · verified source</span><code>{ESCROW_ADDRESS}</code><a href={VERIFIED_CONTRACT_URL} target="_blank" rel="noreferrer">Verified source on BaseScan ↗</a><a href={SOURCIFY_CONTRACT_URL} target="_blank" rel="noreferrer">Sourcify exact match ↗</a><a href="/abi/DeliveryEscrow.json" target="_blank" rel="noreferrer">Download ABI ↗</a></div><div className="stats-grid"><Stat label="Total liabilities" value={usd(totalLiability)} /><Stat label="Configured value cap" value="None" /><Stat label="Accrued fees" value={usd(accruedFees)} /><Stat label="Accounting invariant" value={solvent ? 'Healthy' : 'BROKEN'} /></div><div className="panel rules"><h2>Fixed fees</h2><div><span>Listing</span><strong>{usd(fees.listing)}</strong></div><div><span>Purchase</span><strong>{usd(fees.purchase)}</strong></div><div><span>Action / claim</span><strong>{usd(fees.action)}</strong></div><div><span>Courier offer</span><strong>{usd(fees.offer)}</strong></div></div><div className="panel stack"><h2>Manual timeouts</h2><p>Deadlines do not execute transactions automatically. After a deadline, anyone may press the matching finalize, expire or default button. Once credited, funds remain claimable without an expiry.</p></div><div className="panel stack"><h2>What this site cannot control</h2><p>The site never holds USDC and cannot sign transactions. It prepares calls to the published contract; your wallet shows the final address, network and amounts.</p></div>{sameAddress(account, TREASURY_ADDRESS) && <div className="panel treasury"><h2>Guardian</h2><p>Only new listings, purchases and reactivations can be paused. Existing deals keep working.</p><button className={paused ? 'primary' : 'danger'} disabled={busy} onClick={() => simple(paused ? 'Resuming protocol' : 'Pausing new activity', 'setNewActivityPaused', [!paused])}>{paused ? 'Resume new activity' : 'Pause new activity'}</button></div>}</section>}

      {tab === 'Docs' && <section className="page docs-page"><p className="eyebrow">Public documentation</p><h1 className="page-title">Read before signing.</h1><p className="lede">The documents below are static, versioned with the interface and readable without a wallet. Bots should start with <code>/llms.txt</code> and pin every chain and contract address.</p><div className="docs-grid"><a className="doc-card" href="/user-guide.md" target="_blank"><span>Start here</span><h2>User guide</h2><p>Click-by-click instructions for buyers, sellers, forward couriers and return couriers.</p></a><a className="doc-card" href="/whitepaper.md" target="_blank"><span>Protocol</span><h2>Whitepaper</h2><p>Roles, state machine, bonds, fees, deadlines, settlements and administrator limits.</p></a><a className="doc-card" href="/bot-guide.md" target="_blank"><span>Automation</span><h2>Bot guide</h2><p>Exact addresses, read calls, transaction sequences, approvals, examples and safety checks.</p></a><a className="doc-card" href="/risk-disclosure.md" target="_blank"><span>Legal and risk</span><h2>Risk disclosure</h2><p>Smart-contract, wallet, USDC, physical-delivery, legal and counterparty risks.</p></a><a className="doc-card" href="/reputation-design.md" target="_blank"><span>Design proposal</span><h2>On-chain reputation</h2><p>Why an ERC-20 balance is wrong and how a separate rating registry should work.</p></a></div><div className="panel stack disclosure-panel"><h2>Important</h2><p>Markeete is experimental and has not received an independent security audit. It is not an insurer, carrier, marketplace arbiter, identity provider, inspection service, bank or custodian. No interface can prove a physical-world event. Transactions are public and generally irreversible.</p><p>Nothing on this site is legal, tax, financial, sanctions, customs or export advice. Each participant is responsible for checking the transaction, wallet prompt, contract address, counterparty, product and applicable law.</p></div><div className="panel stack"><h2>Machine-readable entry points</h2><code>https://markeete.online/llms.txt</code><code>https://markeete.online/user-guide.md</code><code>https://markeete.online/bot-guide.md</code><code>https://markeete.online/whitepaper.md</code><code>https://markeete.online/abi/DeliveryEscrow.json</code></div></section>}

      {buyProduct && <dialog open className="modal-backdrop"><form className="modal" onSubmit={submitPurchase}><button type="button" className="close" onClick={() => setBuyProduct(undefined)} aria-label="Close">×</button><p className="eyebrow">Buying product #{buyProduct.id.toString()}</p><h2>{labels[buyProduct.metadataHash.toLowerCase()] || `Product ${buyProduct.id.toString()}`}</h2><div className="fee-line"><span>Product price</span><strong>{usd(buyProduct.price)}</strong></div><Field label="Delivery to buyer, USDC"><input inputMode="decimal" value={forwardFee} onChange={(e) => setForwardFee(e.target.value)} placeholder="20.00" required /></Field><Field label="Return delivery reserve, USDC"><input inputMode="decimal" value={returnFee} onChange={(e) => setReturnFee(e.target.value)} placeholder="20.00" required /></Field><label className="checkbox"><input type="checkbox" checked={safeDrop} onChange={(e) => setSafeDrop(e.target.checked)} /><span>Allow courier safe drop at the delivery address</span></label><div className="fee-line"><span>Protocol fee</span><strong>{usd(fees.purchase)}</strong></div><p className="transaction-disclosure">Your wallet transaction is irreversible. The protocol cannot verify the product, delivery or counterparty and cannot recover a lost wallet. By signing, you accept the published contract rules and risk disclosure.</p><button className="primary full" disabled={busy}>Pay in USDC</button></form></dialog>}
      {walletPicker && <dialog open className="modal-backdrop"><div className="modal wallet-modal"><button type="button" className="close" onClick={() => setWalletPicker(false)} aria-label="Close">×</button><p className="eyebrow">Base Mainnet</p><h2>{account ? 'Connected wallet' : 'Choose wallet'}</h2>{account && <div className="connected-address"><code>{account}</code><button className="secondary" onClick={() => { setAccount(undefined); setProvider(undefined); setWalletPicker(false); }}>Disconnect from interface</button></div>}{!account && wallets.length === 0 && <Empty>MetaMask, Rabby or Phantom was not found. Install a wallet extension and reload the page.</Empty>}{!account && wallets.map((wallet) => <button className="wallet-choice" key={wallet.key} onClick={() => void connect(wallet)} disabled={busy}>{wallet.icon ? <span className="wallet-icon" aria-hidden="true" style={{ backgroundImage: `url(${wallet.icon})` }} /> : <span className="wallet-fallback">W</span>}<strong>{wallet.name}</strong><span>Connect</span></button>)}</div></dialog>}
      {notice && <output className="toast"><div><strong>{notice}</strong>{txHash && <a href={`${BASESCAN_URL}/tx/${txHash}`} target="_blank" rel="noreferrer">Transaction ↗</a>}</div><button onClick={() => setNotice('')} aria-label="Dismiss">×</button></output>}
      <footer className="site-footer">
        <div className="footer-brand"><strong>markeete</strong><span>Non-custodial USDC escrow on Base Mainnet.</span><span className="footer-version">DeliveryEscrow V2</span></div>
        <div className="footer-column"><strong>Protocol</strong><a href={VERIFIED_CONTRACT_URL} target="_blank" rel="noreferrer">Verified contract</a><a href={SOURCIFY_CONTRACT_URL} target="_blank" rel="noreferrer">Sourcify exact match</a><a href="/abi/DeliveryEscrow.json" target="_blank" rel="noreferrer">Contract ABI</a><code>{ESCROW_ADDRESS}</code></div>
        <div className="footer-column"><strong>Documentation</strong><button onClick={() => setTab('Docs')}>Documentation home</button><a href="/user-guide.md" target="_blank" rel="noreferrer">Buyer, seller and courier guide</a><a href="/whitepaper.md" target="_blank" rel="noreferrer">Whitepaper</a><a href="/bot-guide.md" target="_blank" rel="noreferrer">Bot integration guide</a><a href="/reputation-design.md" target="_blank" rel="noreferrer">Reputation design</a></div>
        <div className="footer-column"><strong>Risk</strong><a href="/risk-disclosure.md" target="_blank" rel="noreferrer">Full risk disclosure</a><span>Experimental and unaudited. No custody, insurance, delivery verification, dispute resolution or warranty. Transactions are irreversible; use only funds you can afford to lose.</span></div>
        <div className="footer-bottom"><span>© {new Date().getFullYear()} markeete.online</span><span>Verify Base chain ID 8453 and the full contract address before every signature.</span></div>
      </footer>
    </main>
  );
}

function OrderDetail({ order, role, actionFee, offerFee, pickupDays, setPickupDays, deliveryDays, setDeliveryDays, courierAddress, setCourierAddress, returnCourierAddress, setReturnCourierAddress, account, busy, simple }: {
  order: Order & { id: bigint }; role: string; actionFee: bigint; offerFee: bigint; pickupDays: string;
  setPickupDays: (value: string) => void; deliveryDays: string; setDeliveryDays: (value: string) => void;
  courierAddress: string; setCourierAddress: (value: string) => void; returnCourierAddress: string;
  setReturnCourierAddress: (value: string) => void; account?: Address; busy: boolean;
  simple: (label: string, name: string, args?: readonly unknown[], cost?: bigint) => Promise<void>;
}) {
  const id = order.id; const isBuyer = sameAddress(account, order.buyer); const isSeller = sameAddress(account, order.seller);
  const isCourier = sameAddress(account, order.courier); const isReturnCourier = sameAddress(account, order.returnCourier);
  const courierBond = order.price + (order.price * 1500n + 9999n) / 10_000n;
  const sellerBond = order.forwardDeliveryFee + order.returnDeliveryFee;
  const action = (label: string, name: string, cost = 0n, args: readonly unknown[] = [id]) => <button className="secondary" disabled={busy} onClick={() => simple(label, name, args, cost)}>{label}</button>;
  return <>
    <div className="detail-head"><div><p className="eyebrow">Your role: {role}</p><h2>Order #{id.toString()}</h2></div><span className="state">{ORDER_STATES[order.state] || order.state}</span></div>
    <div className="stats-grid order-stats"><Stat label="Price" value={usd(order.price)} /><Stat label="Delivery" value={usd(order.forwardDeliveryFee)} /><Stat label="Return delivery" value={usd(order.returnDeliveryFee)} /><Stat label="Product" value={`#${order.productId}`} /></div>
    <div className="panel parties"><div><span>Buyer</span><code>{shortAddress(order.buyer)}</code></div><div><span>Seller</span><code>{shortAddress(order.seller)}</code></div><div><span>Courier</span><code>{order.courier === zeroAddress ? 'not selected' : shortAddress(order.courier)}</code></div><div><span>Return courier</span><code>{order.returnCourier === zeroAddress ? 'not selected' : shortAddress(order.returnCourier)}</code></div></div>
    <div className="panel stack actions"><h3>Available actions</h3>
      {order.state === 1 && <>{!isBuyer && !isSeller && <div className="action-form"><Field label="Pickup within, days"><input inputMode="decimal" value={pickupDays} onChange={(e) => setPickupDays(e.target.value)} /></Field><Field label="Delivery after pickup, days"><input inputMode="decimal" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} /></Field><button className="primary" disabled={busy} onClick={() => simple('Courier offer', 'acceptCourier', [id, toPeriod(pickupDays), toPeriod(deliveryDays)], offerFee)}>Offer delivery · {usd(offerFee)}</button></div>}{isSeller && <div className="action-form"><Field label="Selected courier address"><input value={courierAddress} onChange={(e) => setCourierAddress(e.target.value)} placeholder="0x…" /></Field><button className="primary" disabled={busy || !isAddress(courierAddress)} onClick={() => simple('Courier selection', 'approveCourier', [id, courierAddress as Address])}>Approve courier</button></div>}{isBuyer && action('Cancel order', 'cancelUnmatchedOrder', actionFee)}{action('Expire overdue stage', 'expireOrderBeforePickup')}</>}
      {order.state === 2 && <>{isCourier && action(`Fund bond ${usd(courierBond)}`, 'fundCourierBond', courierBond + actionFee)}{action('Reset expired selection', 'expireOrderBeforePickup')}</>}
      {order.state === 3 && <>{isSeller && action(`Fund bond ${usd(sellerBond)}`, 'fundSellerBond', sellerBond + actionFee)}{action('Finalize timeout', 'expireOrderBeforePickup')}</>}
      {order.state === 4 && <>{(isSeller || isCourier) && action('Confirm courier pickup', 'confirmPickup', actionFee)}{action('Finalize timeout', 'expireOrderBeforePickup')}</>}
      {order.state === 5 && <>{(isBuyer || isCourier) && action('Confirm delivery', 'confirmDelivery', actionFee)}{(isBuyer || isCourier) && action('Confirm mismatch', 'confirmMismatch', actionFee)}{isCourier && order.deliveryMode === 1 && action('Confirm safe drop', 'confirmSafeDrop', actionFee)}{isCourier && order.absentReportedAt === 0n && action('Report buyer absent', 'reportBuyerAbsent', actionFee)}{isCourier && order.absentReportedAt > 0n && action('Start absent-buyer return', 'beginBuyerAbsentReturn', actionFee)}{action('Finalize courier report', 'finalizeCourierReportedDelivery')}{action('Declare courier default', 'declareCourierDefault')}</>}
      {order.state === 6 && <>{isBuyer && action('Request return', 'requestReturn', actionFee)}{action('Finalize after inspection', 'finalizeInspection')}</>}
      {order.state === 7 && <>{!isBuyer && !isSeller && action(`Offer return delivery · ${usd(offerFee)}`, 'acceptReturnCourier', offerFee)}{isBuyer && <div className="action-form"><Field label="Return courier address"><input value={returnCourierAddress} onChange={(e) => setReturnCourierAddress(e.target.value)} placeholder="0x…" /></Field><button className="primary" disabled={busy || !isAddress(returnCourierAddress)} onClick={() => simple('Selecting return courier', 'approveReturnCourier', [id, returnCourierAddress as Address])}>Approve courier</button></div>}{action('Expire unmatched return', 'expireUnmatchedReturn')}</>}
      {order.state === 8 && <>{isReturnCourier && action(`Fund bond ${usd(courierBond)}`, 'fundReturnCourierBond', courierBond + actionFee)}{action('Reset after timeout', 'expireUnmatchedReturn')}</>}
      {order.state === 9 && <>{(isBuyer || isReturnCourier) && action('Confirm return pickup', 'confirmReturnPickup', actionFee)}{action('Reset after timeout', 'expireUnmatchedReturn')}</>}
      {order.state === 10 && <>{(isSeller || isReturnCourier) && action('Confirm return delivery', 'confirmReturnDelivery', actionFee)}{action('Finalize courier report', 'finalizeCourierReportedReturn')}{action('Declare return courier default', 'declareCourierDefault')}</>}
      {order.state >= 11 && <p>The deal is complete. Credited funds are available under Funds.</p>}
    </div>
    <div className="panel deadlines"><h3>Deadlines</h3><div><span>Courier selection</span><strong>{deadline(order.courierAcceptDeadline)}</strong></div><div><span>Pickup</span><strong>{deadline(order.pickupDeadline)}</strong></div><div><span>Delivery</span><strong>{deadline(order.deliveryDeadline)}</strong></div><div><span>Inspection ends</span><strong>{deadline(order.inspectionEndsAt)}</strong></div><div><span>Return delivery</span><strong>{deadline(order.returnDeliveryDeadline)}</strong></div></div>
  </>;
}
