'use strict';
const http=require('node:http');
const crypto=require('node:crypto');
const {createBot,rubToMicro,capability}=require('./ads-bot');
const {verificationFromPosting}=require('./acquiring');
const {createAcquiringDailyReader}=require('./acquiring-daily');
const readAcquiringTransactions=createAcquiringDailyReader();
const {readStocks}=require('./dashboard-stocks');
let dashboardStockCache=null,dashboardStockPending=null,dashboardStockPause=0;
let balanceCache=null,balancePending=null,balancePause=0;
const PORT=Number(process.env.PORT||10000);
const CLIENT_ID=process.env.OZON_CLIENT_ID||'';
const API_KEY=process.env.OZON_API_KEY||'';
const ACCESS_TOKEN=process.env.APP_ACCESS_TOKEN||'';
const ALLOWED_ORIGINS=new Set(['https://ozonaiassist.github.io','https://ozon-ai-assistant.onrender.com']);
const API_BASE='https://api-seller.ozon.ru';
const PERFORMANCE_BASE='https://api-performance.ozon.ru';
const PERF_ID=process.env.OZON_PERFORMANCE_CLIENT_ID||'';
const PERF_SECRET=process.env.OZON_PERFORMANCE_CLIENT_SECRET||'';
const MAX_ITEMS=20000;
function cors(origin){return {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'};}
function reply(res,status,body,origin){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...cors(origin)});res.end(JSON.stringify(body));}
function authorized(req){const auth=req.headers.authorization||'';const supplied=auth.startsWith('Bearer ')?auth.slice(7):'';if(!supplied||!ACCESS_TOKEN)return false;const a=Buffer.from(supplied),b=Buffer.from(ACCESS_TOKEN);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
async function fetchJSON(url,options={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),25000);try{const response=await fetch(url,{...options,signal:controller.signal});if(!response.ok){const err=new Error('Upstream HTTP '+response.status);err.status=response.status;throw err;}return await response.json();}finally{clearTimeout(timer);}}
async function ozon(path,body){return fetchJSON(API_BASE+path,{method:'POST',headers:{'Client-Id':CLIENT_ID,'Api-Key':API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});}
function productSkus(item){const sources=Array.isArray(item.sources)?item.sources:[];return [...new Set([item.sku,...sources.filter(s=>!s.shipment_type||/^(?:SHIPMENT_TYPE_)?GENERAL$/i.test(s.shipment_type)).map(s=>s.sku)].filter(v=>v!=null&&/^\d+$/.test(String(v))&&Number(v)>0).map(String))];}
async function products(){let lastId='';const all=[],seen=new Set();while(all.length<MAX_ITEMS){const data=await ozon('/v3/product/list',{filter:{visibility:'ALL'},last_id:lastId,limit:1000});const result=data.result||{};const items=Array.isArray(result.items)?result.items:[];for(const item of items){const id=String(item.product_id??'');if(!id||seen.has(id))continue;seen.add(id);all.push({product_id:id,offer_id:String(item.offer_id??'')});}const next=String(result.last_id||'');if(!next||next===lastId||!items.length)break;lastId=next;}if(all.length>=MAX_ITEMS)throw new Error('Слишком много товаров: достигнут лимит безопасности.');const names=new Map();for(let i=0;i<all.length;i+=1000){const batch=all.slice(i,i+1000);const data=await ozon('/v3/product/info/list',{product_id:batch.map(x=>Number(x.product_id))});for(const item of data.items||[]){names.set(String(item.id??item.product_id),{ozon_sku:productSkus(item)[0]||'',ozon_skus:productSkus(item),name:String(item.name||''),offer_id:String(item.offer_id||''),image_url:String(item.primary_image||(Array.isArray(item.images)?item.images[0]:'')||'')});}}return all.map(item=>({...item,name:names.get(item.product_id)?.name||'',ozon_sku:names.get(item.product_id)?.ozon_sku||'',ozon_skus:names.get(item.product_id)?.ozon_skus||[],offer_id:names.get(item.product_id)?.offer_id||item.offer_id,image_url:names.get(item.product_id)?.image_url||''}));}
function scalar(v){return (typeof v==='string'||typeof v==='number'||typeof v==='boolean')?v:null;}
function limited(v,depth=0){if(depth>2||v==null)return null;if(['string','number','boolean'].includes(typeof v))return typeof v==='string'?v.slice(0,180):v;if(Array.isArray(v))return v.slice(0,8).map(x=>limited(x,depth+1));if(typeof v==='object'){const allowed=['id','type','name','title','value','amount','price','percent','percentage','discount','discount_percent','action_id','action_type','enabled','status','currency_code','index','color','ozon','seller'];const o={};for(const k of allowed){if(Object.prototype.hasOwnProperty.call(v,k))o[k]=limited(v[k],depth+1);}return o;}return null;}
async function priceDiagnostic(offerId){const data=await ozon('/v5/product/info/prices',{filter:{offer_id:[offerId],visibility:'ALL'},limit:1000});const rows=Array.isArray(data.items)?data.items:(Array.isArray(data.result?.items)?data.result.items:[]);const item=rows.find(x=>String(x.offer_id||'')===offerId);if(!item)return {found:false,offer_id:offerId,available_fields:[],seller_prices:{},card_price:null,card_discount:null,coinvest:null};const prices=item.price&&typeof item.price==='object'?item.price:{};const permitted=['price','old_price','marketing_price','marketing_seller_price','min_price','currency_code','vat','declared_price','net_price','retail_price'];const safe={};for(const key of permitted){const val=prices[key]??item[key];if(['string','number'].includes(typeof val))safe[key]=val;}return {found:true,offer_id:offerId,available_fields:Object.keys(item).filter(k=>!['images','primary_image'].includes(k)).sort(),price_fields:Object.keys(prices).sort(),seller_prices:safe,extra_diagnostic:{acquiring:scalar(item.acquiring),marketing_actions:limited(item.marketing_actions),commissions:limited(item.commissions),price_indexes:limited(item.price_indexes)},card_price:null,card_discount:null,coinvest:null,note:'Поля цены покупателя с Ozon Картой, скидки по карте и соинвеста не подтверждены этим методом.'};}
let cachedToken='',tokenExpiry=0;
async function performanceToken(){if(cachedToken&&Date.now()<tokenExpiry-60000)return cachedToken;if(!PERF_ID||!PERF_SECRET)throw new Error('Performance API credentials are not configured');const data=await fetchJSON(PERFORMANCE_BASE+'/api/client/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:PERF_ID,client_secret:PERF_SECRET,grant_type:'client_credentials'})});if(!data.access_token)throw new Error('Performance token missing in response');cachedToken=data.access_token;tokenExpiry=Date.now()+Math.max(120,Number(data.expires_in)||1800)*1000;return cachedToken;}
async function performanceCampaigns(){let token=await performanceToken();const all=[];const ids=new Set();for(let page=1;page<=30;page++){const url=PERFORMANCE_BASE+'/api/client/campaign?page='+page+'&pageSize=100';let data;for(let attempt=0;attempt<2;attempt++){try{data=await fetchJSON(url,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});break;}catch(e){if(e.status!==401||attempt===1)throw e;cachedToken='';token=await performanceToken();}}const list=Array.isArray(data.list)?data.list:(Array.isArray(data.campaigns)?data.campaigns:[]);for(const c of list){const id=String(c.id??'');if(!id||ids.has(id))continue;ids.add(id);all.push({id,name:String(c.title||c.name||''),status:String(c.state||''),type:String(c.advObjectType||''),payment_type:String(c.paymentType||''),autopilot_in_ozon:String(c.productAutopilotStrategy||''),weekly_budget:String(c.weeklyBudget||''),daily_budget:String(c.dailyBudget||''),placement:String(c.placement||''),autopilot:c.autopilot||null});}if(list.length<100)break;if(page===30)throw new Error('Campaign page limit reached');}return all;}
// Campaign-period totals contain add-to-cart counts; daily rows do not promise them.
async function performanceGet(path,query){
 let token=await performanceToken();
 for(let attempt=0;attempt<2;attempt++){
  try{return await fetchJSON(PERFORMANCE_BASE+path+'?'+query,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});}
  catch(e){if(e.status!==401||attempt===1)throw e;cachedToken='';token=await performanceToken();}
 }
}
function performanceRows(data){
 return Array.isArray(data)?data:[data?.rows,data?.data,data?.result?.rows,data?.result?.data,data?.result].find(Array.isArray)||[];
}
function campaignCartTotals(data){
 const rows=performanceRows(data),totals=new Map(),duplicates=new Set();
 const fields=['addToCart','add_to_cart','addToCartCount','add_to_cart_count','cartAdds','cart_adds','addedToCart','cartCount','carts','addToCartQuantity','addToCartTotal','add_to_cart_total','cartAddsCount','toCart'];
 for(const row of rows){
  if(!row||typeof row!=='object')continue;
  const id=String(row.campaignId??row.campaign_id??row.id??row.campaign?.id??'');
  if(!/^\d+$/.test(id))continue;
  // This endpoint returns period totals per campaign, not daily or SKU rows.
  // Never add a repeated campaign total twice or guess which duplicate is right.
  if(totals.has(id)||duplicates.has(id)){totals.delete(id);duplicates.add(id);continue;}
  let carts=null;
  for(const field of fields){
   const raw=row[field];
   if((typeof raw!=='number'&&typeof raw!=='string')||String(raw).trim()==='')continue;
   const value=Number(String(raw).replace(/\s/g,'').replace(',','.'));
   if(Number.isSafeInteger(value)&&value>=0){carts=value;break;}
  }
  totals.set(id,carts);
 }
 const names=x=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x).filter(k=>/^[a-zA-Z_][a-zA-Z_0-9]{0,39}$/.test(k)).slice(0,24):[];
 return {totals,rows:rows.length,duplicates:duplicates.size,top_level_keys:names(data),row_field_names:rows.length?names(rows[0]):[]};
}
async function performanceDaily(from,to){
 const qs=new URLSearchParams({dateFrom:from,dateTo:to});
 const data=await performanceGet('/api/client/statistics/daily/json',qs);
 const rows=performanceRows(data);
 const shapeOf=x=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x).filter(k=>/^[a-zA-Z_][a-zA-Z_0-9]{0,39}$/.test(k)).slice(0,24):[];
 const diagnostic={response_type:Array.isArray(data)?'array':typeof data,
  top_level_keys:shapeOf(data),rows_count:rows.length,
  row_field_names:rows.length?shapeOf(rows[0]):[],
  campaign_id_field_present:rows.some(r=>r&&typeof r==='object'&&['campaignId','campaign_id','id'].some(k=>r[k]!=null)),
  note:'Диагностика показывает только имена полей и количество строк, без значений и ключей. ordersMoney — показатель рекламного отчёта, не подтверждённая выплата.'};
 if(rows.length===0&&diagnostic.top_level_keys.length&&
    !['rows','data','result'].some(k=>diagnostic.top_level_keys.includes(k))){
   diagnostic.warning='Ответ Ozon не похож на ожидаемый массив статистики';
 }
 const groups=new Map();
 const num=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null};
 const pick=(obj,keys)=>{for(const k of keys){if(Object.prototype.hasOwnProperty.call(obj,k)){const n=num(obj[k]);if(n!==null)return n}}return null};
 const aliases={
  spend:['moneySpent','money_spent','spent','expense','cost','money'],
  orders:['orders','ordersCount','orders_count','orderCount','orders_count_total','ordersCountTotal','ordersQty'],
  clicks:['clicks','clickCount','click_count'],
  impressions:['views','impressions','shows','showCount','viewCount','viewsCount','impressionCount','impressionsCount'],
  carts:['addToCart','add_to_cart','addToCartCount','add_to_cart_count','cartAdds','cart_adds','addedToCart','cartCount','carts','addToCartQuantity','addToCartTotal','add_to_cart_total','cartAddsCount'],
  revenue:['revenue','orderSum','ordersSum','orders_sum','sales','salesAmount','attributedRevenue','revenueAmount','ordersMoney','orders_money','ordersAmount','orders_amount','orderRevenue']
 };
 for(const row of rows){
  if(!row||typeof row!=='object')continue;
  const id=String(row.campaignId??row.campaign_id??row.id??row.campaign?.id??'');
  if(!/^\d+$/.test(id))continue;
  const old=groups.get(id)||{id,sums:{},seen:{}};
  for(const [field,keys] of Object.entries(aliases)){
   const value=pick(row,keys);
   if(value!==null){old.sums[field]=(old.sums[field]||0)+value;old.seen[field]=true}
  }
  groups.set(id,old);
 }
 // Join only carts by campaign ID and the exact same date bounds.
 // Do not mix the other campaign totals into the existing daily sums.
 try{
  const report=campaignCartTotals(await performanceGet('/api/client/statistics/campaign/product/json',qs));
  for(const [id,carts] of report.totals){
   if(carts===null)continue;
   const group=groups.get(id)||{id,sums:{},seen:{}};
   group.sums.carts=carts;group.seen.carts=true;groups.set(id,group);
  }
  diagnostic.carts_report={status:'ok',source:'/api/client/statistics/campaign/product/json',rows_count:report.rows,top_level_keys:report.top_level_keys,row_field_names:report.row_field_names,duplicate_campaigns:report.duplicates,campaigns_with_carts:[...report.totals.values()].filter(x=>x!==null).length};
 }catch(e){
  // Optional enrichment must not hide otherwise valid spend, clicks and orders.
  diagnostic.carts_report={status:'unavailable',source:'/api/client/statistics/campaign/product/json',upstream_status:Number.isInteger(e.status)?e.status:null};
 }
 diagnostic.missing_metrics={
  carts:![...groups.values()].some(g=>g.seen.carts),
  orders:![...groups.values()].some(g=>g.seen.orders),
  revenue:![...groups.values()].some(g=>g.seen.revenue)
 };
 const round=n=>Number(n.toFixed(2));
 return {rows:[...groups.values()].map(x=>{
  const value=k=>x.seen[k]?round(x.sums[k]):null;
  const spend=value('spend'),orders=value('orders'),clicks=value('clicks'),impressions=value('impressions'),carts=value('carts'),revenue=value('revenue');
  const ratio=(a,b)=>a!==null&&b!==null&&b>0?round(a/b*100):null;
  return {id:x.id,spend,orders,clicks,impressions,carts,revenue,
   avg_cpc:spend!==null&&clicks!==null&&clicks>0?round(spend/clicks):null,
   ctr:ratio(clicks,impressions),cart_rate:ratio(carts,clicks),order_rate:ratio(orders,clicks),
   drr:ratio(spend,revenue),roas:spend!==null&&revenue!==null&&spend>0?round(revenue/spend):null};
 }),raw_count:rows.length,parsed_count:groups.size,diagnostic};

}
if(!CLIENT_ID||!API_KEY||!ACCESS_TOKEN){console.error('Missing required environment variables: OZON_CLIENT_ID, OZON_API_KEY, APP_ACCESS_TOKEN');process.exit(1);}
// Read-only Ozon Performance cache. In-memory cache is reset when Render restarts.
const PERF_TTL_MS=5*60*1000;
const PERF_429_COOLDOWN_MS=15*60*1000;
const perfCache=new Map();
let perfBlockedUntil=0;
async function cachedPerformance(key,load){
 const now=Date.now();let entry=perfCache.get(key);
 if(entry&&entry.value&&now-entry.updatedAt<PERF_TTL_MS)return {...entry.value,cache_status:'fresh',cached:true,checked_at:new Date(entry.updatedAt).toISOString()};
 if(entry?.pending)return entry.pending;
 if(now<perfBlockedUntil){
  if(entry?.value)return {...entry.value,cache_status:'stale',cached:true,checked_at:new Date(entry.updatedAt).toISOString(),retry_after_seconds:Math.ceil((perfBlockedUntil-now)/1000)};
  const err=new Error('Ozon ограничил частоту запросов (HTTP 429). Повторите позже.');err.status=429;err.retryAfter=Math.ceil((perfBlockedUntil-now)/1000);throw err;
 }
 entry=entry||{};perfCache.set(key,entry);
 const pending=(async()=>{
  try{
   const value=await load();const stamp=Date.now();entry.value=value;entry.updatedAt=stamp;
   return {...value,cache_status:'fresh',cached:false,checked_at:new Date(stamp).toISOString()};
  }catch(err){
   if(err.status===429)perfBlockedUntil=Math.max(perfBlockedUntil,Date.now()+PERF_429_COOLDOWN_MS);
   if(entry.value)return {...entry.value,cache_status:'stale',cached:true,checked_at:new Date(entry.updatedAt).toISOString(),retry_after_seconds:Math.ceil(Math.max(0,perfBlockedUntil-Date.now())/1000)};
   throw err;
  }finally{entry.pending=null;}
 })();entry.pending=pending;return pending;
}
async function deliveryDatesFromReport(from,to){
  const created=await ozon('/v1/report/postings/create',{filter:{processed_at_from:from,processed_at_to:to,delivery_schema:['fbs']},language:'RU'});
  const code=created.result?.code;
  if(typeof code!=='string'||!code)throw new Error('Report code missing');
  let report;
  for(let attempt=0;attempt<60;attempt++){
   const info=await ozon('/v1/report/info',{code});report=info.result;
   if(report?.status==='success'||report?.status==='failed')break;
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(report?.status!=='success')throw new Error('Delivery report is not ready');
   const file=new URL(report.file);
   if(file.protocol!=='https:'||file.username||file.password||file.port||!/(^|\.)ozone?\.ru$/.test(file.hostname))throw new Error('Unexpected report file host');
   const response=await fetch(file,{signal:AbortSignal.timeout(25000),redirect:'error'});
   if(!response.ok)throw Object.assign(new Error('Report download failed'),{status:response.status});
   let csv='',bytes=0;const decoder=new TextDecoder();
   for await(const chunk of response.body){bytes+=chunk.length;if(bytes>2*1024*1024)throw new Error('Report exceeds diagnostic size limit');csv+=decoder.decode(chunk,{stream:true});}
   csv+=decoder.decode();
   const rows=[];let row=[],cell='',quoted=false;
   for(let i=0;i<csv.length;i++){
    const c=csv[i];
    if(c==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&(c===';'||c==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(c==='\n'){rows.push(row);row=[];}}
    else cell+=c;
   }
   if(quoted)throw new Error('Invalid CSV quoting');
   if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
   const header=(rows.shift()||[]).map(x=>x.replace(/^\uFEFF/,'').trim());

 const postingIndex=header.indexOf('Номер отправления'),dateIndex=header.indexOf('Дата доставки');
 if(postingIndex<0||dateIndex<0)throw new Error('Delivery report columns missing');
 const values=new Map(),conflicts=new Set();
 for(const row of rows){
  const id=row[postingIndex],raw=row[dateIndex];
  if(!id||!raw||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw))continue;
  const iso=raw.replace(' ','T')+'Z',stamp=Date.parse(iso);
  if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,19)!==iso.slice(0,19))continue;
  if(values.has(id)&&values.get(id)!==iso)conflicts.add(id);
  values.set(id,iso);
 }
 for(const id of conflicts)values.delete(id);
 return values;
}

