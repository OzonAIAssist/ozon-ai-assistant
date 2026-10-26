'use strict';
// Ozon AI Assistant v0.8 — demo-only pricing safety calculator.
// Does not connect to Ozon or change marketplace prices.
function safePrice(input) {
  const fields = ['cost','logistics','other','profit','commissionPct','adsPct'];
  for (const field of fields) {
    const value = input[field];
    if (value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0) {
      return {status:'blocked',reason:'Заполните все расходы и проценты.'};
    }
  }
  const rate = (Number(input.commissionPct) + Number(input.adsPct)) / 100;
  if (rate >= 1) return {status:'blocked',reason:'Сумма процентных расходов должна быть меньше 100%.'};
  const minimum = Math.ceil((Number(input.cost) + Number(input.logistics) + Number(input.other) + Number(input.profit)) / (1-rate));
  const mode = input.mode;
  if (mode !== 'fixed' && mode !== 'range') return {status:'blocked',reason:'Неизвестный режим.'};
  const rawDesired = mode === 'fixed' ? input.fixed : input.min;
  const desired = Number(rawDesired);
  const upper = Number(input.max);
  if (rawDesired === '' || rawDesired === null || rawDesired === undefined || !Number.isFinite(desired) || desired <= 0 ||
      (mode === 'range' && (input.max === '' || input.max === null || input.max === undefined || !Number.isFinite(upper) || upper <= 0 || upper < desired))) {
    return {status:'blocked',reason:'Проверьте границы цен.'};
  }
  if (mode === 'fixed' && desired < minimum) {
    return {status:'blocked',minimum,requested:desired,reason:'Фиксированная цена ниже безопасного минимума. Сохранение заблокировано.'};
  }
  if (mode === 'range' && minimum > upper) {
    return {status:'blocked',minimum,reason:'Безопасная цена выше максимума: изменение заблокировано.'};
  }
  const effective = Math.max(minimum,desired);
  return {status:effective > desired ? 'raised' : 'ok',minimum,effective,requested:desired,
    reason:effective > desired ? 'Расчётная нижняя граница повышена до безопасного минимума.' : 'Цена не ниже безопасного минимума.'};
}
if (typeof module !== 'undefined') module.exports = {safePrice};

