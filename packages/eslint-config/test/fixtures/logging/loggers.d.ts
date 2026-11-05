// Stand-ins for the logger declarations that the logging rules read, copied from @nestjs/common
// 12.3.2, pino 10.4.0 and nestjs-pino 5.3.1: the same overloads and parameter names, everything
// else left out. @medibooker/eslint-config does not depend on these packages; the API's lint
// proves the rules against the installed declarations. The nest fixture references this file.

declare module '@nestjs/common' {
  export interface LoggerService {
    log(message: any, ...optionalParams: any[]): any;
    error(message: any, ...optionalParams: any[]): any;
    warn(message: any, ...optionalParams: any[]): any;
    debug?(message: any, ...optionalParams: any[]): any;
    verbose?(message: any, ...optionalParams: any[]): any;
    fatal?(message: any, ...optionalParams: any[]): any;
  }

  export class Logger implements LoggerService {
    constructor();
    constructor(context: string);
    constructor(context: string, options?: { timestamp?: boolean });
    error(message: any, stack?: string, context?: string): void;
    error(message: any, ...optionalParams: [...any, string?, string?]): void;
    log(message: any, context?: string): void;
    log(message: any, ...optionalParams: [...any, string?]): void;
    warn(message: any, context?: string): void;
    warn(message: any, ...optionalParams: [...any, string?]): void;
    debug(message: any, context?: string): void;
    debug(message: any, ...optionalParams: [...any, string?]): void;
    verbose(message: any, context?: string): void;
    verbose(message: any, ...optionalParams: [...any, string?]): void;
    fatal(message: any, context?: string): void;
    fatal(message: any, ...optionalParams: [...any, string?]): void;
    static log(message: any, context?: string): void;
    static log(message: any, ...optionalParams: [...any, string?]): void;
  }
}

declare module 'pino' {
  type PlaceholderSpecifier = 'd' | 's' | 'j' | 'o' | 'O';
  type PlaceholderTypeMapping<T extends PlaceholderSpecifier> = T extends 'd'
    ? number
    : T extends 's'
      ? unknown
      : T extends 'j' | 'o' | 'O'
        ? {} | null
        : never;
  type ParseLogFnArgs<
    T,
    Acc extends unknown[] = [],
  > = T extends `${infer _}%${infer Placeholder}${infer Rest}`
    ? Placeholder extends PlaceholderSpecifier
      ? ParseLogFnArgs<Rest, [...Acc, PlaceholderTypeMapping<Placeholder>]>
      : ParseLogFnArgs<Rest, Acc>
    : Acc;

  export type Bindings = Record<string, any>;

  export interface LogFnFields {}

  export interface LogFn {
    <TMsg extends string = string>(msg: TMsg, ...args: ParseLogFnArgs<TMsg>): void;
    <T, TMsg extends string = string>(
      obj: [T] extends [object] ? T & LogFnFields : T,
      msg?: T extends string ? never : TMsg,
      ...args: ParseLogFnArgs<TMsg> | []
    ): void;
    <T, TMsg extends string = string>(
      obj: [T] extends [object] ? T & LogFnFields : T,
      msg?: T extends string ? never : TMsg,
      ...args: ParseLogFnArgs<TMsg> extends [unknown, ...unknown[]]
        ? ParseLogFnArgs<TMsg>
        : unknown[]
    ): void;
  }

  export interface ChildLoggerOptions {
    msgPrefix?: string;
  }

  export interface Logger {
    trace: LogFn;
    debug: LogFn;
    info: LogFn;
    warn: LogFn;
    error: LogFn;
    fatal: LogFn;
    child(bindings: Bindings, options?: ChildLoggerOptions): Logger;
    bindings(): Bindings;
    setBindings(bindings: Bindings): void;
    get msgPrefix(): string | undefined;
  }
}

declare module 'nestjs-pino' {
  import type { LoggerService } from '@nestjs/common';
  import type { Bindings, Logger as BaseLogger } from 'pino';

  export interface RunInContextOptions {
    bindings?: Bindings;
    inherit?: boolean;
  }

  export class PinoLogger {
    get logger(): BaseLogger;
    trace(msg: string, ...args: any[]): void;
    trace(obj: unknown, msg?: string, ...args: any[]): void;
    debug(msg: string, ...args: any[]): void;
    debug(obj: unknown, msg?: string, ...args: any[]): void;
    info(msg: string, ...args: any[]): void;
    info(obj: unknown, msg?: string, ...args: any[]): void;
    warn(msg: string, ...args: any[]): void;
    warn(obj: unknown, msg?: string, ...args: any[]): void;
    error(msg: string, ...args: any[]): void;
    error(obj: unknown, msg?: string, ...args: any[]): void;
    fatal(msg: string, ...args: any[]): void;
    fatal(obj: unknown, msg?: string, ...args: any[]): void;
    setContext(value: string): void;
    assign(fields: Bindings): void;
    runInContext<T>(fn: () => T, options?: RunInContextOptions): T;
  }

  export class Logger implements LoggerService {
    verbose(message: any, ...optionalParams: any[]): void;
    debug(message: any, ...optionalParams: any[]): void;
    log(message: any, ...optionalParams: any[]): void;
    warn(message: any, ...optionalParams: any[]): void;
    error(message: any, ...optionalParams: any[]): void;
    fatal(message: any, ...optionalParams: any[]): void;
  }
}
