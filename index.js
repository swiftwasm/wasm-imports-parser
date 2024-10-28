// @ts-check
/**
 * @typedef {import("./index.d.ts").ImportEntry } ImportEntry
 * @typedef {import("./index.d.ts").FunctionType } FunctionType
 * @typedef {import("./index.d.ts").TableType } TableType
 * @typedef {import("./index.d.ts").MemoryType } MemoryType
 * @typedef {import("./index.d.ts").ValueType } ValueType
 */

/**
 * Parse a WebAssembly module bytes and return the imports entries.
 *
 * @param {BufferSource} moduleBytes - The WebAssembly module bytes.
 * @returns {ImportEntry[]} - The import entries.
 * @throws {Error} - If the module bytes are invalid.
 *
 * @example
 * import { parseImports } from "wasm-imports-parser";
 *
 * function mockImports(imports) {
 *   let mock = {};
 *   for (const imp of imports) {
 *     let value;
 *     switch (imp.kind) {
 *       case "table":
 *         value = new WebAssembly.Table(imp.type);
 *         break;
 *       case "memory":
 *         value = new WebAssembly.Memory(imp.type);
 *         break;
 *       case "global":
 *         value = new WebAssembly.Global(imp.type, undefined);
 *         break;
 *       case "function":
 *         value = () => { throw "unimplemented" };
 *         break;
 *     }
 *     if (! (imp.module in mock)) mock[imp.module] = {};
 *     mock[imp.module][imp.name] = value;
 *   }
 *   return mock;
 * }
 *
 * const imports = parseImports(moduleBytes);
 * const importObject = mockImports(imports);
 * const { instance } = await WebAssembly.instantiate(moduleBytes, importObject);
 */
export function parseImports(moduleBytes) {
  if (moduleBytes instanceof Uint8Array) {
    // no cast needed
  } else if (moduleBytes instanceof ArrayBuffer) {
    // cast ArrayBuffer to Uint8Array
    moduleBytes = new Uint8Array(moduleBytes);
  } else if (moduleBytes.buffer instanceof ArrayBuffer) {
    // cast TypedArray or DataView to Uint8Array
    moduleBytes = new Uint8Array(moduleBytes.buffer);
  } else {
    throw new Error("Argument must be a buffer source, like Uint8Array or ArrayBuffer");
  }
  const parseState = new ParseState(moduleBytes);
  parseMagicNumber(parseState);
  parseVersion(parseState);

  /**
   * @type {FunctionType[]}
   */
  const types = [];
  /**
   * @type {ImportEntry[]}
   */
  const imports = [];

  while (parseState.hasMoreBytes()) {
    const sectionId = parseState.readByte();
    const sectionSize = parseState.readUnsignedLEB128();
    switch (sectionId) {
      case 1: {
        // Type section
        const typeCount = parseState.readUnsignedLEB128();
        for (let i = 0; i < typeCount; i++) {
          types.push(parseFunctionType(parseState));
        }
        break;
      }
      case 2: {
        // Ok, found import section
        const importCount = parseState.readUnsignedLEB128();
        for (let i = 0; i < importCount; i++) {
          const module = parseState.readName();
          const name = parseState.readName();
          const type = parseState.readByte();
          switch (type) {
            case 0x00:
              const index = parseState.readUnsignedLEB128();
              imports.push({ module, name, kind: "function", type: types[index] });
              break;
            case 0x01:
              imports.push({ module, name, kind: "table", type: parseTableType(parseState) });
              break;
            case 0x02:
              imports.push({ module, name, kind: "memory", type: parseLimits(parseState) });
              break;
            case 0x03:
              imports.push({ module, name, kind: "global", type: parseGlobalType(parseState) });
              break;
            default:
              throw new Error(`Unknown import descriptor type ${type}`);
          }
        }
        // Skip the rest of the module
        return imports;
      }
      default: {
        parseState.skipBytes(sectionSize);
        break;
      }
    }
  }
  return [];
}