// Shared caches/cooldown must survive individual HTTP requests.
const financeCache=new Map();
let financeCooldownUntil=0;
// Financial accruals can arrive after delivery; do not freeze incomplete results for a day.
const FINANCE_TTL=2*60*60*1000;
const deliveryVerificationCache=new Map();
let accrualTypesCache={expires:0,types:new Map(),available:false};
let accrualTypesPending=null;
async function getAccrualTypes(){
 if(accrualTypesCache.expires>Date.now())return accrualTypesCache;
 if(accrualTypesPending)return accrualTypesPending;
 accrualTypesPending=(async()=>{
  try{
   const t=await ozon('/v1/finance/accrual/types',{});
   if(!Array.isArray(t.accrual_types))throw Error('Unexpected accrual type response');
   const types=new Map(t.accrual_types.filter(x=>x&&x.id!=null).map(x=>[String(x.id),String(x.description||x.name||x.type_name||x.title||'').slice(0,140)]));
   accrualTypesCache={expires:Date.now()+6*60*60*1000,types,available:true};
  }catch(e){
   console.warn('Finance type dictionary unavailable:',e.status||e.message);
   accrualTypesCache={expires:Date.now()+15*60*1000,types:new Map(),available:false};
  }
  return accrualTypesCache;
 })();
 try{return await accrualTypesPending}finally{accrualTypesPending=null}
}

