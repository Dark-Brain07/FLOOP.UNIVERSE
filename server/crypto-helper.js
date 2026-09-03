import * as ed from '@noble/ed25519';
import bs58 from 'bs58';
import crypto from 'crypto';

// Single-line unicode sweep matching technocore specs
export function normalizeMessage(text) {
  if (typeof text !== 'string') return '';
  const cleaned = text.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu, ' ').trim();
  return cleaned.replace(/\s+/g, ' ');
}

export function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function base64urlDecode(str) {
  return Buffer.from(str, 'base64url');
}

export async function generateIdentity(alias = 'Agent-' + Math.floor(Math.random() * 10000)) {
  const privBytes = ed.utils.randomPrivateKey();
  const pubBytes = await ed.getPublicKeyAsync(privBytes);
  
  // Multicodec 0xed01 + pubBytes
  const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(pubBytes)]);
  const multibase = 'z' + bs58.encode(multicodec);
  const did = 'did:key:' + multibase;
  
  const fingerprint = crypto.createHash('sha256').update(did, 'utf8').digest('hex').slice(0, 16);
  const noteShard = `did-${fingerprint.slice(0, 2)}`;
  const noteKey = fingerprint.slice(2, 16);
  const notePath = `kv/${noteShard}/${noteKey}`;
  
  return {
    alias,
    privateKeyHex: Buffer.from(privBytes).toString('hex'),
    publicKeyHex: Buffer.from(pubBytes).toString('hex'),
    did,
    fingerprint,
    noteShard,
    noteKey,
    notePath,
    createdAt: new Date().toISOString()
  };
}

export async function signMessage(privateKeyHex, room, nonce, text) {
  const normalized = normalizeMessage(text);
  const payloadStr = `${room}|${nonce}|${normalized}`;
  const payloadBytes = Buffer.from(payloadStr, 'utf8');
  const privBytes = Buffer.from(privateKeyHex, 'hex');
  const sigBytes = await ed.signAsync(payloadBytes, privBytes);
  const sig = base64url(sigBytes);
  return {
    normalized,
    payload: payloadStr,
    sig,
    nonce: String(nonce)
  };
}

export async function verifySignature(did, room, nonce, text, sig) {
  try {
    if (!did.startsWith('did:key:z6Mk')) return false;
    const multibase = did.slice('did:key:'.length);
    const decoded = bs58.decode(multibase.slice(1));
    if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) return false;
    const pubKey = decoded.slice(2);
    
    const normalized = normalizeMessage(text);
    const payloadBytes = Buffer.from(`${room}|${nonce}|${normalized}`, 'utf8');
    const sigBytes = base64urlDecode(sig);
    return await ed.verifyAsync(sigBytes, payloadBytes, pubKey);
  } catch (err) {
    return false;
  }
}

export function generateNonce() {
  // High precision nonce within 19 digits
  const hrTime = process.hrtime.bigint();
  return hrTime.toString().slice(0, 19);
}

export function contributionPayload(artifactUrl, commit) {
  const record = {
    artifact_url: artifactUrl.trim(),
    commit: commit.toLowerCase().trim(),
    schema: "technocore-contribution-v1"
  };
  // Canonical JSON sorted keys with no extra whitespace
  const canonical = JSON.stringify(record, Object.keys(record).sort());
  return Buffer.from(canonical, 'utf8');
}

export async function createContributionProof(privateKeyHex, did, artifactUrl, commit) {
  const payload = contributionPayload(artifactUrl, commit);
  const privBytes = Buffer.from(privateKeyHex, 'hex');
  const sigBytes = await ed.signAsync(payload, privBytes);
  return {
    schema: "technocore-contribution-proof-v1",
    did,
    artifact_url: artifactUrl.trim(),
    commit: commit.toLowerCase().trim(),
    signature: base64url(sigBytes),
    created_at: new Date().toISOString()
  };
}

export async function verifyContributionProof(proof) {
  try {
    if (proof.schema !== "technocore-contribution-proof-v1") return false;
    const { did, artifact_url, commit, signature } = proof;
    if (!did || !artifact_url || !commit || !signature) return false;
    const payload = contributionPayload(artifact_url, commit);
    
    const multibase = did.slice('did:key:'.length);
    const decoded = bs58.decode(multibase.slice(1));
    const pubKey = decoded.slice(2);
    const sigBytes = base64urlDecode(signature);
    return await ed.verifyAsync(sigBytes, payload, pubKey);
  } catch (err) {
    return false;
  }
}

export function privateKeyHexToPem(privateKeyHex, passphrase = null) {
  const derPrefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const der = Buffer.concat([derPrefix, Buffer.from(privateKeyHex, 'hex')]);
  const keyObj = crypto.createPrivateKey({
    key: der,
    format: 'der',
    type: 'pkcs8'
  });
  if (passphrase) {
    return keyObj.export({
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase
    });
  }
  return keyObj.export({
    type: 'pkcs8',
    format: 'pem'
  });
}

export async function importFromPem(pemString, passphrase = null) {
  const options = { key: pemString, format: 'pem' };
  if (passphrase) options.passphrase = passphrase;
  const keyObj = crypto.createPrivateKey(options);
  const der = keyObj.export({ type: 'pkcs8', format: 'der' });
  const privBytes = der.slice(-32);
  const pubBytes = await ed.getPublicKeyAsync(privBytes);
  const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(pubBytes)]);
  const multibase = 'z' + bs58.encode(multicodec);
  const did = 'did:key:' + multibase;
  const fingerprint = crypto.createHash('sha256').update(did, 'utf8').digest('hex').slice(0, 16);
  return {
    privateKeyHex: privBytes.toString('hex'),
    publicKeyHex: Buffer.from(pubBytes).toString('hex'),
    did,
    fingerprint,
    noteShard: `did-${fingerprint.slice(0, 2)}`,
    noteKey: fingerprint.slice(2, 16),
    notePath: `kv/did-${fingerprint.slice(0, 2)}/${fingerprint.slice(2, 16)}`
  };
}


