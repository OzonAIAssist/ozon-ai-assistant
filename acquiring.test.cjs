const {test}=require('node:test'),assert=require('node:assert/strict');
const {ACQUIRING_TYPE,rubles,verificationFromPosting,acquiringMonths,normalizeAcquiring,readAcquiringTransactions}=require('./acquiring');
const posting='28142819-0371-1',base='28142819-0371';
const verification={created_at:'2026-10-18T07:10:27Z',skus:['123'],related_posting_numbers:[],parent_posting_number:''};
const fee=(overrides={})=>({operation_id:1001,operation_type:ACQUIRING_TYPE,operation_date:'2026-10-18 10:00:00',amount:-200,posting:{posting_number:base},items:[{sku:123}],...overrides});
test('signed RUB amounts: negative debit, positive refund, explicit zero; invalid is unknown',()=>{
 assert.equal(rubles(-200),-200);assert.equal(rubles({amount:'25.50'}),25.5);assert.equal(rubles(0),0);for(const v of [null,'',true,{},Infinity])assert.equal(rubles(v),null);
});
test('parent acquiring is included once only when unsplit posting and SKU attribution are confirmed',()=>{
 const r=normalizeAcquiring([fee(),fee(),fee({operation_id:1002,amount:20})],posting,verification);assert.equal(r.lines.length,2);assert.equal(r.lines.reduce((s,x)=>s+x.amount,0),-180);assert.ok(r.lines.every(x=>x.is_acquiring));
 for(const v of [{...verification,related_posting_numbers:['28142819-0371-2']},{...verification,related_posting_numbers:null},{...verification,parent_posting_number:'other'},{...verification,skus:['456']}]){const r=normalizeAcquiring([fee()],posting,v);assert.equal(r.lines.length,0);assert.equal(r.unallocated,1);}
});
test('exact posting transaction is allowed for split shipments; sibling/unrelated/non-acquiring excluded',()=>{
 const r=normalizeAcquiring([fee({posting:{posting_number:posting}}),fee({operation_id:2,posting:{posting_number:'28142819-0371-2'}}),fee({operation_id:3,operation_type:'OtherOperation'}),fee({operation_id:4,posting:{posting_number:'99999999-0001'}})],posting,{...verification,related_posting_numbers:['28142819-0371-2']});assert.equal(r.lines.length,1);assert.equal(r.lines[0].source_posting_number,posting);
});
test('same operation ID conflicts and possible same-day accrual overlap are not charged twice',()=>{
 let r=normalizeAcquiring([fee(),fee({amount:-300})],posting,verification);assert.equal(r.lines.length,0);assert.equal(r.overlap,1);
 r=normalizeAcquiring([fee()],posting,verification,[{accrued:-200,accrual_date:'2026-10-18',sku:'123'}]);assert.equal(r.lines.length,0);assert.equal(r.overlap,1);
 r=normalizeAcquiring([fee()],posting,verification,[{accrued:-200,accrual_date:'2026-10-17',sku:'123'}]);assert.equal(r.lines.length,1);
});
test('verified identity retains only required fields; unknown split metadata remains unknown',()=>{
 const r=verificationFromPosting({in_process_at:'2026-10-18',products:[{sku:123}],customer:{secret:'not retained'}});assert.deepEqual(r.skus,['123']);assert.equal(r.related_posting_numbers,null);assert.equal(r.parent_posting_number,null);assert.equal('customer' in r,false);
});
test('monthly date bounds include order payment month and are capped to current instant',()=>{
 assert.deepEqual(acquiringMonths('2026-09-30T22:00:00Z','2026-10-25T10:00:00Z'),[{from:'2026-09-01T00:00:00.000Z',to:'2026-09-30T23:59:59.999Z'},{from:'2026-10-01T00:00:00.000Z',to:'2026-10-25T10:00:00.000Z'}]);assert.deepEqual(acquiringMonths('bad',Date.now()),[]);assert.deepEqual(acquiringMonths('2020-01-01',Date.now()),[]);
});
test('read-only transaction paging, duplicates, exact filters; incomplete pages are rejected',async()=>{
 const calls=[];const r=await readAcquiringTransactions(async(path,body)=>{calls.push({path,body});return {result:{operations:[fee()],page_count:2}};},posting,verification,[],'2026-10-25T10:00:00Z');assert.equal(calls.length,2);assert.equal(r.lines.length,1);assert.equal(r.complete,true);for(const c of calls){assert.equal(c.path,'/v3/finance/transaction/list');assert.equal(c.body.filter.posting_number,base);assert.deepEqual(c.body.filter.operation_type,[ACQUIRING_TYPE]);}
 await assert.rejects(readAcquiringTransactions(async()=>({result:{operations:[],page_count:11}}),posting,verification,[],'2026-10-25T10:00:00Z'),/page limit/);
});
