import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  generateIdentity,
  signMessage,
  verifySignature,
  createContributionProof,
  verifyContributionProof,
  generateNonce,
  normalizeMessage,
  privateKeyHexToPem,
  importFromPem
} from './crypto-helper.js';
import {
  loadIdentities,
  saveIdentity,
  deleteIdentity,
  loadPresets,
  savePresets
} from './identity-store.js';
import {
  getTestnetStatus,
  getAccountBalance,
  claimTestnetFaucet,
  submitMessageRemarkTx,
  submitTestnetTransfer
} from './flop-testnet.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
let TARGET_BASE_URL = process.env.TECHNOCORE_BASE_URL || 'https://technocore.chat';

const ALLOWED_CORS_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

function isLoopbackHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

function isDisallowedPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (isLoopbackHostname(h)) return false;
  if (h === '0.0.0.0' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^127\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (/^(fc|fd|fe80)/i.test(h)) return true;
  return false;
}

function validateTargetNodeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error('Invalid URL format');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Credentials in target URL are not allowed');
  }
  const loopback = isLoopbackHostname(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('Target URL must use HTTPS (or http://localhost / http://127.0.0.1)');
  }
  if (!loopback && isDisallowedPrivateHost(parsed.hostname)) {
    throw new Error('Private or link-local hosts are not allowed');
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

function safeDownloadFilename(name, fallback = 'export') {
  const cleaned = String(name || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (ALLOWED_CORS_ORIGINS.has(origin)) return callback(null, true);
      try {
        const u = new URL(origin);
        if (isLoopbackHostname(u.hostname) || u.hostname.endsWith('.vercel.app')) {
          return callback(null, true);
        }
      } catch {}
      return callback(null, false);
    }
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend
app.use(express.static(path.resolve(__dirname, '../public')));
// Serve local Three.js
app.use('/vendor/three', express.static(path.resolve(__dirname, '../node_modules/three/build')));

// Helper for outbound requests to Technocore
async function fetchTechnocore(urlPath, options = {}, baseUrlOverride = null) {
  const base = (baseUrlOverride || TARGET_BASE_URL).replace(/\/$/, '');
  const targetUrl = `${base}${urlPath.startsWith('/') ? '' : '/'}${urlPath}`;
  const headers = {
    'User-Agent': 'FloopTerminal/1.0.0 (Mozilla/5.0; AI-Agent-Interface)',
    ...(options.headers || {})
  };

  const controller = new AbortController();
  const timeout = options.timeout || 30000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(targetUrl, {
      ...options,
      headers,
      redirect: 'error',
      signal: controller.signal
    });
    clearTimeout(timer);
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const text = await res.text();

    return {
      status: res.status,
      ok: res.ok,
      contentType,
      headers: Object.fromEntries(res.headers.entries()),
      data: isJson ? JSON.parse(text) : text
    };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// -------------------------------------------------------------
// Target Node Configuration
// -------------------------------------------------------------
app.get('/api/config/target', (req, res) => {
  res.json({
    targetBaseUrl: TARGET_BASE_URL,
    defaultUrl: 'https://technocore.chat'
  });
});

app.post('/api/config/target', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Valid URL is required' });
  }
  if (process.env.VERCEL && process.env.ALLOW_TARGET_SWITCH !== 'true') {
    return res.status(403).json({
      error: 'Switching global target node is disabled on shared serverless hosting',
      targetBaseUrl: TARGET_BASE_URL
    });
  }
  let cleanUrl;
  try {
    cleanUrl = validateTargetNodeUrl(url);
  } catch (err) {
    return res.status(400).json({ error: err.message, targetBaseUrl: TARGET_BASE_URL });
  }
  try {
    // Test connectivity against the proposed URL before activating it
    const testRes = await fetchTechnocore('/rooms?format=json&limit=1', { timeout: 8000 }, cleanUrl);
    if (!testRes.ok || typeof testRes.data !== 'object') {
      throw new Error(`Target node returned HTTP ${testRes.status} (expected JSON /rooms response)`);
    }
    TARGET_BASE_URL = cleanUrl;
    res.json({
      success: true,
      targetBaseUrl: TARGET_BASE_URL,
      remoteStatus: testRes.status
    });
  } catch (err) {
    res.status(502).json({
      error: `Could not reach target Technocore node: ${err.message}`,
      targetBaseUrl: TARGET_BASE_URL
    });
  }
});

// -------------------------------------------------------------
// Live Rooms & Proxy Endpoints
// -------------------------------------------------------------

// List Rooms
app.get('/api/proxy/rooms', async (req, res) => {
  try {
    const query = new URLSearchParams(req.query).toString();
    const result = await fetchTechnocore(`/rooms?${query}`, { timeout: 15000 });
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(502).json({ error: `Proxy failed to load rooms: ${err.message}` });
  }
});

// Read Room Messages (with long-poll support)
app.get('/api/proxy/r/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const query = new URLSearchParams(req.query).toString();
    const waitSec = parseFloat(req.query.wait || '0');
    // Set server timeout to be longer than requested long-poll wait
    const timeout = Math.max(15000, (waitSec + 5) * 1000);
    const result = await fetchTechnocore(`/r/${encodeURIComponent(room)}?${query}`, { timeout });
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(502).json({ error: `Proxy failed to read room: ${err.message}` });
  }
});

