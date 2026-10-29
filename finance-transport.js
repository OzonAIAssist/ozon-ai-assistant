'use strict';
// One read-only queue/cache shared by posting lookup, ledger and acquiring scans.
function createFinanceTransport({send,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),interval=1250,maxBytes=24*1024*1024}={}){
 const cache=new Map(),pending=new Map();let queue=Promise.resolve(),last=0,pause=0,bytes=0;
 const waitSeconds=()=>Math.max(0,Math.ceil((pause-now())/1000));
 const limited=()=>Object.assign(Error('Finance requests paused'),{status:429,retryAfter:waitSeconds()});
 const keyOf=(p,b)=>p+':'+JSON.stringify(Object.fromEntries(Object.entries(b||{}).sort(([a],[b])=>a.localeCompare(b))));
 function ttl(p,b){return p.endsWith('/types')?6*3600000:p.endsWith('/by-day')&&b.date===new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()))?60000:600000}
 async function read(p,b){if(!/^\/v1\/finance\/accrual\/(?:types|by-day|postings)$/.test(p))throw Error('Unsupported financial method');const key=keyOf(p,b),old=cache.get(key);if(old&&now()<old.expires)return structuredClone(old.data);if(pending.has(key))return structuredClone(await pending.get(key));if(now()<pause)throw limited();
 const task=queue.catch(()=>{}).then(async()=>{if(now()<pause)throw limited();const delay=interval-(now()-last);if(delay>0)await sleep(delay);if(now()<pause)throw limited();last=now();try{const data=await send(p,b),size=Buffer.byteLength(JSON.stringify(data));if(size<=maxBytes){if(old){bytes-=old.size;cache.delete(key)}while(cache.size&&(cache.size>=120||bytes+size>maxBytes)){const [k,v]=cache.entries().next().value;bytes-=v.size;cache.delete(k)}cache.set(key,{data:structuredClone(data),size,expires:now()+ttl(p,b)});bytes+=size}return data}catch(e){if(e.status===429){const seconds=Number(e.retryAfter);pause=Math.max(pause,now()+Math.max(60,Number.isFinite(seconds)&&seconds>0?seconds:900)*1000);e.retryAfter=waitSeconds()}throw e}});
 queue=task;pending.set(key,task);try{return structuredClone(await task)}finally{pending.delete(key)}
 }
 return {read,waitSeconds};
}
module.exports={createFinanceTransport};
