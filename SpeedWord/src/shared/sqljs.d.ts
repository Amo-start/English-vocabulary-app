// sql.js 类型声明（本项目仅用到 subset 的 API）。
// 不引入 @types/sql.js：其 export= 形态与 esModuleInterop 下的
// `import * as` / 命名类型导入存在摩擦；此处按实际用法声明即可。
declare module "sql.js" {
  export class Statement {
    bind(params?: unknown[]): void;
    run(params?: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  export class Database {
    constructor(data?: Uint8Array | ArrayLike<number> | null);
    exec(sql: string): unknown[];
    run(sql: string, params?: unknown[]): unknown;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;
}