// Post Message (Unsigned or Signed)
app.post('/api/proxy/r/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const body = req.body;
    const result = await fetchTechnocore(`/r/${encodeURIComponent(room)}?format=json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout: 10000
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(502).json({ error: `Proxy failed to post message: ${err.message}` });
  }
});

// Helper to send upstream raw text without HTML sniffing
function sendPlainProxy(res, result) {
  res.type('text/plain; charset=utf-8');
  const payload = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
  res.status(result.status).send(payload);
}

// GET Say (Unsigned write via GET)
app.get('/api/proxy/r/:room/say/:nick/:text', async (req, res) => {
  try {
    const { room, nick, text } = req.params;
    const result = await fetchTechnocore(
      `/r/${encodeURIComponent(room)}/say/${encodeURIComponent(nick)}/${encodeURIComponent(text)}`,
      { timeout: 10000 }
    );
    sendPlainProxy(res, result);
  } catch (err) {
    res.status(502).json({ error: `Proxy GET say failed: ${err.message}` });
  }
});

// GET Say-Signed (Signed write via GET)
app.get('/api/proxy/r/:room/say-signed/:did/:sig/:nonce/:text', async (req, res) => {
  try {
    const { room, did, sig, nonce, text } = req.params;
    const result = await fetchTechnocore(
      `/r/${encodeURIComponent(room)}/say-signed/${encodeURIComponent(did)}/${encodeURIComponent(sig)}/${encodeURIComponent(nonce)}/${encodeURIComponent(text)}`,
      { timeout: 10000 }
    );
    sendPlainProxy(res, result);
  } catch (err) {
    res.status(502).json({ error: `Proxy GET say-signed failed: ${err.message}` });
  }
});

// Export Room JSONL
app.get('/api/proxy/r/:room/export', async (req, res) => {
  try {
    const { room } = req.params;
    const result = await fetchTechnocore(`/r/${encodeURIComponent(room)}/export`, { timeout: 20000 });
    const safeRoom = safeDownloadFilename(room, 'room');
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeRoom}-export.jsonl"`);
    res.status(result.status).send(typeof result.data === 'string' ? result.data : JSON.stringify(result.data));
  } catch (err) {
    res.status(502).json({ error: `Export failed: ${err.message}` });
  }
});

// -------------------------------------------------------------
// Notes (KV Store)
// -------------------------------------------------------------

// Read Note
app.get('/api/proxy/kv/:ns/:key', async (req, res) => {
  try {
    const { ns, key } = req.params;
    const result = await fetchTechnocore(`/kv/${encodeURIComponent(ns)}/${encodeURIComponent(key)}`, {
      timeout: 10000
    });
    sendPlainProxy(res, result);
  } catch (err) {
    res.status(502).json({ error: `Read note failed: ${err.message}` });
  }
});

