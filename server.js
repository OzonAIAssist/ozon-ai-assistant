'use strict';
const http=require('node:http');
const crypto=require('node:crypto');
const PORT=Number(process.env.PORT||10000);
const CLIENT_ID=process.env.OZON_CLIENT_ID||'';
const API_KEY=process.env.OZON_API_KEY||'';
const ACCESS_TOKEN=process.env.APP_ACCESS_TOKEN||'';
const ORIGIN=(process.env.ALLOWED_ORIGIN||'https://ozonaiassist.github.io').trim().replace(/\/+$/,'');
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
async function products(){let lastId='';const all=[],seen=new Set();while(all.length<MAX_ITEMS){const data=await ozon('/v3/product/list',{filter:{visibility:'ALL'},last_id:lastId,limit:1000});const result=data.result||{};const items=Array.isArray(result.items)?result.items:[];for(const item of items){const id=String(item.product_id??'');if(!id||seen.has(id))continue;seen.add(id);all.push({product_id:id,offer_id:String(item.offer_id??'')});}const next=String(result.last_id||'');if(!next||next===lastId||!items.length)break;lastId=next;}if(all.length>=MAX_ITEMS)throw new Error('Слишком много товаров: достигнут лимит безопасности.');const names=new Map();for(let i=0;i<all.length;i+=1000){const batch=all.slice(i,i+1000);const data=await ozon('/v3/product/info/list',{product_id:batch.map(x=>Number(x.product_id))});for(const item of data.items||[]){names.set(String(item.id??item.product_id),{name:String(item.name||''),offer_id:String(item.offer_id||''),image_url:String(item.primary_image||(Array.isArray(item.images)?item.images[0]:'')||'')});}}return all.map(item=>({...item,name:names.get(item.product_id)?.name||'',offer_id:names.get(item.product_id)?.offer_id||item.offer_id,image_url:names.get(item.product_id)?.image_url||''}));}
function scalar(v){return (typeof v==='string'||typeof v==='number'||typeof v==='boolean')?v:null;}
function limited(v,depth=0){if(depth>2||v==null)return null;if(['string','number','boolean'].includes(typeof v))return typeof v==='string'?v.slice(0,180):v;if(Array.isArray(v))return v.slice(0,8).map(x=>limited(x,depth+1));if(typeof v==='object'){const allowed=['id','type','name','title','value','amount','price','percent','percentage','discount','discount_percent','action_id','action_type','enabled','status','currency_code','index','color','ozon','seller'];const o={};for(const k of allowed){if(Object.prototype.hasOwnProperty.call(v,k))o[k]=limited(v[k],depth+1);}return o;}return null;}
async function priceDiagnostic(offerId){const data=await ozon('/v5/product/info/prices',{filter:{offer_id:[offerId],visibility:'ALL'},limit:1000});const rows=Array.isArray(data.items)?data.items:(Array.isArray(data.result?.items)?data.result.items:[]);const item=rows.find(x=>String(x.offer_id||'')===offerId);if(!item)return {found:false,offer_id:offerId,available_fields:[],seller_prices:{},card_price:null,card_discount:null,coinvest:null};const prices=item.price&&typeof item.price==='object'?item.price:{};const permitted=['price','old_price','marketing_price','marketing_seller_price','min_price','currency_code','vat','declared_price','net_price','retail_price'];const safe={};for(const key of permitted){const val=prices[key]??item[key];if(['string','number'].includes(typeof val))safe[key]=val;}return {found:true,offer_id:offerId,available_fields:Object.keys(item).filter(k=>!['images','primary_image'].includes(k)).sort(),price_fields:Object.keys(prices).sort(),seller_prices:safe,extra_diagnostic:{acquiring:scalar(item.acquiring),marketing_actions:limited(item.marketing_actions),commissions:limited(item.commissions),price_indexes:limited(item.price_indexes)},card_price:null,card_discount:null,coinvest:null,note:'Поля цены покупателя с Ozon Картой, скидки по карте и соинвеста не подтверждены этим методом.'};}
let cachedToken='',tokenExpiry=0;
async function performanceToken(){if(cachedToken&&Date.now()<tokenExpiry-60000)return cachedToken;if(!PERF_ID||!PERF_SECRET)throw new Error('Performance API credentials are not configured');const data=await fetchJSON(PERFORMANCE_BASE+'/api/client/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:PERF_ID,client_secret:PERF_SECRET,grant_type:'client_credentials'})});if(!data.access_token)throw new Error('Performance token missing in response');cachedToken=data.access_token;tokenExpiry=Date.now()+Math.max(120,Number(data.expires_in)||1800)*1000;return cachedToken;}
async function performanceCampaigns(){let token=await performanceToken();const all=[];const ids=new Set();for(let page=1;page<=30;page++){const url=PERFORMANCE_BASE+'/api/client/campaign?page='+page+'&pageSize=100';let data;for(let attempt=0;attempt<2;attempt++){try{data=await fetchJSON(url,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});break;}catch(e){if(e.status!==401||attempt===1)throw e;cachedToken='';token=await performanceToken();}}const list=Array.isArray(data.list)?data.list:(Array.isArray(data.campaigns)?data.campaigns:[]);for(const c of list){const id=String(c.id??'');if(!id||ids.has(id))continue;ids.add(id);all.push({id,name:String(c.title||c.name||''),status:String(c.state||''),type:String(c.advObjectType||''),payment_type:String(c.paymentType||''),autopilot_in_ozon:String(c.productAutopilotStrategy||'')});}if(list.length<100)break;if(page===30)throw new Error('Campaign page limit reached');}return all;}
async function performanceDaily(from,to){
 let token=await performanceToken();const qs=new URLSearchParams({dateFrom:from,dateTo:to});
 let data;for(let attempt=0;attempt<2;attempt++){try{data=await fetchJSON(PERFORMANCE_BASE+'/api/client/statistics/daily/json?'+qs,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});break;}catch(e){if(e.status!==401||attempt===1)throw e;cachedToken='';token=await performanceToken();}}
 const rows=Array.isArray(data)?data:[data?.rows,data?.data,data?.result?.rows,data?.result?.data,data?.result].find(Array.isArray)||[];
 const shapeOf=x=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x).filter(k=>/^[a-zA-Z_][a-zA-Z_0-9]{0,39}$/.test(k)).slice(0,24):[];
 const diagnostic={response_type:Array.isArray(data)?'array':typeof data,
  top_level_keys:shapeOf(data),rows_count:rows.length,
  row_field_names:rows.length?shapeOf(rows[0]):[],
  campaign_id_field_present:rows.some(r=>r&&typeof r==='object'&&['campaignId','campaign_id','id'].some(k=>r[k]!=null)),
  note:'Диагностика показывает только имена полей и количество строк, без значений и ключей.'};
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
const routes=new Set(['/api/products','/api/price-diagnostic','/api/ads/campaigns','/api/ads/statistics','/api/orders','/api/orders/finance']);
const server=http.createServer(async(req,res)=>{const origin=req.headers.origin||'';const allowed=!origin||origin===ORIGIN;const path=new URL(req.url||'/','http://localhost');console.log('[request]',req.method,path.pathname,'origin:',origin||'(none)','allowed:',allowed);if(!allowed)return reply(res,403,{error:'Origin not allowed'},ORIGIN);if(req.method==='OPTIONS'){if(!routes.has(path.pathname)&&path.pathname!=='/health')return reply(res,404,{error:'Not found'},ORIGIN);res.writeHead(204,{...cors(ORIGIN),'Cache-Control':'no-store'});return res.end();}if(path.pathname==='/health'&&req.method==='GET')return reply(res,200,{status:'ok'},ORIGIN);if(req.method!=='GET'||!routes.has(path.pathname))return reply(res,404,{error:'Not found'},ORIGIN);if(!authorized(req))return reply(res,401,{error:'Unauthorized'},ORIGIN);

if(path.pathname==='/api/orders'){
 const days=Math.min(30,Math.max(1,Number(path.searchParams.get('days')||7)||7));
 const since=new Date(Date.now()-(days-1)*86400000).toISOString();
 const to=new Date().toISOString();
 const all=[],errors=[];
 function normalize(x,scheme){
  const items=Array.isArray(x.products)?x.products.map(p=>({name:String(p.name||''),sku:String(p.sku??''),quantity:Number(p.quantity||1),price:p.price??null})): [];
  const status=String(x.status||'');
  const delivered=['delivered','delivered_to_customer'].includes(status.toLowerCase());
  return {posting_number:String(x.posting_number||''),order_id:String(x.order_id??''),scheme,status,delivered,created_at:x.in_process_at||x.created_at||'',shipment_date:x.shipment_date||null,products:items,amount:null,financial_ready:false};
 }
 try{
  let offset=0;
  for(let i=0;i<10;i++){
   const d=await ozon('/v3/posting/fbs/list',{dir:'DESC',filter:{since,to},limit:100,offset,with:{analytics_data:false,financial_data:false}});
   const items=Array.isArray(d.result?.postings)?d.result.postings:[];
   all.push(...items.map(x=>normalize(x,'FBS')));
   if(items.length<100)break;offset+=items.length;
  }
 }catch(e){errors.push('FBS: '+e.message)}
 try{
  let offset=0;
  for(let i=0;i<10;i++){
   const d=await ozon('/v2/posting/fbo/list',{dir:'DESC',filter:{since,to},limit:100,offset,translit:false,with:{analytics_data:false,financial_data:false}});
   const items=Array.isArray(d.result)?d.result:Array.isArray(d.result?.postings)?d.result.postings:[];
   all.push(...items.map(x=>normalize(x,'FBO')));
   if(items.length<100)break;offset+=items.length;
  }
 }catch(e){errors.push('FBO: '+e.message)}
 if(errors.length===2)return reply(res,502,{error:'Не удалось загрузить заказы',details:errors},ORIGIN);
 const seen=new Set();
 const orders=all.filter(x=>x.posting_number&&!seen.has(x.posting_number)&&seen.add(x.posting_number)).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
 return reply(res,200,{read_only:true,days,orders,partial:errors.length>0,errors,checked_at:new Date().toISOString()},ORIGIN);
}
if(path.pathname==='/api/orders/finance'){
 const posting=path.searchParams.get('posting_number')||'';
 const created=path.searchParams.get('created_at')||'';
 const delivered=path.searchParams.get('delivered')==='true';
 if(!/^[a-zA-Z0-9-]{4,90}$/.test(posting))return reply(res,400,{error:'Неверный номер отправления'},ORIGIN);
 if(!delivered)return reply(res,409,{error:'Финансы доступны после доставки заказа'},ORIGIN);
 // Verify delivery independently on the server; do not trust the browser flag.
 let verified=false;
 try{
  const d=await ozon('/v3/posting/fbs/get',{posting_number:posting,with:{analytics_data:false,financial_data:false}});
  verified=['delivered','delivered_to_customer'].includes(String(d.result?.status||'').toLowerCase());
 }catch(_){}
 if(!verified){
  try{
   const d=await ozon('/v2/posting/fbo/get',{posting_number:posting,translit:false});
   verified=['delivered','delivered_to_customer'].includes(String(d.result?.status||'').toLowerCase());
  }catch(_){}
 }
 if(!verified)return reply(res,409,{error:'Не удалось подтвердить доставку заказа через Ozon'},ORIGIN);
 const date=new Date(created);if(!Number.isFinite(date.getTime()))return reply(res,400,{error:'Неизвестна дата заказа'},ORIGIN);
 const from=new Date(date.getTime()-7*86400000).toISOString(),to=new Date(Math.min(Date.now(),date.getTime()+120*86400000)).toISOString();
 try{
  const operations=[];
  for(let page=1;page<=10;page++){
   const d=await ozon('/v3/finance/transaction/list',{filter:{date:{from,to},operation_type:[],posting_number:posting,transaction_type:'all'},page,page_size:100});
   const rows=Array.isArray(d.result?.operations)?d.result.operations:[];
   operations.push(...rows.filter(x=>String(x.posting?.posting_number||x.posting_number||'')===posting));
   const pages=Number(d.result?.page_count||0);
   if((pages&&page>=pages)||rows.length<100)break;
  }
  const lines=operations.map(x=>({id:String(x.operation_id??''),date:x.operation_date||'',name:String(x.operation_type_name||x.operation_type||'Операция Ozon'),amount:typeof x.amount==='number'?x.amount:null,accruals:typeof x.accruals_for_sale==='number'?x.accruals_for_sale:null,sale_commission:typeof x.sale_commission==='number'?x.sale_commission:null,delivery_charge:typeof x.delivery_charge==='number'?x.delivery_charge:null,return_delivery_charge:typeof x.return_delivery_charge==='number'?x.return_delivery_charge:null,services:Array.isArray(x.services)?x.services.map(s=>({name:String(s.name||''),price:typeof s.price==='number'?s.price:null})):[]}));
  return reply(res,200,{read_only:true,posting_number:posting,source:'Ozon Seller API /v3/finance/transaction/list',operations:lines,checked_at:new Date().toISOString(),finalized:false,note:'Финансовые операции могут появиться после доставки и корректироваться позднее.'},ORIGIN);
 }catch(e){console.error('Order finance failed:',e.message);return reply(res,502,{error:'Не удалось получить финансовые операции Ozon',details:e.message.startsWith('Upstream HTTP ')?e.message:undefined},ORIGIN)}
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