class ParseState {
  constructor(moduleBytes) {
    this.moduleBytes = moduleBytes;
    this.offset = 0;
    this.textDecoder = new TextDecoder("utf-8");
  }

  hasMoreBytes() {
    return this.offset < this.moduleBytes.length;
  }

  readByte() {
    return this.moduleBytes[this.offset++];
  }

  skipBytes(count) {
    this.offset += count;
  }

  /// Read unsigned LEB128 integer
  readUnsignedLEB128() {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = this.readByte();
      result |= (byte & 0x7F) << shift;
      shift += 7;
    } while (byte & 0x80);
    return result;
  }

  readName() {
    const nameLength = this.readUnsignedLEB128();
    const nameBytes = this.moduleBytes.slice(this.offset, this.offset + nameLength);
    const name = this.textDecoder.decode(nameBytes);
    this.offset += nameLength;
    return name;
  }

  assertBytes(expected) {
    const baseOffset = this.offset;
    const expectedLength = expected.length;
    for (let i = 0; i < expectedLength; i++) {
      if (this.moduleBytes[baseOffset + i] !== expected[i]) {
        throw new Error(`Expected ${expected} at offset ${baseOffset}`);
      }
    }
    this.offset += expectedLength;
  }
}

function parseMagicNumber(parseState) {
  const expected = [0x00, 0x61, 0x73, 0x6D];
  parseState.assertBytes(expected);
}

function parseVersion(parseState) {
  const expected = [0x01, 0x00, 0x00, 0x00];
  parseState.assertBytes(expected);
}

/**
 * @returns {TableType}
 */
function parseTableType(parseState) {
  const elementType = parseState.readByte();
  /**
   * @type {"funcref" | "externref"}
   */
  let element;
  switch (elementType) {
    case 0x70:
      element = "funcref";
      break;
    case 0x6F:
      element = "externref";
      break;
    default:
      throw new Error(`Unknown table element type ${elementType}`);
  }
  const { minimum, maximum } = parseLimits(parseState);
  if (maximum) {
    return { element, minimum, maximum };
  } else {
    return { element, minimum };
  }
}

/**
 * @returns {MemoryType}
 */
function parseLimits(parseState) {
  const flags = parseState.readByte();
  const minimum = parseState.readUnsignedLEB128();
  const hasMaximum = flags & 1;
  const shared = (flags & 2) !== 0;
  const isMemory64 = (flags & 4) !== 0;
  const index = isMemory64 ? "i64" : "i32";
  if (hasMaximum) {
    const maximum = parseState.readUnsignedLEB128();
    return { minimum, shared, index, maximum };
  } else {
    return { minimum, shared, index };
  }
}

function parseGlobalType(parseState) {
  const value = parseValueType(parseState);
  const mutable = parseState.readByte() === 1;
  return { value, mutable };
}

/**
 * @returns {ValueType}
 */
function parseValueType(parseState) {
  const type = parseState.readByte();
  switch (type) {
    case 0x7F:
      return "i32";
    case 0x7E:
      return "i64";
    case 0x7D:
      return "f32";
    case 0x7C:
      return "f64";
    case 0x70:
      return "funcref";
    case 0x6f:
      return "externref";
    case 0x7B:
      return "v128";
    default:
      throw new Error(`Unknown value type ${type}`);
  }
}

function parseFunctionType(parseState) {
  const form = parseState.readByte();
  if (form !== 0x60) {
    throw new Error(`Expected function type form 0x60, got ${form}`);
  }
  /**
   * @type {ValueType[]}
   */
  const parameters = [];
  const parameterCount = parseState.readUnsignedLEB128();
  for (let i = 0; i < parameterCount; i++) {
    parameters.push(parseValueType(parseState));
  }
  /**
   * @type {ValueType[]}
   */
  const results = [];
  const resultCount = parseState.readUnsignedLEB128();
  for (let i = 0; i < resultCount; i++) {
    results.push(parseValueType(parseState));
  }
  return { parameters, results };
}
