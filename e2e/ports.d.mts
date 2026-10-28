export declare const ports: {
  server: number;
  licenceServer: number;
  web: number;
  licenceWeb: number;
  visualServer: number;
  visualWeb: number;
};
export declare function functionalPorts(mode: {
  image: boolean;
  azurite: boolean;
  sql?: boolean;
}): number[];
export declare const visualPorts: number[];
export declare function usesAzuriteConfig(args: readonly string[]): boolean;
export declare function usesSqlConfig(args: readonly string[]): boolean;
