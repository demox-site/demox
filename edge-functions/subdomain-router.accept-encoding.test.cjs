const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

// 2026-11-04 www 白屏：浏览器的 Accept-Encoding 被带进发往 sites.demox.site 的子请求，
// 子请求响应的 content-encoding: br / 压缩后 content-length 被复制到明文正文上，流被重置（curl 92）。
// 子请求不带 accept-encoding；透传和守卫返回前去掉 content-encoding / content-length。
const PUID='1985655011013808129';const SIZES={js:612834,css:117733};
const HOME='<!doctype html><html><head><title>Demox</title><script type="module" src="/assets/index-DxCBZomZ.js"></script><link rel="stylesheet" href="/assets/index-DWMADRiU.css"></head><body><div id="root"></div></body></html>';
const SITE='<!doctype html><html><head><title>Coverage</title></head><body><main>Coverage</main></body></html>';
function hb(i,n){if(n&&n.headers)return new Headers(n.headers);if(i&&i.headers)return new Headers(i.headers);return new Headers();}
function make(src,secret,mode){const calls=[];const store=new Map();
 const ctx=vm.createContext({URL,Request,Response,Headers,crypto,TextEncoder,TextDecoder,setTimeout,clearTimeout,AbortController,console:{log(){},warn(){},error(){},info(){}},
 env:Object.assign({DEMOX_API_URL:'https://api.test',DEMOX_HOME_URL:'https://www.demox.site'},secret?{DEMOX_ORIGIN_GUARD_SECRET_A:'origin-guard-test-slot-a-placeholder',DEMOX_ORIGIN_GUARD_KID:'A'}:{}),
 caches:{default:{match:async()=>undefined,put:async()=>{},delete:async()=>false}},addEventListener(){},
 fetch:async(input,init)=>{const href=String(input&&input.url?input.url:input);const h=hb(input,init);
  if(href.includes('/resolve-subdomain')||href.includes('/check-site-access')){const p=JSON.parse(init.body);const id=p.websiteId;
   if(id==='VMPZGKSR')return Response.json({success:true,allow:false,reason:'blocked'});
   if(id)return Response.json({success:true,allow:true,path:`sites/${PUID}/${id}/dist`,visibility:'public'});
   if(p.subdomain==='coverage')return Response.json({success:true,path:`sites/${PUID}/HGSBPOX6/dist`,websiteId:'HGSBPOX6',origin:'site-3.demox.site',visibility:'public',hideWatermark:true});
   if(p.subdomain==='aehttps')return Response.json({success:true,path:`sites/${PUID}/AEHTTPS1/dist`,websiteId:'AEHTTPS1',origin:'sites.demox.site',visibility:'public',hideWatermark:true});
   if(p.subdomain==='banned')return Response.json({success:false,banned:true,message:'blocked'},{status:403});
   if(p.subdomain==='www')return Response.json({success:true,path:`sites/${PUID}/EPX2UU43/dist`,websiteId:'EPX2UU43',origin:'sites.demox.site',visibility:'public',hideWatermark:true});
   return Response.json({success:false},{status:404});}
  const method=String((init&&init.method)||(input&&input.method)||'GET').toUpperCase();
  calls.push({href,method,ae:h.get('accept-encoding'),cookie:h.get('cookie'),host:h.get('host'),redirect:(init&&init.redirect)||'',duplex:(init&&init.duplex)||'',token:h.get('x-demox-origin-token')||'',body:null});
  if(mode==='reject-duplex'&&init&&init.duplex)throw new Error('duplex option is not supported');
  if(/VMPZGKSR/.test(href))return new Response('BANNED-BODY',{status:200});
  if(method==='POST'||method==='PUT'){
    const raw=init&&init.body!=null?await new Response(init.body).text():(input&&input.body!=null?await new Response(input.body).text():'');
    calls[calls.length-1].body=raw;
    return new Response(SITE,{status:200,headers:{'content-type':'text/html'}});
  }
  if(method==='OPTIONS')return new Response(null,{status:204,headers:{Allow:'GET, HEAD, OPTIONS'}});
  const m=href.match(/\/assets\/index-\w+\.(js|css)/);
  if(m){const ae=h.get('accept-encoding')||'';const hdr={'content-type':m[1]==='js'?'application/javascript':'text/css','cache-control':'public, max-age=31536000, immutable'};
   // EO-like origin: if AE forwarded, labels br + compressed length but hands a plain body
   const plainBody=Buffer.alloc(SIZES[m[1]],m[1]==='js'?'a':'c');
   // 源站/边缘已经解开正文，但仍留下 content-encoding 和压缩前的 content-length。
   if(mode==='stale'){hdr['content-encoding']='br';hdr['content-length']=String(Math.floor(SIZES[m[1]]/5));return new Response(plainBody,{status:200,headers:hdr});}
   // real COS-like origin: AE forwarded → a genuinely compressed body
   if(mode==='real'&&/br|gzip/.test(ae)){const c=/br/.test(ae)?zlib.brotliCompressSync(plainBody):zlib.gzipSync(plainBody);hdr['content-encoding']=/br/.test(ae)?'br':'gzip';hdr['content-length']=String(c.length);return new Response(c,{status:200,headers:hdr});}
   if(/br|gzip/.test(ae)){hdr['content-encoding']=/br/.test(ae)?'br':'gzip';hdr['content-length']=String(Math.floor(SIZES[m[1]]/5));}
   return new Response(Buffer.alloc(SIZES[m[1]],m[1]==='js'?'a':'c'),{status:200,headers:hdr});}
  if(/HGSBPOX6/.test(href)||/AEHTTPS1/.test(href))return new Response(SITE,{status:200,headers:{'content-type':'text/html'}});
  if(/EPX2UU43\/dist\/(index\.html)?$/.test(href)||/EPX2UU43\/dist\/index\.html/.test(href))return new Response(HOME,{status:200,headers:{'content-type':'text/html'}});
  return new Response('<Error>NoSuchKey</Error>',{status:404});}});
 vm.runInContext(src+'\nglobalThis.__h=handle;',ctx);
 return async(url,init)=>{calls.length=0;const reqInit=Object.assign({},init);if(reqInit.body!=null&&!reqInit.duplex)reqInit.duplex='half';const r=await ctx.__h(new Request(url,reqInit),{waitUntil(){},passThroughOnException(){}});const b=Buffer.from(await r.arrayBuffer());
  const origins=calls.filter((c)=>!c.href.includes('/resolve-subdomain')&&!c.href.includes('/check-site-access'));
  return {status:r.status,ce:r.headers.get('content-encoding'),cl:r.headers.get('content-length'),ct:r.headers.get('content-type'),allow:r.headers.get('allow'),route:r.headers.get('x-demox-route'),size:b.length,body:b,text:b.toString('utf8'),fwdAE:calls.map(c=>c.ae).filter(Boolean).join('|')||'-',origins};};}

