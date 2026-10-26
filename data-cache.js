(function(){
 'use strict';
 const api='https://ozon-ai-assistant-api.onrender.com',authKey='hogar_device_access_v1',legacy='hogar_session_access_v44',prefix='hogar_http_cache_v1:';
 const nativeFetch=window.fetch.bind(window),pending=new Map(),retry=new Map();let manualUntil=0;
 document.addEventListener('click',e=>{if(e.isTrusted&&e.target.closest?.('#v10sync,#h44refresh,#h50refresh,.h90-refresh-ad,[data-refresh]'))manualUntil=Date.now()+1500},true);
 const read=k=>{try{return JSON.parse(localStorage.getItem(k)||'null')}catch(_){return null}};
 function access(){let v='';try{v=document.getElementById('v10token')?.value.trim()||sessionStorage.getItem(legacy)||localStorage.getItem(authKey)||'';if(v){localStorage.setItem(authKey,v);sessionStorage.setItem(legacy,v)}}catch(_){}return v}
 const allowed=new Set(['/api/products','/api/orders','/api/orders/finance','/api/ads/campaigns','/api/ads/statistics','/api/dashboard/balance','/api/dashboard/stocks']);
 function save(k,value){try{localStorage.setItem(k,JSON.stringify(value))}catch(_){/* Existing module caches remain usable if device storage is full. */}}
 function response(entry){return new Response(JSON.stringify(entry.body),{status:200,headers:{'Content-Type':'application/json','X-Hogar-Cache':'device'}})}
 function announce(url){window.dispatchEvent(new CustomEvent('hogar:data-cache-updated',{detail:{path:url.pathname}}))}
 async function update(url,options,key){
  if(pending.has(key))return (await pending.get(key)).clone();
  const task=(async()=>{const r=await nativeFetch(url.href,options);if(r.ok){const body=await r.clone().json();save(key,{at:Date.now(),body});retry.delete(key);announce(url)}else if(r.status===429){retry.set(key,Date.now()+Math.max(900,Number(r.headers.get('Retry-After'))||0)*1000)}else retry.set(key,Date.now()+60000);return r})();
  pending.set(key,task);try{return (await task).clone()}finally{pending.delete(key)}
 }
 window.fetch=async function(input,options={}){
  const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.origin!==api)return nativeFetch(input,options);
  const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));const token=access();if(token&&!headers.has('Authorization'))headers.set('Authorization','Bearer '+token);
  const opts={...options,headers},method=String(options.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  if(method!=='GET'||!allowed.has(url.pathname)||!token)return nativeFetch(input,opts);
  const key=prefix+url.pathname+url.search,entry=read(key),ttl=url.pathname==='/api/products'?15*60000:5*60000;
  if(entry&&entry.body&&Number.isFinite(entry.at)&&Date.now()>=manualUntil){
   if(Date.now()-entry.at>=ttl&&Date.now()>=(retry.get(key)||0))update(url,opts,key).catch(()=>retry.set(key,Date.now()+60000));
   return response(entry);
  }
  return update(url,opts,key);
 };
 function hydrate(){const t=access(),input=document.getElementById('v10token');if(input&&t){input.value=t;input.hidden=true;const label=document.querySelector('label[for=v10token]');if(label)label.hidden=true}if(t)document.documentElement.dataset.deviceConnected='true'}
 access();document.addEventListener('DOMContentLoaded',()=>{hydrate();document.getElementById('v10token')?.addEventListener('change',hydrate);setTimeout(cycle,1500)});
 // Timers stop when the app is hidden/offline; no paid price scans or ad writes.
 let lastCycle=0;
 function cycle(){if(document.hidden||navigator.onLine===false||!access()||Date.now()-lastCycle<60000)return;lastCycle=Date.now();window.dispatchEvent(new Event('hogar:background-refresh'))}
 setInterval(cycle,5*60000);document.addEventListener('visibilitychange',cycle);window.addEventListener('online',cycle);
 window.HogarDeviceAccess=access;
})();
