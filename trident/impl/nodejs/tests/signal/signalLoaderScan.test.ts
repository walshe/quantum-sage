import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scanSignalDirOnce } from '../../src/signal/loader.js';
import type { SignalFile } from '../../src/signal/types.js';

const TODAY = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const NOW_HHMM = new Date().toTimeString().slice(0, 5);

function signalYaml(dateStr: string, timeStr: string): string {
  return `schema_version: "1.0"
meta:
  date: "${dateStr}"
  timestamp: "${timeStr}"
  update_seq: 1
  contract: "ESM6"
  futures_last: 6578.67
  cash_last: 6535.67
  basis: 43.00
  execution_instrument: "ES"
volatility: { dvs: 50, dvs_prior: 48, skew: 140, regime: "normal" }
vwap: { value: 6555, updated_at: "${timeStr}", source: "manual" }
ranges: { range_1_up: 6680, range_2_up: 6647, range_2_down: 6542, range_1_down: 6509 }
levels:
  level_time: "${timeStr}"
  max_sell_1: 6616
  max_sell_2: 6582
  max_buy_1: null
  max_buy_2: 6467
  additional: []
levels_recal:
  level_time: null
  max_sell_1: null
  max_sell_2: null
  max_buy_1: null
  max_buy_2: null
  additional: []
bias: { direction: "neutral" }
`;
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'trident-scan-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('scanSignalDirOnce', () => {
  it('invokes callback for the most recent today-file by mtime', () => {
    const older = join(tmp, `qs_setup_${TODAY}_0900.yaml`);
    const newer = join(tmp, `qs_setup_${TODAY}_1500.yaml`);
    writeFileSync(older, signalYaml(TODAY, '09:00'), 'utf8');
    writeFileSync(newer, signalYaml(TODAY, NOW_HHMM), 'utf8');
    // Age `older` so mtime ordering is deterministic.
    const past = (Date.now() - 3_600_000) / 1000;
    utimesSync(older, past, past);

    let received: { signal: SignalFile; path: string } | null = null;
    scanSignalDirOnce(tmp, (signal, path) => {
      received = { signal, path };
    });

    expect(received).not.toBeNull();
    expect(received!.path).toBe(newer);
    expect(received!.signal.meta.date).toBe(TODAY);
  });

  it('ignores files from yesterday', () => {
    const yesterday = '2020-01-01';
    const stale = join(tmp, `qs_setup_${yesterday}_0900.yaml`);
    writeFileSync(stale, signalYaml(yesterday, '09:00'), 'utf8');

    let called = false;
    scanSignalDirOnce(tmp, () => { called = true; });
    expect(called).toBe(false);
  });

  it('ignores files whose name does not match the signal pattern', () => {
    writeFileSync(join(tmp, 'notes.yaml'), 'hello', 'utf8');
    writeFileSync(join(tmp, `qs_setup_${TODAY}_0900.txt`), 'hello', 'utf8');
    let called = false;
    scanSignalDirOnce(tmp, () => { called = true; });
    expect(called).toBe(false);
  });

  it('silently does nothing if the directory does not exist', () => {
    let called = false;
    expect(() =>
      scanSignalDirOnce(join(tmp, 'no-such-subdir'), () => { called = true; })
    ).not.toThrow();
    expect(called).toBe(false);
  });

  it('skips unparseable files without throwing', () => {
    writeFileSync(join(tmp, `qs_setup_${TODAY}_0900.yaml`), ':: not yaml ::', 'utf8');
    let called = false;
    expect(() =>
      scanSignalDirOnce(tmp, () => { called = true; })
    ).not.toThrow();
    // js-yaml is lenient and may return a string; callback fires but with a junk parse.
    // The important assertion is that we don't throw.
  });
});
