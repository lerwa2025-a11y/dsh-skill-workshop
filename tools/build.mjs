/**
 * Assemble the browser bundle.
 *
 * The page's stylesheet is inlined into `client.js` as a string, because the
 * Client module loader serves one JavaScript file per plugin and offers no
 * stylesheet hook. One substitution, no bundler: the source is already plain
 * CommonJS-in-a-factory and needs no transformation.
 *
 *   node tools/build.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const [source, css] = await Promise.all([
  readFile(join(root, 'src', 'client.js'), 'utf8'),
  readFile(join(root, 'src', 'client.css'), 'utf8'),
])

if (!source.includes('CSS__')) throw new Error('src/client.js no longer carries the CSS__ placeholder')

// A JSON string literal is valid JavaScript, and the loader hands the file to
// the browser as-is, so the stylesheet survives quotes, backslashes and braces.
const output = source.replace('CSS__', JSON.stringify(css))
await writeFile(join(root, 'client.js'), output, 'utf8')

const bytes = Buffer.byteLength(output, 'utf8')
console.log(`client.js  ${(bytes / 1024).toFixed(1)} KiB  (css ${(Buffer.byteLength(css, 'utf8') / 1024).toFixed(1)} KiB)`)
