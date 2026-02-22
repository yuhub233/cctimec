const crypto = require('crypto');

function generateEncryptionKey(salt) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const hourBlock = Math.floor(now.getHours() / 6);
  const seed = `${salt}_${dateStr}_${hourBlock}`;
  return crypto.createHash('sha256').update(seed).digest();
}

function encrypt(text, salt) {
  const key = generateEncryptionKey(salt);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText, salt) {
  const key = generateEncryptionKey(salt);
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(parts[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function tryDecryptWithRecentKeys(encryptedText, salt) {
  const now = new Date();
  for (let offset = 0; offset <= 1; offset++) {
    for (let hb = 0; hb < 4; hb++) {
      try {
        const d = new Date(now.getTime() - offset * 86400000);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const seed = `${salt}_${dateStr}_${hb}`;
        const key = crypto.createHash('sha256').update(seed).digest();
        const parts = encryptedText.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let dec = decipher.update(parts[1], 'hex', 'utf8');
        dec += decipher.final('utf8');
        return dec;
      } catch (e) { continue; }
    }
  }
  throw new Error('Decryption failed');
}

module.exports = { encrypt, decrypt, tryDecryptWithRecentKeys, generateEncryptionKey };
