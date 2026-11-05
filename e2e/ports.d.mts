export declare const ports: {
  server: number;
  licenceServer: number;
  web: number;
  licenceWeb: number;
  visualServer: number;
  visualWeb: number;
  selfHostedVisualServer: number;
  selfHostedVisualWeb: number;
  sandboxWeb: number;
  oauthStub: number;
};
export declare function functionalPorts(mode: {
  image: boolean;
  azurite: boolean;
  sql?: boolean;
  oauth?: boolean;
  sandbox?: boolean;
}): number[];
export declare const visualPorts: number[];
export declare const selfHostedVisualPorts: number[];
export declare function usesAzuriteConfig(args: readonly string[]): boolean;
export declare function usesSqlConfig(args: readonly string[]): boolean;
