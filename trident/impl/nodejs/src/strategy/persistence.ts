/**
 * Engine state persistence.
 *
 * Why: `TridentEngine` keeps its entire state in memory. On crash + restart
 * we'd otherwise lose the open position, the daily lock, and the loaded
 * signal — see FAQ Q1. This module serialises a full snapshot to a JSON
 * file on every meaningful transition and restores it on boot.
 *
 * Single writer. Atomic write via tmp + fsync + rename so a crash mid-write
 * can never leave a corrupt file. Snapshots from a prior trading day are
 * discarded on load (fresh start each day — the daily lock is per-day).
 */

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { getLogger } from '../logger.js';
import type { SignalFile, ActiveLevels } from '../signal/types.js';
import type { ActivePosition, EntryLevel, Fill, PositionState, Direction } from './types.js';

const log = getLogger('Persistence');

const SNAPSHOT_VERSION = 1;

/** Today's date as YYYY-MM-DD in the local timezone. */
function todayStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

interface SerializedFill {
  entryNumber: 1 | 2 | 3;
  price: number;
  allocationPct: number;
  filledAt: string;
}

interface SerializedPosition {
  direction: Direction;
  fills: SerializedFill[];
  pendingEntries: EntryLevel[];
  avgEntry: number;
  currentStop: number;
  vwapTarget: number;
  lastFillTime: string;
  breakEvenActive: boolean;
}

export interface EngineSnapshot {
  version: number;
  savedAt: string;
  date: string;
  state: PositionState;
  dailyLocked: boolean;
  currentSignal: SignalFile | null;
  signalFilePath: string | null;
  activeLevels: ActiveLevels | null;
  tradeSetup: EntryLevel[] | null;
  /** Alt entry chain for two-sided (neutral bias) watching. Null once one side triggers. */
  tradeSetupAlt: EntryLevel[] | null;
  position: SerializedPosition | null;
}

export interface HydratedState {
  state: PositionState;
  dailyLocked: boolean;
  currentSignal: SignalFile | null;
  signalFilePath: string | null;
  activeLevels: ActiveLevels | null;
  tradeSetup: EntryLevel[] | null;
  tradeSetupAlt: EntryLevel[] | null;
  position: ActivePosition | null;
}

export interface SnapshotInput {
  state: PositionState;
  dailyLocked: boolean;
  currentSignal: SignalFile | null;
  signalFilePath: string | null;
  activeLevels: ActiveLevels | null;
  tradeSetup: EntryLevel[] | null;
  tradeSetupAlt: EntryLevel[] | null;
  position: ActivePosition | null;
}

export function buildSnapshot(input: SnapshotInput): EngineSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    date: todayStr(),
    state: input.state,
    dailyLocked: input.dailyLocked,
    currentSignal: input.currentSignal,
    signalFilePath: input.signalFilePath,
    activeLevels: input.activeLevels,
    tradeSetup: input.tradeSetup,
    tradeSetupAlt: input.tradeSetupAlt,
    position: input.position ? serializePosition(input.position) : null,
  };
}

function serializePosition(p: ActivePosition): SerializedPosition {
  return {
    direction: p.direction,
    fills: p.fills.map(f => ({
      entryNumber: f.entryNumber,
      price: f.price,
      allocationPct: f.allocationPct,
      filledAt: f.filledAt.toISOString(),
    })),
    pendingEntries: p.pendingEntries,
    avgEntry: p.avgEntry,
    currentStop: p.currentStop,
    vwapTarget: p.vwapTarget,
    lastFillTime: p.lastFillTime.toISOString(),
    breakEvenActive: p.breakEvenActive,
  };
}

function deserializePosition(p: SerializedPosition): ActivePosition {
  const fills: Fill[] = p.fills.map(f => ({
    entryNumber: f.entryNumber,
    price: f.price,
    allocationPct: f.allocationPct,
    filledAt: new Date(f.filledAt),
  }));
  return {
    direction: p.direction,
    fills,
    pendingEntries: p.pendingEntries,
    avgEntry: p.avgEntry,
    currentStop: p.currentStop,
    vwapTarget: p.vwapTarget,
    lastFillTime: new Date(p.lastFillTime),
    breakEvenActive: p.breakEvenActive,
    entrySignalFilePath: (p as any).entrySignalFilePath ?? '',
    entrySignal: (p as any).entrySignal ?? null,
  };
}

/**
 * Atomic write: write to `<path>.tmp`, fsync, rename over the target.
 * A crash between any two steps leaves either the old file intact or
 * nothing to clean up on next boot.
 */
export function saveSnapshot(path: string, snapshot: EngineSnapshot): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = `${path}.tmp`;
  const json = JSON.stringify(snapshot, null, 2);
  writeFileSync(tmp, json, 'utf8');
  const fd = openSync(tmp, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  log.debug('Snapshot saved', { path, state: snapshot.state, hasPosition: snapshot.position !== null });
}

/**
 * Load a snapshot, or return null if:
 *   - the file does not exist
 *   - the file is unparseable or malformed
 *   - the snapshot version does not match
 *   - the snapshot is from a previous calendar day (fresh start per day)
 */
export function loadSnapshot(path: string): HydratedState | null {
  if (!existsSync(path)) return null;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    log.error('Failed to read snapshot file', { path, error: (err as Error).message });
    return null;
  }

  let parsed: EngineSnapshot;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.error('Snapshot file is not valid JSON — ignoring', { path, error: (err as Error).message });
    return null;
  }

  if (parsed.version !== SNAPSHOT_VERSION) {
    log.warn('Snapshot version mismatch — ignoring', { path, found: parsed.version, expected: SNAPSHOT_VERSION });
    return null;
  }

  const today = todayStr();
  if (parsed.date !== today) {
    log.info('Snapshot is from a previous trading day — starting fresh', { snapshotDate: parsed.date, today });
    return null;
  }

  log.info('Restoring engine state from snapshot', {
    savedAt: parsed.savedAt,
    state: parsed.state,
    dailyLocked: parsed.dailyLocked,
    hasPosition: parsed.position !== null,
  });

  return {
    state: parsed.state,
    dailyLocked: parsed.dailyLocked,
    currentSignal: parsed.currentSignal,
    signalFilePath: parsed.signalFilePath,
    activeLevels: parsed.activeLevels,
    tradeSetup: parsed.tradeSetup,
    tradeSetupAlt: parsed.tradeSetupAlt ?? null,  // null in older snapshots
    position: parsed.position ? deserializePosition(parsed.position) : null,
  };
}

export function clearSnapshot(path: string): void {
  if (existsSync(path)) {
    unlinkSync(path);
    log.info('Snapshot file cleared', { path });
  }
}
