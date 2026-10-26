const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),http=require('node:http'),crypto=require('node:crypto');
const acquiring=require('./acquiring'),source=fs.readFileSync(__dirname+'/server.js','utf8'),posting='28142819-0371-1';
function harness(options={}){
 const calls=[];let handler;const created=new Date(Date.now()-7*86400000).toISOString();
 const own=options.own??[{type_id:1,accrual_date:created,accrued:{amount:'-1500',currency:'RUB'},sku:'123',quantity:1,seller_price:{amount:'10000',currency:'RUB'}}];
 const ctx={require:name=>name==='node:http'?{createServer:fn=>{handler=fn;return {listen(){}};}}:name==='node:crypto'?crypto:name==='./acquiring'?acquiring:require(name),process:{env:{OZON_CLIENT_ID:'fixture-id',OZON_API_KEY:'fixture-key',APP_ACCESS_TOKEN:'fixture-token'},exit(){throw Error('unexpected exit')}},console:{log(){},warn(){},error(){}},URL,URLSearchParams,Buffer,AbortController,AbortSignal,TextDecoder,setTimeout:(fn,ms)=>setTimeout(fn,ms<=1250?0:ms),clearTimeout,fetch:async(url,opts)=>{
 const pathname=new URL(url).pathname,body=JSON.parse(opts.body||'{}');calls.push({pathname,body,method:opts.method});let value;
 if(pathname==='/v3/posting/fbs/get')value={result:{status:options.status||'delivered',in_process_at:created,products:[{sku:123}],parent_posting_number:'',related_postings:{related_posting_numbers:options.related||[]}}};
 else if(pathname==='/v1/finance/accrual/postings'){assert.equal(body.posting_numbers[0],posting,'never send parent ID to accruals');value={posting_accruals:[{posting_number:posting,accruals:own}]};}
 else if(pathname==='/v1/finance/accrual/types')value={accrual_types:[{id:1,description:'Комиссия Ozon'},{id:2,description:'Эквайринг'}]};
 else if(pathname==='/v1/finance/accrual/by-day'){
  if(options.txStatus)return {ok:false,status:options.txStatus};
  value={last_id:'',accruals:[{accrual_id:1001,date:created.slice(0,10),unit_number:options.txPosting||'28142819-0371',non_item_fee:{type_id:2,accrued:{amount:'-200',currency:'RUB'}}}]};
 }else throw Error('Unexpected endpoint '+pathname);
 return {ok:true,json:async()=>value};
 }};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 async function call({number=posting,token='fixture-token',delivered='true',origin='https://ozon-ai-assistant.onrender.com'}={}){let response;await handler({url:'/api/orders/finance?posting_number='+number+'&created_at=1990-01-01&delivered='+delivered,method:'GET',headers:{authorization:'Bearer '+token,origin}},{writeHead(status){response={status}},end(text){response.data=JSON.parse(text)}});return response;}
 return {call,calls,created};
}
test('delivered finance includes confirmed fee once in total and cache; transaction date uses verified order',async()=>{
 const h=harness();let r=await h.call();assert.equal(r.status,200);assert.equal(r.data.total_accrued,-1700);assert.equal(r.data.operations.filter(x=>x.is_acquiring).length,1);assert.equal(r.data.acquiring_version,4);assert.equal(r.data.acquiring_detected,true);assert.equal(r.data.acquiring_lookup_complete,true);const tx=h.calls.find(x=>x.pathname==='/v1/finance/accrual/by-day');assert.equal(tx.body.date,new Date(Date.parse(h.created)-86400000).toISOString().slice(0,10));const count=h.calls.length;r=await h.call();assert.equal(r.data.cached,true);assert.equal(h.calls.length,count);
});
test('existing own acquiring does not trigger or double-add transaction fallback',async()=>{
 const h=harness({own:[{type_id:2,accrued:{amount:'-200',currency:'RUB'}}]});const r=await h.call();assert.equal(r.data.total_accrued,-200);assert.equal(r.data.acquiring_detected,true);assert.ok(!h.calls.some(x=>x.pathname==='/v1/finance/accrual/by-day'));
});
test('optional transaction failure preserves accruals; 429 cooldown blocks new financial reads',async()=>{
 for(const txStatus of [403,429,500]){const h=harness({txStatus});const r=await h.call();assert.equal(r.status,200);assert.equal(r.data.total_accrued,-1500);assert.equal(r.data.operations.length,1);assert.equal(r.data.acquiring_detected,false);assert.equal(r.data.acquiring_lookup_complete,false);assert.equal(r.data.acquiring_lookup_status,txStatus===429?'rate_limited':'unavailable');if(txStatus===429){const count=h.calls.length;const next=await h.call({number:'99999999-1234-1'});assert.equal(next.status,429);assert.equal(h.calls.length,count);}}
});
test('split parent order fee is not deducted from each posting',async()=>{
 const h=harness({related:['28142819-0371-2']});const r=await h.call();assert.equal(r.data.total_accrued,-1500);assert.equal(r.data.acquiring_lookup_status,'unallocated_parent');assert.equal(r.data.acquiring_unallocated,1);
});
test('delivery verification, authorization and CORS remain mandatory',async()=>{
 const h=harness();assert.equal((await h.call({token:'wrong'})).status,401);assert.equal((await h.call({origin:'https://foreign.test'})).status,403);assert.equal((await h.call({delivered:'false'})).status,409);assert.equal(h.calls.length,0);const denied=harness({status:'delivering'});assert.equal((await denied.call()).status,409);assert.equal(denied.calls.length,1);
});

