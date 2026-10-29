'use strict';
const L=require('./finance-ledger');
function createLedgerReader({now=Date.now}={}){
 const cache=new Map(),pending=new Map();let pause=0;
 async function read(ozon,date,types){
  if(!L.valid(date)||date>L.today(now()))throw Object.assign(Error('Invalid ledger date'),{status:400});
  const old=cache.get(date),ttl=date===L.today(now())?60000:600000;
  if(old&&now()-old.at<ttl)return {...old.data,cache_status:'fresh'};
  if(now()<pause){if(old)return {...old.data,cache_status:'stale',retry_after_seconds:Math.ceil((pause-now())/1000)};throw Object.assign(Error('Ledger cooldown'),{status:429,retry_after_seconds:Math.ceil((pause-now())/1000)})}
  if(pending.has(date))return pending.get(date);
  const task=(async()=>{let last='',rows=[];const cursors=new Set();
   for(let page=0;page<100;page++){
    const d=await ozon('/v1/finance/accrual/by-day',{date,last_id:last});
    if(!Array.isArray(d.accruals)||typeof d.last_id!=='string')throw Error('Invalid ledger response');
    rows.push(...d.accruals);if(rows.length>100000)throw Error('Ledger row limit');
    if(!d.last_id){const data={...L.normalize(rows,types,date),checked_at:new Date(now()).toISOString(),read_only:true,source:'Ozon Seller API /v1/finance/accrual/by-day'};cache.set(date,{at:now(),data});while(cache.size>120)cache.delete(cache.keys().next().value);return {...data,cache_status:'fresh'}}
    if(cursors.has(d.last_id))throw Error('Repeated ledger cursor');cursors.add(d.last_id);last=d.last_id;
   }throw Error('Ledger page limit');
  })().catch(e=>{pause=now()+(e.status===429?Math.max(60,Number(e.retryAfter)||900)*1000:60000);if(old)return {...old.data,cache_status:'stale',upstream_status:e.status||null,retry_after_seconds:Math.ceil((pause-now())/1000)};throw e}).finally(()=>pending.delete(date));
  pending.set(date,task);return task;
 }
 return {read,paused:()=>Math.max(0,Math.ceil((pause-now())/1000))};
}
module.exports={createLedgerReader};
