(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HogarFinanceLedger=factory()})(typeof window==='object'?window:this,function(){
 'use strict';
 const VERSION=1,labels={payout_fee:'Выплаты и расчётное обслуживание',penalty:'Штрафы',customer:'Компенсации покупателям',refund:'Возврат выручки',returns:'Возвраты и невыкупы: услуги',storage:'Складские услуги',disposal:'Вывоз и утилизация',subscription:'Подписки и сервисы',advertising:'Продвижение',acquiring:'Эквайринг',commission:'Комиссии',logistics:'Логистика',compensation:'Компенсации продавцу',transfer:'Движение денег',unknown:'Требует разбора',posting_net:'Итог отправления'};
 const money=v=>{if(!v||typeof v!=='object'||v.currency!=='RUB'||!['number','string'].includes(typeof v.amount)||!String(v.amount).trim())return null;const n=Number(v.amount);if(!Number.isFinite(n)||Math.abs(n)>1e11||Math.abs(n*100-Math.round(n*100))>.0001)return null;return Math.round(n*100)};
 const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 function dates(r){if(!valid(r?.from)||!valid(r?.to)||r.from>r.to)throw Error('Проверьте даты');const n=Math.round((Date.parse(r.to)-Date.parse(r.from))/86400000)+1;if(n>92)throw Error('Не более 92 дней за одну загрузку');return Array.from({length:n},(_,i)=>new Date(Date.parse(r.from+'T12:00:00Z')+i*86400000).toISOString().slice(0,10))}
 const clean=s=>String(s??'').replace(/[\u0000-\u001f]/g,' ').slice(0,300);
 function classify(name){const s=String(name||'').toLowerCase();
  // Unknown labels remain unresolved. A negative sign alone never means expense.
  if(/обеспечитель|резервировани[ея] средств|пополнение баланса|перечисление (?:денежных )?средств|вывод (?:денежных )?средств|погашение (?:основного долга|тела кредита)/.test(s))return 'transfer';
  if(/(?:услуг|плат[аыу]|комисси).*(?:досрочн.*выплат|гибк.*график.*выплат|ежедневн.*выплат|еженедельн.*выплат)|комисси.*(?:выплат|расч[её]тн.*обслужив)/.test(s))return 'payout_fee';
  if(/декомпенсац|компенсац.*(?:утрат|утер|поврежд)|возмещени.*(?:утрат|утер|поврежд)/.test(s))return 'compensation';
  if(/компенсац.*(?:покупател|клиент)|частичн.*(?:возврат|компенсац)|возмещени.*(?:покупател|клиент)/.test(s))return 'customer';
  if(/возврат (?:выручки|стоимости товара|суммы продажи)|refund.*sale/.test(s))return 'refund';
  if(/штраф|неустойк|пени\b/.test(s))return 'penalty';
  if(/утилизац|вывоз/.test(s))return 'disposal';
  if(/возврат|невыкуп|отмен/.test(s))return 'returns';
  if(/эквайр|acquir|обработк.*платеж/.test(s))return 'acquiring';
  if(/premium|подписк|премиум/.test(s))return 'subscription';
  if(/реклам|продвижени|advertis|marketing/.test(s))return 'advertising';
  if(/размещени|хранени|кросс.док|при[её]мк|перемещени.*склад/.test(s))return 'storage';
  if(/комисси|вознаграждение за продаж/.test(s))return 'commission';
  if(/логист|доставк|обработка отправления|drop.off/.test(s))return 'logistics';
  return 'unknown';
 }
 function normalize(rows,types,date){if(!valid(date)||!Array.isArray(rows))throw Error('Неверная схема начислений');const result=[],seen=new Map(),issues=[];
  for(const row of rows){
   const id=String(row?.accrual_id??'');if(!/^\d+$/.test(id)||(typeof row.accrual_id==='number'&&!Number.isSafeInteger(row.accrual_id)))throw Error('Нет точного ID начисления');
   if(row.date!==date)throw Error('Начисление вне запрошенного дня');
   const total=money(row.total_amount);if(total===null)throw Error('Нет подтверждённой суммы RUB');
   const category=String(row.accrued_category||''),posting=clean(row.unit_number),lines=[];
   const add=(f,sku,scope)=>{if(!f||f.type_id==null)throw Error('Нет типа детализации');const cents=money(f.accrued);if(cents===null)throw Error('Нет подтверждённой суммы детализации');const type=String(f.type_id);if(!/^\d+$/.test(type))throw Error('Неверный ID типа начисления');const name=clean(types.get(type)||'Неизвестный тип '+type);lines.push({id:id+':'+lines.length,accrual_id:id,date,posting,sku:sku==null?null:clean(sku),type_id:type,name,category:classify(name),cents,scope})};
   if(row.non_item_fee)add(row.non_item_fee,null,'non_item');
   const items=row.item_fees?.fees;if(items!=null&&!Array.isArray(items))throw Error('Неверная детализация товаров');for(const item of items||[]){if(!Array.isArray(item.fees))throw Error('Неверные услуги товара');for(const f of item.fees)add(f,item.sku,'item')}
   const containers=row.container_fees?.fees;if(containers!=null&&!Array.isArray(containers))throw Error('Неверная детализация контейнера');for(const f of containers||[])add(f,null,'container');
   if(row.posting!=null){if(category!=='POSTING'||lines.length)throw Error('Неоднозначное начисление отправления');lines.push({id:id+':net',accrual_id:id,date,posting,sku:null,type_id:null,name:'Итог отправления',category:'posting_net',cents:total,scope:'posting'});}
   if(!lines.length)lines.push({id:id+':unknown',accrual_id:id,date,posting,sku:null,type_id:null,name:'Начисление без подтверждённой детализации',category:'unknown',cents:total,scope:'unknown'});
   if(!Number.isSafeInteger(lines.reduce((s,l)=>s+l.cents,0))||lines.reduce((s,l)=>s+l.cents,0)!==total)throw Error('Итог не совпадает с детализацией');
   const safe={id,date,posting,category,total_cents:total,lines},signature=JSON.stringify(safe);
   if(seen.has(id)){if(seen.get(id)!==signature)throw Error('Конфликт одинаковых ID начислений');continue}seen.set(id,signature);result.push(safe);
   if(lines.some(l=>l.category==='unknown'))issues.push('Не распознано начисление '+id);
  }
  if(!Number.isSafeInteger(result.reduce((s,r)=>s+r.total_cents,0)))throw Error('Превышена точность суммы');
  return {version:VERSION,date,rows:result,issues,total_cents:result.reduce((s,r)=>s+r.total_cents,0),complete:true};
 }
 function reconcile(base,s,days,overrides={},returnReviews={}){
  const range=s.range,required=dates(range),issues=[],all=[],known=required.filter(d=>validateDay(days[d])&&days[d].date===d);let adjustment=0,unknown=0,matched=0,transfers=0,ads=0;const groups={};
  const dateOf=v=>typeof v==='string'?v.slice(0,10):'',inside=d=>valid(d)&&d>=range.from&&d<=range.to;
  const basePostings=new Map((s.orders||[]).filter(o=>o.delivered&&inside(dateOfMoscow(o.delivered_at))).map(o=>[String(o.posting_number),o]));
  const pool=[];for(const [posting,o] of basePostings){const f=s.finance?.(o);for(const op of f?.operations||[]){if(typeof op.amount!=='number'||!Number.isFinite(op.amount))continue;pool.push({posting,origin:String(op.source_posting_number||posting),type:String(op.type_id??''),sku:op.sku==null?null:String(op.sku),date:dateOf(op.date),cents:Math.round(op.amount*100),used:false})}}
  function returnCost(l){const review=returnReviews[l.id];if(review?.signature===signature(l)&&Number.isSafeInteger(review.cost_change_cents)&&Math.abs(review.cost_change_cents)<=1e11&&review.confirmed_at){adjustment+=review.cost_change_cents;l.return_cost=review.cost_change_cents/100;l.status+=' · себестоимость подтверждена вручную'}else{unknown++;l.status+=' · требуется подтвердить изменение себестоимости'}}
  const ids=new Set();for(const date of known)for(const row of days[date].rows||[]){if(ids.has(row.id)){issues.push('Повтор ID в разных днях: '+row.id);unknown++;continue}ids.add(row.id);for(const original of row.lines||[]){let l={...original};if(l.category!=='refund'&&Object.hasOwn(labels,overrides[l.type_id])&&l.type_id!=null&&!['posting_net','unknown'].includes(overrides[l.type_id]))l.category=overrides[l.type_id];l.status='';
   groups[l.category]=(groups[l.category]||0)+l.cents;
   if(l.category==='posting_net'){
    l.status=basePostings.has(l.posting)?'Экономика доставленных заказов':'Требуется сверка продажи/возврата';
    // A net posting total includes sale proceeds. Never add it to sales a second time.
    if(!basePostings.has(l.posting)&&l.cents!==0){unknown++;issues.push('Начисление по отправлению вне доставок периода: '+l.posting)}
   }else if(l.category==='unknown'){l.status='Укажите назначение';unknown++}
   else if(l.category==='transfer'){transfers+=l.cents;l.status='Движение денег, вне прибыли'}
   else if(l.category==='advertising'){ads+=l.cents;l.status='Отдельно: уже используется отчёт Performance'}
   else{
    const candidates=pool.filter(p=>!p.used&&(p.posting===l.posting||p.origin===l.posting)&&p.type===l.type_id&&p.cents===l.cents&&p.date===l.date&&(p.sku===l.sku||p.sku===null&&l.sku===null));
    if(candidates.length===1){candidates[0].used=true;matched++;l.status='Уже учтено в заказе';if(l.category==='refund')returnCost(l)}
    else if(candidates.length>1||l.posting&&[...basePostings.keys()].some(p=>p!==l.posting&&p.startsWith(l.posting+'-'))||basePostings.has(l.posting)&&pool.some(p=>p.posting===l.posting&&p.type===l.type_id&&!p.used)){unknown++;l.status='Неоднозначное пересечение с заказом'}
    else if(basePostings.has(l.posting)&&!s.finance?.(basePostings.get(l.posting))){unknown++;l.status='Сначала загрузите финансы заказа'}
    else if(l.category==='refund'){adjustment+=l.cents;l.status='Возврат выручки';returnCost(l)}
    else if(l.cents!==0){adjustment+=l.cents;l.status='Дополнительная корректировка прибыли'}else l.status='Нулевое начисление';
   }
   all.push(l);
  }}
  if(known.length!==required.length)issues.unshift('Начисления загружены за '+known.length+' из '+required.length+' дней');if(unknown)issues.push('Требуют сверки: '+unknown+' операций');
  const fresh=known.every(d=>days[d].cache_status!=='stale'&&Date.now()-Date.parse(days[d].checked_at)<86400000),complete=known.length===required.length&&unknown===0&&fresh;
  if(known.length&& !fresh)issues.push('Сохранённые начисления требуют обновления');
  const profit=complete&&base.profit!==null?Math.round((base.profit*100+adjustment))/100:null;
  const estimatedBase=base.profit??base.estimatedProfit,estimated=estimatedBase!==null&&known.length?Math.round(estimatedBase*100+adjustment)/100:null;
  return {profit,estimatedProfit:estimated,adjustment:adjustment/100,knownDays:known.length,totalDays:required.length,complete,issues,lines:all,groups:Object.entries(groups).map(([id,cents])=>({id,name:labels[id],amount:cents/100})),matched,transfers:transfers/100,advertising:ads/100};
 }
 function validateDay(d){if(!d||d.version!==VERSION||!valid(d.date)||d.complete!==true||!Array.isArray(d.rows)||!Number.isSafeInteger(d.total_cents))return false;const ids=new Set(),lineIds=new Set();let total=0;for(const r of d.rows){if(!r||!/^\d+$/.test(r.id)||ids.has(r.id)||r.date!==d.date||!Number.isSafeInteger(r.total_cents)||!Array.isArray(r.lines)||!r.lines.length)return false;ids.add(r.id);let sum=0;for(const l of r.lines){if(!l||typeof l.id!=='string'||lineIds.has(l.id)||l.accrual_id!==r.id||l.date!==d.date||!Object.hasOwn(labels,l.category)||!Number.isSafeInteger(l.cents))return false;lineIds.add(l.id);sum+=l.cents}if(!Number.isSafeInteger(sum)||sum!==r.total_cents)return false;total+=r.total_cents}return Number.isSafeInteger(total)&&total===d.total_cents}
 function today(now=Date.now()){return dateOfMoscow(new Date(now).toISOString())}
 function signature(l){return [l.accrual_id,l.date,l.posting,l.sku??'',l.type_id??'',l.cents].join('|')}
 function dateOfMoscow(v){if(!v||!Number.isFinite(Date.parse(v)))return '';return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v))}
 return {VERSION,labels,money,valid,dates,classify,normalize,reconcile,signature,validateDay,today};
});
