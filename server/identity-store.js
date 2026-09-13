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
  return [];
}

export function saveIdentity(identity) {
  return [];
}

export function deleteIdentity(did) {
  return [];
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
