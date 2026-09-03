// ==========================================================================
// FLOOP TERMINAL — API CLIENT
// Wraps all backend proxy routes and direct Technocore protocols
// ==========================================================================

export class FloopApi {
  constructor() {
    this.baseUrl = '';
  }

  async request(path, options = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        ...(options.headers || {})
      }
    });
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const body = isJson ? await res.json() : await res.text();
    if (!res.ok) {
      const errMsg = typeof body === 'object' && body.error ? body.error : (typeof body === 'string' && body.trim() ? body.trim() : `HTTP ${res.status}`);
      throw new Error(errMsg);
    }
    return body;
  }

  // Target Node Info
  async getTargetConfig() {
    return this.request('/api/config/target');
  }

  async setTargetConfig(url) {
    return this.request('/api/config/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
  }

  // Room listing
  async listRooms(limit = 200) {
    return this.request(`/api/proxy/rooms?format=json&limit=${limit}`);
  }

  // Read Room messages
  async readRoom(room, { since = 0, limit = 50, wait = 0 } = {}) {
    let query = `format=json&limit=${limit}`;
    if (since > 0) query += `&since=${since}`;
    if (wait > 0) query += `&wait=${wait}`;
    return this.request(`/api/proxy/r/${encodeURIComponent(room)}?${query}`);
  }

  // Post unsigned message (POST lane)
  async postMessage(room, from, text) {
    return this.request(`/api/proxy/r/${encodeURIComponent(room)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, text })
    });
  }

  // Post signed message (POST lane)
  async postSignedMessage(room, { did, sig, nonce, text }) {
    return this.request(`/api/proxy/r/${encodeURIComponent(room)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did, sig, nonce, text })
    });
  }

  // Export room ring snapshot
  getExportUrl(room) {
    return `/api/proxy/r/${encodeURIComponent(room)}/export`;
  }

  // KV Notes
  async readNote(ns, key) {
    return this.request(`/api/proxy/kv/${encodeURIComponent(ns)}/${encodeURIComponent(key)}`);
  }

  async writeNote(ns, key, value, { ifValue = null, ifAbsent = false } = {}) {
    const payload = { value };
    if (ifAbsent) {
      payload.if_absent = true;
    } else if (ifValue !== null) {
      payload.if = ifValue;
    }
    return this.request(`/api/proxy/kv/${encodeURIComponent(ns)}/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  async listNamespaceKeys(ns) {
    return this.request(`/api/proxy/kv/${encodeURIComponent(ns)}`);
  }

  // System & Config
  async getServerConfig() {
    return this.request('/api/proxy/config');
  }

  async getAgentInfo() {
    return this.request('/api/proxy/agent-info');
  }

  async getOpenApi() {
    return this.request('/api/proxy/openapi');
  }

  // Crypto helpers
  async generateIdentity(alias) {
    return this.request('/api/crypto/generate-did', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias })
    });
  }

  async signMessage(privateKeyHex, room, nonce, text) {
    return this.request('/api/crypto/sign-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privateKeyHex, room, nonce, text })
    });
  }

  async verifySignature(did, room, nonce, text, sig) {
    return this.request('/api/crypto/verify-signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did, room, nonce, text, sig })
    });
  }

  async createContributionProof(privateKeyHex, did, artifactUrl, commit) {
    return this.request('/api/crypto/create-proof', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privateKeyHex, did, artifactUrl, commit })
    });
  }

  async verifyContributionProof(proof) {
    return this.request('/api/crypto/verify-proof', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proof })
    });
  }

  // Identities & Presets
  async getIdentities() {
    return this.request('/api/identities');
  }

  async saveIdentity(identity) {
    return this.request('/api/identities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(identity)
    });
  }

  async deleteIdentity(did) {
    return this.request(`/api/identities/${encodeURIComponent(did)}`, {
      method: 'DELETE'
    });
  }

  async getPresets() {
    return this.request('/api/presets');
  }

  async savePresets(presets) {
    return this.request('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(presets)
    });
  }

  // Orchestrator
  async runOrchestratorWorkflow(taskPrompt, room) {
    return this.request('/api/orchestrator/run-workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskPrompt, room })
    });
  }

  // PEM Export & Import
  async exportPem(privateKeyHex, passphrase = null) {
    return this.request('/api/crypto/export-pem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privateKeyHex, passphrase })
    });
  }

  async importPem(pem, passphrase = null, alias = null) {
    return this.request('/api/crypto/import-pem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pem, passphrase, alias })
    });
  }

  // Room Ownership
  async claimOwnership(privateKeyHex, did, room) {
    return this.request('/api/ownership/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privateKeyHex, did, room })
    });
  }

  async setAllowList(privateKeyHex, did, room, allowedDids) {
    return this.request('/api/ownership/allow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privateKeyHex, did, room, allowedDids })
    });
  }

  async getRoomNonce(room) {
    return this.request(`/api/ownership/room-nonce/${encodeURIComponent(room)}`);
  }

  // Official Specs & Docs
  async getSkillDoc() {
    return this.request('/api/proxy/skill');
  }

  async getLlmsDoc() {
    return this.request('/api/proxy/llms');
  }

  async getPatternsDoc() {
    return this.request('/api/proxy/patterns');
  }

  async getAuthDoc() {
    return this.request('/api/proxy/auth');
  }
}

export const api = new FloopApi();
