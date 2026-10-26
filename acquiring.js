'use strict';
// Read only: bank acquiring transactions; never estimate a percentage.
const ACQUIRING_TYPE='MarketplaceRedistributionOfAcquiringOperation';
function rubles(value){
 const raw=value&&typeof value==='object'?value.amount:value;
 if((typeof raw!=='string'&&typeof raw!=='number')||String(raw).trim()==='')return null;
 const n=Number(raw);return Number.isFinite(n)?Math.round(n*100)/100:null;
}
function verificationFromPosting(item){
 return {created_at:item.created_at||item.order_date||item.in_process_at||'',skus:(Array.isArray(item.products)?item.products:[]).map(p=>String(p.sku??p.product_id??'')).filter(Boolean),related_posting_numbers:Array.isArray(item.related_postings?.related_posting_numbers)?item.related_postings.related_posting_numbers.map(String):null,parent_posting_number:typeof item.parent_posting_number==='string'?item.parent_posting_number:null};
}
function acquiringMonths(created,now){
 const start=new Date(created),end=new Date(now);
 if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start>end||end-start>93*86400000)return [];
 // Include the order's whole UTC month, since payment can predate processing.
 const cursor=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),1)),ranges=[];
 while(cursor<=end){
  const next=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,1));
  ranges.push({from:cursor.toISOString(),to:new Date(Math.min(next.getTime()-1,end.getTime())).toISOString()});
  cursor.setTime(next.getTime());
 }
 return ranges;
}
function normalizeAcquiring(operations,posting,verification,existing=[]){
 const base=posting.replace(/-\d+$/,''),seen=new Set(),lines=[];
 let unallocated=0,overlap=0;
 const ownSkus=new Set(verification.skus||[]);
 const signatures=new Map(),conflicts=new Set();
 for(const op of operations){
  if(op?.operation_type!==ACQUIRING_TYPE||op.operation_id==null)continue;
  const id=String(op.operation_id),signature=JSON.stringify([op.posting?.posting_number,op.operation_date,rubles(op.amount)]);
  if(signatures.has(id)&&signatures.get(id)!==signature)conflicts.add(id);
  signatures.set(id,signature);
 }
 overlap+=conflicts.size;
 const unsplit=Array.isArray(verification.related_posting_numbers)&&verification.related_posting_numbers.every(n=>n===posting)&&verification.parent_posting_number==='';
 for(const op of operations){
  if(!op||op.operation_type!==ACQUIRING_TYPE)continue;
  const origin=String(op.posting?.posting_number||'');
  if(origin!==posting&&origin!==base)continue;
  const items=Array.isArray(op.items)?op.items:[];
  const itemSkus=items.map(p=>String(p.sku??'')).filter(Boolean);
  if(origin===base&&(!unsplit||!itemSkus.length||!itemSkus.every(s=>ownSkus.has(s)))){unallocated++;continue;}
  const id=op.operation_id;
  if(conflicts.has(String(id)))continue;
  const amount=rubles(op.amount);
  if(id==null||!/^\d+$/.test(String(id))||(typeof id==='number'&&!Number.isSafeInteger(id))||amount===null||(op.currency&&op.currency!=='RUB'))continue;
  const key=String(id);if(seen.has(key))continue;seen.add(key);
  const date=String(op.operation_date||'');
  // No cross-source IDs in accruals: an unresolved same-day/amount overlap is
  // excluded instead of risking a duplicate debit. Never match by amount alone.
  const possiblyIncluded=existing.some(x=>rubles(x.accrued)===amount&&String(x.accrual_date||x.date||'').slice(0,10)===date.slice(0,10)&&date.slice(0,10).length===10&&(!x.sku||itemSkus.includes(String(x.sku))));
  if(possiblyIncluded){overlap++;continue;}
  lines.push({id:'acquiring-'+key,date,name:'Эквайринг',amount,type_id:ACQUIRING_TYPE,operation_id:key,source:'Ozon Seller API /v3/finance/transaction/list',source_posting_number:origin,sku:itemSkus.length===1?itemSkus[0]:null,quantity:null,seller_price:null,currency:'RUB',is_acquiring:true,accruals:null,sale_commission:null,delivery_charge:null,return_delivery_charge:null,services:[]});
 }
 return {lines,unallocated,overlap};
}
async function readAcquiringTransactions(ozon,posting,verification,existing,now=Date.now()){
 const ranges=acquiringMonths(verification.created_at,now);
 if(!ranges.length)return {lines:[],complete:false,status:'missing_order_date',unallocated:0,overlap:0};
 const base=posting.replace(/-\d+$/,''),operations=[];
 for(const date of ranges){
  for(let page=1;page<=10;page++){
   const response=await ozon('/v3/finance/transaction/list',{filter:{date,operation_type:[ACQUIRING_TYPE],posting_number:base,transaction_type:'all'},page,page_size:1000});
   const result=response.result;
   if(!result||!Array.isArray(result.operations)||!Number.isInteger(result.page_count)||result.page_count<0)throw Error('Invalid acquiring transaction response');
   operations.push(...result.operations);
   if(page>=result.page_count)break;
   if(page===10)throw Error('Acquiring transaction page limit');
  }
 }
 const result=normalizeAcquiring(operations,posting,verification,existing);
 return {...result,complete:!result.unallocated&&!result.overlap,status:result.unallocated?'unallocated_parent':result.overlap?'unresolved_overlap':'ok'};
}
module.exports={ACQUIRING_TYPE,rubles,verificationFromPosting,acquiringMonths,normalizeAcquiring,readAcquiringTransactions};

