declare module "sql.js" {
  export interface Statement {
    bind(values: (string | number | null)[]): boolean;
    step(): boolean;
    getAsObject(): any;
    run(values?: (string | number | null)[]): void;
    free(): void;
  }
  export interface Database {
    run(sql: string): void;
    exec(sql: string): any[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
    create_function(name: string, fn: (...args: any[]) => any): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }
  export default function initSqlJs(opts?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
