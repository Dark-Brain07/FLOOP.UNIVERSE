import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import { hexToU8a, stringToU8a, u8aToHex, u8aWrapBytes } from '@polkadot/util';
import {
  cryptoWaitReady,
  encodeAddress,
  decodeAddress,
  mnemonicToMiniSecret,
  mnemonicValidate
} from '@polkadot/util-crypto';
import bs58 from 'bs58';
import crypto from 'crypto';

export const FLOP_TESTNET_CONFIG = {
  chainId: 'flop_testnet',
  chainName: 'FLOP Testnet',
  rpc: process.env.FLOP_TESTNET_RPC || 'wss://testnet.flop.network/',
  httpRpc: process.env.FLOP_TESTNET_HTTP_RPC || 'https://testnet.flop.network/',
  faucetUrl: process.env.FLOP_TESTNET_FAUCET || 'https://faucet.flop.network',
  explorerUrl: 'https://testnet.flopscan.io',
  genesisHash: '0x918abd58fb16306b30ef3886514cfaebffecb4de43e82b6f8ec4795c43cfd800',
  ss58Format: 42,
  decimals: 18,
  tokenSymbol: 'FLOP',
  bootnodes: [
    '/dns4/boot-eu-1.testnet.flop.network/tcp/30333/p2p/12D3KooWDAiKaoMzEWHJBaRuGcgfdZCv4YH8MeH893p5rvXbPCmy',
    '/dns4/boot-sg-1.testnet.flop.network/tcp/30333/p2p/12D3KooWDjyav9hUeEmcYwr1XZ3AG8XtohQQDegW2cBYWsz6HSSR'
  ]
};

const PLANCK_PER_FLOP = 10n ** BigInt(FLOP_TESTNET_CONFIG.decimals);
const MAX_REMARK_BYTES = 1800;

let cryptoReadyPromise = null;
let apiPromise = null;
let activeProvider = null;

/**
 * Ensures Polkadot WASM/JS cryptographic primitives are initialized once.
 */
export async function ensureSubstrateCryptoReady() {
  if (!cryptoReadyPromise) {
    cryptoReadyPromise = cryptoWaitReady();
  }
  await cryptoReadyPromise;
}

/**
 * Normalizes a 32-byte hex string into lowercase 64 hex characters without 0x prefix.
 */
export function normalizeHex32(hexStr, label = 'key') {
  const clean = String(hexStr || '').trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`Invalid 32-byte hex ${label}`);
  }
  return clean;
}

/**
 * Derives a FLOP Testnet SS58 address (prefix 42) from a 32-byte Ed25519 public key hex or did:key.
 */
export async function deriveFlopAddressFromPublic(publicKeyOrDid) {
  await ensureSubstrateCryptoReady();
  if (typeof publicKeyOrDid === 'string' && publicKeyOrDid.startsWith('did:key:z')) {
    const decoded = bs58.decode(publicKeyOrDid.slice('did:key:z'.length));
    if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
      throw new Error('Unsupported did:key multicodec (expected Ed25519 0xed01)');
    }
    return encodeAddress(decoded.slice(2), FLOP_TESTNET_CONFIG.ss58Format);
  }
  const cleanHex = normalizeHex32(publicKeyOrDid, 'public key');
  return encodeAddress(hexToU8a(`0x${cleanHex}`), FLOP_TESTNET_CONFIG.ss58Format);
}

/**
 * Creates a Substrate Ed25519 KeyringPair (SS58 prefix 42) from a 32-byte private key hex seed.
 */
export async function pairFromPrivateKeyHex(privateKeyHex) {
  await ensureSubstrateCryptoReady();
  const cleanHex = normalizeHex32(privateKeyHex, 'privateKeyHex');
  const keyring = new Keyring({ type: 'ed25519', ss58Format: FLOP_TESTNET_CONFIG.ss58Format });
  return keyring.addFromSeed(hexToU8a(`0x${cleanHex}`));
}

/**
 * Validates and converts either an SS58 address, did:key, or 32-byte public key hex to canonical SS58 address.
 */
export async function resolveSs58Address(input) {
  await ensureSubstrateCryptoReady();
  const val = String(input || '').trim();
  if (!val) throw new Error('Account address is required');
  if (val.startsWith('did:key:z') || /^(0x)?[0-9a-fA-F]{64}$/.test(val)) {
    return deriveFlopAddressFromPublic(val);
  }
  const pub = decodeAddress(val, false, FLOP_TESTNET_CONFIG.ss58Format);
  return encodeAddress(pub, FLOP_TESTNET_CONFIG.ss58Format);
}

