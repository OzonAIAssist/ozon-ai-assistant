(function(root,factory){const a=factory(typeof module==='object'&&module.exports?require('./product-analytics'):root.HogarAnalytics);if(typeof module==='object'&&module.exports)module.exports=a;else root.HogarDashboardModel=a;})(typeof window==='object'?window:this,function(A){
 'use strict';
 const num=A.number,inside=(d,r)=>d&&d>=r.from&&d<=r.to;
 function previous(range){const a=new Date(range.from+'T12:00:00Z'),b=new Date(range.to+'T12:00:00Z'),length=Math.round((b-a)/86400000)+1;const end=new Date(a-86400000),start=new Date(end-(length-1)*86400000);return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)}}
 function change(value,before){return num(value)!==null&&num(before)!==null&&before!==0?(value-before)/Math.abs(before)*100:null}
 function adTotals(data){const rows=Array.isArray(data?.rows)?data.rows:null;if(!rows)return {spend:null,revenue:null,complete:false};
  // Daily report includes inactive campaigns too. Duplicate IDs are ambiguous.
  const ids=new Set(),duplicate=rows.some(r=>{const id=String(r.id||'');if(!id||ids.has(id))return true;ids.add(id);return false});
  const known=key=>rows.filter(r=>num(r[key])!==null);
  const sum=key=>known(key).length?known(key).reduce((s,r)=>s+num(r[key]),0):null;
  const spendKnown=known('spend').length,revenueKnown=known('revenue').length;
  const spendComplete=!duplicate&&(data.spend_complete===true||(rows.length>0&&spendKnown===rows.length));
  return {spend:duplicate?null:(sum('spend')??(spendComplete?0:null)),revenue:duplicate?null:sum('revenue'),spendKnown,revenueKnown,rows:rows.length,partial:!spendComplete,complete:spendComplete};
 }
 function build({orders=[],products=[],range,finance=()=>null,hasOrders=false,partial=false,ads=null,checked='',now=new Date()}){
  const s=A.summarize(orders,products,range,finance),a=adTotals(ads),issues=[];
  let newOrders=0,inTransit=0,delivered=0,cancelled=0,unknownDates=0,other=0,adOverlap=false;
  const active=new Set(['awaiting_registration','awaiting_packaging','awaiting_deliver','acceptance_in_progress','sent_by_seller','delivering','last_mile','arbitration']);
  const unique=[...new Map(orders.filter(o=>o.posting_number).map(o=>[o.posting_number,o])).values()];
  for(const o of unique){const created=inside(A.day(o.created_at),range);if(created)newOrders++;
   if(active.has(String(o.status).toLowerCase()))inTransit++;
   if(o.delivered&&!A.day(o.delivered_at))unknownDates++;
   if(created&&String(o.status).toLowerCase()==='cancelled')cancelled++;
   if(!o.delivered||!inside(A.day(o.delivered_at),range))continue;delivered++;
   const f=finance(o),ops=Array.isArray(f?.operations)?f.operations:[];
   if(ops.some(op=>/реклам|advertis|marketing/i.test(op.name||'')))adOverlap=true;
   for(const l of o.products||[]){const ps=products.filter(p=>A.match(p,l));
    const q=num(l.quantity);
    if(ps.length===1){const unitOther=num(ps[0].settings?.other);if(unitOther!==null&&unitOther>=0&&q!==null)other+=unitOther*q;}
   }
  }
  const complete=hasOrders&&!partial&&!unknownDates,finComplete=complete&&s.financeKnown===s.deliveredPostings&&s.contributionKnown===s.deliveredPostings;
  const revenue=complete&&s.deliveredRevenueKnown===s.deliveredLines?s.deliveredRevenue:null;
  if(!hasOrders)issues.push('Заказы ещё не загружены');if(partial)issues.push('Выгрузка заказов неполная');if(unknownDates)issues.push('Не подтверждены даты '+unknownDates+' доставок');
  if(s.unmatched)issues.push('Не заполнена себестоимость или не сопоставлены товары: '+s.unmatched+' поз.');
  if(s.financeKnown<s.deliveredPostings)issues.push('Финансы получены для '+s.financeKnown+' из '+s.deliveredPostings+' доставленных отправлений');
  if(s.acquiringKnown<s.deliveredPostings)issues.push('Эквайринг подтверждён не для всех доставок');
  if(!a.complete)issues.push('Не получены полные рекламные расходы за период');if(adOverlap)issues.push('Требуется сверить пересечение рекламы с удержаниями Ozon');
  const profit=finComplete&&a.complete&&!adOverlap?s.contribution-other-a.spend:null;
  const expenses=profit!==null&&revenue!==null?revenue-profit:null;
  const estimatedProfit=finComplete&&!adOverlap&&a.spend!==null?s.contribution-other-a.spend:null;
  const knownExpenses=s.expenses+s.cost+s.logistics+other+(a.spend??0);
  const first=checked?A.day(new Date(new Date(checked).getTime()-34*86400000)):'';
  return {summary:s,range,ads:a,issues,profit,revenue,expenses,estimatedProfit,estimatedMargin:estimatedProfit!==null&&revenue>0?estimatedProfit/revenue*100:null,knownExpenses:hasOrders?knownExpenses:null,other,tax:0,taxExcluded:true,cost:s.unmatched?null:s.cost,logistics:s.unmatched?null:s.logistics,ozon:s.financeKnown===s.deliveredPostings&&hasOrders?s.expenses:null,acquiring:s.acquiringKnown?s.acquiring:null,
   margin:profit!==null&&revenue>0?profit/revenue*100:null,average:revenue!==null&&delivered>0?revenue/delivered:null,
   newOrders:hasOrders?newOrders:null,inTransit:hasOrders?inTransit:null,delivered:complete?delivered:null,cancelled:hasOrders?cancelled:null,
   previousCovered:!!first&&previous(range).from>first&&!partial,stockAsOf:A.day(now),checked};
 }
 return {build,adTotals,previous,change};
});


