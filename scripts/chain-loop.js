#!/usr/bin/env node
/**
 * Chain loop CLI — thin wrapper ke ChainRunner.
 *
 * Cara pakai:
 *   node scripts/chain-loop.js --count 5
 *   node scripts/chain-loop.js --count 3 --seed HWPMXZ
 *   node scripts/chain-loop.js --count 10 --output chain.txt
 */

import { ChainRunner } from '../src/runner/chain-runner.js';
import { config, count, seedRef, proxyManager, emailList } from './chain-loop-config.js';

const runner = new ChainRunner(config, proxyManager, undefined, emailList);

// Forward events to console
runner.on('start', ({ count, seedRef: ref }) => {
  console.log(`\nChain loop config:`);
  console.log(`  Count     : ${count}`);
  console.log(`  Seed ref  : ${ref}`);
  if (proxyManager && proxyManager.count > 0) {
    const s = proxyManager.status();
    console.log(`  Proxies   : ${s.healthy} healthy / ${s.total} total`);
  }
});

runner.on('progress', (r) => {
  if (r.ok) {
    console.log(`✅ [${r.idx + 1}/${r.total}] ${r.email} | Ref: ${r.refCode || '-'} | API: ${(r.apiKey || '-').substring(0, 20)}...`);
  } else {
    console.log(`❌ [${r.idx + 1}/${r.total}] ${r.email || '?'} | ${r.error}`);
  }
});

runner.on('log', (msg) => console.log(msg));

runner.on('done', ({ okCount, failCount }) => {
  console.log(`\n═══ DONE ═══`);
  console.log(`✅ ${okCount} success | ❌ ${failCount} failed`);
  process.exit(okCount > 0 ? 0 : 1);
});

runner.on('stopped', ({ okCount, failCount }) => {
  console.log(`\n⏹ Chain stopped. ✅ ${okCount} success | ❌ ${failCount} failed`);
  process.exit(0);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\nCaught SIGINT...');
  runner.stop();
});
process.on('SIGTERM', () => runner.stop());

runner.start({ count, seedRef }).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
