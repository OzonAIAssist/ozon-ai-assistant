// Legacy UI tests isolate UI/finance from HTTP caching. Cache behavior has its own
// transport test (data-cache.test.cjs). Browser layout QA is separate.
const fs=require('node:fs'),{JSDOM:Original}=require('jsdom'),cache=fs.readFileSync(__dirname+'/data-cache.js','utf8');
require('jsdom').JSDOM=class extends Original{
 constructor(html,options={}){if(typeof html==='string')html=html.replace('<script>'+cache+'</script>','<script>/* HTTP cache tested independently */</script>');const before=options.beforeParse;super(html,{...options,beforeParse(w){w.Headers=Headers;w.Request=Request;w.Response=Response;before?.(w)}})}
};
