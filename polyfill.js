import { parseImports } from "./index.js";

export const hasWasmTypeReflectionSupport = (() => {
    const moduleBytes = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, // magic number
        0x01, 0x00, 0x00, 0x00, // version
        // import section with one import
        0x02, // section code
        0x06, // section length
        0x01, // number of imports
        0x00, // module name length
        0x00, // field name length
        0x02, // import kind: memory
        0x00, // limits flags
        0x01, // initial pages: 1
    ]);
    const module = new WebAssembly.Module(moduleBytes);
    const imports = WebAssembly.Module.imports(module);
    const memoryImport = imports[0];
    return typeof memoryImport.type === "object"
})();

/**
 * Polyfill the WebAssembly object to support "type" field in the import object
 * returned by `WebAssembly.Module.imports` function.
 *
 * @param {WebAssembly} WebAssembly
 * @returns {WebAssembly}
 * @example
 * import fs from "fs";
 * import { polyfill } from "wasm-imports-parser/polyfill";
 *
 * const WebAssembly = polyfill(globalThis.WebAssembly);
 * const module = await WebAssembly.compile(fs.readFileSync(process.argv[2]));
 * for (const imp of WebAssembly.Module.imports(module)) {
 *     console.log(imp);
 * }
 */
export function polyfill(WebAssembly) {
    // Check if the WebAssembly type reflection is supported.

    if (hasWasmTypeReflectionSupport) {
        // If the WebAssembly type reflection is supported, no need to polyfill.
        return WebAssembly;
    }

    // Re-construct the WebAssembly object with the polyfill.
    const newWebAssembly = {};
    // Copy all properties from the original WebAssembly object.
    // Some properties are not enumerable, so we need to use Object.getOwnPropertyDescriptors.
    for (const key in Object.getOwnPropertyDescriptors(WebAssembly)) {
        newWebAssembly[key] = WebAssembly[key];
    }
    // Hook the Module constructor to store the source bytes.
    const newModule = newWebAssembly.Module = function (bytes) {
        const module = new WebAssembly.Module(bytes);
        module[sourceBytesSymbol] = bytes;
        Object.setPrototypeOf(module, newModule.prototype);
        return module;
    }
    Object.setPrototypeOf(newModule.prototype, WebAssembly.Module.prototype);

    // Symbol to store the source bytes inside WebAssembly.Module object.
    const sourceBytesSymbol = Symbol("sourceBytes");

    // Hook the compile function to store the source bytes.
    newWebAssembly.compile = async (source) => {
        const module = await WebAssembly.compile(source);
        module[sourceBytesSymbol] = source;
        return module;
    };

    // Hook the compileStreaming function too if supported.
    if (WebAssembly.compileStreaming) {
        newWebAssembly.compileStreaming = async (source) => {
            const response = await source;
            const clone = response.clone();
            const module = await WebAssembly.compileStreaming(response);
            module[sourceBytesSymbol] = new Uint8Array(await clone.arrayBuffer());
            return module;
        };
    }

    // Polyfill the WebAssembly.Module.imports function.
    newModule.imports = (module) => {
        const sourceBytes = module[sourceBytesSymbol];
        if (!sourceBytes) {
            // If the source bytes are not available for some reason, fallback to the original function.
            return WebAssembly.Module.imports(module);
        }
        return parseImports(sourceBytes);
    };

    return newWebAssembly;
}

