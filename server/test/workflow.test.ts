import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import { Writable } from 'node:stream';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yauzl from 'yauzl';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';
import { hashPassword } from '../src/auth/password.js';
import type { AuthOptions } from '../src/auth/index.js';
import type { AssetOptions } from '../src/assets/index.js';

const migrations = fileURLToPath(new URL('../../migrations', import.meta.url));
const password = 'Flujo HTTP de prueba 2026!';
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function failingWriter(code: string): Writable {
  return new Writable({ write(_chunk, _encoding, callback) { callback(Object.assign(new Error(code), { code })); } });
}

async function readZip(buffer: Buffer): Promise<Array<{ name:string; data:Buffer }>> {
  return new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(error,zip)=>{
    if(error||!zip)return reject(error);
    const entries:Array<{name:string;data:Buffer}>=[];
    zip.on('error',reject); zip.on('end',()=>resolve(entries));
    zip.on('entry',entry=>zip.openReadStream(entry,(readError,stream)=>{
      if(readError||!stream)return reject(readError);
      const chunks:Buffer[]=[]; stream.on('data',chunk=>chunks.push(chunk as Buffer)); stream.on('error',reject);
      stream.on('end',()=>{entries.push({name:entry.fileName,data:Buffer.concat(chunks)});zip.readEntry()});
    })); zip.readEntry();
  }));
}

