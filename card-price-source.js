'use strict';
const API='https://api.apify.com/v2';
function sellerPath(value){try{const u=new URL(value);return u.protocol==='https:'&&['ozon.ru','www.ozon.ru'].includes(u.hostname)&&/^\/seller\/[^/]+\/?$/.test(u.pathname)?u.pathname.replace(/\/$/,''):null}catch(_){return null}}
function validPrice(v){return typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=1e9?v:null}
function normalize(rows,{sku,sellerUrl,startedAt,finishedAt,now=Date.now(),maxAge=30*60*1000}){
 const begin=Date.parse(startedAt),end=Date.parse(finishedAt),expected=sellerPath(sellerUrl);
 if(!expected)return {status:'unconfigured',reason:'Не задано подтверждённое предложение продавца.'};
 if(!Number.isFinite(begin)||!Number.isFinite(end)||end<begin||end>now+60000||begin>now||now-begin>maxAge)return {status:'stale',reason:'Нет свежего замера цены с Ozon Картой.'};
 const matching=rows.filter(r=>String(r.sku)===sku&&r.deliveryRegion==='Москва'&&r.storefront==='ru');
 if(matching.length!==1)return {status:'unverified',reason:'Нет однозначного замера SKU для Москвы.'};
 const row=matching[0];if(row.isAvailable!==true||sellerPath(row.seller?.url)!==expected)return {status:'unverified',reason:'Продавец или доступность товара не подтверждены.'};
 const price=validPrice(row.cardPriceDecimal);if(price===null)return {status:'unavailable',reason:'Источник не передал цену с Ozon Картой.'};
 // No fallback to the ordinary price, variant price or another seller.
 return {status:'ok',price,currency:'RUB',sku,region:'Москва',source:'Apify · Zen Studio · витрина Ozon',observed_since:new Date(begin).toISOString(),checked_at:new Date(end).toISOString(),seller_verified:true,usable_for_repricing:false,reason:'Режим наблюдения: совпадение с витриной ещё должно быть проверено.'};
}
function createReader({token='',taskId='',sellerUrl='',fetcher=global.fetch,now=()=>Date.now()}={}){
 let cache=null,pending=null;
 const configured=!!token&&/^[A-Za-z0-9_-]{1,100}$/.test(taskId)&&!!sellerPath(sellerUrl);
 async function get(path){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetcher(API+path,{method:'GET',headers:{Authorization:'Bearer '+token},signal:controller.signal,redirect:'error'});if(!r.ok)throw Error('Источник недоступен (HTTP '+r.status+').');const text=await r.text();if(text.length>4000000)throw Error('Ответ источника превышает лимит.');return JSON.parse(text)}finally{clearTimeout(timer)}}
 async function snapshot(){if(cache&&now()-cache.at<60000)return cache;if(pending)return pending;pending=(async()=>{const response=await get('/actor-tasks/'+taskId+'/runs?desc=true&limit=5&status=SUCCEEDED'),runs=response.data?.items;if(!Array.isArray(runs))throw Error('Некорректный ответ источника.');const run=runs.find(r=>r.status==='SUCCEEDED'&&r.actTaskId===taskId);if(!run||!/^[A-Za-z0-9_-]+$/.test(run.defaultDatasetId||''))throw Error('Нет завершённого замера источника.');if(now()-Date.parse(run.startedAt)>1800000)return {at:now(),run,rows:[]};const rows=await get('/datasets/'+run.defaultDatasetId+'/items?format=json&clean=true&limit=1001');if(!Array.isArray(rows)||rows.length>1000)throw Error('Слишком большой или некорректный набор данных.');cache={at:now(),run,rows};return cache})().finally(()=>pending=null);return pending}
 return async function read(sku){if(!/^\d{1,20}$/.test(sku))return {status:'invalid',reason:'Некорректный SKU Ozon.'};if(!configured)return {status:'unconfigured',reason:'Источник цены с Ozon Картой ещё не подключён. Нужны задача Apify, серверный токен и подтверждённый продавец.'};try{const s=await snapshot();return normalize(s.rows,{sku,sellerUrl,startedAt:s.run.startedAt,finishedAt:s.run.finishedAt,now:now()})}catch(_){return {status:'unavailable',reason:'Не удалось обновить цену с Ozon Картой. Автокорректировка недоступна.'}}};
}
module.exports={createReader,normalize,sellerPath};