async function controlCall(method,path,body){
 const token=await performanceToken(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
 try{const response=await fetch(PERFORMANCE_BASE+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/json','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});if(!response.ok){const e=Error('Ozon control HTTP '+response.status);e.status=response.status;throw e;}const text=await response.text();return text?JSON.parse(text):{};}finally{clearTimeout(timer);}
}
async function controlProducts(id){const all=[];for(let page=1;page<=6;page++){const data=await controlCall('GET','/api/client/campaign/'+id+'/v2/products?page='+page+'&pageSize=100');if(!Array.isArray(data.products))throw Error('Ozon не передал список товаров');all.push(...data.products.map(p=>({sku:String(p.sku||''),bid:String(p.bid||'')})));if(data.products.length<100)return all;}throw Error('Слишком много товаров для управления');}
const controlAdapter={
 campaign:async id=>(await performanceCampaigns()).find(c=>c.id===id),
 products:controlProducts,
 budget:async(id,value)=>{const campaign=await controlAdapter.campaign(id);await controlCall('PATCH','/api/client/campaign/'+id,{weeklyBudget:rubToMicro(value),...(campaign.autopilot?{autopilot:campaign.autopilot}:{})});},
 bids:(id,bids)=>controlCall('PUT','/api/client/campaign/'+id+'/products',{bids}),
 pause:id=>controlCall('POST','/api/client/campaign/'+id+'/deactivate',{}),
 activate:id=>controlCall('POST','/api/client/campaign/'+id+'/activate',{}),
 spend:async(id,today,week)=>{const d=await cachedPerformance('stats:'+today+':'+today,()=>performanceDaily(today,today));const w=await cachedPerformance('stats:'+week+':'+today,()=>performanceDaily(week,today));const day=d.rows?.find(x=>String(x.id)===id),weekly=w.rows?.find(x=>String(x.id)===id);return {daily:day?.spend??null,weekly:weekly?.spend??null,stale:d.cache_status==='stale'||w.cache_status==='stale'};},
 stats:async(id,today)=>{const date=new Date(today+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-1);const end=date.toISOString().slice(0,10);date.setUTCDate(date.getUTCDate()-6);const from=date.toISOString().slice(0,10);const d=await cachedPerformance('stats:'+from+':'+end,()=>performanceDaily(from,end));const row=d.rows?.find(x=>String(x.id)===id);return row?{...row,stale:d.cache_status==='stale'}:null;}
};
const adsBot=createBot({dir:process.env.ADS_CONTROL_DIR||'',enabled:process.env.ADS_CONTROL_ENABLED==='true'&&process.env.ADS_CONTROL_PERSISTENT==='true',adapter:controlAdapter});
adsBot.init().then(()=>adsBot.start()).catch(()=>console.error('Ads control initialization failed'));
// Graceful shutdown releases the persistent-disk lock. An unclean shutdown requires journal review.
process.on?.('SIGTERM',()=>adsBot.close().finally(()=>server.close(()=>process.exit(0))));
async function controlRoute(req,res,url,origin){
 if(!authorized(req))return reply(res,401,{error:'Unauthorized'},origin);
 const id=url.searchParams.get('campaign_id')||'';if(!/^\d{1,20}$/.test(id))return reply(res,400,{error:'Некорректный ID кампании'},origin);
 if(req.method==='GET'){try{const campaign=await controlAdapter.campaign(id);return reply(res,200,{...adsBot.status(id),compatible:!capability(campaign),compatibility_reason:capability(campaign),ozon_strategy:campaign?.autopilot_in_ozon||null},origin);}catch(e){return reply(res,502,{...adsBot.status(id),error:'Не удалось проверить доступность управления в Ozon'},origin);}}
 if(req.method!=='POST')return reply(res,405,{error:'Method not allowed'},origin);
 if(!adsBot.status(id).ready)return reply(res,503,{error:adsBot.status(id).reason,...adsBot.status(id)},origin);
 if(!String(req.headers['content-type']||'').startsWith('application/json'))return reply(res,415,{error:'Требуется JSON'},origin);
 try{let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>20000)return reply(res,413,{error:'Слишком большой запрос'},origin);}const body=JSON.parse(text);if(['enable','stop','reconcile'].includes(body.op)&&body.confirm!==true)return reply(res,400,{error:'Подтвердите применение управления рекламой'},origin);const result=await adsBot.command(body.op,id,body.config);return reply(res,200,result,origin);}catch(e){return reply(res,400,{error:String(e.message).slice(0,300),...adsBot.status(id)},origin);}
}

