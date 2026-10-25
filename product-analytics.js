(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HogarAnalytics=api;})(typeof window==='object'?window:this,function(){
 'use strict';
 const number=v=>(typeof v!=='string'&&typeof v!=='number')||v===null||v===undefined||String(v).trim()===''?null:Number.isFinite(Number(v))?Number(v):null;
 const day=v=>{const d=new Date(v);return v&&Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(d):'';};
 function period(key,now=new Date()){
  const to=day(now),d=new Date(to+'T12:00:00Z');let end=to;
  if(key==='yesterday'){d.setUTCDate(d.getUTCDate()-1);end=d.toISOString().slice(0,10)}
  else if(key==='week')d.setUTCDate(d.getUTCDate()-6);
  else if(key==='month')d.setUTCDate(1);
  return {from:d.toISOString().slice(0,10),to:end};
 }
 function settings(p){const s=p?.settings||{};return {cost:number(s.cost),logistics:number(s.logistics)??500};}
 function match(p,line){return !!((line.sku&&[p.ozon_sku,...(Array.isArray(p.ozon_skus)?p.ozon_skus:[])].filter(Boolean).map(String).includes(String(line.sku)))||(p.sku&&line.offer_id&&String(p.sku)===String(line.offer_id)));}
 function mergeProducts(current,items){
  const next=current.map(p=>({...p}));
  for(const item of items){const id=String(item.product_id||'');if(!id)continue;
   let p=next.find(p=>String(p.product_id||'')===id)||next.find(p=>p.sku&&String(p.sku)===String(item.offer_id||''));
   if(!p){p={id:'ozon-'+id,product_id:id,settings:{}};next.push(p)}
   p.product_id=id;p.sku=String(item.offer_id||p.sku||'');p.name=item.name||p.name||p.sku||'Товар '+id;
   if(item.ozon_sku)p.ozon_sku=String(item.ozon_sku);
   if(Array.isArray(item.ozon_skus))p.ozon_skus=item.ozon_skus.map(String);
   if(typeof item.image_url==='string'&&/^https:\/\//i.test(item.image_url))p.image_url=item.image_url;
  }return next;
 }
 const active=new Set(['awaiting_registration','awaiting_packaging','awaiting_deliver','acceptance_in_progress','sent_by_seller','delivering','last_mile','arbitration']);
 function summarize(orders,products,range,finance=()=>null,selected=null){
  const x={orders:0,units:0,cancelled:0,inTransit:0,delivered:0,deliveredPostings:0,revenue:0,revenueKnown:0,revenueLines:0,deliveredRevenue:0,deliveredRevenueKnown:0,deliveredLines:0,expenses:0,acquiring:0,net:0,cost:0,logistics:0,contribution:0,financeKnown:0,contributionKnown:0,acquiringKnown:0,unmatched:0,trend:{}};
  const included=d=>d&&d>=range.from&&d<=range.to;
  const unique=new Map(orders.filter(o=>o?.posting_number).map(o=>[o.posting_number,o]));
  for(const o of unique.values()){
   const lines=Array.isArray(o.products)?o.products:[],chosen=selected?lines.filter(l=>match(selected,l)):lines;if(!chosen.length)continue;
   const created=day(o.created_at),delivered=o.delivered&&included(day(o.delivered_at));
   const f=finance(o),ops=Array.isArray(f?.operations)?f.operations:null;
   const price=l=>number(l.price)??number(ops?.find(op=>String(op.sku||'')===String(l.sku||'')&&number(op.seller_price)!==null)?.seller_price);
   const quantity=l=>{const q=number(l.quantity);return q!==null&&q>0?q:0};
   if(included(created)){
    x.orders++;x.trend[created]=(x.trend[created]||0)+1;
    const count=chosen.reduce((s,l)=>s+quantity(l),0);x.units+=count;
    if(String(o.status).toLowerCase()==='cancelled')x.cancelled+=count;
    else{for(const l of chosen){x.revenueLines++;const p=price(l);if(p!==null){x.revenue+=p*quantity(l);x.revenueKnown++}}}
    if(active.has(String(o.status).toLowerCase()))x.inTransit+=count;
   }
   if(!delivered)continue;
   x.deliveredPostings++;x.deliveredLines+=chosen.length;
   x.delivered+=chosen.reduce((s,l)=>s+quantity(l),0);
   let sales=0,pricesComplete=true,costComplete=true,cost=0,logistics=0;
   for(const l of chosen){const p=price(l),q=quantity(l);if(p===null)pricesComplete=false;else{x.deliveredRevenue+=p*q;x.deliveredRevenueKnown++;sales+=p*q}
    const candidates=products.filter(p=>match(p,l)),product=selected|| (candidates.length===1?candidates[0]:null);
    const s=product?settings(product):null;if(!s||s.cost===null){costComplete=false;x.unmatched++}else cost+=s.cost*q;
    if(s)logistics+=s.logistics*q;else costComplete=false;
   }
   x.cost+=cost;x.logistics+=logistics;
   // Finance belongs to a posting. A mixed-product fee cannot be assigned to one SKU safely.
   const assignable=!selected||lines.every(l=>match(selected,l));
   const amounts=ops?.map(op=>op.amount),complete=assignable&&amounts?.length&&amounts.every(v=>typeof v==='number'&&Number.isFinite(v));
   if(complete){x.financeKnown++;const net=amounts.reduce((s,v)=>s+v,0);x.net+=net;x.expenses+=amounts.filter(v=>v<0).reduce((s,v)=>s-v,0);
    const acq=ops.filter(op=>op.is_acquiring||/эквайр|acquir/i.test(op.name||''));if(acq.length){x.acquiringKnown++;x.acquiring-=acq.reduce((s,op)=>s+op.amount,0)}
    if(pricesComplete&&costComplete&&acq.length){x.contributionKnown++;x.contribution+=sales+net-cost-logistics;}
   }
  }
  return x;
 }
 return {number,day,period,settings,match,mergeProducts,summarize};
});
