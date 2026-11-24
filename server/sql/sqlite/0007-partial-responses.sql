-- Partial responses (docs/architecture/data-model.md, ADR 0038). Statements end with a semicolon at the end of a line.
-- The partial column exists since 0002; the app now writes it. These indexes serve a client's rows.

-- The clients that have a partial row: a partial row is rare, so the index is small.
create index survey_responses_partial_clients on survey_responses (survey_id, client_id) where partial;

-- A client's rows in submission order, for folding a client's rows into runs.
create index survey_responses_client on survey_responses (survey_id, client_id, submitted_at, id) where client_id is not null;
