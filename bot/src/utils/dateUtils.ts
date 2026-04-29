// Timezone: BRT = UTC-3
const BRT_OFFSET_HOURS = 3;
const BRT_OFFSET_MS = BRT_OFFSET_HOURS * 3600000;

export function getTodayStrBRT(): string {
  return new Date(Date.now() - BRT_OFFSET_MS).toISOString().split('T')[0];
}

export function getDateRangeBRT(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T03:00:00.000Z`);
  const end   = new Date(start.getTime() + 86400000 - 1);
  return { start, end };
}

export function getTodayRangeBRT(): { start: Date; end: Date } {
  return getDateRangeBRT(getTodayStrBRT());
}

export function getMonthRangeBRT(year: number, month: number): { start: Date; end: Date } {
  const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const { start } = getDateRangeBRT(startStr);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const nextStr   = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const end = new Date(getDateRangeBRT(nextStr).start.getTime() - 1);
  return { start, end };
}

export function getWorkdayRangeBRT(
  date: Date,
  horarioAbertura: string = '07:00'
): { start: Date; end: Date } {
  const [hours, minutes] = horarioAbertura.split(':').map(Number);
  const brtDateStr = new Date(date.getTime() - BRT_OFFSET_MS).toISOString().split('T')[0];
  const [year, month, day] = brtDateStr.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, hours + BRT_OFFSET_HOURS, minutes, 0, 0));
  if (date < start) {
    start.setUTCDate(start.getUTCDate() - 1);
  }
  const end = new Date(start.getTime() + 86400000 - 1);
  return { start, end };
}

/**
 * Janela fixa do dia em BRT: 07:00 → 23:59:59.999 do dia informado.
 * Ordens finalizadas entre 00:00 e 06:59 ficam fora (pertencerão ao dia anterior).
 * Sem dependência de horarioAbertura da empresa.
 *
 * Ex: '2026-04-28' → { start: 2026-04-28T10:00:00Z, end: 2026-04-29T02:59:59.999Z }
 *   (07:00 BRT = UTC+3h → 10:00 UTC | 23:59 BRT = 02:59 UTC do dia seguinte)
 */
export function getFixedDayRangeBRT(dateStr: string): { start: Date; end: Date } {
  // 07:00 BRT = 10:00 UTC do mesmo dia BRT
  const start = new Date(`${dateStr}T10:00:00.000Z`);
  // 23:59:59.999 BRT = fim do dia BRT (03:00 UTC do dia seguinte - 1ms)
  const endOfDay = new Date(`${dateStr}T03:00:00.000Z`);
  endOfDay.setTime(endOfDay.getTime() + 86400000 - 1);
  return { start, end: endOfDay };
}

/** Janela fixa de hoje em BRT (07:00 → 23:59). */
export function getTodayFixedRangeBRT(): { start: Date; end: Date } {
  return getFixedDayRangeBRT(getTodayStrBRT());
}
