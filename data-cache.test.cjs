const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('device access survives reload, cached GET is immediate, stale data refreshes once and writes are never cached',async()=>{
 const local=new Map(),session=new Map([['hogar_session_access_v44','test-device-token']]);let calls=0,events=0,now=1000000,release;
 const storage=m=>({getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)});
 const w={fetch:async(u,o)=>{calls++;assert.equal(o.headers.get('Authorization'),'Bearer test-device-token');if(release)await new Promise(r=>release=r);return new Response(JSON.stringify({items:[calls]}),{headers:{'Content-Type':'application/json'}})},dispatchEvent:()=>events++,addEventListener:()=>{}};
 const context={window:w,document:{getElementById:()=>null,addEventListener:()=>{},hidden:false},localStorage:storage(local),sessionStorage:storage(session),location:{href:'https://ozonaiassist.github.io/'},navigator:{onLine:true},URL,Response,Request,Headers,Map,Set,Number,JSON,CustomEvent:class{},Event:class{},setInterval:()=>{},Date:{now:()=>now}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/data-cache.js','utf8'),context);
 const url='https://ozon-ai-assistant-api.onrender.com/api/products';await w.fetch(url);assert.equal(calls,1);await w.fetch(url);assert.equal(calls,1);session.clear();assert.equal(w.HogarDeviceAccess(),'test-device-token');
 now+=16*60000;release=true;const old=await w.fetch(url);assert.deepEqual(await old.json(),{items:[1]});await w.fetch(url);assert.equal(calls,2);release();await new Promise(r=>setImmediate(r));release=null;
 await w.fetch(url,{method:'POST'});assert.equal(calls,3);assert.ok(events>=1);
});
