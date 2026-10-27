(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./product-analytics'),require('./dashboard-model-cache-v1'));else root.HogarDesignAnalytics=factory(root.HogarAnalytics,root.HogarDashboardModel)})(typeof window==='object'?window:this,function(A,M){
 'use strict';
 const day=A.day,num=A.number,shift=(s,n)=>new Date(Date.parse(s+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 const valid=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;const t=Date.parse(s+'T12:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s};
 function dates(r){if(!valid(r?.from)||!valid(r?.to)||r.from>r.to)throw Error('Проверьте даты периода');const n=Math.round((Date.parse(r.to)-Date.parse(r.from))/86400000)+1;if(n>366)throw Error('Максимальный период — 366 дней');return Array.from({length:n},(_,i)=>shift(r.from,i))}
 function period(key,now=new Date()){const to=day(now);return {from:key==='month'?to.slice(0,8)+'01':shift(to,-Number(key)+1),to}}
 function comparison(r,key,custom){const n=dates(r).length;if(key==='custom'){dates(custom);return {...custom}}if(key==='year'){const back=s=>{const y=Number(s.slice(0,4))-1,m=Number(s.slice(5,7)),d=Math.min(Number(s.slice(8)),new Date(Date.UTC(y,m,0)).getUTCDate());return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')};return {from:back(r.from),to:back(r.to)}}return {from:shift(r.from,-n),to:shift(r.from,-1)}}
 function money(v,compact=false){if(num(v)===null)return 'Нет данных';v=Number(v);const n=Math.abs(v);return (compact&&n>=1e6?(v/1e6).toLocaleString('ru-RU',{maximumFractionDigits:2})+' млн':compact&&n>=1e5?(v/1000).toLocaleString('ru-RU',{maximumFractionDigits:2})+' тыс.':v.toLocaleString('ru-RU',{maximumFractionDigits:2}))+'\u00a0₽'}
 function covered(s,r){const end=s?.checked?day(s.checked):'';return !!s?.hasOrders&&!s.partial&&!!end&&r.from>=shift(end,-34)&&r.to<=end}
 function build(s,r,ads=null){
  dates(r);const coverage=covered(s,r),m=M.build({...s,range:r,partial:!!s?.partial||!coverage,ads});
  const series=m.revenue===null?[]:dates(r).map(d=>({date:d,value:M.build({...s,range:{from:d,to:d},ads:null}).revenue}));
  const top=coverage&&(s?.products||[]).map(p=>{const summary=A.summarize(s.orders||[],s.products||[],r,s.finance,p);return {id:String(p.id),name:p.short_name||p.name||p.sku||'Товар',sku:p.sku||'',revenue:m.revenue!==null&&summary.deliveredRevenueKnown===summary.deliveredLines?summary.deliveredRevenue:null,orders:summary.deliveredPostings,units:summary.delivered,contribution:summary.financeKnown===summary.deliveredPostings&&summary.contributionKnown===summary.deliveredPostings?summary.contribution:null}}).filter(x=>x.orders>0)||[];
  const fees={commission:0,logistics:0,returns:0};let feeKnown=coverage&&m.ozon!==null;
  for(const o of s?.orders||[]){const d=day(o.delivered_at);if(!o.delivered||d<r.from||d>r.to)continue;const ops=s.finance?.(o)?.operations;if(!Array.isArray(ops)||!ops.length||ops.some(x=>num(x.amount)===null)){feeKnown=false;continue}for(const x of ops){const name=String(x.name||''),debit=x.amount<0?-x.amount:0;if(/комисс|вознаграждение|SaleCommission/i.test(name))fees.commission+=debit;if(/логист|доставк|Logistic/i.test(name))fees.logistics+=debit;if(/возврат|return/i.test(name))fees.returns+=debit}}
  if(!feeKnown)Object.keys(fees).forEach(k=>fees[k]=null);
  const issues=[...m.issues];if(!coverage)issues.unshift('Выбранный период не покрыт доступной выгрузкой FBS (до 35 дней).');
  const rows=Array.isArray(ads?.rows)?ads.rows:[],ids=new Set(rows.map(x=>String(x.id))),unique=rows.length>0&&ids.size===rows.length&&!rows.some(x=>!x.id);
  const sum=k=>unique&&rows.every(x=>num(x[k])!==null)?rows.reduce((s,x)=>s+num(x[k]),0):null;
  const detailedAds={...m.ads,orders:sum('orders'),clicks:sum('clicks'),impressions:sum('impressions'),carts:sum('carts')};
  const safe={};if(!coverage)for(const k of ['newOrders','delivered','cancelled','revenue','profit','expenses','margin','average','ozon','acquiring','cost','logistics','other','estimatedProfit','estimatedMargin','knownExpenses'])safe[k]=null;
  return {...m,...safe,ads:detailedAds,loaded:!!s?.hasOrders,coverage,series,top,fees,issues};
 }
 function bucket(rows,kind){const grouped=new Map();for(const r of rows){let k=r.date;if(kind==='week')k=shift(k,-((new Date(k+'T12:00:00Z').getUTCDay()+6)%7));if(kind==='month')k=k.slice(0,7);grouped.set(k,(grouped.get(k)||0)+r.value)}return [...grouped].map(([date,value])=>({date,value}))}
 function comparable(a,b,r,previous){return a.coverage&&b.coverage&&dates(r).length===dates(previous).length}
 function recommendations(m,products){const out=[],missing=(products||[]).filter(p=>A.settings(p).cost===null).length;
  if(missing)out.push({priority:'critical',label:'Критично',title:'Заполните себестоимость',basis:missing+' товаров без себестоимости. Полный расчёт прибыли недоступен.',action:'Открыть каталог',target:'catalog'});
  if(m.ads.spend>0&&m.ads.orders===0)out.push({priority:'attention',label:'Внимание',title:'Проверьте кампании без заказов',basis:'За период есть подтверждённые рекламные расходы и 0 атрибутированных заказов. Причина по этим данным не установлена.',action:'Открыть рекламу',target:'ads'});
  if(m.profit!==null&&m.profit<0)out.push({priority:'critical',label:'Критично',title:'Расходы превышают выручку',basis:'Расчёт по полученным суммам отрицательный. Проверьте расшифровку расходов, не меняя цены вслепую.',action:'Открыть финансы',target:'finances'});
  if(m.loaded&&!m.coverage)out.push({priority:'attention',label:'Внимание',title:'Уточните период анализа',basis:'Выбранные даты выходят за пределы доступной выгрузки. Значения не подменяются нулями.',action:'Открыть заказы',target:'orders'});
  return out;
 }
 return {day,num,valid,shift,dates,period,comparison,money,covered,build,bucket,comparable,recommendations};
});