const BODIES = {
  'subdomain-router.js': fs.readFileSync(path.join(__dirname, 'subdomain-router.js'), 'utf8'),
  'fixtures/live-subdomain-router.71a677cf.js': fs.readFileSync(path.join(__dirname, 'fixtures/live-subdomain-router.71a677cf.js'), 'utf8')
};
test('live fixture sha256 is 71a677cf', () => {
  assert.equal(crypto.createHash('sha256').update(BODIES['fixtures/live-subdomain-router.71a677cf.js']).digest('hex'), '71a677cfea3ce35ceb4b9a1e5b93993b513aac6d635cc4a1cb536c9a20a45a24');
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

// 2026-11-04 云帆 gate2：c4e1d339 对无令牌直连 sites.demox.site 仍转发 AE，源站回真 br，
// 删掉 content-encoding 后客户端拿到压缩字节。c4e1d339 从未上线，fixture 已删除；这里对仓库路由和现网 71a677cf 都跑。
for (const [name, src] of Object.entries(BODIES)) {
  for (const secret of [true, false]) {
    for (const [type, file] of [['js', 'index-DxCBZomZ.js'], ['css', 'index-DWMADRiU.css']]) {
      for (const ae of ['gzip, deflate, br', 'br', 'gzip', '']) {
        test(`${name} secret=${secret} direct sites.demox.site ${type} real-compression origin Accept-Encoding=${ae || 'none'}: plain body`, async () => {
          const run = make(src, secret, 'real');
          const r = await run(`https://sites.demox.site/sites/${PUID}/EPX2UU43/dist/assets/${file}`, { headers: ae ? { 'accept-encoding': ae } : {} });
          assert.equal(r.fwdAE, '-', 'direct origin hit must not forward accept-encoding');
          assert.equal(r.status, 200);
          assert.equal(r.ce, null);
          assert.ok(r.cl == null || Number(r.cl) === r.size, 'content-length ' + r.cl);
          assert.equal(r.size, SIZES[type]);
          assert.ok(r.body.every((x) => x === (type === 'js' ? 97 : 99)), 'body must be plain');
        });
      }
    }
  }
}

// 用户站走 fetchSiteOrigin。现网 71a677cf 仍把访客 Accept-Encoding 带进回源；仓库这一份去掉 AE，
// 重建响应前删 content-encoding / content-length。live fixture 不跑通过用例，只锁住缺口还在。
const repoSrc = BODIES['subdomain-router.js'];
const liveSrc = BODIES['fixtures/live-subdomain-router.71a677cf.js'];

function assertPlainAsset(r, type) {
  assert.equal(r.fwdAE, '-', 'user-site subrequest must not carry accept-encoding');
  assert.equal(r.status, 200);
  assert.equal(r.ce, null);
  assert.ok(r.cl == null || Number(r.cl) === r.size, 'content-length ' + r.cl);
  assert.equal(r.size, SIZES[type]);
  assert.ok(r.body.every((x) => x === (type === 'js' ? 97 : 99)), 'body must be plain');
  assert.ok(r.origins.length >= 1);
  for (const hit of r.origins) {
    assert.equal(hit.ae, null);
    assert.equal(hit.cookie, 'a=1');
    assert.equal(hit.host, null);
  }
}

for (const secret of [true, false]) {
  for (const [type, file] of [['js', 'index-DxCBZomZ.js'], ['css', 'index-DWMADRiU.css']]) {
    for (const ae of ['gzip, deflate, br', 'br', 'gzip', 'identity']) {
      test(`repo secret=${secret} coverage /assets ${type} Accept-Encoding=${ae}: full plain body, cookie kept`, async () => {
        const run = make(repoSrc, secret);
        const r = await run(`https://coverage.demox.site/assets/${file}`, { headers: { 'accept-encoding': ae, cookie: 'a=1' } });
        assertPlainAsset(r, type);
      });
      test(`repo secret=${secret} coverage /assets ${type} real-compression Accept-Encoding=${ae}: plain body, CE matches`, async () => {
        const run = make(repoSrc, secret, 'real');
        const r = await run(`https://coverage.demox.site/assets/${file}`, { headers: { 'accept-encoding': ae, cookie: 'a=1' } });
        assertPlainAsset(r, type);
      });
    }
  }
}

for (const secret of [true, false]) {
  for (const [type, file] of [['js', 'index-DxCBZomZ.js'], ['css', 'index-DWMADRiU.css']]) {
    test(`repo secret=${secret} coverage /assets ${type} stale CE/CL on plain body is dropped`, async () => {
      const run = make(repoSrc, secret, 'stale');
      const r = await run(`https://coverage.demox.site/assets/${file}`, { headers: { 'accept-encoding': 'br', cookie: 'a=1' } });
      assertPlainAsset(r, type);
    });
  }
  for (const ae of ['br', 'gzip', 'identity']) {
    test(`repo secret=${secret} coverage homepage Accept-Encoding=${ae}: full html, no content-encoding`, async () => {
      const run = make(repoSrc, secret);
      const r = await run('https://coverage.demox.site/', { headers: { 'accept-encoding': ae, cookie: 'a=1', accept: 'text/html' } });
      assert.equal(r.fwdAE, '-');
      assert.equal(r.status, 200);
      assert.equal(r.ce, null);
      assert.match(r.text, /Coverage/);
      assert.ok(r.text.length >= SITE.length);
      assert.equal(r.origins[0].cookie, 'a=1');
      assert.equal(r.origins[0].ae, null);
      assert.equal(r.origins[0].host, null);
    });
  }
  test(`repo secret=${secret} coverage POST without Accept-Encoding still forwards the request method`, async () => {
    const run = make(repoSrc, secret);
    const r = await run('https://coverage.demox.site/form', {
      method: 'POST',
      headers: { cookie: 'a=1', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'x=1'
    });
    assert.equal(r.status, 200);
    assert.equal(r.origins[0].method, 'POST');
    assert.equal(r.origins[0].body, 'x=1');
    assert.equal(r.origins[0].cookie, 'a=1');
  });
  for (const method of ['POST', 'PUT', 'OPTIONS']) {
    test(`repo secret=${secret} coverage ${method} with Accept-Encoding is origin GET and keeps cookie`, async () => {
      const run = make(repoSrc, secret);
      const init = { method, headers: { 'accept-encoding': 'gzip, br', cookie: 'a=1', accept: 'text/html' } };
      if (method !== 'OPTIONS') {
        init.body = 'x=1';
        init.headers['content-type'] = 'text/plain';
      }
      const r = await run('https://coverage.demox.site/form', init);
      assert.equal(r.status, 200);
      assert.equal(r.fwdAE, '-');
      assert.equal(r.ce, null);
      assert.equal(r.origins[0].method, 'GET');
      assert.equal(r.origins[0].ae, null);
      assert.equal(r.origins[0].cookie, 'a=1');
      assert.equal(r.origins[0].host, null);
    });
  }
}

test('repo secret https user-site POST keeps method, body, cookie, redirect manual, and strips AE', async () => {
  const run = make(repoSrc, true);
  const r = await run('https://aehttps.demox.site/form', {
    method: 'POST',
    headers: { 'accept-encoding': 'gzip, br', cookie: 'a=1', 'content-type': 'text/plain' },
    body: 'x=1'
  });
  assert.equal(r.status, 200);
  assert.equal(r.fwdAE, '-');
  const hit = r.origins[0];
  assert.ok(hit, JSON.stringify(r.origins));
  assert.equal(hit.method, 'POST');
  assert.equal(hit.body, 'x=1');
  assert.equal(hit.ae, null);
  assert.equal(hit.cookie, 'a=1');
  assert.equal(hit.host, null);
  assert.equal(hit.redirect, 'manual');
  assert.equal(hit.duplex, 'half');
  assert.ok(hit.token);
});

test('repo secret https user-site POST retries without duplex when the runtime rejects it', async () => {
  const run = make(repoSrc, true, 'reject-duplex');
  const r = await run('https://aehttps.demox.site/form', {
    method: 'POST',
    headers: { 'accept-encoding': 'br', cookie: 'a=1', 'content-type': 'text/plain' },
    body: 'x=1'
  });
  assert.equal(r.status, 200);
  assert.equal(r.text, SITE);
  const posted = r.origins.filter((hit) => hit.method === 'POST');
  assert.ok(posted.some((hit) => hit.duplex === 'half'));
  const ok = posted.find((hit) => hit.duplex === '');
  assert.ok(ok, JSON.stringify(posted));
  assert.equal(ok.body, 'x=1');
  assert.equal(ok.ae, null);
  assert.equal(ok.cookie, 'a=1');
  assert.equal(ok.redirect, 'manual');
});

test('live 71a677cf still forwards Accept-Encoding on coverage assets', async () => {
  const run = make(liveSrc, false, 'real');
  const r = await run('https://coverage.demox.site/assets/index-DxCBZomZ.js', { headers: { 'accept-encoding': 'br', cookie: 'a=1' } });
  assert.equal(r.fwdAE, 'br');
  assert.notEqual(r.size, SIZES.js);
});
