const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

// 2026-11-04 www 白屏：浏览器的 Accept-Encoding 被带进发往 sites.demox.site 的子请求，
// 子请求响应的 content-encoding: br / 压缩后 content-length 被复制到明文正文上，流被重置（curl 92）。
// 子请求不带 accept-encoding；透传和守卫返回前去掉 content-encoding / content-length。
const PUID='1985655011013808129';const SIZES={js:612834,css:117733};
const HOME='<!doctype html><html><head><title>Demox</title><script type="module" src="/assets/index-DxCBZomZ.js"></script><link rel="stylesheet" href="/assets/index-DWMADRiU.css"></head><body><div id="root"></div></body></html>';
const SITE='<!doctype html><html><head><title>Coverage</title></head><body><main>Coverage</main></body></html>';
function hb(i,n){if(n&&n.headers)return new Headers(n.headers);if(i&&i.headers)return new Headers(i.headers);return new Headers();}
function make(src,secret){const calls=[];const store=new Map();
 const ctx=vm.createContext({URL,Request,Response,Headers,crypto,TextEncoder,TextDecoder,setTimeout,clearTimeout,AbortController,console:{log(){},warn(){},error(){},info(){}},
 env:Object.assign({DEMOX_API_URL:'https://api.test',DEMOX_HOME_URL:'https://www.demox.site'},secret?{DEMOX_ORIGIN_GUARD_SECRET_A:'origin-guard-test-slot-a-placeholder',DEMOX_ORIGIN_GUARD_KID:'A'}:{}),
 caches:{default:{match:async()=>undefined,put:async()=>{},delete:async()=>false}},addEventListener(){},
 fetch:async(input,init)=>{const href=String(input&&input.url?input.url:input);const h=hb(input,init);
  if(href.includes('/resolve-subdomain')||href.includes('/check-site-access')){const p=JSON.parse(init.body);const id=p.websiteId;
   if(id==='VMPZGKSR')return Response.json({success:true,allow:false,reason:'blocked'});
   if(id)return Response.json({success:true,allow:true,path:`sites/${PUID}/${id}/dist`,visibility:'public'});
   if(p.subdomain==='coverage')return Response.json({success:true,path:`sites/${PUID}/HGSBPOX6/dist`,websiteId:'HGSBPOX6',origin:'site-3.demox.site',visibility:'public',hideWatermark:true});
   if(p.subdomain==='banned')return Response.json({success:false,banned:true,message:'blocked'},{status:403});
   if(p.subdomain==='www')return Response.json({success:true,path:`sites/${PUID}/EPX2UU43/dist`,websiteId:'EPX2UU43',origin:'sites.demox.site',visibility:'public',hideWatermark:true});
   return Response.json({success:false},{status:404});}
  const method=String((init&&init.method)||(input&&input.method)||'GET').toUpperCase();calls.push({href,method,ae:h.get('accept-encoding')});
  if(/VMPZGKSR/.test(href))return new Response('BANNED-BODY',{status:200});
  if(method==='POST'||method==='PUT')return new Response(SITE,{status:200,headers:{'content-type':'text/html'}});
  if(method==='OPTIONS')return new Response(null,{status:204,headers:{Allow:'GET, HEAD, OPTIONS'}});
  const m=href.match(/\/assets\/index-\w+\.(js|css)/);
  if(m){const ae=h.get('accept-encoding')||'';const hdr={'content-type':m[1]==='js'?'application/javascript':'text/css','cache-control':'public, max-age=31536000, immutable'};
   // EO-like origin: if AE forwarded, labels br + compressed length but hands a plain body
   if(/br|gzip/.test(ae)){hdr['content-encoding']=/br/.test(ae)?'br':'gzip';hdr['content-length']=String(Math.floor(SIZES[m[1]]/5));}
   return new Response(Buffer.alloc(SIZES[m[1]],m[1]==='js'?'a':'c'),{status:200,headers:hdr});}
  if(/HGSBPOX6/.test(href))return new Response(SITE,{status:200,headers:{'content-type':'text/html'}});
  if(/EPX2UU43\/dist\/(index\.html)?$/.test(href)||/EPX2UU43\/dist\/index\.html/.test(href))return new Response(HOME,{status:200,headers:{'content-type':'text/html'}});
  return new Response('<Error>NoSuchKey</Error>',{status:404});}});
 vm.runInContext(src+'\nglobalThis.__h=handle;',ctx);
 return async(url,init)=>{calls.length=0;const r=await ctx.__h(new Request(url,init),{waitUntil(){},passThroughOnException(){}});const b=Buffer.from(await r.arrayBuffer());
  return {status:r.status,ce:r.headers.get('content-encoding'),cl:r.headers.get('content-length'),ct:r.headers.get('content-type'),allow:r.headers.get('allow'),route:r.headers.get('x-demox-route'),size:b.length,body:b,fwdAE:calls.map(c=>c.ae).filter(Boolean).join('|')||'-'};};}

const BODIES = {
  'subdomain-router.js': fs.readFileSync(path.join(__dirname, 'subdomain-router.js'), 'utf8'),
  'fixtures/live-subdomain-router.c4e1d339.js': fs.readFileSync(path.join(__dirname, 'fixtures/live-subdomain-router.c4e1d339.js'), 'utf8')
};
test('hotfix fixture sha256 is c4e1d339', () => {
  assert.equal(crypto.createHash('sha256').update(BODIES['fixtures/live-subdomain-router.c4e1d339.js']).digest('hex'), 'c4e1d3393282422ab5ea8b74cc6c9980b0794c0782664130925e9084231760ee');
});
for (const [name, src] of Object.entries(BODIES)) {
  for (const secret of [true, false]) {
    for (const [type, file] of [['js', 'index-DxCBZomZ.js'], ['css', 'index-DWMADRiU.css']]) {
      for (const ae of ['gzip, deflate, br', 'gzip', '']) {
        test(`${name} secret=${secret} www /assets ${type} Accept-Encoding=${ae || 'none'}: full plain body, no content-encoding`, async () => {
          const run = make(src, secret);
          const r = await run(`https://www.demox.site/assets/${file}`, { headers: ae ? { 'accept-encoding': ae } : {} });
          assert.equal(r.fwdAE, '-', 'subrequest must not carry accept-encoding');
          assert.equal(r.status, 200);
          assert.equal(r.ce, null);
          assert.ok(r.cl == null || Number(r.cl) === r.size, 'content-length ' + r.cl);
          assert.equal(r.size, SIZES[type]);
        });
      }
    }
  }
}
