document.addEventListener('DOMContentLoaded', async () => {
    // Configuração do Day.js
    dayjs.extend(window.dayjs_plugin_utc);
    dayjs.extend(window.dayjs_plugin_weekOfYear);

    const container = document.getElementById('cal-isolated');
    if (container) {
        await renderCalendarWithData(container, dayjs());
    }
});

async function renderCalendarWithData(container, date) {
    const ganhos = await fetchGanhosDoMes(date.year(), date.month() + 1);
    renderCalendar(container, date, ganhos);
}

async function fetchGanhosDoMes(ano, mes) {
    try {
        // A função getGanhosDoMes já está no escopo global via api.js
        return await window.api.getGanhosDoMes({ ano, mes });
    } catch (error) {
        console.error('Erro ao carregar ganhos:', error);
        // Retorna um array vazio em caso de erro para não quebrar o resto do código
        return [];
    }
}

function renderCalendar(container, date, ganhos) {
    const calendarHtml = `
        <div class="cal-header">
            <h2 class="cal-title">Ganhos de ${date.format('MMMM')}</h2>
            <div>
                <button class="cal-menu" onclick="mudarMes(-1)"><i class="fas fa-chevron-left"></i></button>
                <button class="cal-menu" onclick="mudarMes(1)"><i class="fas fa-chevron-right"></i></button>
            </div>
        </div>
        <div class="cal-summary">
            <div class="cal-amount" id="totalMes">R$ 0,00</div>
            <div class="cal-change up" id="changeMes"><i class="fas fa-arrow-up"></i> +0%</div>
        </div>
        <div class="cal-grid" id="cal-grid">
            <!-- Dias da semana e dias do mês serão inseridos aqui -->
        </div>
    `;

    container.innerHTML = calendarHtml;
    const grid = document.getElementById('cal-grid');

    // Processar e agregar ganhos
    const ganhosPorDia = (ganhos || []).reduce((acc, ganho) => {
        const dia = dayjs(ganho.pagoEm).date();
        acc[dia] = (acc[dia] || 0) + ganho.valor;
        return acc;
    }, {});

    const totalGanhosMes = Object.values(ganhosPorDia).reduce((sum, val) => sum + val, 0);
    document.getElementById('totalMes').textContent = formatCurrency(totalGanhosMes);

    const maxGanho = Math.max(...Object.values(ganhosPorDia), 0);

    renderWeekdays(grid);
    renderDays(grid, date, ganhosPorDia, maxGanho);
}

function renderWeekdays(grid) {
    const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    weekdays.forEach(d => {
        const weekdayEl = document.createElement('div');
        weekdayEl.className = 'cal-weekday';
        weekdayEl.textContent = d;
        grid.appendChild(weekdayEl);
    });
}

function renderDays(grid, date, ganhosPorDia, maxGanho) {
    const start = date.startOf('month').startOf('week');
    const end = date.endOf('month').endOf('week');
    let currentDay = start;

    while (currentDay.isBefore(end) || currentDay.isSame(end, 'day')) {
        const dayEl = createDayElement(currentDay, date, ganhosPorDia, maxGanho);
        grid.appendChild(dayEl);
        currentDay = currentDay.add(1, 'day');
    }
}

function createDayElement(day, currentMonth, ganhosPorDia, maxGanho) {
    const dayEl = document.createElement('div');
    dayEl.className = 'cal-day';

    const isThisMonth = day.month() === currentMonth.month();
    if (isThisMonth) dayEl.classList.add('in-month');
    if (day.isSame(dayjs(), 'day')) dayEl.classList.add('today');

    const ganhoDoDia = isThisMonth ? (ganhosPorDia[day.date()] || 0) : 0;
    const hasIncome = ganhoDoDia > 0;

    let dotHtml = '';
    let tooltipHtml = '';

    if (hasIncome) {
        // O raio mínimo é 2, o máximo é 10. A proporção é baseada no maior ganho do mês.
        const radius = 2 + (ganhoDoDia / maxGanho) * 8;
        const isDimmed = radius < 3;

        dotHtml = `
            <div class="cal-dot">
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                    <circle cx="12" cy="12" r="${radius}" class="${isDimmed ? 'dimmed' : ''}"></circle>
                </svg>
            </div>
        `;

        const formattedValue = formatCurrency(ganhoDoDia);
        tooltipHtml = `<div class="cal-tooltip">${formattedValue} - ${day.format('D/MMM')}</div>`;
    }

    dayEl.innerHTML = `
        ${dotHtml}
        <span class="cal-day-num">${day.date()}</span>
        ${tooltipHtml}
    `;

    return dayEl;
}

async function mudarMes(delta) {
    const container = document.getElementById('cal-isolated');
    const currentMonthStr = container.querySelector('.cal-title').textContent.split(' de ')[1];
    // Dayjs precisa de um formato que ele entenda para parsear o mês em português
    let currentMonth = dayjs(currentMonthStr, 'MMMM', 'pt-br');
    
    currentMonth = currentMonth.add(delta, 'month');
    await renderCalendarWithData(container, currentMonth);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}