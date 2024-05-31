# wasm-imports-parser

[![npm version](https://badge.fury.io/js/wasm-imports-parser.svg)](https://badge.fury.io/js/wasm-imports-parser)

A simple parser for WebAssembly imports with [WebAssembly Type Reflection JS API](https://github.com/WebAssembly/js-types/blob/main/proposals/js-types/Overview.md) compatibility.

Typically useful for constructing shared memory with a limit requested by imports of a WebAssembly module.

## Installation

```
npm install wasm-imports-parser
```

## Example


```js
import { parseImports } from 'wasm-imports-parser';

const moduleBytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x02, 0x06, 0x01, 0x00, 0x00, 0x02, 0x00, 0x01,
]);
const imports = parseImports(moduleBytes);
console.log(imports);
// > [
// >   {
// >     module: '',
// >     name: '',
// >     kind: 'memory',
// >     type: { minimum: 1, shared: false, index: 'i32' }
// >   }
// > ]
```

## As a polyfill for [WebAssembly Type Reflection JS API](https://github.com/WebAssembly/js-types/blob/main/proposals/js-types/Overview.md)

This parser can be used as a polyfill for the WebAssembly Type Reflection JS API.

```js
import { polyfill } from 'wasm-imports-parser/polyfill.js';

const WebAssembly = polyfill(globalThis.WebAssembly);

const moduleBytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x02, 0x06, 0x01, 0x00, 0x00, 0x02, 0x00, 0x01,
]);
const module = await WebAssembly.compile(moduleBytes);
const imports = WebAssembly.Module.imports(module);
console.log(imports);
// > [
// >   {
// >     module: '',
// >     name: '',
// >     kind: 'memory',
// >     type: { minimum: 1, shared: false, index: 'i32' }
// >   }
// > ]
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