// Write Note (Unconditional or CAS)
app.post('/api/proxy/kv/:ns/:key', async (req, res) => {
  try {
    const { ns, key } = req.params;
    const result = await fetchTechnocore(`/kv/${encodeURIComponent(ns)}/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      timeout: 10000
    });
    sendPlainProxy(res, result);
  } catch (err) {
    res.status(502).json({ error: `Write note failed: ${err.message}` });
  }
});

// List keys in namespace
app.get('/api/proxy/kv/:ns', async (req, res) => {
  try {
    const { ns } = req.params;
    const result = await fetchTechnocore(`/kv/${encodeURIComponent(ns)}?format=json`, {
      timeout: 10000
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(502).json({ error: `List keys failed: ${err.message}` });
  }
});

// Server Config
app.get('/api/proxy/config', async (req, res) => {
  try {
    const result = await fetchTechnocore('/config', { timeout: 8000 });
    sendPlainProxy(res, result);
  } catch (err) {
    res.status(502).json({ error: `Config fetch failed: ${err.message}` });
  }
});

// Agent limits info
app.get('/api/proxy/agent-info', async (req, res) => {
  try {
    const result = await fetchTechnocore('/.well-known/agent.json', { timeout: 8000 });
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(502).json({ error: `Agent info fetch failed: ${err.message}` });
  }
});

// OpenAPI Spec
app.get('/api/proxy/openapi', async (req, res) => {
  try {
    const result = await fetchTechnocore('/openapi.json', { timeout: 8000 });
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(502).json({ error: `OpenAPI fetch failed: ${err.message}` });
  }
});

// Full Agent Manual (llms.txt)
app.get('/api/proxy/llms', async (req, res) => {
  try {
    const result = await fetchTechnocore('/llms.txt', { timeout: 8000 });
    sendPlainProxy(res, result);
  } catch (err) {
    res.status(502).json({ error: `Manual fetch failed: ${err.message}` });
  }
});

// Onboarding Skill (skill.md)
app.get('/api/proxy/skill', async (req, res) => {
  try {
    const result = await fetchTechnocore('/skill.md', { timeout: 8000 });
    sendPlainProxy(res, result);
  } catch (err) {
    res.status(502).json({ error: `Skill fetch failed: ${err.message}` });
  }
});

// Patterns (patterns.md)
app.get('/api/proxy/patterns', async (req, res) => {
  try {
    const result = await fetchTechnocore('/patterns.md', { timeout: 8000 });
    sendPlainProxy(res, result);
  } catch (err) {
    res.status(502).json({ error: `Patterns fetch failed: ${err.message}` });
  }
});

// Auth manual (auth.md)
app.get('/api/proxy/auth', async (req, res) => {
  try {
    const result = await fetchTechnocore('/auth.md', { timeout: 8000 });
    sendPlainProxy(res, result);
  } catch (err) {
    res.status(502).json({ error: `Auth doc fetch failed: ${err.message}` });
  }
});

// Room Nonce Counter
app.get('/api/ownership/room-nonce/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const result = await fetchTechnocore(`/kv/room-nonce/${encodeURIComponent(room)}`, { timeout: 8000 });
    sendPlainProxy(res, result);
  } catch (err) {
    res.status(502).json({ error: `Nonce check failed: ${err.message}` });
  }
});

// Claim Room Ownership (Signed)
app.post('/api/ownership/claim', async (req, res) => {
  try {
    const { privateKeyHex, did, room } = req.body;
    if (!room.startsWith('d-')) {
      return res.status(400).json({ error: 'Only d-* rooms can be owned' });
    }
    const nonce = generateNonce();
    // Signature covers `room-owners|d-<room>|<claim_nonce>|<the same did:key>`
    const payloadStr = `room-owners|${room}|${nonce}|${did}`;
    const sigData = await signMessage(privateKeyHex, room, nonce, did);
    // Path: GET /kv/room-owners/d-<room>/set-signed/<did>/<sig>/<claim_nonce>/<the same did:key>?if_absent=1
    const targetPath = `/kv/room-owners/${encodeURIComponent(room)}/set-signed/${encodeURIComponent(did)}/${encodeURIComponent(sigData.sig)}/${encodeURIComponent(nonce)}/${encodeURIComponent(did)}?if_absent=1`;
    const result = await fetchTechnocore(targetPath, { timeout: 10000 });
    res.status(result.status).send(result.data);
  } catch (err) {
    res.status(500).json({ error: `Claim failed: ${err.message}` });
  }
});

// Set Room Allow-List (Signed)
app.post('/api/ownership/allow', async (req, res) => {
  try {
    const { privateKeyHex, did, room, allowedDids } = req.body;
    if (!room.startsWith('d-')) {
      return res.status(400).json({ error: 'Only d-* rooms have allow-lists' });
    }
    const nonce = generateNonce();
    // Signature covers `room-allow|d-<room>|<greater_nonce>|<value>`
    const val = allowedDids.join(' ').trim();
    const sigData = await signMessage(privateKeyHex, room, nonce, val);
    const targetPath = `/kv/room-allow/${encodeURIComponent(room)}/set-signed/${encodeURIComponent(did)}/${encodeURIComponent(sigData.sig)}/${encodeURIComponent(nonce)}/${encodeURIComponent(val)}`;
    const result = await fetchTechnocore(targetPath, { timeout: 10000 });
    res.status(result.status).send(result.data);
  } catch (err) {
    res.status(500).json({ error: `Allow-list update failed: ${err.message}` });
  }
});

// Export Identity to PEM
app.post('/api/crypto/export-pem', (req, res) => {
  try {
    const { privateKeyHex, passphrase } = req.body;
    const pem = privateKeyHexToPem(privateKeyHex, passphrase || null);
    res.json({ pem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import Identity from PEM
app.post('/api/crypto/import-pem', async (req, res) => {
  try {
    const { pem, passphrase, alias } = req.body;
    const identity = await importFromPem(pem, passphrase || null);
    identity.alias = alias || `Imported-${identity.did.slice(8, 14)}`;
    identity.createdAt = new Date().toISOString();
    // Client stores identity strictly in browser localStorage; do not save to server
    res.json({ identity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Cryptographic Endpoints
// -------------------------------------------------------------

app.post('/api/crypto/generate-did', async (req, res) => {
  try {
    const { alias } = req.body;
    const identity = await generateIdentity(alias);
    res.json(identity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crypto/sign-message', async (req, res) => {
  try {
    const { privateKeyHex, room, nonce, text } = req.body;
    if (!privateKeyHex || !room || !text) {
      return res.status(400).json({ error: 'Missing privateKeyHex, room, or text' });
    }
    const selectedNonce = nonce || generateNonce();
    const signed = await signMessage(privateKeyHex, room, selectedNonce, text);
    res.json(signed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crypto/verify-signature', async (req, res) => {
  try {
    const { did, room, nonce, text, sig } = req.body;
    if (!did || !room || !nonce || !text || !sig) {
      return res.status(400).json({ error: 'Missing required signature verification fields' });
    }
    const isValid = await verifySignature(did, room, nonce, text, sig);
    res.json({ valid: isValid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crypto/create-proof', async (req, res) => {
  try {
    const { privateKeyHex, did, artifactUrl, commit } = req.body;
    if (!privateKeyHex || !did || !artifactUrl || !commit) {
      return res.status(400).json({ error: 'Missing required proof fields' });
    }
    const proof = await createContributionProof(privateKeyHex, did, artifactUrl, commit);
    res.json(proof);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crypto/verify-proof', async (req, res) => {
  try {
    const { proof } = req.body;
    if (!proof) return res.status(400).json({ error: 'Missing proof object' });
    const isValid = await verifyContributionProof(proof);
    res.json({ valid: isValid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// FLOP Testnet On-Chain RPC (wss://testnet.flop.network/)
// -------------------------------------------------------------
app.get('/api/testnet/status', async (req, res) => {
  try {
    const status = await getTestnetStatus();
    res.json(status);
  } catch (err) {
    res.status(502).json({ error: `FLOP Testnet RPC unavailable: ${err.message}` });
  }
});

app.get('/api/testnet/balance/:address', async (req, res) => {
  try {
    const balance = await getAccountBalance(req.params.address);
    res.json(balance);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/testnet/faucet-claim', async (req, res) => {
  try {
    const { privateKeyHex, nonce } = req.body;
    if (!privateKeyHex) {
      return res.status(400).json({ error: 'Missing privateKeyHex' });
    }
    const result = await claimTestnetFaucet(privateKeyHex, nonce || null);
    res.status(result.success ? 200 : result.httpStatus || 502).json(result);
  } catch (err) {
    res.status(500).json({ error: `Faucet claim failed: ${err.message}` });
  }
});

app.post('/api/testnet/submit-message-tx', async (req, res) => {
  try {
    const { privateKeyHex, room, did, text, nonce, sig, autoClaim, faucetNonce, waitForFinality } = req.body;
    if (!privateKeyHex || !room || !text) {
      return res.status(400).json({ error: 'Missing privateKeyHex, room, or text' });
    }
    const receipt = await submitMessageRemarkTx({
      privateKeyHex,
      room,
      did,
      text,
      nonce,
      messageSig: sig,
      autoClaim: autoClaim !== false,
      faucetNonce: faucetNonce || null,
      waitForFinality: Boolean(waitForFinality)
    });
    res.json(receipt);
  } catch (err) {
    res.status(500).json({ submitted: false, error: err.message });
  }
});

app.post('/api/testnet/transfer', async (req, res) => {
  try {
    const { privateKeyHex, toAddress, amountFlop, waitForFinality } = req.body;
    if (!privateKeyHex || !toAddress || !amountFlop) {
      return res.status(400).json({ error: 'Missing privateKeyHex, toAddress, or amountFlop' });
    }
    const receipt = await submitTestnetTransfer({
      privateKeyHex,
      toAddress,
      amountFlop,
      waitForFinality: Boolean(waitForFinality)
    });
    res.json(receipt);
  } catch (err) {
    res.status(400).json({ submitted: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Identity & Presets Management
// -------------------------------------------------------------
// NOTE: Identities and private keys are stored strictly in client browser
// localStorage to ensure complete privacy across users. The server returns empty.
app.get('/api/identities', (req, res) => {
  res.json([]);
});

app.post('/api/identities', (req, res) => {
  res.json([]);
});

app.delete('/api/identities/:did', (req, res) => {
  res.json([]);
});

app.get('/api/presets', (req, res) => {
  res.json(loadPresets());
});

app.post('/api/presets', (req, res) => {
  try {
    const updated = savePresets(req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Agent Orchestrator Simulator
// -------------------------------------------------------------
// Coordinates a 3-phase handoff (Planner -> Implementer -> Reviewer)
app.post('/api/orchestrator/run-workflow', async (req, res) => {
  try {
    const { taskPrompt, room, plannerId, implementerId, reviewerId } = req.body;
    const targetRoom = room || `p-orch-${Date.now().toString(36)}`;
    
    // Create identities if not provided
    const planner = plannerId || (await generateIdentity('Planner-Agent'));
    const implementer = implementerId || (await generateIdentity('Implementer-Agent'));
    const reviewer = reviewerId || (await generateIdentity('Reviewer-Agent'));

    const log = [];

    // Step 1: Planner sends initial plan
    const nonce1 = generateNonce();
    const planText = `[PLAN: v1] Objective: ${taskPrompt || 'Build distributed heartbeat service'}. Steps: 1. Setup ring 2. Subscribe DID.`;
    const sig1 = await signMessage(planner.privateKeyHex, targetRoom, nonce1, planText);
    
    await fetchTechnocore(`/r/${encodeURIComponent(targetRoom)}?format=json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: planner.did,
        sig: sig1.sig,
        nonce: nonce1,
        text: sig1.normalized
      })
    });
    log.push({ phase: 'PLAN', agent: 'Planner', did: planner.did, text: planText, nonce: nonce1 });

    // Step 2: Implementer acknowledges and posts candidate commit
    const nonce2 = generateNonce();
    const commitText = `[IMPLEMENTATION] Candidate commit 4b825dc642cb6eb9a060e54bf8d69288fbee4904 ready for review.`;
    const sig2 = await signMessage(implementer.privateKeyHex, targetRoom, nonce2, commitText);
    await fetchTechnocore(`/r/${encodeURIComponent(targetRoom)}?format=json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: implementer.did,
        sig: sig2.sig,
        nonce: nonce2,
        text: sig2.normalized
      })
    });
    log.push({ phase: 'IMPLEMENT', agent: 'Implementer', did: implementer.did, text: commitText, nonce: nonce2 });

    // Step 3: Reviewer signs approval
    const nonce3 = generateNonce();
    const reviewText = `[REVIEW: APPROVED] Deterministic tests passed. Signature verified against commit hash.`;
    const sig3 = await signMessage(reviewer.privateKeyHex, targetRoom, nonce3, reviewText);
    await fetchTechnocore(`/r/${encodeURIComponent(targetRoom)}?format=json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: reviewer.did,
        sig: sig3.sig,
        nonce: nonce3,
        text: sig3.normalized
      })
    });
    log.push({ phase: 'REVIEW', agent: 'Reviewer', did: reviewer.did, text: reviewText, nonce: nonce3 });

    res.json({
      success: true,
      room: targetRoom,
      workflowLog: log
    });
  } catch (err) {
    res.status(500).json({ error: `Workflow failed: ${err.message}` });
  }
});

// Fallback to SPA index.html
app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/index.html'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 Floop Terminal backend running at http://localhost:${PORT}`);
    console.log(`🌐 Proxying to Technocore Hub: ${TARGET_BASE_URL}`);
    console.log(`=======================================================`);
  });
}

export default app;
