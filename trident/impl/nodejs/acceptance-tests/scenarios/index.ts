import { scenario as longFull }           from './01-long-full.js';
import { scenario as shortFull }          from './02-short-full.js';
import { scenario as longStoppedOut }     from './03-long-stopped-out.js';
import { scenario as longTimeExit }       from './04-long-time-exit.js';
import { scenario as dvsBlocked }         from './05-dvs-blocked.js';
import { scenario as dvsUnblock }         from './06-dvs-unblock.js';
import { scenario as neutralBiasLong }    from './07-neutral-bias-long.js';
import { scenario as longSmallAccount }   from './08-long-small-account.js';
import { scenario as longMicroAccount }   from './09-long-micro-account.js';

export const scenarios = [
  longFull,
  shortFull,
  longStoppedOut,
  longTimeExit,
  dvsBlocked,
  dvsUnblock,
  neutralBiasLong,
  longSmallAccount,
  longMicroAccount,
];
