// 交付检查：验证实际 ESM 和独立浏览器包的公开入口，不加载真实厂商脚本。
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import vm from 'node:vm'

const root = fileURLToPath(new URL('../', import.meta.url))
const esm = await import(pathToFileURL(resolve(root, 'web/dist/aliyun-captcha.js')).href)
assert.equal(typeof esm.mountAliyunCaptcha, 'function')
assert.equal(typeof esm.AliyunCaptcha, 'function')
const browser = { console, setTimeout, clearTimeout }
browser.window = browser
vm.runInNewContext(readFileSync(resolve(root, 'web/dist/aliyun-captcha.iife.js'), 'utf8'), browser, { timeout: 5000 })
assert.equal(typeof browser.AliyunCaptchaSDK.mountAliyunCaptcha, 'function')
for (const declaration of ['index.d.ts', 'react.d.ts', 'mount.d.ts']) assert.ok(existsSync(resolve(root, 'web/dist', declaration)))
console.log('ESM、独立浏览器包和类型声明入口均通过交付检查')