/**
 * Extracts a 32-byte Ed25519 private seed hex from a BIP39 mnemonic phrase or raw 64-char hex seed.
 */
export async function extractSeedHexFromPhraseOrHex(secret) {
  await ensureSubstrateCryptoReady();
  const trimmed = String(secret || '').trim();
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(trimmed)) {
    return normalizeHex32(trimmed, 'hex seed');
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if ((words.length === 12 || words.length === 24) && mnemonicValidate(words.join(' '))) {
    const mini = mnemonicToMiniSecret(words.join(' '));
    return Buffer.from(mini).toString('hex');
  }
  return null;
}

/**
 * Converts raw plancks (BigInt or numeric string) into a clean decimal FLOP string.
 */
export function formatPlancksToFlop(rawPlancks, fractionDigits = 4) {
  const raw = BigInt(rawPlancks || 0);
  const whole = raw / PLANCK_PER_FLOP;
  const rem = raw % PLANCK_PER_FLOP;
  if (rem === 0n) return whole.toString();
  const padded = rem.toString().padStart(FLOP_TESTNET_CONFIG.decimals, '0');
  const sliced = padded.slice(0, fractionDigits).replace(/0+$/, '');
  return sliced ? `${whole.toString()}.${sliced}` : whole.toString();
}

/**
 * Converts a positive decimal FLOP amount string/number into exact planck BigInt.
 */
export function parseFlopToPlancks(amountInput) {
  const str = String(amountInput ?? '').trim();
  if (!/^\d+(?:\.\d{1,18})?$/.test(str)) {
    throw new Error('Amount must be a positive decimal FLOP number (up to 18 decimals)');
  }
  const [wholePart, fracPart = ''] = str.split('.');
  const fracPadded = fracPart.padEnd(FLOP_TESTNET_CONFIG.decimals, '0');
  const raw = BigInt(wholePart) * PLANCK_PER_FLOP + BigInt(fracPadded);
  if (raw <= 0n) {
    throw new Error('Amount must be greater than zero');
  }
  return raw;
}

/**
 * Resets cached Substrate WS connection cleanly.
 */
