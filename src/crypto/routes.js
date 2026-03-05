import express from 'express';
import { generateDek, wrapDek, unwrapDek, encryptWithDek, decryptWithDek } from './encryption.js';

const router = express.Router();

router.post('/encrypt', (req, res) => {
  const { plaintext } = req.body || {};
  if (typeof plaintext !== 'string') {
    return res.status(400).json({ error: 'plaintext must be a string' });
  }

  const dek = generateDek();
  const wrappedDek = wrapDek(dek);
  const ciphertext = encryptWithDek(dek, plaintext);

  res.json({
    wrappedDek,
    ciphertext
  });
});

router.post('/decrypt', (req, res) => {
  const { wrappedDek, ciphertext } = req.body || {};

  if (!wrappedDek || !ciphertext) {
    return res.status(400).json({ error: 'wrappedDek and ciphertext required' });
  }

  try {
    const dek = unwrapDek(wrappedDek);
    const plaintext = decryptWithDek(dek, ciphertext);
    req.emit('decryption-success');
    res.json({ plaintext });
  } catch (err) {
    req.emit('decryption-failed');
    return res.status(400).json({ error: 'Decryption failed' });
  }
});

export default router;

