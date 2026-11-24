// The `getSurvey` cache (ADR 0039 point 4): each survey's answer kept with Studio's ETag. Every
// request revalidates with `If-None-Match`, so an edit shows at once and an unchanged survey costs
// Studio a `304`. Least recently used surveys go first once `maxEntries` are kept.

export interface CachedSurvey {
  /** Studio's strong ETag for the definition. */
  readonly etag: string;
  /** The answer's body: the definition as JSON text. */
  readonly body: string;
}

export class SurveyCache {
  // A Map iterates in insertion order: re-inserting on use keeps the least recently used first.
  private readonly entries = new Map<string, CachedSurvey>();

  constructor(private readonly maxEntries: number) {}

  get size(): number {
    return this.entries.size;
  }

  get(surveyId: string): CachedSurvey | undefined {
    const key = surveyId.toLowerCase();
    const entry = this.entries.get(key);
    if (entry !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  set(surveyId: string, entry: CachedSurvey): void {
    if (this.maxEntries <= 0) return;
    const key = surveyId.toLowerCase();
    this.entries.delete(key);
    this.entries.set(key, entry);
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(oldest);
    }
  }

  delete(surveyId: string): void {
    this.entries.delete(surveyId.toLowerCase());
  }
}
