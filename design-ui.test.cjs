const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM,VirtualConsole}=require('jsdom');
test('analytics navigation, comparisons, recommendations and SKU links work without network writes',async()=>{
 const errors=[],calls=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errors.push(e.message)});
 const html=fs.readFileSync(__dirname+'/index.html','utf8').replace(/<script src="([^"]+)"><\/script>/g,(_,f)=>'<script>'+fs.readFileSync(__dirname+'/'+f.split('?')[0],'utf8')+'</script>');
 const product={id:'qa-product',sku:'offer',ozon_sku:'11',name:'TEST DATA — товар',settings:{cost:'500',logistics:'0'}},now=new Date().toISOString();
 const order={posting_number:'TEST',created_at:now,delivered_at:now,delivered:true,status:'delivered',products:[{sku:'11',offer_id:'offer',quantity:1,price:1000}]};
 const dom=new JSDOM(html,{url:'https://ozonaiassist.github.io/ozon-ai-assistant/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.Headers=Headers;w.Request=Request;w.Response=Response;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},fillRect(){},fillText(){}});w.localStorage.setItem('ozon_products_v09',JSON.stringify([product]));w.sessionStorage.setItem('hogar_session_access_v44','TEST');w.fetch=async(url,opts={})=>{calls.push({url:String(url),method:opts.method||'GET'});const path=new URL(url).pathname;const data=path==='/api/orders'?{orders:[order],checked_at:now}:path==='/api/orders/finance'?{operations:[{name:'Комиссия',amount:-100},{name:'Эквайринг',amount:-10,is_acquiring:true}],acquiring_version:4,acquiring_detected:true,acquiring_lookup_complete:true}:path==='/api/ads/campaigns'?{campaigns:[],checked_at:now}:path==='/api/ads/statistics'?{rows:[],checked_at:now}:path==='/api/dashboard/balance'?{balance:7654,currency:'RUB',checked_at:now}:path==='/api/dashboard/stocks'?{available:3,checked_at:now}:{items:[]};return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}})}}});
 try{
  const w=dom.window,d=w.document,tick=()=>new Promise(r=>setTimeout(r,70));await tick();d.querySelector('.bottom-nav [data-tab=home]').click();await tick();
  const host=d.querySelector('#tab-analytics');assert.equal(host.querySelectorAll('[data-da-tab]').length,6);
  for(const b of [...host.querySelectorAll('[data-da-tab]')]){host.querySelector('[data-da-tab="'+b.dataset.daTab+'"]').click();assert.ok(host.querySelector('.da-root'))}
  host.querySelector('[data-da-tab=overview]').click();assert.ok(host.querySelector('.da-recommendations').compareDocumentPosition(host.querySelector('.da-table-wrap'))&w.Node.DOCUMENT_POSITION_FOLLOWING);
  host.querySelector('[data-da-period="90"]').click();assert.match(host.textContent,/не покрыт|Недостаточно|за пределы/);assert.equal(host.querySelectorAll('.da-chart circle').length,0);
  host.querySelector('[data-da-period="7"]').click();host.querySelector('[data-da-group=week]').click();assert.ok(host.querySelector('.da-chart circle'));
  const cmp=host.querySelector('[data-da-compare]');cmp.value='custom';cmp.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(host.querySelectorAll('[data-da-previous]').length,2);
  host.querySelector('[data-da-all]').click();assert.ok(d.querySelector('.da-dialog[open]'));d.querySelector('[aria-label="Закрыть рекомендации"]').click();assert.equal(d.querySelector('.da-dialog'),null);
  host.querySelector('[data-da-product="qa-product"]').click();assert.ok(d.querySelector('.hc-product-detail'));
  assert.ok(calls.length);assert.ok(calls.every(x=>x.method==='GET'));assert.deepEqual(errors,[]);
 }finally{dom.window.close()}
});