async function resetApiConnection() {
  const prevApi = apiPromise;
  const prevProvider = activeProvider;
  apiPromise = null;
  activeProvider = null;
  try {
    if (prevApi) {
      const api = await prevApi.catch(() => null);
      if (api) await api.disconnect().catch(() => {});
    } else if (prevProvider) {
      await prevProvider.disconnect().catch(() => {});
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Connects and caches an authenticated ApiPromise bound strictly to FLOP Testnet genesis.
 */
export async function getTestnetApi() {
  await ensureSubstrateCryptoReady();
  if (apiPromise) {
    try {
      const existing = await apiPromise;
      if (existing.isConnected) return existing;
    } catch {
      await resetApiConnection();
    }
  }

  const provider = new WsProvider(FLOP_TESTNET_CONFIG.rpc, 3000, {}, 12000);
  activeProvider = provider;

  const connectTask = (async () => {
    const api = await ApiPromise.create({
      provider,
      noInitWarn: true,
      throwOnConnect: true
    });
    const genesis = api.genesisHash.toHex().toLowerCase();
    if (genesis !== FLOP_TESTNET_CONFIG.genesisHash) {
      await api.disconnect().catch(() => {});
      throw new Error(`Unexpected chain genesis ${genesis} (expected ${FLOP_TESTNET_CONFIG.genesisHash})`);
    }
    api.on('disconnected', () => {
      if (apiPromise === connectTask) {
        apiPromise = null;
        activeProvider = null;
      }
    });
    api.on('error', () => {
      if (apiPromise === connectTask) {
        apiPromise = null;
        activeProvider = null;
      }
    });
    return api;
  })();

  apiPromise = connectTask;

  try {
    return await Promise.race([
      connectTask,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out connecting to ${FLOP_TESTNET_CONFIG.rpc}`)), 12000)
      )
    ]);
  } catch (err) {
    await resetApiConnection();
    throw err;
  }
}

/**
 * Reads live FLOP Testnet chain state, latest finalized block, and faucet readiness.
 */
export async function getTestnetStatus() {
  const api = await getTestnetApi();
  const [chain, finalizedHash, health] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.chain.getFinalizedHead(),
    api.rpc.system.health()
  ]);
  const finalizedHeader = await api.rpc.chain.getHeader(finalizedHash);
  const blockNumber = finalizedHeader.number.toNumber();

  let faucet = null;
  try {
    const [limitsRes, healthRes] = await Promise.all([
      fetch(`${FLOP_TESTNET_CONFIG.faucetUrl}/limits`, { signal: AbortSignal.timeout(4000) }),
      fetch(`${FLOP_TESTNET_CONFIG.faucetUrl}/health`, { signal: AbortSignal.timeout(4000) })
    ]);
    const limitsJson = await limitsRes.json().catch(() => null);
    const healthJson = await healthRes.json().catch(() => null);
    faucet = {
      url: FLOP_TESTNET_CONFIG.faucetUrl,
      ready: Boolean(healthJson?.ready),
      status: limitsJson?.faucet?.status || (healthRes.ok ? 'open' : 'degraded'),
      agentGrantFlop: limitsJson?.faucet?.agent?.grantFlop ?? 10,
      faucetBalanceFlop: limitsJson?.faucet?.balanceFlop ?? null,
      error: healthJson?.dependencies?.indexer?.error || null,
      reason: healthJson?.dependencies?.indexer?.reason || null
    };
  } catch (err) {
    faucet = {
      url: FLOP_TESTNET_CONFIG.faucetUrl,
      ready: false,
      status: 'unreachable',
      error: err.message
    };
  }

  return {
    network: FLOP_TESTNET_CONFIG.chainId,
    chainName: chain.toString(),
    rpc: FLOP_TESTNET_CONFIG.rpc,
    httpRpc: FLOP_TESTNET_CONFIG.httpRpc,
    explorerUrl: FLOP_TESTNET_CONFIG.explorerUrl,
    genesisHash: api.genesisHash.toHex(),
    specName: api.runtimeVersion.specName.toString(),
    specVersion: api.runtimeVersion.specVersion.toNumber(),
    transactionVersion: api.runtimeVersion.transactionVersion.toNumber(),
    finalizedBlockNumber: blockNumber,
    finalizedBlockHash: finalizedHash.toHex(),
    blockExplorerUrl: `${FLOP_TESTNET_CONFIG.explorerUrl}/blocks/${blockNumber}`,
    peers: health.peers.toNumber(),
    isSyncing: health.isSyncing.isTrue,
    ss58Format: FLOP_TESTNET_CONFIG.ss58Format,
    tokenSymbol: FLOP_TESTNET_CONFIG.tokenSymbol,
    decimals: FLOP_TESTNET_CONFIG.decimals,
    faucet
  };
}

/**
 * Fetches live FLOP balance and nonce for an SS58 address, did:key, or Ed25519 public key hex.
 */
export async function getAccountBalance(addressOrPublic) {
  const ss58Address = await resolveSs58Address(addressOrPublic);
  const api = await getTestnetApi();
  const [accountInfo, nextIndex] = await Promise.all([
    api.query.system.account(ss58Address),
    api.rpc.system.accountNextIndex(ss58Address)
  ]);

  const freeRaw = accountInfo.data.free.toString();
  const reservedRaw = accountInfo.data.reserved.toString();
  return {
    ss58Address,
    network: FLOP_TESTNET_CONFIG.chainId,
    tokenSymbol: FLOP_TESTNET_CONFIG.tokenSymbol,
    freeRaw,
    freeFlop: formatPlancksToFlop(freeRaw, 4),
    reservedRaw,
    reservedFlop: formatPlancksToFlop(reservedRaw, 4),
    nonce: nextIndex.toNumber(),
    explorerUrl: `${FLOP_TESTNET_CONFIG.explorerUrl}/accounts/${ss58Address}`
  };
}

/**
 * Submits an official D10 signed testnet agent claim (10 FLOP / 24h) to https://faucet.flop.network/v1/testnet/agent-claims.
 */
export async function claimTestnetFaucet(privateKeyHex, providedNonce = null) {
  const pair = await pairFromPrivateKeyHex(privateKeyHex);
  const nonce = String(providedNonce || Date.now());
  const payload = ['flop-faucet-agent/v1', FLOP_TESTNET_CONFIG.genesisHash, pair.address, nonce].join('|');
  const signature = u8aToHex(pair.sign(u8aWrapBytes(stringToU8a(payload))));

  const res = await fetch(`${FLOP_TESTNET_CONFIG.faucetUrl}/v1/testnet/agent-claims`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: pair.address,
      nonce,
      signature
    }),
    signal: AbortSignal.timeout(15000)
  });

  const data = await res.json().catch(() => ({}));
  const txHash = typeof data.txHash === 'string' && /^0x[0-9a-f]{64}$/i.test(data.txHash) ? data.txHash : null;
  return {
    success: Boolean(res.ok && data.success),
    httpStatus: res.status,
    status: data.status || (res.ok ? 'accepted' : 'failed'),
    address: pair.address,
    nonce,
    amountFlop: data.amount ?? (res.ok ? 10 : 0),
    txHash,
    explorerUrl: txHash ? `${FLOP_TESTNET_CONFIG.explorerUrl}/transactions/${txHash}` : null,
    error: data.error || (!res.ok ? `HTTP ${res.status}` : null),
    reason: data.reason || null,
    retryAfterSeconds: data.retryAfterSeconds ?? null
  };
}

/**
 * Signs and submits a Substrate extrinsic cleanly to wss://testnet.flop.network/,
 * resolving once included in a block (or finalized when requested) with verified receipt metadata.
 */
async function submitSignedExtrinsic(api, tx, pair, { waitForFinality = false, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = null;
    let txHashHex = tx.hash?.toHex?.() || null;

    const finish = (err, receipt = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe();
        } catch {}
      }
      if (err) reject(err);
      else resolve(receipt);
    };

    const timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for FLOP Testnet block inclusion${txHashHex ? ` (tx ${txHashHex})` : ''}`));
    }, timeoutMs);

    const onStatus = async (result) => {
      if (settled) return;
      try {
        txHashHex = result.txHash?.toHex?.() || txHashHex;
        const { status } = result;

        if (status?.isInvalid || status?.isDropped || status?.isUsurped || status?.isFinalityTimeout) {
          finish(new Error(`Transaction rejected by node (${status.type})`));
          return;
        }

        const readyToResolve = waitForFinality ? status?.isFinalized : status?.isInBlock || status?.isFinalized;
        if (!readyToResolve) return;

        const dispatchErr =
          result.dispatchError ||
          result.events?.find(({ event }) => event.section === 'system' && event.method === 'ExtrinsicFailed')?.event
            ?.data?.[0];

        if (dispatchErr) {
          const decoded =
            dispatchErr.isModule && api.registry?.findMetaError
              ? api.registry.findMetaError(dispatchErr.asModule)
              : null;
          const msg = decoded
            ? `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`
            : `On-chain dispatch error: ${dispatchErr.toString()}`;
          finish(new Error(msg));
          return;
        }

        const blockHash = status.isFinalized ? status.asFinalized.toHex() : status.asInBlock.toHex();
        let blockNumber = null;
        try {
          const header = await api.rpc.chain.getHeader(blockHash);
          blockNumber = header.number.toNumber();
        } catch {
          blockNumber = null;
        }

        finish(null, {
          txHash: txHashHex,
          blockHash,
          blockNumber,
          extrinsicIndex: result.txIndex ?? null,
          status: status.isFinalized ? 'finalized' : 'in_block',
          explorerUrl: `${FLOP_TESTNET_CONFIG.explorerUrl}/transactions/${txHashHex}`,
          blockUrl: blockNumber !== null ? `${FLOP_TESTNET_CONFIG.explorerUrl}/blocks/${blockNumber}` : null
        });
      } catch (err) {
        finish(err);
      }
    };

    tx.signAndSend(pair, onStatus)
      .then((unsub) => {
        if (settled) {
          if (typeof unsub === 'function') unsub();
        } else {
          unsubscribe = unsub;
        }
      })
      .catch((err) => finish(err));
  });
}

