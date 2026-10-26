'use strict';
const {rubles}=require('./acquiring');
const acquiringName=s=>/эквайр|acquir|payment[ ._-]*processing|обработк[аи] платеж|оплат[аыу] карт/i.test(s||'');
function createAcquiringDailyReader(){
 const cache=new Map(),pending=new Map();let queue=Promise.resolve(),pauseUntil=0;
 async function day(ozon,date){const saved=cache.get(date);if(saved&&Date.now()-saved.at<600000)return saved.rows;if(pending.has(date))return pending.get(date);
  const job=queue.catch(()=>{}).then(async()=>{if(Date.now()<pauseUntil)throw Object.assign(Error('Daily finance rate limited'),{status:429});let last='',rows=[];const cursors=new Set();for(let page=0;page<10;page++){const d=await ozon('/v1/finance/accrual/by-day',{date,last_id:last});if(!Array.isArray(d.accruals)||typeof d.last_id!=='string')throw Error('Invalid daily accrual response');rows.push(...d.accruals);if(!d.last_id){cache.set(date,{at:Date.now(),rows});return rows}if(cursors.has(d.last_id))throw Error('Repeated daily accrual cursor');cursors.add(d.last_id);last=d.last_id}throw Error('Daily accrual page limit')}).catch(e=>{if(e.status===429)pauseUntil=Date.now()+900000;throw e});queue=job;pending.set(date,job);try{return await job}finally{pending.delete(date)}
 }
 return async function read(ozon,posting,verification,existing,now=Date.now(),types=new Map()){
  const created=Date.parse(verification.created_at);if(!Number.isFinite(created)||created>now)return {lines:[],complete:false,status:'missing_order_date',unallocated:0,overlap:0};
  const days=[new Date(created).toISOString().slice(0,10),...existing.map(x=>String(x.accrual_date||'').slice(0,10)),new Date(now).toISOString().slice(0,10)].filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Date.parse(d)<=now);
  const dates=[...new Set(days)].slice(0,7),base=posting.replace(/-\d+$/,''),unsplit=Array.isArray(verification.related_posting_numbers)&&verification.related_posting_numbers.every(n=>n===posting)&&verification.parent_posting_number==='';
  const seen=new Set(),lines=[];let unallocated=0,overlap=0;
  for(const date of dates){const rows=await day(ozon,date);for(const row of rows){const origin=String(row.unit_number||'');if(origin!==posting&&origin!==base)continue;const fees=[...(row.container_fees?.fees||[]),...(row.item_fees?.fees||[]).flatMap(x=>(x.fees||[]).map(f=>({...f,sku:x.sku}))),...(row.non_item_fee?[row.non_item_fee]:[])];
   for(let i=0;i<fees.length;i++){const f=fees[i],typeId=String(f.type_id??''),label=types.get(typeId);if(!acquiringName(label))continue;const amount=rubles(f.accrued);if(row.accrual_id==null||!/^\d+$/.test(String(row.accrual_id))||amount===null||f.accrued?.currency!=='RUB')continue;
    const key=[row.accrual_id,typeId,f.sku??'',i].join(':');if(seen.has(key))continue;seen.add(key);if(origin===base&&!unsplit){unallocated++;continue}
    if(existing.some(x=>String(x.type_id)===typeId&&rubles(x.accrued)===amount&&String(x.accrual_date||'').slice(0,10)===String(row.date||date).slice(0,10))){overlap++;continue}
    lines.push({id:'daily-acquiring-'+key,date:String(row.date||date),name:'Эквайринг',amount,type_id:typeId,source:'Ozon Seller API /v1/finance/accrual/by-day',source_posting_number:origin,sku:f.sku==null?null:String(f.sku),currency:'RUB',is_acquiring:true,seller_price:null,quantity:null,services:[]});
   }
  }}
  return {lines,complete:lines.length>0&&!unallocated&&!overlap,status:unallocated?'unallocated_parent':overlap?'unresolved_overlap':lines.length?'ok':'not_found_in_checked_days',unallocated,overlap,checked_days:dates};
 };
}
module.exports={createAcquiringDailyReader};
