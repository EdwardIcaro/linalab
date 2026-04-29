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
