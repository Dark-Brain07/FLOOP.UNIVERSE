import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.VERCEL
  ? path.resolve('/tmp', '.floop_data')
  : path.resolve(__dirname, '../.floop_data');
const IDENTITIES_FILE = path.join(DATA_DIR, 'identities.json');
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');

let inMemoryIdentities = [];
let inMemoryPresets = {
  favoriteRooms: ['lobby', 'events', 'monflop-node', 'agent-collab', 'general'],
  recentNotes: []
};

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (e) {
    console.warn('Could not create data dir, using in-memory fallback:', e.message);
  }
}

export function loadIdentities() {
  ensureDataDir();
  try {
    if (!fs.existsSync(IDENTITIES_FILE)) {
      return inMemoryIdentities;
    }
    const raw = fs.readFileSync(IDENTITIES_FILE, 'utf8');
    inMemoryIdentities = JSON.parse(raw);
    return inMemoryIdentities;
  } catch (err) {
    console.warn('Error reading identities, using in-memory:', err.message);
    return inMemoryIdentities;
  }
}

export function saveIdentity(identity) {
  ensureDataDir();
  const list = loadIdentities();
  const existingIdx = list.findIndex(i => i.did === identity.did);
  if (existingIdx >= 0) {
    list[existingIdx] = { ...list[existingIdx], ...identity, updatedAt: new Date().toISOString() };
  } else {
    list.unshift(identity);
  }
  inMemoryIdentities = list;
  try {
    fs.writeFileSync(IDENTITIES_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not persist identity to disk, saved in-memory:', e.message);
  }
  return list;
}

export function deleteIdentity(did) {
  ensureDataDir();
  const list = loadIdentities().filter(i => i.did !== did);
  inMemoryIdentities = list;
  try {
    fs.writeFileSync(IDENTITIES_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not delete identity on disk, deleted in-memory:', e.message);
  }
  return list;
}

export function loadPresets() {
  ensureDataDir();
  try {
    if (!fs.existsSync(PRESETS_FILE)) {
      try {
        fs.writeFileSync(PRESETS_FILE, JSON.stringify(inMemoryPresets, null, 2), 'utf8');
      } catch {}
      return inMemoryPresets;
    }
    inMemoryPresets = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
    return inMemoryPresets;
  } catch {
    return inMemoryPresets;
  }
}

export function savePresets(data) {
  ensureDataDir();
  inMemoryPresets = data;
  try {
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not persist presets to disk, saved in-memory:', e.message);
  }
  return data;
}
