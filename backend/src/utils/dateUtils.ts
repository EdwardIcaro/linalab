// Timezone: BRT = UTC-3
const BRT_OFFSET_HOURS = 3;
const BRT_OFFSET_MS = BRT_OFFSET_HOURS * 3600000;

/**
 * Retorna a data atual em BRT como string YYYY-MM-DD.
 * Ex: às 23:30 BRT de 28/04 retorna '2026-04-28' (não '2026-04-29' como daria toISOString())
 */
export function getTodayStrBRT(): string {
  return new Date(Date.now() - BRT_OFFSET_MS).toISOString().split('T')[0];
}

/**
 * Converte uma string de data (YYYY-MM-DD) para o intervalo UTC correspondente
 * ao dia completo em BRT (00:00 a 23:59:59.999 BRT).
 *
 * Ex: '2026-04-28' → { start: 2026-04-28T03:00:00Z, end: 2026-04-29T02:59:59.999Z }
 */
export function getDateRangeBRT(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T03:00:00.000Z`);
  const end   = new Date(start.getTime() + 86400000 - 1); // +24h -1ms
  return { start, end };
}

/** Intervalo de hoje completo em BRT. */
export function getTodayRangeBRT(): { start: Date; end: Date } {
  return getDateRangeBRT(getTodayStrBRT());
}

/**
 * Intervalo de um mês completo em BRT.
 * month é 1-based (1=Jan … 12=Dez).
 */
export function getMonthRangeBRT(year: number, month: number): { start: Date; end: Date } {
  const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const { start } = getDateRangeBRT(startStr);

  // Início do próximo mês em BRT = fim deste mês + 1ms
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const nextStr   = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const end = new Date(getDateRangeBRT(nextStr).start.getTime() - 1);

  return { start, end };
}

/**
 * Intervalo de turno de trabalho baseado no horário de abertura da empresa (em BRT).
 *
 * Replica a lógica de getWorkdayRange do caixaController mas com timezone correto:
 * - Se o horário atual (BRT) ainda não atingiu horarioAbertura, usa o turno do dia anterior.
 * - O turno dura exatamente 24h.
 *
 * Ex: horarioAbertura='07:00', agora=2026-04-28 10:00 BRT
 *   → start=2026-04-28 07:00 BRT (10:00 UTC), end=2026-04-29 06:59:59.999 BRT
 */
/**
 * Janela fixa do dia em BRT: 07:00 → 23:59:59.999 do dia informado.
 * Ordens entre 00:00 e 06:59 ficam fora (pertencem ao dia anterior).
 * Sem dependência de horarioAbertura — usado em relatórios de faturamento.
 *
 * Ex: '2026-04-30' → { start: 2026-04-30T10:00:00Z, end: 2026-05-01T02:59:59.999Z }
 */
export function getFixedDayRangeBRT(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T10:00:00.000Z`); // 07:00 BRT = 10:00 UTC
  const endOfDay = new Date(`${dateStr}T03:00:00.000Z`);
  endOfDay.setTime(endOfDay.getTime() + 86400000 - 1); // 23:59:59.999 BRT
  return { start, end: endOfDay };
}

/** Janela fixa de hoje em BRT (07:00 → 23:59). */
export function getTodayFixedRangeBRT(): { start: Date; end: Date } {
  return getFixedDayRangeBRT(getTodayStrBRT());
}

export function getWorkdayRangeBRT(
  date: Date,
  horarioAbertura: string = '07:00'
): { start: Date; end: Date } {
  const [hours, minutes] = horarioAbertura.split(':').map(Number);

  // Data em BRT
  const brtDateStr = new Date(date.getTime() - BRT_OFFSET_MS).toISOString().split('T')[0];
  const [year, month, day] = brtDateStr.split('-').map(Number);

  // Horário de abertura em UTC: hora BRT + 3h (Date.UTC lida com overflow, ex: 22+3=25 → dia seguinte 01:00)
  const start = new Date(Date.UTC(year, month - 1, day, hours + BRT_OFFSET_HOURS, minutes, 0, 0));

  // Se ainda não chegou no horário de abertura, pertence ao turno do dia anterior
  if (date < start) {
    start.setUTCDate(start.getUTCDate() - 1);
  }

  const end = new Date(start.getTime() + 86400000 - 1);
  return { start, end };
}
