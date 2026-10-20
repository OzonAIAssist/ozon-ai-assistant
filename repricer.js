'use strict';
// Standalone, dependency-free pricing safety engine. Demo only; no Ozon API calls.
function safePrice(input) {
  const fields=['cost','logistics','other','profit','commissionPct','taxPct','adsPct'];
  for (const f of fields) if (!Number.isFinite(Number(input[f])) || Number(input[f])<0 || input[f]==='') return {status:'blocked',reason:'Заполните все расходы и проценты.'};
  const rate=(Number(input.commissionPct)+Number(input.taxPct)+Number(input.adsPct))/100;
  if(rate>=1) return {status:'blocked',reason:'Сумма процентных расходов должна быть меньше 100%.'};
  const minimum=Math.ceil((Number(input.cost)+Number(input.logistics)+Number(input.other)+Number(input.profit))/(1-rate));
  const mode=input.mode;
  if(mode!=='fixed'&&mode!=='range')return {status:'blocked',reason:'Неизвестный режим.'};
  const desired=Number(mode==='fixed'?input.fixed:input.min);
  const upper=Number(input.max);
  if(!Number.isFinite(desired)||desired<=0||(mode==='range'&&(!Number.isFinite(upper)||upper<=0||upper<desired)))return {status:'blocked',reason:'Проверьте границы цен.'};
  if(mode==='range'&&minimum>upper)return {status:'blocked',minimum,reason:'Безопасная цена выше максимума: изменение заблокировано.'};
  const effective=Math.max(minimum,desired);
  return {status:effective>desired?'raised':'ok',minimum,effective,requested:desired,reason:effective>desired?'Цена поднята до безопасного минимума.':'Цена не ниже безопасного минимума.'};
}
if(typeof module!=='undefined')module.exports={safePrice};
