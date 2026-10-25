const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(require('node:path').join(__dirname,'server.js'),'utf8');
function harness(daily,report,options={}){
 const calls=[];let tokens=0,requests=0;
 const ctx={URLSearchParams,Map,Set,Number,String,Object,Array,JSON,Math,performanceToken:async()=>{tokens++;return 'fixture-token';},PERFORMANCE_BASE:'https://api-performance.ozon.ru',cachedToken:'',fetchJSON:async(url,opts)=>{calls.push({url,method:opts.method||'GET'});if(url.includes('/daily/'))return daily;requests++;if(options.unauthorized&&requests===1)throw Object.assign(Error('no'),{status:401});if(options.status)throw Object.assign(Error('no'),{status:options.status});return report;}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function performanceGet'),source.indexOf("if(!CLIENT_ID||!API_KEY||!ACCESS_TOKEN)")),ctx);
 return {ctx,calls,tokens:()=>tokens};
}
const daily={rows:[{campaignId:'11',moneySpent:'10,50',clicks:'4',views:'100',orders:'2',ordersMoney:'50'},{campaignId:'11',moneySpent:'9,50',clicks:'6',views:'200',orders:'1',ordersMoney:'25'},{campaignId:'22',clicks:0,moneySpent:0,orders:0,ordersMoney:0}]};
test('period campaign carts replace rather than add to daily totals; same bounds; other metrics unchanged',async()=>{
 const h=harness(daily,{rows:[{id:'11',addToCart:'7',moneySpent:999999},{id:'22',addToCart:0},{id:'33',addToCart:5}]});const r=await h.ctx.performanceDaily('2026-10-19','2026-10-25');
 const a=r.rows.find(x=>x.id==='11');assert.equal(a.carts,7);assert.equal(a.spend,20);assert.equal(a.clicks,10);assert.equal(a.orders,3);assert.equal(a.revenue,75);assert.equal(a.cart_rate,70);
 assert.equal(r.rows.find(x=>x.id==='22').carts,0);assert.equal(r.rows.find(x=>x.id==='22').cart_rate,null);assert.equal(r.rows.find(x=>x.id==='33').carts,5);
 assert.equal(r.diagnostic.missing_metrics.carts,false);assert.equal(h.calls.length,2);for(const c of h.calls){const u=new URL(c.url);assert.equal(u.searchParams.get('dateFrom'),'2026-10-19');assert.equal(u.searchParams.get('dateTo'),'2026-10-25');assert.equal(c.method,'GET');}
});
test('optional report 403/429/failure preserves existing statistics and missing carts stays null',async()=>{
 for(const status of [403,429,500]){const h=harness(daily,null,{status});const r=await h.ctx.performanceDaily('2026-10-25','2026-10-25');assert.equal(r.rows.find(x=>x.id==='11').spend,20);assert.equal(r.rows.find(x=>x.id==='11').carts,null);assert.equal(r.diagnostic.carts_report.upstream_status,status);assert.equal(r.diagnostic.missing_metrics.carts,true);}
});
test('missing, empty, negative, fractional, boolean and duplicate totals never become zero or double-count',()=>{
 const h=harness([],[]);for(const raw of [null,'',' ',false,true,-1,1.5,'not a number'])assert.equal(h.ctx.campaignCartTotals([{campaignId:'11',addToCart:raw}]).totals.get('11'),null);
 const duplicates=h.ctx.campaignCartTotals([{id:'11',addToCart:7},{id:'11',addToCart:7}]);assert.equal(duplicates.totals.has('11'),false);assert.equal(duplicates.duplicates,1);
 assert.equal(h.ctx.campaignCartTotals({result:{rows:[{campaign_id:'12',addToCartCount:'1 234'}]}}).totals.get('12'),1234);
});
test('period totals do not add to carts already returned by daily rows',async()=>{
 const h=harness([{id:'11',clicks:10,carts:2},{id:'11',clicks:10,carts:3}],[{id:'11',carts:8}]);const r=await h.ctx.performanceDaily('2026-10-25','2026-10-25');assert.equal(r.rows[0].carts,8);assert.equal(r.rows[0].clicks,20);
});
test('single retry with refreshed token on 401, read-only request',async()=>{
 const h=harness(daily,[{id:'11',addToCart:4}],{unauthorized:true});const r=await h.ctx.performanceDaily('2026-10-25','2026-10-25');assert.equal(r.rows.find(x=>x.id==='11').carts,4);assert.equal(h.tokens(),3);assert.equal(h.calls.length,3);
});
