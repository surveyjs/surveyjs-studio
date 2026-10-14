export interface ProviderSet {
  readonly name: string;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}