const routes=new Set(['/api/ads/control','/api/dashboard/balance','/api/dashboard/stocks','/api/products','/api/price-diagnostic','/api/ads/campaigns','/api/ads/statistics','/api/orders','/api/orders/finance','/api/orders/delivery-diagnostic','/api/orders/status-date-check','/api/orders/posting-presence-check']);
const server=http.createServer(async(req,res)=>{const origin=req.headers.origin||'';const allowed=!origin||ALLOWED_ORIGINS.has(origin);const ORIGIN=allowed?origin:'';const path=new URL(req.url||'/','http://localhost');console.log('[request]',req.method,path.pathname,'origin:',origin||'(none)','allowed:',allowed);if(!allowed)return reply(res,403,{error:'Origin not allowed'},ORIGIN);if(req.method==='OPTIONS'){if(!routes.has(path.pathname)&&path.pathname!=='/health')return reply(res,404,{error:'Not found'},ORIGIN);res.writeHead(204,{...cors(ORIGIN),...(path.pathname==='/api/ads/control'?{'Access-Control-Allow-Methods':'GET, POST, OPTIONS'}:{}),'Cache-Control':'no-store'});return res.end();}if(path.pathname==='/health'&&req.method==='GET')return reply(res,200,{status:'ok'},ORIGIN);if(path.pathname==='/api/ads/control')return controlRoute(req,res,path,ORIGIN);if(req.method!=='GET'||!routes.has(path.pathname))return reply(res,404,{error:'Not found'},ORIGIN);if(!authorized(req))return reply(res,401,{error:'Unauthorized'},ORIGIN);

// Balance is the closing balance of the official rolling report, not a payout.
if(path.pathname==='/api/dashboard/balance'){
 if(balanceCache&&Date.now()-balanceCache.at<10*60*1000)return reply(res,200,{...balanceCache.data,cache_status:'fresh'},ORIGIN);
 if(Date.now()<balancePause)return balanceCache?reply(res,200,{...balanceCache.data,cache_status:'stale'},ORIGIN):reply(res,429,{error:'Обновление баланса на паузе после ограничения Ozon',read_only:true},ORIGIN);
 try{
  if(!balancePending)balancePending=(async()=>{
   const end=new Date(),start=new Date(end);start.setUTCDate(start.getUTCDate()-29);
   const report={date_from:start.toISOString().slice(0,10),date_to:end.toISOString().slice(0,10)};
   const d=await ozon('/v1/finance/balance',report),amount=d.total?.closing_balance;
   const value=(typeof amount?.value==='number'||typeof amount?.value==='string')&&String(amount.value).trim()!==''?Number(amount.value):NaN;
   if(!Number.isFinite(value)||!['RUB','RUR'].includes(amount?.currency_code))throw Error('Unconfirmed balance');
   const data={balance:value,currency:'RUB',report,as_of:report.date_to,checked_at:new Date().toISOString(),read_only:true,source:'Ozon Seller API /v1/finance/balance · total.closing_balance',note:'Баланс на конец отчётного периода. Не сумма доступной выплаты и не прибыль.'};
   balanceCache={at:Date.now(),data};return data;
  })().finally(()=>{balancePending=null});
  return reply(res,200,await balancePending,ORIGIN);
 }catch(e){console.warn('Balance unavailable:',Number.isInteger(e.status)?e.status:'unconfirmed_response');balancePause=Date.now()+15*60*1000;if(balanceCache)return reply(res,200,{...balanceCache.data,cache_status:'stale'},ORIGIN);return reply(res,e.status===429?429:502,{error:e.status===403?'Ozon запретил доступ к отчёту баланса':e.status===429?'Ozon ограничил обновление баланса. Повторите позже':'Ozon не передал подтверждённый баланс',read_only:true,retry_after_seconds:900,upstream_status:Number.isInteger(e.status)?e.status:null},ORIGIN)}
}
// Safe read-only delivery diagnosis: no raw Ozon response, buyer data, or credentials exposed.
if(path.pathname==='/api/dashboard/stocks'){
 if(dashboardStockCache&&Date.now()-dashboardStockCache.at<10*60*1000)return reply(res,200,{...dashboardStockCache.data,cache_status:'fresh'},ORIGIN);
 if(Date.now()<dashboardStockPause)return dashboardStockCache?reply(res,200,{...dashboardStockCache.data,cache_status:'stale'},ORIGIN):reply(res,429,{error:'Ozon временно ограничил остатки',read_only:true},ORIGIN);
 try{if(!dashboardStockPending)dashboardStockPending=readStocks(ozon).then(data=>{dashboardStockCache={at:Date.now(),data};return data}).finally(()=>{dashboardStockPending=null});return reply(res,200,await dashboardStockPending,ORIGIN)}
 catch(e){dashboardStockPause=Date.now()+15*60*1000;if(dashboardStockCache)return reply(res,200,{...dashboardStockCache.data,cache_status:'stale'},ORIGIN);return reply(res,e.status===429?429:502,{error:'Не удалось получить остатки FBS',read_only:true},ORIGIN)}
}
if(path.pathname==='/api/orders/delivery-diagnostic'){
 const posting=String(path.searchParams.get('posting')||'');
 if(!/^\d{6,15}-\d{3,6}-\d{1,3}$/.test(posting))return reply(res,400,{error:'Некорректный номер отправления'},ORIGIN);
 try{
  const d=await ozon('/v3/posting/fbs/get',{posting_number:posting,with:{analytics_data:false,financial_data:false}});
  const item=d.result||d;
  const fields={};
  function collect(obj,prefix='',depth=0){
   if(!obj||typeof obj!=='object'||depth>3)return;
   for(const [key,value] of Object.entries(obj)){
    const path=prefix?prefix+'.'+key:key;
    if(/(?:date|_at$|timestamp|status|history|event|change)/i.test(key)){
     if(typeof value==='string'||typeof value==='number'||value===null)fields[path]=value;
     else if(Array.isArray(value))fields[path]='array('+value.length+')';
    }
    if(value&&typeof value==='object'&&!Array.isArray(value)&&!/(?:products|financial|analytics|customer|address|phone|recipient|buyer|cancellation)/i.test(key))collect(value,path,depth+1);
   }
  }
  collect(item);
  const candidates=['delivered_at','delivered_date','delivery.delivered_at','status_changed_at','last_changed_status_date'];
  const confirmed=candidates.map(k=>({field:k,value:k.split('.').reduce((v,part)=>v?.[part],item)})).filter(x=>typeof x.value==='string'&&Number.isFinite(Date.parse(x.value)));
  return reply(res,200,{read_only:true,posting_number:posting,status:String(item.status||''),date_fields:fields,confirmed_candidates:confirmed,diagnostic_note:'Поля показаны для диагностики. Дата вручения подтверждается только после проверки значения в Ozon Seller.'},ORIGIN);
 }catch(e){return reply(res,e.status===429?429:502,{error:'Не удалось получить подробности FBS',upstream_status:e.status||null},ORIGIN)}
}
// Isolated read-only check of the last_changed_status_date filter.
// Read-only comparison: unfiltered FBS list vs individual posting details.
if(path.pathname==='/api/orders/posting-presence-check'){
 const posting='28142819-0371-1';
 const out={read_only:true,posting_number:posting,expected_seller_delivery:'2026-10-23 09:48 МСК',list:{},detail:{}};
 const safeDates=obj=>{
  const fields={};
  const walk=(value,prefix='',depth=0)=>{
   if(!value||typeof value!=='object'||depth>2)return;
   for(const [key,v] of Object.entries(value)){
    if(/customer|buyer|phone|address|recipient|products|financial|analytics|barcode/i.test(key))continue;
    const path=prefix?prefix+'.'+key:key;
    if(/status|substatus|date|time|_at$|history|events/i.test(key)){
     if(typeof v==='string'||typeof v==='number'||v===null)fields[path]=v;
     else if(Array.isArray(v))fields[path]='array('+v.length+')';
    }
    if(v&&typeof v==='object'&&!Array.isArray(v))walk(v,path,depth+1);
   }
  };
  walk(obj);return fields;
 };
 try{
  let cursor='',pages=0,scanned=0,found=null,complete=false;
  const cursors=new Set();
  for(let i=0;i<20;i++){
   const d=await ozon('/v4/posting/fbs/list',{filter:{since:'2026-10-01T00:00:00Z',to:'2026-10-25T00:00:00Z'},limit:100,cursor,sort_dir:'desc',with:{analytics_data:false,financial_data:false}});
   const payload=Array.isArray(d.postings)?d:(d.result&&typeof d.result==='object'?d.result:d);
   const items=payload.postings;
   if(!Array.isArray(items))throw new Error('Unexpected FBS list response');
   pages++;scanned+=items.length;
   found=items.find(x=>String(x.posting_number||'')===posting)||null;
   if(found){complete=true;break;}
   if(!payload.has_next){complete=true;break;}
   const next=String(payload.cursor||'');
   if(!next||next===cursor||cursors.has(next))break;
   cursors.add(next);cursor=next;
  }
  out.list={found:!!found,scanned,pages,complete,filter:'creation period only; no last_changed_status_date',status:found?String(found.status||''):null,date_fields:found?safeDates(found):{}};
 }catch(e){out.list={error:'Не удалось получить список FBS',upstream_status:e.status||null};}
 try{
  const d=await ozon('/v3/posting/fbs/get',{posting_number:posting,with:{analytics_data:false,financial_data:false}});
  const item=d.result||d;
  out.detail={found:!!item?.posting_number,status:String(item?.status||''),date_fields:safeDates(item)};
 }catch(e){out.detail={error:'Не удалось получить подробности FBS',upstream_status:e.status||null};}

 // Diagnostic report probe for this posting only; no finance routes or caches used.
 try{
  const created=await ozon('/v1/report/postings/create',{filter:{processed_at_from:'2026-10-18T00:00:00Z',processed_at_to:'2026-10-19T00:00:00Z',delivery_schema:['fbs']},language:'RU'});
  const code=created.result?.code;
  if(typeof code!=='string'||!code)throw new Error('Report code missing');
  let report;
  for(let attempt=0;attempt<12;attempt++){
   const info=await ozon('/v1/report/info',{code});report=info.result;
   if(report?.status==='success'||report?.status==='failed')break;
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(report?.status!=='success'){
   out.report={source:'/v1/report/postings/create → /v1/report/info',status:report?.status==='failed'?'failed':'pending',found:false};
  }else{
   const file=new URL(report.file);
   if(file.protocol!=='https:'||file.username||file.password||file.port||!/(^|\.)ozone?\.ru$/.test(file.hostname))throw new Error('Unexpected report file host');
   const response=await fetch(file,{signal:AbortSignal.timeout(25000),redirect:'error'});
   if(!response.ok)throw Object.assign(new Error('Report download failed'),{status:response.status});
   let csv='',bytes=0;const decoder=new TextDecoder();
   for await(const chunk of response.body){bytes+=chunk.length;if(bytes>2*1024*1024)throw new Error('Report exceeds diagnostic size limit');csv+=decoder.decode(chunk,{stream:true});}
   csv+=decoder.decode();
   const rows=[];let row=[],cell='',quoted=false;
   for(let i=0;i<csv.length;i++){
    const c=csv[i];
    if(c==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&(c===';'||c==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(c==='\n'){rows.push(row);row=[];}}
    else cell+=c;
   }
   if(quoted)throw new Error('Invalid CSV quoting');
   if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
   const header=(rows.shift()||[]).map(x=>x.replace(/^\uFEFF/,'').trim());
   const postingIndex=header.indexOf('Номер отправления'),dateIndex=header.indexOf('Дата доставки'),statusIndex=header.indexOf('Статус');
   if(postingIndex<0||dateIndex<0||statusIndex<0)throw new Error('Required report columns missing');
   const matches=rows.filter(r=>r[postingIndex]===posting);
   const dates=[...new Set(matches.map(r=>r[dateIndex]).filter(Boolean))];
   const raw=dates.length===1?dates[0]:null;
   const valid=raw&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)&&Number.isFinite(Date.parse(raw.replace(' ','T')+'Z'));
   out.report={source:'/v1/report/postings/create → /v1/report/info',status:'success',found:matches.length>0,matched_rows:matches.length,
    posting_status:matches[0]?.[statusIndex]||null,delivery_date_column:'Дата доставки',delivery_date_raw:raw,
    delivery_date_utc:valid?raw.replace(' ','T')+'Z':null,expected_csv_utc:'2026-10-23T06:48:07Z',
    matches_seller_csv:valid?raw==='2026-10-23 06:48:07':false,
    timezone_note:'UTC verified by comparison with the Seller CSV and processing timestamps; Moscow is UTC+03:00.'};
  }
 }catch(e){out.report={source:'/v1/report/postings/create → /v1/report/info',status:'error',upstream_status:Number.isInteger(e.status)?e.status:null,note:'Report probe failed; no raw response, file URL or credentials returned.'};}
 out.note='Даты отгрузки и fact_delivery_date не считаются подтверждённым временем вручения. Личные данные не возвращаются.';
 out.checked_at=new Date().toISOString();
 return reply(res,200,out,ORIGIN);
}
if(path.pathname==='/api/orders/status-date-check'){
 const posting='28142819-0371-1';
 const sellerDelivery='2026-10-23 09:48 МСК';
 const results=[];
 async function checkWindow(name,from,to){
  let cursor='',found=false,scanned=0,pages=0,hasMore=false,error=null;
  try{
   for(let i=0;i<10;i++){
    const d=await ozon('/v4/posting/fbs/list',{filter:{since:'2026-10-19T00:00:00Z',to:'2026-10-25T00:00:00Z',status:['delivered'],last_changed_status_date:{from,to}},limit:100,cursor,sort_dir:'desc',with:{analytics_data:false,financial_data:false}});
    const payload=Array.isArray(d.postings)?d:(d.result&&typeof d.result==='object'?d.result:d);
    const items=Array.isArray(payload.postings)?payload.postings:null;
    if(!items)throw Object.assign(new Error('Unexpected FBS list format'),{status:502});
    pages++;scanned+=items.length;
    if(items.some(x=>String(x.posting_number||'')===posting)){found=true;break;}
    hasMore=!!payload.has_next;
    const next=String(payload.cursor||'');if(!hasMore||!next||next===cursor)break;
    cursor=next;
   }
  }catch(e){error={upstream_status:e.status||null,reason:e.status===400?'Ozon отклонил параметры фильтра':e.status===429?'Ozon ограничил частоту запросов':'Ошибка запроса Ozon'};}
  const complete=!hasMore&&!error;
  const row={window:name,from,to,found,scanned,pages,complete,error};results.push(row);
  return row;
 }
 // Calendar dates are Moscow local time (UTC+03:00).
 let matchDay=null;
 for(const day of ['21','22','23','24']){
  const from=`2026-10-${day}T00:00:00+03:00`;
  const to=`2026-10-${day}T23:59:59+03:00`;
  const row=await checkWindow(`Весь день ${day} октября МСК`,new Date(from).toISOString(),new Date(to).toISOString());
  if(row.found)matchDay=day;
  if(row.error)break;
 }
 // If a date matched, narrow only that day into six-hour windows.
 if(matchDay&&!results.some(x=>x.error)){
  for(let hour=0;hour<24;hour+=6){
   const from=new Date(`2026-10-${matchDay}T${String(hour).padStart(2,'0')}:00:00+03:00`).toISOString();
   const to=new Date(`2026-10-${matchDay}T${String(hour+5).padStart(2,'0')}:59:59+03:00`).toISOString();
   const row=await checkWindow(`${matchDay} октября, ${String(hour).padStart(2,'0')}:00–${String(hour+6).padStart(2,'0')}:00 МСК`,from,to);
   if(row.error)break;
  }
 }
 return reply(res,200,{read_only:true,posting_number:posting,ozon_seller_delivery:sellerDelivery,source:'/v4/posting/fbs/list · filter.last_changed_status_date',results,interpretation:'Найденный интервал относится к последнему изменению статуса, не обязательно ко времени вручения. Если ни один день не совпал, фильтр не подтверждает дату доставки.',checked_at:new Date().toISOString()},ORIGIN);

}
if(path.pathname==='/api/orders'){
 const days=Math.min(35,Math.max(1,Number(path.searchParams.get('days')||7)||7));
 const since=new Date(Date.now()-(days-1)*86400000).toISOString();
 const to=new Date().toISOString();
 const orders=[];let cursor='',truncated=false;const usedCursors=new Set();
 const safeError=e=>{const code=Number(e.status);return {code:Number.isInteger(code)?code:null,reason:code===429?'Ozon ограничил частоту запросов':code===401?'Ozon не принял ключ Seller API':code===403?'Ozon запретил доступ к FBS для текущего Seller API-ключа; проверьте права ключа в кабинете Ozon':code===400?'Ozon не принял параметры запроса FBS':code===404?'Метод FBS недоступен':'Ошибка запроса FBS к Ozon'};};
 try{
  for(let page=0;page<20;page++){
   const d=await ozon('/v4/posting/fbs/list',{filter:{since,to},limit:100,cursor,sort_dir:'desc',with:{analytics_data:false,financial_data:false}});
   const payload=Array.isArray(d.postings)?d:(d.result&&typeof d.result==='object'?d.result:d);
   const items=Array.isArray(payload.postings)?payload.postings:null;
   if(!items)throw Object.assign(new Error('Неожиданный формат ответа FBS v4'),{status:502});
   for(const x of items){
    const products=Array.isArray(x.products)?x.products.map(p=>({name:String(p.name||p.product_name||''),sku:String(p.sku??p.product_id??''),offer_id:String(p.offer_id??''),quantity:Number(p.quantity||1),price:p.price??null})):[];
    const status=String(x.status||x.status_alias||'');
    const deliveredStatus=['delivered','delivered_to_customer'].includes(status.toLowerCase());
    // The date of the *current delivered status*, never in_process_at or shipment_date.
    // status_changed_at is only used when the current status is delivered.
    const deliveredAt=deliveredStatus?(x.delivered_at||x.delivery_date||x.delivered_date||x.delivery?.delivered_at||x.status_changed_at||null):null;
    const substatus=String(x.substatus||x.sub_status||'');
    orders.push({posting_number:String(x.posting_number||''),order_id:String(x.order_id??''),scheme:'FBS',status,substatus,delivered_at:deliveredAt,delivery_date_source:deliveredAt?(x.status_changed_at===deliveredAt?'fbs_status_changed_at':'fbs_list'):'not_provided',delivered:['delivered','delivered_to_customer'].includes(status.toLowerCase()),created_at:x.in_process_at||x.created_at||'',shipment_date:x.shipment_date||null,products,amount:null,financial_ready:false});
   }
   if(!payload.has_next)break;
   const next=String(payload.cursor||'');
   if(!next||next===cursor||usedCursors.has(next))throw Object.assign(new Error('Ozon не вернул новый курсор следующей страницы'),{status:502});
   usedCursors.add(next);cursor=next;
   if(page===19)truncated=true;
  }
  const seen=new Set();const unique=orders.filter(x=>x.posting_number&&!seen.has(x.posting_number)&&seen.add(x.posting_number)).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  let deliveryDatesStatus='not_requested';
  if(path.searchParams.get('delivery_dates')!=='0'&&unique.some(o=>o.delivered)){
   try{
    const dates=await deliveryDatesFromReport(since,to);
    for(const order of unique){
     if(!order.delivered)continue;
     order.delivered_at=dates.get(order.posting_number)||null;
     order.delivery_date_source=order.delivered_at?'seller_postings_report':'not_provided';
    }
    deliveryDatesStatus='ok';
   }catch(e){
    const knownReasons=new Set(['Report code missing','Delivery report is not ready','Unexpected report file host','Report download failed','Report exceeds diagnostic size limit','Invalid CSV quoting','Delivery report columns missing']);
    console.warn('Delivery dates unavailable:',Number.isInteger(e.status)?e.status:null,knownReasons.has(e.message)?e.message:'Upstream request failed');
    deliveryDatesStatus='unavailable';
    for(const order of unique){if(order.delivered){order.delivered_at=null;order.delivery_date_source='not_provided';}}
   }
  }
  return reply(res,200,{read_only:true,scheme:'FBS',days,orders:unique,partial:truncated,diagnostic:{source:'Ozon Seller API /v4/posting/fbs/list',fbs:'ok',returned:unique.length,truncated,delivery_dates:deliveryDatesStatus},checked_at:new Date().toISOString()},ORIGIN);
 }catch(e){
  const diagnostic=safeError(e);
  console.error('FBS v4 orders read failed:',diagnostic.code||'unknown',diagnostic.reason);
  return reply(res,502,{error:'Не удалось загрузить заказы FBS',diagnostic:{source:'Ozon Seller API /v4/posting/fbs/list',fbs:'error',...diagnostic},read_only:true},ORIGIN);
 }
}
if(path.pathname==='/api/orders/finance'){
 const posting=path.searchParams.get('posting_number')||'';
 const delivered=path.searchParams.get('delivered')==='true';
 if(!/^[a-zA-Z0-9-]{4,90}$/.test(posting))return reply(res,400,{error:'Неверный номер отправления'},ORIGIN);
 if(!delivered)return reply(res,409,{error:'Финансы доступны после доставки заказа'},ORIGIN);
 const cacheKey=posting;const cached=financeCache.get(cacheKey);
 if(cached&&cached.expires>Date.now())return reply(res,200,{...cached.data,cached:true},ORIGIN);
 if(Date.now()<financeCooldownUntil)return reply(res,429,{error:'Ozon временно ограничил финансовые запросы',retry_after_seconds:Math.ceil((financeCooldownUntil-Date.now())/1000),diagnostic:{stage:'Ожидание после 429',code:429,reason:'Повторите после окончания паузы'}},ORIGIN);
 // Verify delivery independently on the server; do not trust the browser flag.
 const verificationCached=deliveryVerificationCache.get(posting);
 let verified=!!verificationCached&&verificationCached.expires>Date.now();
 let verifiedPosting=verified?verificationCached.posting:null;
 let verifiedDeliveryDate=null;
 if(!verified)try{
  const d=await ozon('/v3/posting/fbs/get',{posting_number:posting,with:{analytics_data:false,financial_data:false}});
  verified=['delivered','delivered_to_customer'].includes(String(d.result?.status||d.status||'').toLowerCase());
  if(verified){const item=d.result||d;verifiedPosting=verificationFromPosting(item);verifiedDeliveryDate=item.delivered_at||item.delivery_date||item.delivered_date||item.delivery?.delivered_at||item.status_changed_at||null;}
  if(verified)deliveryVerificationCache.set(posting,{expires:Date.now()+30*60*1000,posting:verifiedPosting});
 }catch(e){console.error('FBS delivery verification failed:',e.message);return reply(res,502,{error:'Не удалось проверить статус доставки через Ozon',diagnostic:{stage:'Проверка доставки FBS',code:Number.isInteger(e.status)?e.status:null,reason:'Проверка статуса не прошла. Финансовые данные не запрашивались.'}},ORIGIN)}
 if(!verified)return reply(res,409,{error:'Ozon не подтвердил статус «Доставлен»',diagnostic:{stage:'Проверка доставки FBS',reason:'Ответ Ozon не содержит подтверждённого статуса доставки'}},ORIGIN);
 // The accrual/postings API accepts shipment numbers, not date ranges.
 // Amounts are signed RUB values. Never infer profit or invent missing accruals.
 try{
  const basePosting=posting.replace(/-\d+$/,'');
  // Fetch independently: some Ozon accounts reject a batch containing both
  // shipment and parent order identifiers. Never let the optional parent lookup
  // prevent the shipment's own financial data from being returned.
  async function readAccruals(number){
   const data=await ozon('/v1/finance/accrual/postings',{posting_numbers:[number]});
   if(!Array.isArray(data.posting_accruals))throw Error('Unexpected finance accrual response shape');
   return data.posting_accruals;
  }
  const ownPostings=await readAccruals(posting);
  const matched=ownPostings.filter(x=>String(x.posting_number||'')===posting);
  const raw=matched.flatMap(x=>Array.isArray(x.accruals)?x.accruals:[]);
  // Parent-order identifiers are not accepted by the accrual/postings method.
  // Acquiring is read separately from bank transaction operations below.
  let parentLookup='not_needed';
  // The type dictionary may be unavailable to this API key; raw type IDs still work.
  const typeInfo=await getAccrualTypes();
  const types=typeInfo.types,types_available=typeInfo.available;
  const amount=v=>{
   const rawValue=v&&typeof v==='object'?v.amount:v;
   if(rawValue===null||rawValue===undefined||rawValue==='')return null;
   if(typeof rawValue!=='number'&&typeof rawValue!=='string')return null;
   const n=Number(rawValue);return Number.isFinite(n)?Math.round(n*100)/100:null;
  };
  // Only acquiring charges may be joined from the parent order number.
  // Never merge other parent-level operations, as they may belong to sibling postings.
  const isAcquiring=x=>/эквайр|acquir|payment[ ._-]*processing|card[ ._-]*processing|обработк[аи] платеж|оплат[аыу] карт|payment gateway|processing fee|комисси[яи] за (?:оплат|перевод)/i.test([types.get(String(x.type_id)),x.name,x.description,x.operation_type,x.operation_type_name].filter(Boolean).join(' '));
  const dedup=new Set();
  const lines=raw.filter(x=>{const key=JSON.stringify([x.type_id,x.accrual_date,x.accrued,x.sku,x.quantity]);if(dedup.has(key))return false;dedup.add(key);return true}).map((x,i)=>{
   const typeId=x.type_id==null?'':String(x.type_id),acquiring=isAcquiring(x);
   const label=acquiring?'Эквайринг':(types.get(typeId)||String(x.name||x.description||'').slice(0,140)||('Начисление Ozon · тип '+(typeId||'не указан')));
   return {id:String(i+1),date:String(x.accrual_date||''),name:label,amount:amount(x.accrued),type_id:typeId,source_posting_number:posting,sku:x.sku==null?null:String(x.sku),quantity:Number.isFinite(Number(x.quantity))?Number(x.quantity):null,seller_price:amount(x.seller_price),currency:String(x.accrued?.currency||'RUB'),is_acquiring:acquiring,accruals:null,sale_commission:null,delivery_charge:null,return_delivery_charge:null,services:[]};
  });
  let acquiringLookup={complete:true,status:'already_in_accruals',unallocated:0,overlap:0};
  if(!lines.some(x=>x.is_acquiring)){
   try{
    acquiringLookup=await readAcquiringTransactions(ozon,posting,verifiedPosting||{},raw,Date.now(),types);
    lines.push(...acquiringLookup.lines);
    parentLookup=acquiringLookup.status;
   }catch(e){
    if(e.status===429)financeCooldownUntil=Date.now()+15*60*1000;
    acquiringLookup={complete:false,status:e.status===429?'rate_limited':'unavailable',unallocated:0,overlap:0};parentLookup=acquiringLookup.status;
    console.warn('Optional acquiring transactions unavailable:',Number.isInteger(e.status)?e.status:null);
   }
  }
  const complete=lines.every(x=>x.amount!==null&&x.currency==='RUB');
  const total=lines.length&&complete?Math.round(lines.reduce((sum,x)=>sum+x.amount,0)*100)/100:null;
  const result={read_only:true,posting_number:posting,source:'Ozon Seller API /v1/finance/accrual/postings + /v1/finance/accrual/by-day (эквайринг)',
   operations:lines,total_accrued:total,types_available,acquiring_from_parent:lines.filter(x=>x.is_acquiring&&x.source_posting_number===basePosting).length,verified_delivery_at:verifiedDeliveryDate,
   diagnostic:{matched_postings:matched.length,own_accruals:raw.length,parent_accruals:0,
    parent_acquiring_identified:lines.filter(x=>x.is_acquiring&&x.source_posting_number===basePosting).length,parent_unidentified:acquiringLookup.unallocated,parent_lookup:parentLookup,
    order_created_at:verifiedPosting?.created_at||null,acquiring_lookup_status:acquiringLookup.status,
    type_dictionary_available:types_available},
   acquiring_version:3,acquiring_detected:lines.some(x=>x.is_acquiring),acquiring_lookup_complete:acquiringLookup.complete,acquiring_lookup_status:acquiringLookup.status,acquiring_unallocated:acquiringLookup.unallocated,acquiring_overlap:acquiringLookup.overlap,acquiring_check:'Эквайринг берётся из подтверждённых начислений либо транзакций Ozon. Общая комиссия разбитого заказа без подтверждённого распределения не вычитается из каждого отправления. Отсутствие строки не означает нулевую комиссию.',checked_at:new Date().toISOString(),finalized:false,
   note:lines.length?'Это сумма полученных начислений и удержаний, не прибыль. Ozon может обновить данные позже.':'Ozon пока не передал начисления по этому отправлению.'};
  financeCache.set(cacheKey,{data:result,expires:Date.now()+(lines.length&&result.acquiring_detected&&acquiringLookup.complete?FINANCE_TTL:10*60*1000)});
  return reply(res,200,result,ORIGIN);
 }catch(e){if(e.status===429)financeCooldownUntil=Date.now()+15*60*1000;console.error('Order finance accruals failed:',e.status||e.message);
  return reply(res,e.status===429?429:502,{retry_after_seconds:e.status===429?Math.ceil((financeCooldownUntil-Date.now())/1000):undefined,error:'Не удалось получить начисления Ozon',diagnostic:{stage:'Начисления по отправлению',code:Number.isInteger(e.status)?e.status:null,
   reason:e.status===400?'Ozon отклонил параметры запроса':e.status===401||e.status===403?'Нет доступа к финансовым начислениям Seller API':e.status===429?'Ozon временно ограничил частоту запросов':e.status===404?'Финансовый метод недоступен для данного подключения':'Проверьте ответ Ozon в журнале Render'}},ORIGIN)}
}
if(path.pathname==='/api/ads/statistics'){
 const from=path.searchParams.get('from')||'',to=path.searchParams.get('to')||'';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||(Date.parse(to)-Date.parse(from))/86400000>31)return reply(res,400,{error:'Некорректный период'},ORIGIN);
 try{const stats=await cachedPerformance('stats:'+from+':'+to,async()=>({read_only:true,source:'Ozon Performance API',...(await performanceDaily(from,to))}));return reply(res,200,stats,ORIGIN)}catch(e){console.error('Performance statistics read failed:',e.message);return reply(res,e.status===429?429:502,{error:e.status===429?'Ozon временно ограничил запросы. Подождите 15 минут.':'Не удалось получить статистику Ozon',retry_after_seconds:e.retryAfter||undefined},ORIGIN)}
}
if(path.pathname==='/api/ads/campaigns'){try{const result=await cachedPerformance('campaigns',async()=>{const campaigns=await performanceCampaigns();return {source:'Ozon Performance API',read_only:true,automation_enabled:false,count:campaigns.length,campaigns}});return reply(res,200,result,ORIGIN);}catch(e){console.error('Performance read failed:',e.message);return reply(res,e.status===429?429:502,{error:e.status===429?'Ozon временно ограничил запросы. Подождите 15 минут.':'Не удалось загрузить рекламные кампании Ozon.',retry_after_seconds:e.retryAfter||undefined},ORIGIN);}}
if(path.pathname==='/api/price-diagnostic'){const offerId=path.searchParams.get('offer_id')||'';if(!offerId||offerId.length>120||/[\x00-\x1f]/.test(offerId))return reply(res,400,{error:'Укажите корректный offer_id'},ORIGIN);try{return reply(res,200,{checked_at:new Date().toISOString(),source:'Ozon Seller API /v5/product/info/prices',...(await priceDiagnostic(offerId))},ORIGIN);}catch(error){console.error('Price diagnostic failed:',error.message);return reply(res,502,{error:'Не удалось получить цены из Ozon',details:error.message.startsWith('Upstream HTTP ')?error.message:undefined},ORIGIN);}}
try{const items=await products();return reply(res,200,{count:items.length,items},ORIGIN);}catch(error){console.error('Product import failed:',error.message);return reply(res,502,{error:'Не удалось загрузить товары из Ozon. Проверьте права ключа и журнал сервера.'},ORIGIN);}});
server.listen(PORT,'0.0.0.0',()=>console.log('Ozon read-only API server listening on port '+PORT));

