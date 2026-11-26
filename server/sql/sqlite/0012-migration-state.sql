-- State of the hosted migration tool (hosted Step 9). The table is empty and unused unless the
-- tool runs against this database. Statements end with a semicolon at the end of a line. JSON is
-- text; timestamps are ISO 8601 text.

-- What the tool remembers between runs: which run is current, the high-water marks, and which
-- surveys are copied. One JSON value per key.
create table migration_state (
  key text primary key,
  value text not null,
  updated_at text not null
);
