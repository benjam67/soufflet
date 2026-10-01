import { test } from 'vitest';
import { simulateMany } from '../../src/logic/simulate';

const N = Number(process.env.SIM_N ?? 1000);

test(`rapport d'équilibrage (${N} matchs × 3 graines)`, () => {
  for (const seed of [1, 2, 3]) {
    const s = simulateMany(N, seed);
    process.stdout.write(
      `graine ${seed} : Bernard ${(s.winRate.bernard * 100).toFixed(1)} % · Lola ${(s.winRate.lola * 100).toFixed(1)} % · ` +
        `${s.avgSeconds.toFixed(0)} s · ${s.avgTurns.toFixed(1)} tours · ${s.avgRounds.toFixed(2)} rounds · ` +
        `critiques ${(s.critRate * 100).toFixed(0)} % · surchauffes ${(s.selfSlapRate * 100).toFixed(1)} % · chrono ${(s.timeoutRate * 100).toFixed(1)} %\n`,
    );
  }
});
