type ValueType = "i32" | "i64" | "f32" | "f64" | "funcref" | "externref";
type FunctionType = { parameters: ValueType[], results: ValueType[] };
type TableType = { element: "funcref" | "externref", minimum: number, maximum?: number };
type MemoryType = { minimum: number, maximum?: number, shared: boolean, index: "i32" | "i64" };
type GlobalType = { value: ValueType, mutable: boolean };
type ImportEntry = { module: string, name: string } & (
  { kind: "function", type: FunctionType } |
  { kind: "table", type: TableType } |
  { kind: "memory", type: MemoryType } |
  { kind: "global", type: GlobalType }
);

export declare function parseImports(moduleBytes: BufferSource): ImportEntry[]
