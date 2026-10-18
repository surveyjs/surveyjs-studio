import type { SurveyDefinition, SurveyResponse } from "../domain/types.js";
import { commentSuffixOf, questionsOf } from "./definition.js";

/** The byte order mark: spreadsheet programs then read the file as UTF-8. */
export const CSV_BOM = "﻿";
const CRLF = "\r\n";
/** A text cell a spreadsheet would run as a formula (CSV injection) starts with one of these. */
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** One column of the CSV export: its header and how a response fills it. */
export interface CsvColumn {
  readonly header: string;
  readonly value: (response: SurveyResponse) => unknown;
}

/**
 * One CSV field (R3): empty for null and missing values; strings as they are, with a `'` before a
 * leading `=`, `+`, `-`, `@`, TAB or CR; numbers and booleans as text; arrays and objects as JSON
 * text. Quoted as RFC 4180 when it holds a comma, a quote, CR or LF.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "string") text = FORMULA_START.test(value) ? `'${value}` : value;
  else if (typeof value === "number" || typeof value === "boolean") text = String(value);
  else text = JSON.stringify(value) ?? "";
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A CSV record: the fields joined by commas, then CRLF. */
export function csvRecord(values: readonly unknown[]): string {
  return values.map(csvField).join(",") + CRLF;
}

/**
 * The export's columns (R3): `Submitted`, `IPAddress` while the survey stores IP addresses, one per
 * question (and its comment) in definition order, then `ClientId`.
 */
export function csvColumns(
  definition: SurveyDefinition,
  options: { readonly storeRespondentIp: boolean },
): CsvColumn[] {
  const suffix = commentSuffixOf(definition);
  const columns: CsvColumn[] = [{ header: "Submitted", value: (r) => r.submittedAt }];
  if (options.storeRespondentIp)
    columns.push({ header: "IPAddress", value: (r) => r.respondentIp });
  for (const question of questionsOf(definition)) {
    columns.push({ header: question.name, value: (r) => r.data[question.key] });
    if (question.hasComment) {
      columns.push({
        header: question.name + suffix,
        value: (r) => r.data[question.key + suffix],
      });
    }
  }
  columns.push({ header: "ClientId", value: (r) => r.clientId });
  return columns;
}

export const csvHeader = (columns: readonly CsvColumn[]): string =>
  csvRecord(columns.map((column) => column.header));

export const csvRow = (columns: readonly CsvColumn[], response: SurveyResponse): string =>
  csvRecord(columns.map((column) => column.value(response)));
