/**
 * cleanupReports — remove pastas de fotos com mais de 7 dias em bot/reports/
 * Executa diariamente às 03:00 BRT.
 */

import { existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { REPORTS_ROOT } from '../services/reportService';

const DAYS_TO_KEEP = 7;

export function runCleanupReports(): void {
  try {
    if (!existsSync(REPORTS_ROOT)) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DAYS_TO_KEEP);
    const cutoffStr = cutoff.toISOString().split('T')[0]; // YYYY-MM-DD

    const folders = readdirSync(REPORTS_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name));

    let removed = 0;
    for (const folder of folders) {
      if (folder.name < cutoffStr) {
        rmSync(join(REPORTS_ROOT, folder.name), { recursive: true, force: true });
        removed++;
      }
    }

    if (removed > 0) console.log(`[CleanupReports] ${removed} pasta(s) removida(s)`);
  } catch (err) {
    console.error('[CleanupReports] Erro na limpeza:', err);
  }
}

/** Agenda a limpeza diária às 03:00 BRT (06:00 UTC). */
export function scheduleCleanupReports(): void {
  runCleanupReports(); // executa imediatamente no startup

  const msUntilNext03h = (): number => {
    const now  = new Date();
    const next = new Date();
    // 03:00 BRT = 06:00 UTC
    next.setUTCHours(6, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
  };

  const scheduleNext = () => {
    setTimeout(() => {
      runCleanupReports();
      setInterval(runCleanupReports, 24 * 60 * 60 * 1000);
    }, msUntilNext03h());
  };

  scheduleNext();
  console.log('[CleanupReports] Agendado para 03:00 BRT diariamente');
}