/**
 * Builds a bounded UTF-8 JSON remark payload referencing the room message + cryptographic signature.
 */
function buildMessageRemark({ room, did, nonce, messageSig, text }) {
  const baseObj = {
    app: 'floop',
    r: String(room || 'lobby').slice(0, 48),
    d: String(did || '').slice(0, 80),
    n: String(nonce || ''),
    s: String(messageSig || '').slice(0, 128),
    h: crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex').slice(0, 16),
    t: String(text || '')
  };

  let serialized = `floop.v1:${JSON.stringify(baseObj)}`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_REMARK_BYTES) {
    baseObj.t = `${baseObj.t.slice(0, 240)}…`;
    serialized = `floop.v1:${JSON.stringify(baseObj)}`;
  }
  return serialized;
}

/**
 * Submits a real signed `system.remarkWithEvent` transaction on FLOP Testnet (`wss://testnet.flop.network/`).
 * If balance is insufficient and `autoClaim` is enabled, attempts one D10 faucet claim before returning cleanly.
 */
export async function submitMessageRemarkTx({
  privateKeyHex,
  room,
  did,
  text,
  nonce,
  messageSig,
  autoClaim = true,
  faucetNonce = null,
  waitForFinality = false
}) {
  const pair = await pairFromPrivateKeyHex(privateKeyHex);
  const api = await getTestnetApi();

  const remarkStr = buildMessageRemark({ room, did, nonce, messageSig, text });
  const tx = api.tx.system?.remarkWithEvent
    ? api.tx.system.remarkWithEvent(remarkStr)
    : api.tx.system.remark(remarkStr);

  const [paymentInfo, accountInfo] = await Promise.all([
    tx.paymentInfo(pair.address),
    api.query.system.account(pair.address)
  ]);

  const partialFee = BigInt(paymentInfo.partialFee.toString());
  let freeRaw = BigInt(accountInfo.data.free.toString());
  let autoClaimResult = null;

  if (freeRaw < partialFee && autoClaim) {
    try {
      autoClaimResult = await claimTestnetFaucet(privateKeyHex, faucetNonce);
      if (autoClaimResult.success) {
        const deadline = Date.now() + 6000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1200));
          const updated = await api.query.system.account(pair.address);
          freeRaw = BigInt(updated.data.free.toString());
          if (freeRaw >= partialFee) break;
        }
      }
    } catch (err) {
      autoClaimResult = { success: false, error: err.message, reason: 'faucet_request_failed' };
    }
  }

  if (freeRaw < partialFee) {
    const faucetNote = autoClaimResult?.error ? ` (Faucet: ${autoClaimResult.error})` : '';
    return {
      submitted: false,
      reason: autoClaimResult?.reason || 'insufficient_balance',
      error: `Wallet ${pair.address} has ${formatPlancksToFlop(freeRaw, 4)} FLOP; needs at least ${formatPlancksToFlop(partialFee, 6)} FLOP for tx fee${faucetNote}`,
      address: pair.address,
      network: FLOP_TESTNET_CONFIG.chainId,
      freeRaw: freeRaw.toString(),
      freeFlop: formatPlancksToFlop(freeRaw, 4),
      requiredRaw: partialFee.toString(),
      requiredFlop: formatPlancksToFlop(partialFee, 6),
      faucetAttempt: autoClaimResult,
      explorerAddressUrl: `${FLOP_TESTNET_CONFIG.explorerUrl}/accounts/${pair.address}`
    };
  }

  const receipt = await submitSignedExtrinsic(api, tx, pair, { waitForFinality });
  const postAcct = await api.query.system.account(pair.address);
  const postFreeRaw = postAcct.data.free.toString();

  return {
    submitted: true,
    network: FLOP_TESTNET_CONFIG.chainId,
    pallet: api.tx.system?.remarkWithEvent ? 'system.remarkWithEvent' : 'system.remark',
    address: pair.address,
    feeFlop: formatPlancksToFlop(partialFee, 6),
    freeRawAfter: postFreeRaw,
    freeFlopAfter: formatPlancksToFlop(postFreeRaw, 4),
    remarkBytes: Buffer.byteLength(remarkStr, 'utf8'),
    autoClaimTxHash: autoClaimResult?.txHash || null,
    ...receipt
  };
}

