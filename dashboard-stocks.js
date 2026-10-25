'use strict';
function number(v){return (typeof v==='number'||typeof v==='string')&&String(v).trim()!==''&&Number.isFinite(Number(v))?Number(v):null}
async function readStocks(ozon){let cursor='';const seenCursors=new Set(),seenProducts=new Set();let available=0,reserved=0,products=0,unknown=0;
 for(let page=0;page<20;page++){
  const data=await ozon('/v4/product/info/stocks',{filter:{visibility:'ALL'},limit:1000,cursor});
  if(!Array.isArray(data.items))throw Error('Unexpected stock response');
  for(const p of data.items){const id=String(p.product_id||'');if(!id||seenProducts.has(id))throw Error('Ambiguous stock product');seenProducts.add(id);products++;
   if(!Array.isArray(p.stocks)){unknown++;continue}const fbs=p.stocks.filter(s=>String(s.type||s.source||'').toLowerCase()==='fbs');
   if(!fbs.length){unknown++;continue}
   for(const stock of fbs){const present=number(stock.present),held=number(stock.reserved);if(present===null||held===null||present<0||held<0||held>present){unknown++;continue}available+=present-held;reserved+=held}
  }
  const next=String(data.cursor||'');if(!next)return {available:unknown?null:available,reserved:unknown?null:reserved,known_available:available,products,unknown,partial:!!unknown,read_only:true,checked_at:new Date().toISOString()};
  if(next===cursor||seenCursors.has(next))throw Error('Repeated stock cursor');seenCursors.add(next);cursor=next;
 }
 throw Error('Stock page limit reached');
}
module.exports={readStocks};
