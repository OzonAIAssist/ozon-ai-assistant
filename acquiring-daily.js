'use strict';
const {rubles}=require('./acquiring');
const acquiringName=s=>/эквайр|acquir|payment[ ._-]*processing|обработк[аи] платеж|оплат[аыу] карт/i.test(s||'');
function acquiringDates(created,now){
 const start=Date.parse(created),end=new Date(now);if(!Number.isFinite(start)||start>now)return [];
 // Payment fees may precede processing and be posted on a later calendar day.
 const first=new Date(start);first.setUTCHours(0,0,0,0);first.setUTCDate(first.getUTCDate()-1);
 const last=Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),end.getUTCDate());
 if(last-first.getTime()>40*86400000)return [];
 const dates=[];for(let t=first.getTime();t<=last;t+=86400000)dates.push(new Date(t).toISOString().slice(0,10));return dates;
}
function createAcquiringDailyReader(){
 const cache=new Map(),pending=new Map();let queue=Promise.resolve(),pauseUntil=0;
 async function day(ozon,date){const saved=cache.get(date);if(saved&&Date.now()-saved.at<600000)return saved.rows;if(pending.has(date))return pending.get(date);
  const job=queue.catch(()=>{}).then(async()=>{if(Date.now()<pauseUntil)throw Object.assign(Error('Daily finance rate limited'),{status:429});let last='',rows=[];const cursors=new Set();for(let page=0;page<100;page++){const d=await ozon('/v1/finance/accrual/by-day',{date,last_id:last});if(!Array.isArray(d.accruals)||typeof d.last_id!=='string')throw Error('Invalid daily accrual response');rows.push(...d.accruals);if(rows.length>100000)throw Error('Daily accrual size limit');if(!d.last_id){cache.set(date,{at:Date.now(),rows});return rows}if(cursors.has(d.last_id))throw Error('Repeated daily accrual cursor');cursors.add(d.last_id);last=d.last_id}throw Error('Daily accrual page limit')}).catch(e=>{if(e.status===429)pauseUntil=Date.now()+900000;throw e});queue=job;pending.set(date,job);try{return await job}finally{pending.delete(date)}
 }
 return async function read(ozon,posting,verification,existing,now=Date.now(),types=new Map()){
  const dates=acquiringDates(verification.created_at,now);
  if(!dates.length)return {lines:[],complete:false,status:'missing_order_date_or_range',unallocated:0,overlap:0,checked_days:[]};
  if(![...types.values()].some(acquiringName))return {lines:[],complete:false,status:'acquiring_type_unavailable',unallocated:0,overlap:0,checked_days:[]};
  const base=posting.replace(/-\d+$/,''),unsplit=Array.isArray(verification.related_posting_numbers)&&verification.related_posting_numbers.every(n=>n===posting)&&verification.parent_posting_number==='';
  const seen=new Set(),lines=[],checked=[];let unallocated=0,overlap=0,matchedRows=0;
  for(const date of dates){let rows;try{rows=await day(ozon,date)}catch(e){if(e.status!==429)throw e;return {lines:[],complete:false,status:'rate_limited',unallocated,overlap,checked_days:checked,matched_rows:matchedRows,retry_after_seconds:Math.max(1,Math.ceil((pauseUntil-Date.now())/1000))}}checked.push(date);
   for(const row of rows){const origin=String(row.unit_number||'');if(origin!==posting&&origin!==base)continue;matchedRows++;const fees=[...(row.container_fees?.fees||[]),...(row.item_fees?.fees||[]).flatMap(x=>(x.fees||[]).map(f=>({...f,sku:x.sku}))),...(row.posting?.products||[]).flatMap(x=>(x.delivery?.services||[]).map(f=>({...f,sku:x.sku}))),...(row.non_item_fee?[row.non_item_fee]:[])];
   for(let i=0;i<fees.length;i++){const f=fees[i],typeId=String(f.type_id??''),label=types.get(typeId);if(!acquiringName(label))continue;const amount=rubles(f.accrued);if(row.accrual_id==null||!/^\d+$/.test(String(row.accrual_id))||(typeof row.accrual_id==='number'&&!Number.isSafeInteger(row.accrual_id))||amount===null||f.accrued?.currency!=='RUB')continue;
    const key=[row.accrual_id,typeId,f.sku??'',i].join(':');if(seen.has(key))continue;seen.add(key);if(origin===base&&!unsplit){unallocated++;continue}
    if(existing.some(x=>String(x.type_id)===typeId&&rubles(x.accrued)===amount&&String(x.accrual_date||'').slice(0,10)===String(row.date||date).slice(0,10))){overlap++;continue}
    lines.push({id:'daily-acquiring-'+key,date:String(row.date||date),name:'Эквайринг',amount,type_id:typeId,source:'Ozon Seller API /v1/finance/accrual/by-day',source_posting_number:origin,sku:f.sku==null?null:String(f.sku),currency:'RUB',is_acquiring:true,seller_price:null,quantity:null,services:[]});
   }
  }}
  return {lines,complete:lines.length>0&&!unallocated&&!overlap,status:unallocated?'unallocated_parent':overlap?'unresolved_overlap':lines.length?'ok':'not_found_in_checked_days',unallocated,overlap,checked_days:checked,matched_rows:matchedRows};
 };
}
module.exports={createAcquiringDailyReader,acquiringDates};
