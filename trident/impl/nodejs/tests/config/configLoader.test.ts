import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { loadConfig } from '../../src/config/loader.js';

const TMP = '/tmp/qs-config-test.yaml';

const VALID_YAML = `
capital:
  daily_risk_pct: 0.5

trident:
  entry_1_allocation_pct: 32.5
  entry_2_allocation_pct: 35.0
  entry_3_allocation_pct: 32.5
  midpoint_offset_buy: 2
  midpoint_offset_sell: -2
  stop_loss_points: 40
  breakeven_trigger_points: 25
  hard_profit_exit_points: 33
  time_exit_minutes: 180
  dvs_gate: 75

size_adaptation:
  after_one_loss_day: 0.5
  after_two_loss_days: 0.25

signal:
  watch_dir: "./setups"
  stale_threshold_hours: 6
  vwap_staleness_warn_minutes: 90
`;

function write(yaml: string) { writeFileSync(TMP, yaml, 'utf8'); }

beforeEach(() => write(VALID_YAML));
afterEach(() => { try { unlinkSync(TMP); } catch { /* ignore */ } });

describe('loadConfig — valid config', () => {
  it('loads a valid config without throwing', () => {
    const cfg = loadConfig(TMP);
    expect(cfg.trident.dvs_gate).toBe(75);
    expect(cfg.capital.daily_risk_pct).toBe(0.5);
  });
});

describe('loadConfig — missing sections', () => {
  it('throws when capital section is missing', () => {
    write(VALID_YAML.replace(/^capital:[\s\S]*?(?=trident:)/m, ''));
    expect(() => loadConfig(TMP)).toThrow('capital section is missing');
  });

  it('throws when trident section is missing', () => {
    write(VALID_YAML.replace(/^trident:[\s\S]*?(?=size_adaptation:)/m, ''));
    expect(() => loadConfig(TMP)).toThrow('trident section is missing');
  });

  it('throws when size_adaptation section is missing', () => {
    write(VALID_YAML.replace(/^size_adaptation:[\s\S]*?(?=signal:)/m, ''));
    expect(() => loadConfig(TMP)).toThrow('size_adaptation section is missing');
  });

  it('throws when signal section is missing', () => {
    write(VALID_YAML.replace(/\nsignal:[\s\S]*/m, ''));
    expect(() => loadConfig(TMP)).toThrow('signal section is missing');
  });
});

describe('loadConfig — allocation rules', () => {
  it('throws when allocations do not sum to 100', () => {
    write(VALID_YAML.replace('entry_3_allocation_pct: 32.5', 'entry_3_allocation_pct: 30'));
    expect(() => loadConfig(TMP)).toThrow('sum to 100');
  });

  it('throws when an allocation is negative', () => {
    write(VALID_YAML.replace('entry_1_allocation_pct: 32.5', 'entry_1_allocation_pct: -10'));
    expect(() => loadConfig(TMP)).toThrow('entry_1_allocation_pct');
  });
});

describe('loadConfig — range checks', () => {
  it('throws when dvs_gate exceeds 200', () => {
    write(VALID_YAML.replace('dvs_gate: 75', 'dvs_gate: 250'));
    expect(() => loadConfig(TMP)).toThrow('dvs_gate');
  });

  it('throws when breakeven_trigger_points >= hard_profit_exit_points', () => {
    write(VALID_YAML.replace('breakeven_trigger_points: 25', 'breakeven_trigger_points: 33'));
    expect(() => loadConfig(TMP)).toThrow('breakeven_trigger_points must be less than hard_profit_exit_points');
  });

  it('throws when after_two_loss_days >= after_one_loss_day', () => {
    write(VALID_YAML.replace('after_two_loss_days: 0.25', 'after_two_loss_days: 0.5'));
    expect(() => loadConfig(TMP)).toThrow('after_two_loss_days must be less than after_one_loss_day');
  });

  it('throws when daily_risk_pct is 0 or negative', () => {
    write(VALID_YAML.replace('daily_risk_pct: 0.5', 'daily_risk_pct: 0'));
    expect(() => loadConfig(TMP)).toThrow('daily_risk_pct');
  });
});

describe('loadConfig — type checks', () => {
  it('throws when a numeric field is a string', () => {
    write(VALID_YAML.replace('stop_loss_points: 40', 'stop_loss_points: "forty"'));
    expect(() => loadConfig(TMP)).toThrow('stop_loss_points');
  });

  it('throws when watch_dir is empty', () => {
    write(VALID_YAML.replace('watch_dir: "./setups"', 'watch_dir: ""'));
    expect(() => loadConfig(TMP)).toThrow('watch_dir');
  });

  it('throws when config is empty', () => {
    write('');
    expect(() => loadConfig(TMP)).toThrow('empty or not a valid YAML object');
  });
});

describe('loadConfig — execution section', () => {
  it('loads without execution section — auto_execute defaults to absent (false)', () => {
    write(VALID_YAML);
    const cfg = loadConfig(TMP);
    expect(cfg.execution).toBeUndefined();
  });

  it('accepts execution section with auto_execute false (no point_value_eur required)', () => {
    write(VALID_YAML + '\nexecution:\n  auto_execute: false\n');
    const cfg = loadConfig(TMP);
    expect(cfg.execution?.auto_execute).toBe(false);
  });

  it('throws when auto_execute true and point_value_eur is missing', () => {
    write(VALID_YAML + '\nexecution:\n  auto_execute: true\n');
    expect(() => loadConfig(TMP)).toThrow('point_value_eur');
  });

  it('throws when auto_execute true and point_value_eur is zero', () => {
    write(VALID_YAML + '\nexecution:\n  auto_execute: true\n  point_value_eur: 0\n');
    expect(() => loadConfig(TMP)).toThrow('point_value_eur');
  });

  it('accepts valid execution section with auto_execute true', () => {
    write(VALID_YAML + '\nexecution:\n  auto_execute: true\n  point_value_eur: 1\n');
    const cfg = loadConfig(TMP);
    expect(cfg.execution?.auto_execute).toBe(true);
    expect(cfg.execution?.point_value_eur).toBe(1);
  });
});
