import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import sharp from 'sharp';
import { openDatabase } from '../server/dist/db/index.js';
import { buildApp } from '../server/dist/app.js';
import { hashPassword } from '../server/dist/auth/password.js';

// Build with VITE_API_BASE_URL=https://picker.test; provide Playwright from the host.
// All API requests are intercepted; the browser never contacts that host.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
test('ambos botones seleccionan lotes; web sube originales y Android usa el puente', { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'qtd-picker-'));
  let app, browser;
  try {
    const db = openDatabase(dir, path.resolve('server/migrations'));
    const password = 'Prueba local de selector';
    db.prepare('INSERT INTO personal_account VALUES (1, ?, ?)').run(await hashPassword(password), new Date().toISOString());
    const reservation = createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const auth = { production:false, publicOrigin:`http://127.0.0.1:${port}`, androidOrigins:[], sessionTtlSeconds:3600, pairingTtlSeconds:300 };
    app = await buildApp(db, path.resolve('web/dist'), auth, { dataDir:dir, maxFileBytes:1048576 });
    app.log.level = 'silent';
    const base = await app.listen({ host:'127.0.0.1', port });
    browser = await chromium.launch({ channel:'msedge', headless:true });
    const page = await browser.newPage();
    await page.route('**/api/**', async route => {
      const request = route.request();
      const cors = { 'access-control-allow-origin':base, 'access-control-allow-credentials':'true', 'access-control-allow-headers':'content-type,x-csrf-token,idempotency-key,x-file-sha256,x-file-size' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status:204, headers:cors });
      const url = new URL(request.url());
      const response = await route.fetch({ url:`${base}${url.pathname}${url.search}`, headers:{ ...request.headers(), origin:base } });
      await route.fulfill({ response, headers:{ ...response.headers(), ...cors } });
    });
    await page.goto(base);
    await page.locator('input[type=password]').fill(password);
    await page.locator('button[type=submit], .login-submit').click();
    await page.getByRole('button', { name:'Nuevo producto', exact:true }).click();
    await page.getByLabel('Nombre del producto', { exact:true }).fill('Lote de prueba');
    await page.getByRole('button', { name:'Guardar', exact:true }).click();
    await page.getByRole('button', { name:'Abrir Lote de prueba; fotos previas' }).click();
    const png = await sharp({ create:{ width:4, height:4, channels:3, background:'#167a78' } }).png().toBuffer();
    for (const [button, count] of [['Agregar archivos', 2], ['Seleccionar archivos', 4]]) {
      const chooserPromise = page.waitForEvent('filechooser');
      await page.getByRole('button', { name:button, exact:true }).click();
      const chooser = await chooserPromise;
      assert.equal(chooser.isMultiple(), true);
      await chooser.setFiles([1,2].map(n => ({ name:`foto-${count}-${n}.png`, mimeType:'image/png', buffer:png })));
      await page.waitForFunction(n => document.querySelectorAll('.queue-file-icon.complete').length === n, count);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n, count);
    }
    // Controlled native boundary, not a hardware/SAF acceptance test.
    const native = await browser.newContext();
    await native.addInitScript(() => {
      window.androidBridge = {};
      window.pickerCalls = 0;
      const methods = ['getToken','pickMedia','keepScreenAwake','upload','addListener'];
      window.Capacitor = {
        PluginHeaders:[{ name:'NativeDrive', methods:methods.map(name => ({ name, rtype:'promise' })) }],
        nativePromise:async (_plugin, method) => {
          if (method === 'getToken') return { token:'test-boundary' };
          if (method === 'pickMedia') { window.pickerCalls++; return { items:[1,2,3].map(n => ({ id:`uri-${n}`, uri:`content://test/${n}`, name:`nativa-${n}.png`, size:100, mimeType:'image/png' })) }; }
          if (method === 'upload') return new Promise(() => {});
          return { remove:() => {} };
        },
      };
    });
    const product = { id:'native-test', name:'Prueba nativa', assetCount:0, coverAssetId:null, createdAt:new Date().toISOString() };
    const nativePage = await native.newPage();
    await nativePage.route('**/api/products**', route => route.fulfill({ json:route.request().url().includes('/assets') ? { items:[],total:0,page:1,pageSize:100 } : { items:[product],total:1,page:1,pageSize:24 } }));
    await nativePage.goto(base);
    await nativePage.getByRole('button', { name:'Abrir Prueba nativa; fotos previas' }).click();
    for (const [button, count] of [['Agregar archivos',3], ['Seleccionar archivos',6]]) {
      await nativePage.getByRole('button', { name:button, exact:true }).click();
      await nativePage.waitForFunction(n => document.querySelectorAll('.queue-item').length === n, count);
    }
    assert.equal(await nativePage.evaluate(() => window.pickerCalls), 2);
  } finally {
    await browser?.close();
    await app?.close();
    await rm(dir, { recursive:true, force:true });
  }
});