test('flujo HTTP integrado conserva archivos tras fallos, expiración, movimiento y ZIP', { timeout:45_000 }, async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'qtd-workflow-'));
  const db=openDatabase(dir,migrations);
  const passwordHash=await hashPassword(password);
  db.prepare('INSERT INTO personal_account VALUES (1, ?, ?)').run(passwordHash,new Date().toISOString());
  let now=Date.now(); let failNextWrite=false;
  const options:AuthOptions={production:false,publicOrigin:'http://127.0.0.1:5173',androidOrigins:[],sessionTtlSeconds:3600,pairingTtlSeconds:300,now:()=>now};
  const storage:AssetOptions={dataDir:dir,maxFileBytes:16*1024*1024,createWriteStream(file){if(failNextWrite){failNextWrite=false;return failingWriter('ENOSPC')}return createWriteStream(file,{flags:'wx'})}};
  let app=await buildApp(db,path.join(dir,'missing'),options,storage); app.log.level='silent';
  await app.listen({host:'127.0.0.1',port:0});
  const address=app.server.address(); assert.ok(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`; const origin=options.publicOrigin;
  const send=(url:string,init:RequestInit={})=>{const headers=new Headers(init.headers);headers.set('origin',origin);return fetch(`${base}${url}`,{...init,headers})};
  let cookie=''; let csrf='';
  const login=async()=>{
    const response=await send('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})});
    assert.equal(response.status,200); cookie=response.headers.get('set-cookie')!.split(';')[0]; csrf=(await response.json() as {csrfToken:string}).csrfToken;
  };
  const writeHeaders=()=>({cookie,'x-csrf-token':csrf});
  const createProduct=async(name:string)=>{
    const response=await send('/api/products',{method:'POST',headers:{...writeHeaders(),'content-type':'application/json'},body:JSON.stringify({name})});
    assert.equal(response.status,201); return await response.json() as {id:string;name:string};
  };
  const upload=async(productId:string,key:string,fileName:string,data:Buffer)=>{
    const form=new FormData(); form.append('file',new Blob([new Uint8Array(data)],{type:'image/png'}),fileName);
    return send(`/api/products/${productId}/assets`,{method:'POST',headers:{...writeHeaders(),'Idempotency-Key':key,'X-File-SHA256':digest(data),'X-File-Size':String(data.length)},body:form});
  };
  try {
    assert.equal((await send('/api/products')).status,401);
    await login();
    const source=await createProduct('Colección repetida'); const target=await createProduct('Colección repetida');
    assert.notEqual(source.id,target.id,'los nombres iguales conservan IDs distintos');
    const firstImage=await sharp({create:{width:32,height:24,channels:3,background:{r:30,g:145,b:170}}}).png().toBuffer();
    const secondImage=await sharp({create:{width:24,height:32,channels:3,background:{r:200,g:90,b:70}}}).png().toBuffer();
    const first=await upload(source.id,`workflow-first-${randomUUID()}`,'uno.png',firstImage);
    assert.equal(first.status,201); const firstId=(await first.json() as {id:string}).id;

    const retryKey=`workflow-retry-${randomUUID()}`; failNextWrite=true;
    const failed=await upload(source.id,retryKey,'dos.png',secondImage);
    assert.equal(failed.status,507,'el fallo parcial se comunica, no se simula como éxito');
    const recovered=await upload(source.id,retryKey,'dos.png',secondImage);
    assert.equal(recovered.status,201); const secondId=(await recovered.json() as {id:string}).id;
    assert.notEqual(firstId,secondId);

    const largeImage=await sharp({create:{width:1024,height:1024,channels:3,background:{r:28,g:100,b:150}}}).png({compressionLevel:0}).toBuffer();
    const cancelKey=`workflow-cancel-${randomUUID()}`; const boundary=`qtd-${randomUUID()}`;
    const head=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="interrumpido.png"\r\nContent-Type: image/png\r\n\r\n`);
    const tail=Buffer.from(`\r\n--${boundary}--\r\n`);
    const req=httpRequest(`${base}/api/products/${source.id}/assets`,{method:'POST',headers:{origin,cookie,'x-csrf-token':csrf,'content-type':`multipart/form-data; boundary=${boundary}`,'content-length':String(head.length+largeImage.length+tail.length),'Idempotency-Key':cancelKey,'X-File-SHA256':digest(largeImage),'X-File-Size':String(largeImage.length)}},response=>response.resume());
    const disconnected=new Promise<void>(resolve=>{req.on('error',()=>resolve());req.on('close',()=>resolve())});
    req.write(head); req.write(largeImage.subarray(0,64*1024));
    let receiving=false;
    for(let i=0;i<100;i++){receiving=(db.prepare('SELECT state FROM upload_attempts WHERE idempotency_key=?').get(cancelKey) as {state:string}|undefined)?.state==='receiving';if(receiving)break;await delay(10)}
    assert.ok(receiving,'el servidor reservó el intento antes de simular el corte');
    req.destroy(); await disconnected;
    let state:string|undefined;
    for(let i=0;i<100;i++){state=(db.prepare('SELECT state FROM upload_attempts WHERE idempotency_key=?').get(cancelKey) as {state:string}|undefined)?.state;if(state==='failed')break;await delay(20)}
    assert.equal(state,'failed','una subida interrumpida se marca fallida antes de reintentar');
    const resumed=await upload(source.id,cancelKey,'interrumpido.png',largeImage);
    assert.equal(resumed.status,201); const largeId=(await resumed.json() as {id:string}).id;

    const listed=await send(`/api/products/${source.id}/assets`,{headers:{cookie}});
    const sourceAssets=await listed.json() as {items:Array<{id:string;assignedName:string}>;total:number};
    assert.equal(sourceAssets.total,3,'subir más archivos agrega al producto y los completados no se duplican');
    assert.equal(new Set(sourceAssets.items.map(x=>x.id)).size,3);
    const ordering=await send(`/api/products/${source.id}/order`,{method:'POST',headers:{...writeHeaders(),'content-type':'application/json'},body:JSON.stringify({assetIds:[largeId,secondId,firstId]})});
    assert.equal(ordering.status,200);
    const moved=await send('/api/assets/move',{method:'POST',headers:{...writeHeaders(),'content-type':'application/json'},body:JSON.stringify({assetIds:[firstId,secondId,largeId],targetProductId:target.id})});
    assert.equal(moved.status,200,await moved.clone().text());
    const targetList=await send(`/api/products/${target.id}/assets`,{headers:{cookie}});
    const targetAssets=await targetList.json() as {items:Array<{id:string}>;total:number};
    assert.equal(targetAssets.total,3); assert.deepEqual(new Set(targetAssets.items.map(x=>x.id)),new Set([firstId,secondId,largeId]));
    assert.equal((await send(`/api/products/${source.id}/assets`,{headers:{cookie}}).then(r=>r.json()) as {total:number}).total,0);

    for(const route of ['content','thumbnail','download']) assert.equal((await fetch(`${base}/api/assets/${firstId}/${route}`)).status,401,`${route} no es público`);
    assert.equal((await fetch(`${base}/api/products/${target.id}/download.zip`)).status,401,'ZIP tampoco es público');
    const ticketResponse=await send(`/api/assets/${firstId}/ticket`,{method:'POST',headers:{...writeHeaders(),'content-type':'application/json'},body:JSON.stringify({scope:'content'})});
    assert.equal(ticketResponse.status,200); const ticket=await ticketResponse.json() as {url:string};
    const content=await fetch(new URL(ticket.url,base)); assert.equal(content.status,200); assert.equal(digest(Buffer.from(await content.arrayBuffer())),digest(firstImage));
    const zipResponse=await send(`/api/products/${target.id}/download.zip`,{headers:{cookie}});
    assert.equal(zipResponse.status,200); const entries=await readZip(Buffer.from(await zipResponse.arrayBuffer()));
    assert.equal(entries.length,3); assert.deepEqual(new Set(entries.map(x=>digest(x.data))),new Set([digest(firstImage),digest(secondImage),digest(largeImage)]));

    now+=options.sessionTtlSeconds*1000+1;
    assert.equal((await send('/api/products',{headers:{cookie}})).status,401,'la sesión expirada deja de acceder');
    await login();
    const afterLogin=await send('/api/products?page=1&pageSize=100',{headers:{cookie}});
    const finalProducts=await afterLogin.json() as {items:Array<{id:string;name:string;assetCount:number}>};
    assert.equal(finalProducts.items.length,2); assert.ok(finalProducts.items.every(x=>x.name==='Colección repetida'));
    assert.equal(finalProducts.items.find(x=>x.id===target.id)?.assetCount,3,'los bytes y relaciones sobreviven al reingreso');
  } finally { await app.close(); rmSync(dir,{recursive:true,force:true}); }
});
