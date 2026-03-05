import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateDek, wrapDek, encryptWithDek, unwrapDek, decryptWithDek } from '../crypto/encryption.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.resolve(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const storePath = path.join(dataDir, 'inventory.json');

function readStore() {
  if (!fs.existsSync(storePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStore(store) {
  fs.writeFileSync(storePath, JSON.stringify(store), { encoding: 'utf8' });
}

export function saveInventory(steamid, data) {
  const dek = generateDek();
  const wrappedDek = wrapDek(dek);
  const ciphertext = encryptWithDek(dek, JSON.stringify(data));

  const payload = {
    wrappedDek,
    ciphertext,
    updatedAt: Date.now()
  };

  const store = readStore();
  store[steamid] = payload;
  writeStore(store);
}

export function loadInventory(steamid) {
  const store = readStore();
  const entry = store[steamid];
  if (!entry) return null;

  try {
    const dek = unwrapDek(entry.wrappedDek);
    const json = decryptWithDek(dek, entry.ciphertext);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

