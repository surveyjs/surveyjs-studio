export declare function describeCommandLine(text: string): string;
export declare function checkPorts(
  ports: readonly number[],
): Promise<{ port: number; owner: string | null }[]>;
export declare function busyMessage(busy: { port: number; owner: string | null }): string;
export declare function requireFreePorts(ports: readonly number[]): Promise<void>;
