import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { parseImports } from "../index.js";
import { polyfill, hasWasmTypeReflectionSupport } from '../polyfill.js';

function run(command, args) {
  console.log(`$ "${command}" ${args.map(arg => `"${arg}"`).join(" ")}`);
  return execFileSync(command, args, { stdio: 'inherit' });
}

function prepare(testsuitePath) {
  const revision = fs.readFileSync("test/testsuite.revision", "utf8").trim();
  const files = [
    "binary.wast",
    "imports.wast",
    "utf8-import-field.wast",
    "utf8-import-module.wast",
    "linking.wast",
  ]

  for (const file of files) {
    if (fs.existsSync(`${testsuitePath}/${file}`)) {
      continue;
    }
    run("curl", [`https://raw.githubusercontent.com/WebAssembly/testsuite/${revision}/${file}`, "-o", `${testsuitePath}/${file}`]);
    run("wast2json", [`${testsuitePath}/${file}`, "-o", `${testsuitePath}/${file}.json`]);
  }
}

function isStructurallyEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (!keysB.includes(key) || !isStructurallyEqual(a[key], b[key])) {
      return false;
    }
  }
  return true;
}

const minimalModuleBytes = new Uint8Array([
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

async function check(wasmFilePath) {
  const bytes = fs.readFileSync(wasmFilePath);
  let module;
  try {
    module = await WebAssembly.compile(bytes);
  } catch {
    // Skip invalid wasm files
    return true;
  }
  const expected = WebAssembly.Module.imports(module);
  const actual = parseImports(bytes);
  if (actual.length !== expected.length) {
    process.stdout.write("\x1b[31mF\x1b[0m\n");
    console.error(`Expected ${expected.length} imports, but got ${actual.length}`);
    return false;
  }
  for (let i = 0; i < expected.length; i++) {
    const actualImport = actual[i];
    const expectedImport = expected[i];
    if (!isStructurallyEqual(actualImport, expectedImport)) {
      process.stdout.write("\x1b[31mF\x1b[0m\n");
      console.error(`Mismatch at import ${i}`);
      console.error(`  Expected `, expectedImport);
      console.error(`  Actual   `, actualImport);
      return false;
    }
  }
  process.stdout.write("\x1b[32m.\x1b[0m");
  return true;
}

async function checkApiSurface() {
  const bytes = minimalModuleBytes;
  for (const source of [
    bytes,
    bytes.buffer,
    new DataView(bytes.buffer),
  ]) {
    try {
      parseImports(source);
    } catch (e) {
      process.stdout.write("\x1b[31mF\x1b[0m\n");
      console.error(`Failed to parse imports from ${source}`);
      console.error(e);
      return false;
    }
    process.stdout.write("\x1b[32m.\x1b[0m");
  }
  return true;
}

async function checkPolyfill() {
  const bytes = minimalModuleBytes;
  const polyfilledWebAssembly = polyfill(WebAssembly);
  for (const getModule of [
    {
      name: "new WebAssembly.Module",
      async: false,
      fn: () => new polyfilledWebAssembly.Module(bytes)
    },
    {
      name: "compile",
      async: true,
      fn: async () => polyfilledWebAssembly.compile(bytes)
    },
    {
      name: "compileStreaming",
      async: true,
      fn: async () => {
        const headers = new Headers();
        headers.set("Content-Type", "application/wasm");
        const response = new Response(bytes, { headers: headers });
        return polyfilledWebAssembly.compileStreaming(response)
      }
    },
  ]) {
    let imports;
    try {
      let module;
      if (getModule.async) {
        module = await getModule.fn();
      } else {
        module = getModule.fn();
      }
      imports = polyfilledWebAssembly.Module.imports(module);
    } catch (e) {
      process.stdout.write("\x1b[31mF\x1b[0m\n");
      console.error(`Failed to get imports by ${getModule.name}`);
      console.error(e);
      return false;
    }
    if (imports.length !== 1) {
      process.stdout.write("\x1b[31mF\x1b[0m\n");
      return false;
    }
    const memoryImport = imports[0];
    if (typeof memoryImport.type !== "object") {
      process.stdout.write("\x1b[31mF\x1b[0m\n");
      return false;
    }

    if (memoryImport.type.minimum !== 1) {
      process.stdout.write("\x1b[31mF\x1b[0m\n");
      return false;
    }

    process.stdout.write("\x1b[32m.\x1b[0m");
  }
  return true;
}

async function main() {
  let filesToCheck = [];
  if (process.argv.length > 2) {
    filesToCheck = process.argv.slice(2);
  } else {
    const testsuitePath = "test/testsuite";
    fs.mkdirSync(testsuitePath, { recursive: true });
    prepare(testsuitePath);
    filesToCheck = fs.readdirSync(testsuitePath).filter(file => file.endsWith(".wasm"))
      .map(file => `${testsuitePath}/${file}`);
  }

  if (hasWasmTypeReflectionSupport) {
    console.log("Checking compatibility with native implementation");
    for (const file of filesToCheck) {
      try {
        const ok = await check(file);
        if (!ok) {
          console.error(`Check failed for ${file}`);
          process.exit(1);
        }
      } catch (e) {
        process.stdout.write("\x1b[31mF\x1b[0m\n");
        console.error(`Check failed for ${file}: ${e}`);
        process.exit(1);
      }
    }
  }

  process.stdout.write("\n");

  console.log("Checking API surface");
  checkApiSurface();

  process.stdout.write("\n");

  console.log("Checking polyfill");

  const ok = await checkPolyfill();
  if (!ok) {
    console.error("Polyfill check failed");
    process.exit(1);
  }
  process.stdout.write("\n");
}

await main();
