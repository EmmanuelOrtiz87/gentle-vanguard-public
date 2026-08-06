export interface AdapterOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export abstract class Adapter {
  name: string;
  constructor(name: string) {
    this.name = name;
  }

  abstract init(options?: AdapterOptions): Promise<void> | void;
  abstract shutdown(): Promise<void> | void;
}

export default Adapter;
