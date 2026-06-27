/**
 * Email List Client — reads Google account credentials from a text file.
 *
 * Replaces TempmailClient. Instead of generating disposable emails,
 * reads a pre-existing list of Google email:password pairs.
 *
 * File format (one per line):
 *   email@gmail.com:password123
 *   Lines starting with # are ignored.
 *
 * Auto-skips emails already present in chain-result.txt (dedup).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

class EmailList {
  constructor(filePath, resultFilePath) {
    this.accounts = [];
    this.index = 0;
    this._filePath = filePath;
    this._load(filePath);
    if (resultFilePath) {
      this._filterUsed(resultFilePath);
    }
  }

  _load(filePath) {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const sepIdx = trimmed.indexOf(':');
      if (sepIdx === -1) continue;
      const email = trimmed.substring(0, sepIdx).trim();
      const password = trimmed.substring(sepIdx + 1).trim();
      if (email && password) {
        this.accounts.push({ email, password });
      }
    }
    if (this.accounts.length === 0) {
      throw new Error(`EmailList: no valid accounts found in ${filePath}`);
    }
    console.log(`[EmailList] Loaded ${this.accounts.length} accounts from ${filePath}`);
  }

  _filterUsed(resultFilePath) {
    if (!existsSync(resultFilePath)) return;

    const content = readFileSync(resultFilePath, 'utf8');
    const usedEmails = new Set();
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const email = trimmed.split(':')[0]?.trim();
      if (email) usedEmails.add(email.toLowerCase());
    }

    if (usedEmails.size === 0) return;

    const before = this.accounts.length;
    this.accounts = this.accounts.filter(a => !usedEmails.has(a.email.toLowerCase()));
    const removed = before - this.accounts.length;

    if (removed > 0) {
      this._writeBack();
      console.log(`[EmailList] Removed ${removed} already-registered emails from ${this._filePath}`);
    }

    if (this.accounts.length === 0) {
      throw new Error(`EmailList: all ${before} accounts already registered. Add fresh emails to ${this._filePath}`);
    }
  }

  _writeBack() {
    const raw = readFileSync(this._filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const freshEmails = new Set(this.accounts.map(a => a.email.toLowerCase()));
    const kept = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        kept.push(line);
        continue;
      }
      const sepIdx = trimmed.indexOf(':');
      if (sepIdx === -1) continue;
      const email = trimmed.substring(0, sepIdx).trim().toLowerCase();
      if (freshEmails.has(email)) {
        kept.push(line);
      }
    }

    writeFileSync(this._filePath, kept.join('\n') + '\n', 'utf8');
  }

  getNext() {
    if (this.index >= this.accounts.length) return null;
    const account = this.accounts[this.index];
    this.index++;
    return account;
  }

  get remaining() {
    return this.accounts.length - this.index;
  }

  get total() {
    return this.accounts.length;
  }

  peek() {
    if (this.index >= this.accounts.length) return null;
    return this.accounts[this.index];
  }
}

export { EmailList };