/**
 * Transfers FLOP tokens on FLOP Testnet (`balances.transferKeepAlive`) from the signer wallet.
 */
export async function submitTestnetTransfer({ privateKeyHex, toAddress, amountFlop, waitForFinality = false }) {
  const pair = await pairFromPrivateKeyHex(privateKeyHex);
  const recipient = await resolveSs58Address(toAddress);
  const amountRaw = parseFlopToPlancks(amountFlop);
  const api = await getTestnetApi();

  const tx = api.tx.balances?.transferKeepAlive
    ? api.tx.balances.transferKeepAlive(recipient, amountRaw.toString())
    : api.tx.balances.transferAllowDeath(recipient, amountRaw.toString());

  const [paymentInfo, accountInfo] = await Promise.all([
    tx.paymentInfo(pair.address),
    api.query.system.account(pair.address)
  ]);

  const feeRaw = BigInt(paymentInfo.partialFee.toString());
  const freeRaw = BigInt(accountInfo.data.free.toString());
  const needed = amountRaw + feeRaw;

  if (freeRaw < needed) {
    throw new Error(
      `Insufficient FLOP balance: have ${formatPlancksToFlop(freeRaw, 4)} FLOP, need ~${formatPlancksToFlop(needed, 4)} FLOP (amount + fee)`
    );
  }

  const receipt = await submitSignedExtrinsic(api, tx, pair, { waitForFinality });
  const postAcct = await api.query.system.account(pair.address);
  return {
    submitted: true,
    network: FLOP_TESTNET_CONFIG.chainId,
    fromAddress: pair.address,
    toAddress: recipient,
    amountFlop: formatPlancksToFlop(amountRaw, 4),
    feeFlop: formatPlancksToFlop(feeRaw, 6),
    freeFlopAfter: formatPlancksToFlop(postAcct.data.free.toString(), 4),
    ...receipt
  };
}
