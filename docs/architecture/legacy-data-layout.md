# Legacy data layout (surveyjs.io My Surveys)

Status: spike result for Step 2, Task 1 · Last updated: 2026-10-14

This page records how the current surveyjs.io site and `api.surveyjs.io` store My Surveys data. Later
tasks (golden fixtures, the Azurite replica, the Azure legacy provider, the provider suite and the
inspector CLI) are built from it.

**Source.** The private legacy repository of the surveyjs.io site, read from a read-only checkout (2026-10-12). The
site's source files are not named here: each claim says in words which part of the site's code it comes from. Where it
helps, the pre-.NET Core code is called "the pre-port code" (the code before the "NET Core Migration").

**Markers.**

- **[C]** confirmed from code: the cited code does exactly this.
- **[I]** inferred: follows from the code plus platform behaviour (Azure, SQL Server, Form Library), or
  from naming. It needs a storage copy or the site team to confirm.

**Examples are synthetic.** IDs are GUID-shaped so that key formats stay exact. They map to the
names used in the brief:

| Name          | GUID used in examples                  |
| ------------- | -------------------------------------- |
| user-0001     | `11111111-0000-4000-8000-000000000001` |
| user-0002     | `11111111-0000-4000-8000-000000000002` |
| survey-0001   | `22222222-0000-4000-8000-000000000001` |
| post-0001     | `33333333-0000-4000-8000-000000000001` |
| result-0001   | `44444444-0000-4000-8000-000000000001` |
| project-0001  | `55555555-0000-4000-8000-000000000001` |
| instance-0001 | `66666666-0000-4000-8000-000000000001` |
| event-000N    | `77777777-0000-4000-8000-00000000000N` |
| point-0001    | `88888888-0000-4000-8000-000000000001` |
| file-0001     | `99999999-0000-4000-8000-000000000001` |
| member-0001   | `aaaaaaaa-0000-4000-8000-000000000001` |
| licence-000N  | `bbbbbbbb-0000-4000-8000-00000000000N` |
| transfer-0001 | `cccccccc-0000-4000-8000-000000000001` |

Emails are `owner@example.com` and `member@example.com`. No real data or secret values appear here.

## 1. Summary

My Surveys data lives in three physical stores. **Azure SQL** (the "users" database) holds users,
the survey records (name, owner, flags, theme JSON), projects ("organizations") and memberships.
The **surveys storage account** holds the survey definition JSON, its edit history and the saved
results layouts as append blobs, an audit log of survey events in the Azure table `surveys`, and
editor uploads in an Azure **file share**. The **results storage account** holds one Azure table of
responses per survey (`post{postId}`), one table of "already completed" markers per survey, and
respondent uploads in a file share. The ASP.NET Identity database (`ConnectionStrings:Default`) is
wired up but not used by My Surveys. The storage model is **not event-sourced**: every change is
applied synchronously to current-state rows and blobs ("projections"), and for surveys an audit
event row is also appended. Production code never rebuilds state from the event rows; replay exists
only in unit tests and cannot handle several event types. A response row is both the "post result"
event and the stored response.

## 2. Stores and selection

### 2.1 How the code picks a backend

| Setting or switch                                                               | Where                                                                                                                                                 | Effect                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage backend switch (a static setting)                                       | Set to Azure Table storage at start-up by each site service (the old API, the site, the sign-in server and two more); tests set the in-memory backend | The in-memory backend makes every storage class keep its data in memory. The Azure Table setting makes each storage class use its real backend. **[C]** the site's event storage code                                                                                   |
| Backend type (a constructor argument)                                           | Hard-coded per storage class                                                                                                                          | A storage-account type means the Azure Table access code (tables, blobs, file shares, queues). A SQL type means the SQL access code (SQL tables). Only the user storage code passes the SQL type. **[C]** the site's event storage code, the site's user storage code   |
| The site's connection string secret for the surveys store                       | the site's storage setup code                                                                                                                         | Connection string of the surveys storage account, used by the survey storage code. **[C]** the site's survey storage code                                                                                                                                               |
| The site's connection string secret for the results store                       | the site's storage setup code                                                                                                                         | Connection string of the results storage account, used by the results storage code. **[C]** the site's results storage code                                                                                                                                             |
| The site's connection string secret for the users database                      | the site's storage setup code                                                                                                                         | Azure SQL connection string, used by the user storage code and a domain SQL access class. **[C]** the site's user storage code                                                                                                                                          |
| The site's connection string secret for the users-content store                 | the site's storage setup code                                                                                                                         | Storage account for sent-email bodies and the MCP log. Not My Surveys. **[C]** the site's users-content storage code                                                                                                                                                    |
| Where secrets come from                                                         | the site's storage setup code                                                                                                                         | Azure Key Vault (vault URI hard-coded, a different vault for DEBUG builds, the default Azure credential). If `App_Data/secrets.config` exists, its `appSettings` with the same key names are used instead. A failed Key Vault read returns the literal `error`. **[C]** |
| `ConnectionStrings:Default`                                                     | the site's settings file; the site's start-up code                                                                                                    | SQL Server database for the ASP.NET Identity tables (`AspNetUsers`, …). The user store actually registered reads the user storage code instead. **[C]** the site's Identity database context, the site's start-up code                                                  |
| `AppSettings:AppDataStorage:*` and the site's app-data connection string secret | the site's app-data storage code                                                                                                                      | Blob container for site content (docs, examples). Not My Surveys. **[C]**                                                                                                                                                                                               |

The old API's settings files hold only `Logging:*` and `AllowedHosts`; no storage setting lives in
an appsettings file. **[C]** (setting names listed with a key-only script; no values read into this
document.)

### 2.2 Stores

| Store                                           | Backend                    | Holds (My Surveys)                                                                                                                                                                                                              | Code                                                              |
| ----------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Users database                                  | Azure SQL                  | `Users`, `Surveys`, `Organizations`, `OrganizationUsers`                                                                                                                                                                        | the site's user storage code, the site's SQL schema script        |
| Surveys account                                 | Azure Table + Blob + Files | Table `surveys`; containers `surveyjson`, `surveytext`, `surveyjsonhistory`, `surveypublishedjson`, `surveyresultcolumns`, `surveyresulttablestate`, `surveyresultsummarystate`, `surveyresultpermissions`; share `surveyfiles` | the site's survey storage code, the site's survey event base code |
| Results account                                 | Azure Table + Files        | Tables `post{postId}`, `postdelete{postId}`, `SurveyCompletion{surveyId}`; shares `files`, `tempfiles`                                                                                                                          | the site's results storage code, the site's results replay code   |
| Users-content account                           | Azure Table + Blob         | Nothing for My Surveys (sent emails, MCP log)                                                                                                                                                                                   | the site's users-content storage code                             |
| Identity database (`ConnectionStrings:Default`) | SQL Server via EF Core     | Nothing for My Surveys                                                                                                                                                                                                          | the site's Identity database context                              |
| In-memory                                       | in memory                  | Tests only; file operations are no-ops; blob directories are empty                                                                                                                                                              | the site's in-memory access code                                  |

The Azure Table access code also creates a queue client, but no queue is ever used. **[C]**
the site's Azure Table access code (no other reference to the queue client).

### 2.3 What production uses, and how sure we are

Production most likely uses: **Azure SQL** for users, survey records and projects; **Azure Table,
Blob and Files** in two storage accounts for definitions, history, layouts, results and uploads.
Confidence: **high**.

- High, because every deployable site service sets the Azure Table backend at start-up and the backend per storage
  class is hard-coded, not configured. **[C]** (files listed in 2.1)
- High, because the storage connection strings are named secrets in Key Vault, not settings. **[C]**
  the site's storage setup code
- The site team confirmed that the old API with the site's core code in this checkout is the .NET Core
  code that implements access to the legacy storage, so this page treats it as the reference
  behaviour. Data written earlier by the pre-port code can still differ in two places: respondent
  IP capture (section 3.6) and history blob naming (section 3.4). Both behaviours are recorded.
  **[C]** for the difference, **[I]** for which code wrote the existing data.
- Unknown: whether the site's three connection string secrets for the storage accounts name three accounts or one, and whether
  the users database secret and `ConnectionStrings:Default` point to the same database. Only the
  site team can say (section 11).

## 3. Entities

Three general rules first.

**Property names.** The site's persistent data object lower-cases a name when it is set through its indexer, so
almost every stored property or column name is lower case (`happendat`, `postid`). Values added
through a dictionary keep their case. **[C]** the site's persistent object code

**Azure Table keys.** A table name is the storage "path" with `-` removed and a `t` prefix if it
starts with a non-letter. `PartitionKey` is `*` unless the caller passes one; `RowKey` is the
caller's key or the object's `id`. A write is an upsert (the SDK default mode is
merge, so properties left out of a write survive on an existing row **[I]**). On read, the code adds
`rowkey` and `timestamp` to the values. **[C]**
the site's Azure Table access code

**Azure SQL mapping.** The SQL access code maps a "path" to a SQL table and a key column,
ignores the partition and row key arguments of `Write`, and builds an UPDATE-then-INSERT on the key
column from every non-null value in the object. It sets `timestamp = DateTime.UtcNow` on every
write. **[C]** the site's SQL access code, the site's event storage code

| Lookup                       | SQL table           | Key column used for reads | "Partition" column used for lists |
| ---------------------------- | ------------------- | ------------------------- | --------------------------------- |
| Users by id                  | `Users`             | `id`                      | none                              |
| Users by email               | `Users`             | `email`                   | `email`                           |
| Users by access key          | `Users`             | `accesskey`               | none                              |
| Users by external id         | `Users`             | `dxid`                    | none                              |
| Surveys of an owner          | `Surveys`           | `id`                      | `userid`                          |
| Surveys by post id           | `Surveys`           | `postid`                  | none                              |
| Surveys by result id         | `Surveys`           | `resultid`                | none                              |
| Surveys by publish id        | `Surveys`           | `publishid`               | none                              |
| Projects                     | `Organizations`     | `id`                      | none                              |
| Members of a project         | `OrganizationUsers` | `id`                      | `organizationid`                  |
| Memberships of a user        | `OrganizationUsers` | `id`                      | `userid`                          |
| Licences of a user           | `UserLicenses`      | `id`                      | `userid`                          |
| Licences by parent licence   | `UserLicenses`      | `id`                      | `parentlicenseid`                 |
| Licence transfers of a user  | `LicenseTransfers`  | `id`                      | `userid`                          |
| Licence transfers by licence | `LicenseTransfers`  | `id`                      | `licenseid`                       |

Because of this mapping, an extra property on a row object becomes an extra SQL column in the
INSERT. A writer must not add properties to SQL rows that the table does not have. **[C]**
the site's SQL access code

### 3.1 Survey record: SQL `Surveys`

Primary key `id`. Lists are `select * from Surveys where userid = @p`; lookups by `postid`,
`resultid` and `publishid` are single-row selects on those columns. **[C]**
the site's user storage code, the site's SQL schema script

| Column              | SQL type           | Meaning                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | `uniqueidentifier` | Survey ID. **[C]**                                                                                                                                                                                                                                                                                                                                                         |
| `name`              | `nvarchar(200)`    | Survey name. Max 200 characters (the contract allows 256). **[C]** for the column, **[I]** that longer names fail.                                                                                                                                                                                                                                                         |
| `userid`            | `uniqueidentifier` | **Owner scope**: the user's ID for a personal survey, the organization (project) ID for a project survey. **[C]** the site's service handlers, the site's account-management handlers                                                                                                                                                                                      |
| `creatorid`         | `uniqueidentifier` | User who created the survey, or who last moved it (move overwrites it). `00000000-…` when created through the private API. **[C]** the site's survey event code, the old API's surveys handlers                                                                                                                                                                            |
| `postid`            | `uniqueidentifier` | Post ID (see section 4). **[C]**                                                                                                                                                                                                                                                                                                                                           |
| `resultid`          | `uniqueidentifier` | Result ID (see section 4). **[C]**                                                                                                                                                                                                                                                                                                                                         |
| `createdat`         | `datetime`         | Copied from the `SURVEY_CREATE` event's `happendat`, which is `DateTime.Now` (server local time). The SQL writer passes it on with no UTC conversion, unlike the Table writer. **[C]** the site's survey event code, the site's survey event base code, the site's SQL access code. It equals UTC only when the server time zone is UTC (the App Service default). **[I]** |
| `timestamp`         | `datetime`         | Set to UTC now by every SQL write, so it is the "updated" date. Every rename, JSON save, theme change, publish, archive and move rewrites the row. **[C]** the site's SQL access code, the site's survey event code                                                                                                                                                        |
| `ispublished`       | `tinyint`          | `NULL` until first toggled. The list shows "Run" only when it is 1; the run page refuses only when it is 0. The app reads `NULL` as published, as the run page did (Step 14, [ADR 0014](../adr/0014-run-page-and-response-collection.md) S1). **[C]** the site's My Surveys page, the site's run page                                                                      |
| `isarchived`        | `tinyint`          | Archived flag. **[C]**                                                                                                                                                                                                                                                                                                                                                     |
| `allowaccessresult` | `tinyint`          | "Grant Access" (public results). **[C]**                                                                                                                                                                                                                                                                                                                                   |
| `storeipaddress`    | `varchar(200)`     | "Save Respondent IP". A `bool` written into a `varchar`; SQL Server stores `1`/`0`, and the site's reader treats the string `1` as true. **[C]** for the code, **[I]** for the stored text.                                                                                                                                                                                |
| `usecookies`        | `tinyint`          | "Limit to one response": the run page sets the survey's `cookieName` to the ID in the URL. **[C]** the site's run page handler                                                                                                                                                                                                                                             |
| `theme`             | `varchar(max)`     | **Theme JSON** as a string (SurveyJS theme). `varchar`, not `nvarchar`: non-ASCII characters may not survive. **[C]** for the column, **[I]** for the character loss.                                                                                                                                                                                                      |
| `publishid`         | `uniqueidentifier` | Legacy "published version" ID. Set only by the hidden publish-version API; plain publish does not set it. **[C]** the site's user storage code, the old API's surveys handlers                                                                                                                                                                                             |
| `legacytheme`       | `varchar(max)`     | Not referenced by any code. **[C]** (repository-wide search)                                                                                                                                                                                                                                                                                                               |

Synthetic row:

```json
{
  "id": "22222222-0000-4000-8000-000000000001",
  "name": "Customer feedback",
  "userid": "55555555-0000-4000-8000-000000000001",
  "creatorid": "11111111-0000-4000-8000-000000000001",
  "postid": "33333333-0000-4000-8000-000000000001",
  "resultid": "44444444-0000-4000-8000-000000000001",
  "createdat": "2026-03-13 09:12:00.000",
  "timestamp": "2026-04-14 15:30:00.000",
  "ispublished": 1,
  "isarchived": 0,
  "allowaccessresult": 0,
  "storeipaddress": "0",
  "usecookies": null,
  "theme": "{\"themeName\":\"default\",\"colorPalette\":\"light\",\"cssVariables\":{\"--sjs-primary-backcolor\":\"#19b394\"}}",
  "publishid": null,
  "legacytheme": null
}
```

### 3.2 Survey definition: blobs `surveyjson` and `surveytext`

| Item           | Value                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Containers     | `surveyjson` and `surveytext` in the surveys account. **[C]** the site's survey storage code                                                                                                            |
| Blob name      | `{surveyId}` (GUID with dashes, lower case, no extension). **[C]** the site's Azure Table access code                                                                                                   |
| Blob type      | **Append blob**, rewritten whole on each save (`OpenWrite(true)`), UTF-8 text. **[C]** the site's Azure Table access code                                                                               |
| Content        | SurveyJS survey JSON. The editor sends the same text as `Json` and `Text`, so both blobs hold the same string. **[C]** the site's editor script                                                         |
| Who reads what | `surveyjson`: `getSurvey`, the run page, results and history. `surveytext`: only the editor page (it loads `creator.text` from it). **[C]** the site's survey request code, the site's service handlers |
| When created   | On the first save, not on create. Until then `getSurvey` answers 400. **[C]** the site's survey event code, the old API's survey handlers                                                               |

The editor saves with `PUT private/Surveys/changeJson` on every auto-save. **[C]**
the site's editor script

Synthetic content of `surveyjson/22222222-0000-4000-8000-000000000001`:

```json
{
  "title": "Customer feedback",
  "pages": [
    {
      "name": "page1",
      "elements": [
        { "type": "rating", "name": "satisfaction", "title": "How satisfied are you?" },
        { "type": "file", "name": "receipt", "title": "Upload your receipt" }
      ]
    }
  ]
}
```

`surveypublishedjson/{publishId}` is an older "published version" snapshot. Nothing writes it now,
but the site's survey request code still reads it first when `publishid` is set. **[C]**
the site's survey storage code (nothing writes it now), the site's survey request code

### 3.3 Theme

The theme JSON is the `theme` column of the SQL `Surveys` row (3.1), not a blob. The editor saves
it with `PUT private/Surveys/changeTheme` and the body field `ThemeJson`. A theme change (and a definition save) also
deletes the editor preview image `my-surveys-survey-preview-image-{surveyId}` from the `surveyfiles`
share. **[C]** the old API's surveys handlers, the site's editor script

### 3.4 Survey history: blob container `surveyjsonhistory`

Every definition save writes a new history blob with a fresh GUID ("point ID") and the full JSON.
The History page lists entries with the blob's `LastModified` as the time, and loads one by
splitting the listed path at `/` into survey ID and point ID. No user is recorded. **[C]**
the site's survey storage code,
the site's History page

| Item                       | Value                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Intended blob name         | `{surveyId}/{pointId}` (append blob). This is what the pre-port code wrote and what the History page expects. **[C]** the pre-port code, the site's History page                                                                                                                                                               |
| What the current port does | Since surveyjs.io commit `3389d6cd49` (2026-10-20, "Fix empty survey editing history page"): it writes `{surveyId}/{pointId}` append blobs and lists the direct children of `{surveyId}/`, newest `LastModified` first, as the app does it. **[C]** the site's Azure Table access code                                         |
| Before that fix            | The old blob lookup looked for any blob whose name starts with `{surveyId}`. If one existed it rewrote **that** blob; if none existed it wrote a root-level blob named `{pointId}`. Listing returned only the first blob under the survey prefix. **[C]** the pre-port code                                                    |
| Consequence                | Points written before the fix are lost to both sides: root-level `{pointId}` blobs belong to no survey and neither side lists them, and the rewrites replaced earlier saves of older surveys. Nothing migrates them. New saves on either side are listed by both (the live History page listed the app's saves on 2026-10-22). |
| Retention                  | No deletion: deleting a survey leaves its history blobs. **[C]** the site's survey storage code                                                                                                                                                                                                                                |

Example blob: `surveyjsonhistory/22222222-0000-4000-8000-000000000001/88888888-0000-4000-8000-000000000001`,
content identical to the `surveyjson` blob at that time.

**History metadata (Step 6).** The new application writes a **user** for each history point as blob
metadata on the point itself: `userid` (the saving user's id, a lower-case GUID) and `savedat` (the save
time, ISO 8601 UTC with milliseconds). The blob name and content stay in the legacy format, and legacy
code ignores metadata, so the point reads as before. Reading uses `savedat` for the time when it parses
(otherwise the blob's `LastModified`) and `userid` for the user when it is a GUID (otherwise none), so
points written by legacy have no user. Create and clone points get the metadata too (`userid` = the
creator, `savedat` = the creation time). Reasons: [ADR 0012](../adr/0012-editor-content-and-history.md).

**Legacy-overwrite caveat.** Before the site's fix (above), a definition save by the legacy editor
**rewrote the alphabetically first blob under `{surveyId}`** instead of adding a point. If
that blob was a point written by the new application, its content and `LastModified` changed, and its
metadata was replaced by none: the entry then reads as written by no user at the time of that save. This
was accepted ([ADR 0012](../adr/0012-editor-content-and-history.md), R8). Blobs at the root of the
container (that port's new points) are not listed for any survey by the new application. Since the fix was
deployed the legacy editor adds a new point instead, so the caveat applies only to saves made before that.

### 3.5 Survey event log: Azure table `surveys`

Every survey-level operation that runs with "save" appends one row to table `surveys` in the surveys
account, then updates the projections. `PartitionKey` is `*` for all rows; `RowKey` is the event
`id`. See section 5 for the event types and payloads. **[C]**
the site's survey event base code,
the site's survey event code

Common properties:

| Property    | Type           | Notes                                                                                                                                                           |
| ----------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | `Edm.Guid`     | New GUID per event; equals `RowKey`. **[C]** the site's survey event base code                                                                                  |
| `type`      | `Edm.String`   | Event type code (section 5). **[C]**                                                                                                                            |
| `happendat` | `Edm.DateTime` | `DateTime.Now`, converted to UTC on write. **[C]** the site's survey event base code, the site's Azure Table access code                                        |
| `surveyid`  | `Edm.Guid`     | The survey. **[C]**                                                                                                                                             |
| `ipaddress` | `Edm.String`   | Written by the pre-port code for every event; the current port never sets it. **[C]** the pre-port code; the site's survey event base code has it commented out |

Payload properties keep the .NET type of the event member: GUID members (`postid`, `resultid`,
`userid`, `creatorid`) are `Edm.Guid`, flags (`ispublished`, `grantaccess`, `storeipaddress`,
`usecookies`) are `Edm.Boolean`, text and JSON (`name`, `theme`, `resulttablestate`, …) are
`Edm.String`. **[C]** the site's survey event code (member types),
the site's Azure Table access code

Synthetic row for a rename, in the Table REST JSON format (`@odata.type` annotations mark non-string
types; booleans are plain JSON `true`/`false`):

```json
{
  "PartitionKey": "*",
  "RowKey": "77777777-0000-4000-8000-000000000002",
  "id@odata.type": "Edm.Guid",
  "id": "77777777-0000-4000-8000-000000000002",
  "type": "SURVEY_UPDATE",
  "happendat@odata.type": "Edm.DateTime",
  "happendat": "2026-04-14T15:30:00Z",
  "surveyid@odata.type": "Edm.Guid",
  "surveyid": "22222222-0000-4000-8000-000000000001",
  "name": "Customer feedback"
}
```

### 3.6 Results: Azure tables `post{postId}`

One table per survey in the results account, named `post` plus the post ID with the dashes removed,
for example `post33333333000040008000000000000001`. Each row is one submission. **[C]**
the site's results replay code,
the site's Azure Table access code,
the site's survey event code

| Property             | Type           | Domain name    | Notes                                                                                                                                                                                                                                                     |
| -------------------- | -------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PartitionKey`       | string         | none           | Always `*`. **[C]** the site's Azure Table access code                                                                                                                                                                                                    |
| `RowKey`             | string         | `id`           | Same as `id`, GUID with dashes. **[C]** the site's Azure Table access code                                                                                                                                                                                |
| `id`                 | `Edm.Guid`     | `id`           | The **InstanceId**. Readers expose it as `InstanceId`. **[C]** the site's survey request code                                                                                                                                                             |
| `type`               | `Edm.String`   | none           | `SURVEY_POSTRESUTL` (sic). **[C]** the site's survey event code                                                                                                                                                                                           |
| `happendat`          | `Edm.DateTime` | `submittedAt`  | Server time of the post, stored as UTC. Readers expose it as `HappendAt`. **[C]** the site's survey event base code, the site's survey request code                                                                                                       |
| `surveyid`           | `Edm.Guid`     | none           | **Not the survey.** The post path never sets it, so the event base code fills a random GUID. **[C]** the site's survey request code, the site's survey event code                                                                                         |
| `postid`             | `Edm.Guid`     | none           | The survey's post ID. **[C]**                                                                                                                                                                                                                             |
| `result`             | `Edm.String`   | `data`         | The response JSON as a string, after an HTML sanitizer ran over the whole string. **[C]** the site's survey request code. The sanitizer HTML-encodes text, so characters such as `&` and `<` may be stored as entities. **[I]**                           |
| `clientid`           | `Edm.String`   | `clientId`     | Present only when the client sent one. **[C]** the site's survey request code                                                                                                                                                                             |
| `ispartialcompleted` | `Edm.Boolean`  | `partial`      | Present (true) only when a client ID was sent with `isPartialCompleted`. **[C]** the site's survey request code                                                                                                                                           |
| `ipaddress`          | `Edm.String`   | `respondentIp` | Kept only when the survey's `storeipaddress` is on (the event code removes it otherwise). The pre-port code captured it from the request; the current port never sets it, so new rows have no IP. **[C]** the site's survey event code, the pre-port code |
| `Timestamp`          | system         | none           | Azure last-modified time. **[C]**                                                                                                                                                                                                                         |

**The Edm types are part of the format.** A writer must store `id`, `postid` and `surveyid` as
`Edm.Guid`, `happendat` as `Edm.DateTime` and `ispartialcompleted` as `Edm.Boolean`; `result`,
`clientid`, `type` and `ipaddress` are `Edm.String`. The legacy reader converts a stored string to a
value type only through an integer parse, so with the wrong types:

| Stored as                               | Legacy reader sees                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `id` as `Edm.String`                    | `InstanceId` = `00000000-0000-0000-0000-000000000000`                              |
| `happendat` as `Edm.String`             | `HappendAt` = `DateTime.MinValue` (wrong dates, sorting and `from`/`till` filters) |
| `ispartialcompleted` as string `"true"` | `false` (only the string `"1"` reads as true)                                      |

**[C]** the site's persistent object code,
the site's survey request code, member types in
the site's survey event code, and
the site's Azure Table access code (which keeps GUID, date and boolean values as typed properties).

Synthetic row, in the Table REST JSON format:

```json
{
  "PartitionKey": "*",
  "RowKey": "66666666-0000-4000-8000-000000000001",
  "id@odata.type": "Edm.Guid",
  "id": "66666666-0000-4000-8000-000000000001",
  "type": "SURVEY_POSTRESUTL",
  "happendat@odata.type": "Edm.DateTime",
  "happendat": "2026-10-05T06:48:57.517Z",
  "surveyid@odata.type": "Edm.Guid",
  "surveyid": "77777777-0000-4000-8000-000000000009",
  "postid@odata.type": "Edm.Guid",
  "postid": "33333333-0000-4000-8000-000000000001",
  "result": "{\"satisfaction\":4,\"receipt\":[{\"name\":\"receipt.png\",\"type\":\"image/png\",\"content\":\"data:image/png;base64,iVBORw0KGgo=\"}]}",
  "clientid": "client-0001",
  "ispartialcompleted": true
}
```

**Order.** Azure Table returns rows in `PartitionKey`, then `RowKey` order. With one partition and
random GUID row keys, storage order is effectively random, not submission order. The legacy
readers use storage order as is ("first 1,000 responses" means the first 1,000 by row key). **[C]**
for the keys, **[I]** for the ordering (Azure Table semantics).
the site's survey request code

**Limits.** The run page refuses to post when the JSON string is 65,536 characters or longer. **[C]**
the site's run page. Azure Table limits one
string property to 64 KiB, which is 32K UTF-16 characters, so `result` fails at about 32,000
characters and `/post` then answers 400 with the Azure error. **[C]** for the in-repo note in
the site's users-content storage code and the error handling in
the old API's survey handlers; **[I]** that this is the real cap for results.

**Duplicates by client ID.** Readers merge rows that share a `clientid` and return the merged row
once, but the two read paths merge differently:

| Path                                                                                             | Row order before merging            | Which values win                                                                                                                                |
| ------------------------------------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON readers (`getSurveyResults`, `getSurveyDemoResults`, `getSurveyPublicResults`, JSON export) | Storage order                       | **Last** row in storage order: its keys overwrite the earlier row's.                                                                            |
| Calculated paths (`getResult`, CSV export)                                                       | Sorted by `happendat`, newest first | **First** row: the merge only adds keys the row does not have yet, so the newest submission's values win and older rows only fill missing keys. |

**[C]** the site's survey request code,
the site's results data code,
the site's persistent object code,
the site's results summary code

**Implemented in Step 8.** My Surveys writes these rows directly (`writeResponse` in
`providers/azure-legacy/writes.ts`, [ADR 0010](../adr/0010-writing-to-the-legacy-stores.md#step-8-result-rows-and-completion-markers)),
not through the legacy `POST post`, so the sanitizer never runs: the text of `result` is stored as typed,
while old rows may hold entities. The row has exactly the properties above with their Edm types
(`ispartialcompleted` is never written, `clientid` and `ipaddress` only when given), and `surveyid` is a
random GUID as in legacy. The row id is a GUID that the server derives from the `Idempotency-Key`
(a version 5 UUID of the survey id and the key) or makes at random, and `happendat` is the server's clock
in UTC. A result text over **32,768 UTF-16 code units** is refused before anything is written (the answer
is `413`). The table `post{postId}` is created on the first response, and `Surveys.timestamp` is not
touched. The IP address is stored only while the survey's `storeipaddress` is on.

### 3.7 "Already completed" markers: Azure tables `SurveyCompletion{surveyId}`

One table per survey in the results account, for example
`SurveyCompletion22222222000040008000000000000001`. A row is written for each post that has a client
ID. **[C]** the site's results storage code, the site's survey event code

| Property             | Type          | Notes                                                                                                                                                   |
| -------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PartitionKey`       | string        | `*`. **[C]**                                                                                                                                            |
| `RowKey`             | string        | The client ID as sent. Azure forbids `/`, `\`, `#`, `?` and control characters in keys, so such IDs fail. **[C]** for the key, **[I]** for the failure. |
| `ispartialcompleted` | `Edm.Boolean` | `true` → `isCompleted` answers `partial`, otherwise `completed`. **[C]** the site's results storage code                                                |
| `publishid`          | `Edm.String`  | The survey's `publishid`; absent when null. **[C]** for the write, **[I]** for absence.                                                                 |

`ispartialcompleted` must be `Edm.Boolean`: the reader uses `GetValue<bool>`, which reads a string
as true only when it is `"1"`. `publishid` is `Edm.String` because the survey model holds it as a string. **[C]** the site's results storage code, the site's survey model,
the site's persistent object code

Synthetic row in `SurveyCompletion22222222000040008000000000000001`:

```json
{
  "PartitionKey": "*",
  "RowKey": "client-0001",
  "ispartialcompleted": false
}
```

The run page on surveyjs.io never sends a client ID, so it never creates these rows. **[C]**
the site's run page

**Implemented in Step 8.** Every response that carries a client id writes its marker with an upsert
(`Replace`) at the row key `clientId`, with `ispartialcompleted` as `Edm.Boolean` false and `publishid` as
`Edm.String` when the survey has one (read from `Surveys.publishid`). The table
`SurveyCompletion{surveyId}` is created when it is missing. A response that is stored again under the same
id writes the marker again at the store level (the HTTP service answers a keyed retry
before it reaches the store, so only a race of identical requests gets there). A marker written by an old API client
with `ispartialcompleted` true reads as `partial`, and "completed" for the run page is a marker that exists and
is not partial. A client id that Azure refuses as a row key cannot be stored, so the contract's `ClientId`
refuses `/`, `\`, `#`, `?` and control characters up front. The run page of My Surveys, unlike the old one, sends a client
id when "Limit to one response" is on, so it creates these rows.

### 3.8 Deleted-result audit: Azure tables `postdelete{postId}`

Deleting one result (private API `deleteResult`) appends a row here with a copy of the deleted
`result`, `clientid` and `ispartialcompleted`, plus `instanceid`, `postid`, `type =
SURVEY_DELETEPOSTRESUTL`, `happendat` and a random `surveyid`; then it deletes the `post{postId}` row
and the client's completion row. Types follow 3.6: `instanceid`, `postid`, `surveyid` and the row
`id` are `Edm.Guid`, `happendat` is `Edm.DateTime`. **[C]** the site's survey event code
the old API's surveys handlers

### 3.9 Uploaded files

| Kind                                   | Store                                                               | Name                                                                                           | How it is referenced                                                                               | Served by                                                                                                                                                                                                                                                                                         | Code                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Editor assets (images in survey JSON)  | **Azure file share** `surveyfiles`, surveys account, root directory | New GUID, **no extension**; or `my-surveys-survey-preview-image-{surveyId}` for preview images | Absolute URL in the survey JSON: `https://api.surveyjs.io/private/Surveys/files?name={guid}`       | `GET private/Surveys/files?name=` as `application/octet-stream`, no auth                                                                                                                                                                                                                          | **[C]** the old API's surveys handlers, the site's editor script, the site's survey storage code                                                                               |
| Respondent files, legacy upload API    | **Azure file share** `files`, results account                       | `{guid}{ext}`                                                                                  | The API returns `dxsimage:{name}` for jpeg, jpg, png, bmp, svg, gif and `dxsfile:{name}` otherwise | Meant to be `GET public/v1/Survey/image?filePath=` and `file?filePath=`. In the port these actions return an old Web API response object from an ASP.NET Core controller with no compatibility layer, so they most likely answer with that object serialized as JSON, not the file bytes. **[I]** | **[C]** the old API's survey handlers, the site's results storage code; no such compatibility layer in the old API                                                             |
| Respondent files, surveyjs.io run page | Inline in `result`                                                  | none                                                                                           | Form Library file value `[{ name, type, content: "data:…;base64,…" }]`                             | Returned inside results                                                                                                                                                                                                                                                                           | **[C]** the run page has no upload handler and posts the survey data: the site's run page; **[I]** inline data URLs come from the Form Library default `storeDataAsText: true` |
| Temporary files                        | **Azure file share** `tempfiles`, results account                   | `{guid}{ext}`                                                                                  | Not used by My Surveys pages                                                                       | `private/Surveys/getTempFile`, `tempFiles`                                                                                                                                                                                                                                                        | **[C]** the old API's surveys handlers                                                                                                                                         |

Facts that matter for the new app:

- Editor assets are **not linked to a survey**: the upload ignores the posted `Id`, and nothing
  records which survey uses a file. A per-survey quota cannot be computed from legacy data. **[C]**
  the old API's surveys handlers
- The "4,000 KB" limit is a **client-side check per upload batch**, not a per-survey total. **[C]**
  the site's editor script
- No content type, original name or size is stored. **[C]** (the file write stores only bytes)
- Deleting a survey or its results deletes no files. **[C]** the site's survey storage code, the site's results storage code

**Implemented in Step 7** ([ADR 0013](../adr/0013-editor-uploads-and-files.md)):

- New uploads go to a **new blob container `my-surveys-files`** of the surveys account, as block blobs
  `{surveyId}/{fileId}` (the file id is 64 hex digits: the survey's GUID without dashes, then 128 random
  bits). The blob's content type is the detected type; the metadata is `kind` (`asset`), `name`
  (URI-encoded) and `createdat` (ISO 8601 UTC). The container is created on the first upload.
- The legacy share `surveyfiles` and every blob container the legacy code uses are **untouched**: never
  read, written or listed. Legacy code does not know the new container.
- Legacy links (`https://api.surveyjs.io/private/Surveys/files?name={guid}`) in survey JSON are **left in
  place**. They are not counted against the quota, not copied by a clone and not deleted with the survey.
  They stop working when `api.surveyjs.io` is retired; a migration belongs to the rollout.
- Deleting a survey now deletes its files in the new container. A clone copies them.

### 3.10 Results layouts (the only saved UI state)

The Summary and Table layouts are saved **per survey, not per user**. **[C]**
the site's survey storage code,
the site's client script

| Container (surveys account) | Blob         | Content                                                                                                                                                                     | Code                                                                     |
| --------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `surveyresulttablestate`    | `{surveyId}` | SurveyJS Dashboard Table state JSON: `{ "elements": [{ "name", "isVisible", "isPublic", … }], … }`                                                                          | **[C]** the site's results state model                                   |
| `surveyresultsummarystate`  | `{surveyId}` | SurveyJS Dashboard state JSON, same `elements[].name/isPublic` convention                                                                                                   | **[C]** the site's results state model                                   |
| `surveyresultpermissions`   | `{surveyId}` | `[{ "name": "q1", "isPublic": true }]`: which columns public results may show                                                                                               | **[C]** the site's results state model                                   |
| `surveyresultcolumns`       | `{surveyId}` | Old format: `{ "columns": [{ "name", "displayname", "visibility": 0/1/2, "location" }], "newcolumnsvisibility": 0 }`. Still read as a fallback and to filter public results | **[C]** the site's results columns model, the site's survey request code |

"Reset Table State" and "Reset Summary State" send `Json: null`, which deletes the blob. **[C]**
the site's client script,
the old API's surveys handlers

Survey deletion calls a table delete on these four paths instead of deleting the
blobs, so the layout blobs survive, and that delete creates empty tables with these names if they
do not exist. **[C]** the site's survey storage code,
the site's Azure Table access code

Synthetic `surveyresulttablestate/22222222-0000-4000-8000-000000000001`:

```json
{
  "locale": "",
  "elements": [
    {
      "name": "satisfaction",
      "displayName": "How satisfied are you?",
      "isVisible": true,
      "isPublic": true
    },
    {
      "name": "receipt",
      "displayName": "Upload your receipt",
      "isVisible": true,
      "isPublic": false
    }
  ],
  "pageSize": 10
}
```

**Implemented in Step 9** ([ADR 0015](../adr/0015-results-summary-table-and-views.md); the writes are in
[ADR 0010](../adr/0010-writing-to-the-legacy-stores.md#step-9-results-layouts)). Layouts are now **per user
and survey**, in a new container `my-surveys-views` (section 5.3), and the two legacy layout blobs above
are **read only**:

- A user's view is the block blob `{surveyId}/{userId}/{summary|table}` (lower case). A save overwrites it.
- With no own blob, the read falls back to the survey's blob (`surveyresultsummarystate/{id}` or
  `surveyresulttablestate/{id}`), returned as stored. There is no conversion of `surveyresultcolumns` and
  no `isPublic` overlay (`surveyresultpermissions` stayed unread until Step 10, below).
- A reset overwrites the user's blob with a **zero-byte marker**. A zero-byte blob means "reset": the
  read answers "no layout" and does not fall back. The next save replaces the marker.
- The legacy layout blobs are never written or deleted by views. A survey deletion removes the survey's
  prefix in the new container, besides the four legacy blobs as before.
- Neither a save nor a reset writes an audit row or moves `Surveys.timestamp`.

**Implemented in Step 10** ([ADR 0016](../adr/0016-results-details-exports-and-public-results.md); the writes are in
[ADR 0010](../adr/0010-writing-to-the-legacy-stores.md#step-10-deleting-all-results-and-the-public-question-list)).
The blob `surveyresultpermissions/{surveyId}` is now **read and written**, as the survey's list of questions that
public results leave out (the setting `privateResultQuestions`). It is per survey, as in the old site, and not
per user:

- **Read** with the old defaults: the text is parsed as JSON after one leading U+FEFF is removed. The read
  **fails closed**: an empty blob (an append blob between its create and its append, or after a failed append),
  a value that is not an array, or text that does not parse is read once more and then fails (an error with
  the operation name only), never "every question public"; public results then answer `500`, and
  `getSurvey` leaves the setting out. Of an array, each element that is an object with a non-empty string `name` and
  `isPublic` equal to the boolean `false` is a private question (first occurrence only, in array order). An
  element without `isPublic`, with `true`, with `"false"` or that is not an object is **public**, as in the old
  code. A missing blob means every question is public.
- **Written** as the old JSON, one element for each **private** question only:
  `[{ "name": "receipt", "isPublic": false }]`; no list is `[]`. The public entries an older blob held are not
  written again: for the old readers a question with no entry is public too. The blob is an append blob in the
  existing container and is replaced as the other append blobs are. A `404` for the container creates it and
  tries once more. No SQL change, no `timestamp` change and no audit row (a save of the list is not an event of
  its own here; the old code put it into the `SURVEY_UPDATE` row of a layout save).
- **The public overlay is not used.** The old code copied the list into the `isPublic` marks of the saved
  layouts; this application keeps the list as the setting and sets the marks in the user's own layout when the
  Summary mounts. The old `surveyresultcolumns` blob stays unread.
- The survey deletion already removed this blob (one of the four layout blobs). A clone does not copy it.

**Deleting all results (Step 10).** The old code deletes the tables `post{postId}` and `SurveyCompletion{surveyId}`
as a whole. This application deletes **the rows**, in table transactions of at most 100 rows each (one
partition at a time), and **keeps both tables**, so a response that is sent right after is stored at once and
does not meet the 40 seconds of the table-being-deleted error (section 5.1). `postdelete{postId}` is not touched. It then
appends a best-effort `SURVEY_DELETEALLRESULTS` row to the `surveys` table with the survey id (section 5.1), as the
old code did. Respondent files in `my-surveys-files` of kind `response` are deleted first; the editor's assets
stay. The saved layouts, the permissions blob and the survey record stay (the old delete left them too, and left
the files).

The last selected project is a browser cookie `organizationId` (24 hours), not stored data. **[C]**
the site's service handlers

### 3.11 Users: SQL `Users`

Primary key `id`. Lookups by `email` (lower-cased by the caller), `accesskey` and `dxid`. **[C]**
the site's user storage code,
the site's SQL schema script, the site's SQL constraints script
(`users_email_idx`, `users_accesskey_idx`, `users_dxid_idx`)

| Column (My Surveys needs)                                                                                    | Type               | Notes                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                                                         | `uniqueidentifier` | User ID; the `sub` of auth.surveyjs.io. **[C]** the sign-in server's OAuth handlers                                                      |
| `email`                                                                                                      | `varchar(200)`     | Lower case on change; lookups lower-case the input. **[C]** the site's user storage code                                                 |
| `displayname`                                                                                                | `nvarchar(max)`    | Shown in member lists. **[C]** the site's user storage code                                                                              |
| `blocked`                                                                                                    | `tinyint`          | Blocked users cannot use My Surveys; their surveys show as unpublished. **[C]** the site's service handlers, the site's run page handler |
| `accesskey`                                                                                                  | `varchar(200)`     | The legacy private API key, put in page source and URLs. **[C]** the site's user model                                                   |
| `timestamp`                                                                                                  | `datetime`         | Last write. **[C]**                                                                                                                      |
| Other columns: `dxid`, `oldemail`, `passwordhash`, company and billing fields, reseller and enterprise flags | various            | Not needed by My Surveys. **[C]** the site's SQL schema script                                                                           |

The site's SQL schema script is not the full production schema. The site's user store also writes `emailconfirmed`,
`phonenumberconfirmed`, `lockoutenddate`, `lockoutcount`, `twofactorenabled` and
`allowmarketingemails`, and the SQL writer inserts every property as a column, so production must
have these columns. **[C]** the site's user model,
the site's SQL access code; **[I]** for the
production columns.

Site administrators are a hard-coded email list and may open every survey. **[C]**
the site's user model, the site's service handlers

### 3.12 Projects: SQL `Organizations`

| Column      | Type               | Notes                                                                                                                                                                                                                                                                                                             |
| ----------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | `uniqueidentifier` | Project ID. Also used as `Surveys.userid` for the project's surveys. **[C]**                                                                                                                                                                                                                                      |
| `name`      | `nvarchar(max)`    | Project name. **[C]**                                                                                                                                                                                                                                                                                             |
| `type`      | `varchar(max)`     | `ORGANIZATION_CREATE`, or `ORGANIZATION_UPDATE` after a rename. **[C]** the site's project event code                                                                                                                                                                                                             |
| `happendat` | `datetime`         | Time of creation **or of the last rename**: a rename builds a fresh event object, which sets `happendat` to now. **[C]** the site's survey event base code, the site's account-management handlers. Server local time (`DateTime.Now`), written to SQL with no UTC conversion. **[C]** the site's SQL access code |
| `timestamp` | `datetime`         | Last write. **[C]**                                                                                                                                                                                                                                                                                               |
| `ipaddress` | `varchar(max)`     | Only from pre-port writes. **[I]**                                                                                                                                                                                                                                                                                |

There is **no owner column** and no reliable creation time. The creator's membership row (3.13)
keeps the creation time until that member's role changes. **[C]** the site's SQL schema script, the site's project event code

### 3.13 Members and roles: SQL `OrganizationUsers`

One row per membership. **[C]** the site's project event code

| Column           | Type               | Notes                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `uniqueidentifier` | Membership ID. **For the creator's row it equals the organization ID**, because the create and join events share one data object. A role change on the legacy site replaces the row with a new random ID, so the marker is lost for creators whose role changed (Step 11 changes the role in place and keeps it). **[C]** the site's account-management handlers, the site's project event code |
| `organizationid` | `uniqueidentifier` | Project. **[C]**                                                                                                                                                                                                                                                                                                                                                                                |
| `userid`         | `uniqueidentifier` | Member. **[C]**                                                                                                                                                                                                                                                                                                                                                                                 |
| `role`           | `varchar(max)`     | `admin` or `user`; compared case-insensitively. **[C]** the site's project model                                                                                                                                                                                                                                                                                                                |
| `type`           | `varchar(max)`     | `ORGANIZATION_CREATE` (creator row), `ORGANIZATION_JOIN` (added member) or `ORGANIZATION_LEAVE` (row rewritten by a role change, sic). **[C]** the site's project event code (the type of each event class)                                                                                                                                                                                     |
| `name`           | `nvarchar(max)`    | Project name, only on the creator's row. **[C]** (shared data object)                                                                                                                                                                                                                                                                                                                           |
| `happendat`      | `datetime`         | Time of join or last role change, in server local time (`DateTime.Now`, no UTC conversion on the SQL write). **[C]** the site's survey event base code, the site's SQL access code                                                                                                                                                                                                              |
| `timestamp`      | `datetime`         | Last write. **[C]**                                                                                                                                                                                                                                                                                                                                                                             |
| `ipaddress`      | `varchar(max)`     | Only from pre-port writes. **[I]**                                                                                                                                                                                                                                                                                                                                                              |

Synthetic rows for project-0001 (creator user-0001, member user-0002):

```json
[
  {
    "id": "55555555-0000-4000-8000-000000000001",
    "organizationid": "55555555-0000-4000-8000-000000000001",
    "userid": "11111111-0000-4000-8000-000000000001",
    "role": "admin",
    "type": "ORGANIZATION_CREATE",
    "name": "Example project",
    "happendat": "2023-11-21 10:00:00.000"
  },
  {
    "id": "aaaaaaaa-0000-4000-8000-000000000001",
    "organizationid": "55555555-0000-4000-8000-000000000001",
    "userid": "11111111-0000-4000-8000-000000000002",
    "role": "user",
    "type": "ORGANIZATION_JOIN",
    "happendat": "2023-11-22 08:00:00.000"
  }
]
```

### 3.14 Out of scope

| Store                                                                                  | Why out of scope                                                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `UserCart`                                                                             | Shop cart.                                                          |
| `UserInvoices`, `InvoiceItems`                                                         | Billing.                                                            |
| `UserLicenses`, `LicenseTransfers`, `LicenseResell`, `LicenseInvoiceRenewal`           | Licences, except the expiry read of section 3.15.                   |
| `UserVATChecks`, `CurrencyLog`                                                         | Billing.                                                            |
| `UserSites`, `UserCalls`, `UserExternalProviders`, `UserSecurityStamp`, `FailedLogins` | Account and sign-in data owned by surveyjs.io and auth.surveyjs.io. |
| `DownloadedQuotas`, `CreateOrder`, `CaptureOrder`, `PaymentQueue`                      | Orders and payments.                                                |
| `SentEmails`, `UriLog`, `Utils`                                                        | Site logs and counters.                                             |
| Users-content account (`emails` blobs, `McpLog` table, `mcplog` blobs)                 | Email bodies and MCP log.                                           |
| `AspNet*` tables (`ConnectionStrings:Default`)                                         | Identity tables registered but not used for users.                  |
| App-data blob container                                                                | Site content.                                                       |

### 3.15 Licences and the licence-expiry dialogs

surveyjs.io shows two dialogs about the licence renewal subscription: "has expired" and "expires
soon". My Surveys shows the same state as `CurrentUser.notices` when
`ACCOUNT_NOTICES=surveyjs-licenses`. The licence rows live in the **same SQL database** as `Users`
(the site's users database connection string secret), so the azure-legacy provider reads them over its existing connection.
**[C]** the site's user storage code, the site's event storage code

This section was read at legacy commit `(a site commit)` (2026-10-14), later than the rest of the page.

**When the site asks.** The site layout includes both dialogs on every page
(the site's page layout, with its two licence popups). For a signed-in visitor, a page script calls
`GET /api/ManageUser/getLicensesExpirationPopupType` and caches the answer for 6 hours in the
`expirationCookie` cookie. It sends two dismissal times from the browser's `localStorage`
(`expiredNotificationDateTime`, `expiresSoonNotificationDateTime`). The answer is `{ popupType }`:
`none`, `expired`, `expiresSoon` or `warningOnly`. The dialogs and a warning marker in the top bar
(the site's top-bar markup) act on it.
**[C]** the site's account-management handlers

**Which licences belong to a user.** The endpoint asks the site's user service code, which reads all the user's licences from the user storage code. **[C]** the site's user service code,
the site's user storage code

1. Owned licences: the `UserLicenses` rows whose `userid` is the user .
2. A row with a non-empty `parentlicenseid` is a developer seat (the older scheme). Its own
   `expirationdate` is replaced by the parent row's . When the parent row is missing,
   the code dereferences null. The endpoint catches the exception and answers 400, the page script
   cannot parse that answer, and no dialog shows at all. **[C]** for the exception, **[I]** for the
   browser side.
3. Transferred licences (the newer scheme): the `LicenseTransfers` rows whose `userid` is the user.
   Each gives the `UserLicenses` row named by `licenseid`, with that row's own expiry
   . A missing licence row gives a licence
   with no expiry, which the rule skips.

The rest of that method (seat assignments, reseller flags, paid state) does not change the answer.

| Column                         | Type               | Use                                                                                                 |
| ------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------- |
| `UserLicenses.id`              | `uniqueidentifier` | Licence ID; the parent of a seat.                                                                   |
| `UserLicenses.userid`          | `uniqueidentifier` | Owner of the licence (or of the seat).                                                              |
| `UserLicenses.parentlicenseid` | `uniqueidentifier` | Set on a developer seat; NULL or all-zero otherwise.                                                |
| `UserLicenses.expirationdate`  | `datetime`         | End of the renewal subscription. NULL: the licence is skipped (its expiry is the minimum date).     |
| `LicenseTransfers.licenseid`   | `uniqueidentifier` | The transferred `UserLicenses` row.                                                                 |
| `LicenseTransfers.userid`      | `uniqueidentifier` | The user who received it.                                                                           |
| Other `UserLicenses` columns   | various            | Company, invoice, price, product and count fields. Not needed. **[C]** the site's SQL schema script |

`expirationdate` is written from server dates with no UTC conversion, like the other SQL dates
(gap 9). My Surveys treats it as UTC. **[I]**

**The rule.** **[C]** the site's licence model, the site's account-management handlers

- A licence is **expired** when its expiry is earlier than the server's current time.
- A licence **expires soon** when it is not expired and the remaining time has at most 14 whole days
  (whole days drop the fraction). So "soon" starts exactly 15 days before the expiry,
  and the expiry instant itself still counts as "soon".
- Per licence, with the dismissal times: expired and not dismissed since the expiry → the expired
  dialog; else expires soon and not dismissed since 14 days before the expiry → the soon dialog;
  else expired or soon → `warningOnly` (top-bar marker only).
- Over all licences: `expired` wins over `expiresSoon`, which wins over `warningOnly`; else `none`.
- Every signed-in user with such a licence gets it. No role, reseller or "can renew" check applies.

**Dismissal is per browser.** "Later" stores the current time in `localStorage`; "Renew" does the
same and opens `/manage` (the account's licence page). A dialog script also shows its dialog only
when no dismissal time is stored at all. **[C]** (both popup views)

**Dialog content.** Headline "Your renewal subscription has expired." or "Your renewal subscription
expires soon.". The body (the same in both) says the licence is perpetual, so versions released in
the first 12 months stay available, and that renewing keeps Help Desk support and product updates.
The buttons are "Renew" (to `/manage`) and "Later". **[C]** (both popup views)

**My Surveys.** It cannot see the site's `localStorage` dismissals, so it applies the rule as for a
visitor who never dismissed a dialog; `warningOnly` cannot occur. Dismissal is the shell's job.

| Legacy `popupType`      | `Notice.code`          | `message`                                 | `actionUrl`                  | `actionLabel` |
| ----------------------- | ---------------------- | ----------------------------------------- | ---------------------------- | ------------- |
| `expired`               | `license-expired`      | `Your renewal subscription has expired.`  | `https://surveyjs.io/manage` | `Renew`       |
| `expiresSoon`           | `license-expires-soon` | `Your renewal subscription expires soon.` | `https://surveyjs.io/manage` | `Renew`       |
| `none`, (`warningOnly`) | no notice              |                                           |                              |               |

A developer seat whose parent row is missing gives no notice, as on the site, and the provider logs
a warning with the seat's ID.

## 4. IDs

| ID                        | Generated by                                                                       | Format             | Relation                                                                                                   | Appears in public URLs                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Survey ID                 | A new GUID made when the event is created. **[C]** the site's survey event code    | GUID               | Primary key of `Surveys`; names the definition, history and layout blobs and the `SurveyCompletion` table. | `/published?id=`, `/Service/EditSurvey/{id}`, `/Service/SurveyResults/{id}`, `/Service/History/{id}`, `getSurvey?surveyId=`, `getSurveyPublicResults/{id}`. **[C]** controllers in section 7           |
| Post ID                   | A new GUID made when the survey is created, independent of the survey ID. **[C]**  | GUID               | `Surveys.postid`; names the `post{postId}` and `postdelete{postId}` tables. Never changes.                 | Request body of `post`, form field of `upload`; shown by "Copy Post ID". **[C]** the old API's survey handlers, the site's My Surveys row menu markup, the site's My Surveys page                      |
| Result ID                 | A new GUID made when the survey is created, independent. **[C]**                   | GUID               | `Surveys.resultid`; only a lookup key.                                                                     | `getResult?resultId=`, `isCompleted?resultId=`; the public results page takes a result ID. **[C]** the site's results handlers; its URL `/Results/Survey/{resultId}` assumes the default route **[I]** |
| Instance ID               | A new GUID made by the site's survey event base code for each post. **[C]**        | GUID               | `RowKey` and `id` of a `post{postId}` row.                                                                 | Not in URLs. Returned as `InstanceId` by private results; nulled in public results; used by `deleteResult?postId=&instanceId=`. **[C]** the site's survey request code                                 |
| Publish ID                | Legacy only; set by `publishVersion`.                                              | GUID string        | `Surveys.publishid`; names `surveypublishedjson` blobs.                                                    | `/published?id=` accepts a publish ID before a survey ID. **[C]** the site's run page handler                                                                                                          |
| User ID                   | A new GUID made on registration. **[C]** the site's survey event code              | GUID               | `Users.id` = OIDC `sub`.                                                                                   | Not in My Surveys URLs.                                                                                                                                                                                |
| Project (organization) ID | A new GUID made when the project is created. **[C]** the site's project event code | GUID               | `Organizations.id`; used as `Surveys.userid` for project surveys.                                          | `/Service/MySurveys/{orgId}`. **[C]** the site's service handlers                                                                                                                                      |
| History point ID          | A new GUID per save. **[C]** the site's survey storage code                        | GUID               | Blob name under `surveyjsonhistory/{surveyId}/`.                                                           | `getHistoryPoint?id=&pointId=`                                                                                                                                                                         |
| File names                | A new GUID (+ extension for respondent files). **[C]**                             | GUID or `GUID.ext` | File share names.                                                                                          | `files?name=`, `image?filePath=`, `file?filePath=`                                                                                                                                                     |
| Client ID                 | Chosen by the API client.                                                          | Free string        | `clientid` on result rows; `RowKey` of `SurveyCompletion` rows.                                            | Query parameter of `isCompleted` and `getSurveyAndIsCompleted`.                                                                                                                                        |

GUIDs are written in the default lower-case "D" format with dashes, except in table names, where
the dashes are removed. **[C]** for the removal, **[I]** for the case (.NET
GUID formatting).

## 5. Event model

**Verdict.** The brief's first look ("event-based storage with interchangeable SQL, Table and
in-memory backends") is only partly right:

- The backends are not interchangeable. Each storage class is bound to one backend (2.1), and
  the SQL access code does not support blobs (writing one throws). **[C]**
  the site's SQL access code
- "Events" are command objects. Performing an event with saving writes the event row and then applies the change to
  the current-state rows and blobs. **[C]** the site's survey event base code
- Production never replays events. The event replay code is
  called only from unit tests. **[C]** (repository-wide search)
- Replay could not rebuild state anyway: the event factory has no case for
  `SURVEY_THEME_CHANGE`, `SURVEY_DELETE_RESULTS_TABLE_STATE` or `SURVEY_DELETE_RESULTS_SUMMARY_STATE`,
  JSON content is not in the events, and `SURVEY_DELETEALLRESULTS` replays as a no-op. **[C]**
  the site's survey event code
- User and organization events are **not persisted**: their `Write` is overridden with the store
  call commented out. **[C]** the site's survey event code,
  the site's project event code

So the table `surveys` is an **audit log** and the projections are the **source of truth**.

**Ordering and versions.** No sequence number, version or ETag field exists. Rows can only be ordered
by `happendat` (or the system `Timestamp`). **[C]** the site's survey event base code

### 5.1 Survey event types (table `surveys`, surveys account)

| Type code                                                                  | Written by (performed with saving)                                                                                                                                                                | Extra payload properties                                    | Projection change                                                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SURVEY_CREATE`                                                            | Create (site, API), clone (for the copy)                                                                                                                                                          | `postid`, `resultid`, `userid`, `creatorid` (GUIDs), `name` | INSERT `Surveys` (`id`=`surveyid`, `createdat`=`happendat`, …). Clone names the copy `Copy of {name}`, keeps the source's `userid` and `creatorid`. |
| `SURVEY_UPDATE`                                                            | Rename (`name`); JSON save (no payload: the JSON goes through a second, unsaved event); layout save (`resulttablestate`, `resultsummarystate`, `resultpermissions`, `resultcolumns` JSON strings) | as listed                                                   | Rewrites `Surveys` (bumps `timestamp`); writes `surveyjson` + `surveytext` + a history blob for JSON saves; writes the layout blob.                 |
| `SURVEY_THEME_CHANGE`                                                      | Theme save, clone                                                                                                                                                                                 | `theme` (JSON string)                                       | `Surveys.theme`.                                                                                                                                    |
| `SURVEY_PUBLISHED`                                                         | Publish, unpublish                                                                                                                                                                                | `ispublished` (bool)                                        | `Surveys.ispublished`.                                                                                                                              |
| `SURVEY_ARCHIVE`, `SURVEY_RESTORE`                                         | Archive, restore                                                                                                                                                                                  | none                                                        | `Surveys.isarchived`.                                                                                                                               |
| `SURVEY_DELETE`                                                            | Delete                                                                                                                                                                                            | none                                                        | Drops `SurveyCompletion{surveyId}` and `post{postId}`; deletes `surveyjson`, `surveytext` blobs and the `Surveys` row.                              |
| `SURVEY_TRANSFER`                                                          | Move to project                                                                                                                                                                                   | `userid` (target project), `creatorid` (acting user)        | Deletes and rewrites the `Surveys` row with the new `userid` and `creatorid`.                                                                       |
| `SURVEY_ACCESSRESUTL` (sic)                                                | Grant Access                                                                                                                                                                                      | `grantaccess` (bool)                                        | `Surveys.allowaccessresult`.                                                                                                                        |
| `SURVEY_POSTRESUTL` (sic, **here**)                                        | "Save Respondent IP": the site's event for it reports the post-result type by mistake                                                                                                             | `storeipaddress` (bool)                                     | `Surveys.storeipaddress`.                                                                                                                           |
| `SURVEY_USECOOKIES`                                                        | `setUseCookies` API                                                                                                                                                                               | `usecookies` (bool)                                         | `Surveys.usecookies`.                                                                                                                               |
| `SURVEY_DELETEALLRESULTS`                                                  | Delete Results                                                                                                                                                                                    | none                                                        | Drops `SurveyCompletion{surveyId}` and `post{postId}`.                                                                                              |
| `SURVEY_DELETE_RESULTS_TABLE_STATE`, `SURVEY_DELETE_RESULTS_SUMMARY_STATE` | Reset Table / Summary State                                                                                                                                                                       | none                                                        | Deletes the layout blob.                                                                                                                            |
| `SURVEY_VERSION_CHANGETITLE`                                               | Hidden `changeVersionTitle` API                                                                                                                                                                   | `title`, `publishedid`                                      | None (the handler builds an object and discards it).                                                                                                |

All rows in this table are **[C]** from the site's survey event code (the type and the perform step of each event class), the site's user storage code, and the callers in
the old API's surveys handlers and the site's service handlers.
Clone itself writes no `SURVEY_CLONE` row: it runs without saving, and its type would read
`SURVEY_DELETE` anyway. **[C]** the site's survey event code, the site's service handlers

Deleting a whole Azure table and posting to the same table name soon after can fail while Azure
finishes the delete (about 40 seconds, HTTP 409). This affects "Delete Results" followed by a new
submission, which is why Step 10 deletes the rows and keeps the tables (section 3.10). **[I]** (Azure Table behaviour) the site's results storage code

### 5.2 Result events (results account)

| Type code                 | Table                | Payload     | Notes                             |
| ------------------------- | -------------------- | ----------- | --------------------------------- |
| `SURVEY_POSTRESUTL`       | `post{postId}`       | section 3.6 | The row is the stored response.   |
| `SURVEY_DELETEPOSTRESUTL` | `postdelete{postId}` | section 3.8 | Audit copy of a deleted response. |

### 5.3 What a writer must do so legacy readers see a change

Legacy readers read **only** projections. A new writer must update the same projections in the same
formats. Appending the matching audit row to `surveys` is not needed by any reader but keeps the log
complete; we recommend it. **[C]** for "readers use projections only" (all read paths in section 7);
the recommendation is ours.

**Rule for every SQL write:** each write of a `Surveys`, `Organizations` or `OrganizationUsers` row
also sets `timestamp` to UTC now, so every row below that changes `Surveys` (create, definition save,
rename, theme, publish, archive, restore, move, settings and layout save) moves the survey's
"updated" date. A layout reset does not touch the row. **[C]**
the site's SQL access code, the site's user storage code, the site's survey event code. Table rows must use the Edm types given in 3.5–3.8.

**Implemented in Step 4:** the "Create survey" row below is built exactly as written (the columns, the
blobs when a definition is given, and the `SURVEY_CREATE` audit row, written last and best effort) in
`server/src/providers/azure-legacy/writes.ts`; see
[ADR 0010](../adr/0010-writing-to-the-legacy-stores.md). When a definition is given, it writes the three
blobs of a definition save before the row.

**Implemented in Step 5** (same file, `writes.ts`; the rules and orders are in
[ADR 0010](../adr/0010-writing-to-the-legacy-stores.md)). Each row of the table below that Step 5 builds
is listed here with how it is done:

- **Rename:** `UPDATE Surveys SET name, [timestamp]`; audit row `SURVEY_UPDATE` with `name`
  (`Edm.String`).
- **Publish / unpublish:** `ispublished` = 1 / 0 and `timestamp`; audit row `SURVEY_PUBLISHED` with
  `ispublished` (`Edm.Boolean`).
- **Archive / restore:** `isarchived` = 1 / 0 and `timestamp`; audit row `SURVEY_ARCHIVE` or
  `SURVEY_RESTORE`, no payload. Archiving does not touch `ispublished`.
- **Move:** `userid` (the project id, or the user id for Personal), `creatorid` (the acting user) and
  `timestamp`, in the same `UPDATE` (no delete and rewrite of the row); audit row `SURVEY_TRANSFER` with
  `userid` and `creatorid` (`Edm.Guid`). Unlike the legacy code, the server first checks that the acting
  user belongs to the target project.
- **Settings:** `allowaccessresult` (1 / 0) and `storeipaddress` (`"1"` / `"0"`, a text column) and
  `timestamp`; audit rows `SURVEY_ACCESSRESUTL` with `grantaccess` and `SURVEY_POSTRESUTL` with
  `storeipaddress` (both `Edm.Boolean`; the type codes keep the legacy spelling). `usecookies` is not
  written.
- **Delete:** the three results-account tables (`post{postId}`, `SurveyCompletion{surveyId}`,
  `postdelete{postId}`), the blobs `surveyjson/{id}` and `surveytext/{id}`, every history blob under
  `surveyjsonhistory/{id}/`, and the four results-layout blobs of section 3.10 (legacy leaves these
  behind), then the `Surveys` row, then the `SURVEY_DELETE` audit row. The children go first.
- **Clone** (derived from 5.1): the create sequence of Step 4 with the source's definition text copied
  unchanged, then `Surveys.theme` set from the source's theme text when it has one, with an audit row
  `SURVEY_THEME_CHANGE` (`theme`, `Edm.String`). The copy is **not** given the source's creator: the
  acting user is its creator. Legacy's extra empty `SURVEY_UPDATE` row is not written.

**Implemented in Step 6** (same file; rules and order in
[ADR 0010](../adr/0010-writing-to-the-legacy-stores.md#step-6-definition-and-theme-saves)):

- **Save definition:** an existence check; `surveyjson/{id}` replaced with a condition (`If-Match` of the
  blob's ETag, or `If-None-Match: *` for a survey without a blob; a refusal is a conflict and nothing else
  is written); `surveytext/{id}` replaced; a new point `surveyjsonhistory/{id}/{newGuid}` with the metadata
  `userid` and `savedat` (3.4); `UPDATE Surveys SET [timestamp]`; audit row `SURVEY_UPDATE` without a
  payload. All blobs hold the compact JSON text, UTF-8 without a BOM, as append blobs.
- **Save theme:** `UPDATE Surveys SET theme, [timestamp] ... OUTPUT inserted.theme` with a `WHERE` that
  compares the old theme text exactly (the compare-and-set); audit row `SURVEY_THEME_CHANGE` with `theme`
  (`Edm.String`), or without `theme` when it is longer than 32,000 UTF-16 code units. No history entry.
- Not done, and not planned: deleting the editor preview image from the `surveyfiles` share (the rows above
  say "if we keep that behaviour"). Nothing in the legacy repository writes such a file, and Azurite cannot
  emulate the share. See [ADR 0013](../adr/0013-editor-uploads-and-files.md) (R4).

**Implemented in Step 7** (`writes.ts`; [ADR 0013](../adr/0013-editor-uploads-and-files.md)): the file put
and delete in the new container `my-surveys-files` (section 3.9), and a clone that rewrites the file links in
the copy's definition text and theme.

**Implemented in Step 9** (`writes.ts`; [ADR 0015](../adr/0015-results-summary-table-and-views.md)): the
per-user layout save and reset in the new container `my-surveys-views` (section 3.10). They write **no**
audit row and leave `timestamp` alone, so the "Save / reset layouts" row below is not followed for them: the
old per-survey blobs are read only.

**Implemented in Step 10** (`writes.ts`; [ADR 0016](../adr/0016-results-details-exports-and-public-results.md)): the
delete-all-results rows (batched, tables kept, with the `SURVEY_DELETEALLRESULTS` audit row of this section's
table), the kind-limited delete of respondent files and the public-question list in
`surveyresultpermissions/{id}` (section 3.10; no audit row).

**Implemented in Step 11** (`writes.ts`; [ADR 0010](../adr/0010-writing-to-the-legacy-stores.md#step-11-projects-and-members),
[ADR 0017](../adr/0017-projects-and-members.md)): the four rows "Create project", "Add member / change role /
remove", "Rename project" and "Delete project" of the table below, built as follows. None of them writes an
audit row, except the survey move of a delete.

- **Create project:** one transaction. `INSERT Organizations` (`id` a new GUID, `name`, `type`
  `ORGANIZATION_CREATE`, `happendat` = `timestamp` = now, UTC), then `INSERT OrganizationUsers` for the creator
  (`id` = the project id, `organizationid`, `userid`, `role` `admin`, `type` `ORGANIZATION_CREATE`, `name`,
  `happendat`, `timestamp`). Legacy does the same in two separate writes with no transaction.
- **Add member:** a transaction that locks the project, refuses when the user already has a row, then inserts a
  row (a new random `id`, `type` `ORGANIZATION_JOIN`, `role` in lower case, no `name`). Blocked users may be
  added; the user must exist (the service checks).
- **Change role:** `UPDATE OrganizationUsers SET role, [timestamp]` on the member's rows, **in place**: `id`,
  `type`, `happendat` and `name` stay. Legacy deletes the row and inserts a new one (a new id, `type`
  `ORGANIZATION_LEAVE`), so the creator marker is lost; in place it survives. The last-admin check and the
  write are one transaction.
- **Remove member:** a transaction that decides with the last-admin rule and then deletes every row of the user
  in the project (duplicates included).
- **Rename project:** `UPDATE Organizations SET name, [timestamp]`. `type` and `happendat` stay, so
  `createdAt`'s fallback does not move (legacy rewrites both). The creator row's `name` is not rewritten.
- **Delete project:** one transaction in this order: move every survey of the project, archived ones too
  (`UPDATE Surveys SET userid = receiver, [timestamp]`, `creatorid` unchanged), delete the project's
  `OrganizationUsers` rows, delete the `Organizations` row; then one best-effort `SURVEY_TRANSFER` row per
  moved survey (`userid` = the receiver, `creatorid` = the survey's creator). The receiver is the owner (9.3)
  when they are still a member, else the admin who deletes. Legacy's precondition (no surveys, the caller the
  only member) is dropped.

All of these (but not the layout writes of Step 9) set `timestamp` to the time the server's clock gives,
once per request, and an update that changes no value still rewrites it. Every audit row is best effort (a
failure is logged with the survey id and the type only). Still to build: the setting `usecookies`.

| Operation                         | Required writes                                                                                                                                                                                                                                                                                                                                                                                                                          | Recommended audit row         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Create survey                     | INSERT `Surveys` with `id`, `name`, `userid`, `creatorid`, `postid`, `resultid` (three new GUIDs), `createdat`, `timestamp`. No blob yet.                                                                                                                                                                                                                                                                                                | `SURVEY_CREATE`               |
| Save definition                   | Overwrite append blobs `surveyjson/{id}` and `surveytext/{id}`; add append blob `surveyjsonhistory/{id}/{newGuid}`; rewrite the `Surveys` row so `timestamp` moves; delete the preview image `my-surveys-survey-preview-image-{id}` from share `surveyfiles` if we keep that behaviour (the old API's definition save does that).                                                                                                        | `SURVEY_UPDATE` (no payload)  |
| Rename                            | `Surveys.name`, `timestamp`.                                                                                                                                                                                                                                                                                                                                                                                                             | `SURVEY_UPDATE` with `name`   |
| Save theme                        | `Surveys.theme`, `timestamp`; delete the preview image file if we keep that behaviour.                                                                                                                                                                                                                                                                                                                                                   | `SURVEY_THEME_CHANGE`         |
| Publish / unpublish               | `Surveys.ispublished` = 1 / 0.                                                                                                                                                                                                                                                                                                                                                                                                           | `SURVEY_PUBLISHED`            |
| Archive / restore                 | `Surveys.isarchived`.                                                                                                                                                                                                                                                                                                                                                                                                                    | `SURVEY_ARCHIVE` / `_RESTORE` |
| Move                              | `Surveys.userid` = project ID (or user ID for Personal), `creatorid` = acting user.                                                                                                                                                                                                                                                                                                                                                      | `SURVEY_TRANSFER`             |
| Delete survey                     | Delete tables `post{postId}` and `SurveyCompletion{surveyId}`, blobs `surveyjson/{id}` and `surveytext/{id}`, then the `Surveys` row.                                                                                                                                                                                                                                                                                                    | `SURVEY_DELETE`               |
| Settings                          | `allowaccessresult`, `storeipaddress` (`1`/`0`), `usecookies`.                                                                                                                                                                                                                                                                                                                                                                           | as in 5.1                     |
| Submit response                   | Insert into `post{postId}` (create the table if missing) with the properties of 3.6, `PartitionKey` `*`, `RowKey` = new GUID; `id`, `postid`, `surveyid` as `Edm.Guid`, `happendat` as `Edm.DateTime`, `ispartialcompleted` as `Edm.Boolean`, the rest `Edm.String`. When a client ID is given, upsert `SurveyCompletion{surveyId}` row `RowKey` = client ID with `ispartialcompleted` as `Edm.Boolean` and `publishid` as `Edm.String`. | none (the row is the event)   |
| Delete all responses              | Delete both tables. **Step 10 deletes the rows in batches and keeps the tables** (section 3.10), then appends `SURVEY_DELETEALLRESULTS`.                                                                                                                                                                                                                                                                                                 | `SURVEY_DELETEALLRESULTS`     |
| Save / reset layouts              | Overwrite or delete `surveyresulttablestate/{id}` / `surveyresultsummarystate/{id}` / `surveyresultpermissions/{id}`.                                                                                                                                                                                                                                                                                                                    | `SURVEY_UPDATE` / `_DELETE_…` |
| Create project                    | INSERT `Organizations` (`id`, `name`, `type`, `happendat`, `timestamp`); INSERT `OrganizationUsers` for the creator (`role` = `admin`).                                                                                                                                                                                                                                                                                                  | none (not persisted today)    |
| Add member / change role / remove | INSERT / DELETE+INSERT / DELETE `OrganizationUsers` rows. **Step 11 changes the role in place** (`UPDATE`).                                                                                                                                                                                                                                                                                                                              | none                          |
| Rename project                    | `Organizations.name`, `timestamp`. Legacy also rewrites `type` (`ORGANIZATION_UPDATE`) and `happendat`; Step 11 does not.                                                                                                                                                                                                                                                                                                                | none                          |
| Delete project                    | Legacy allows it only with no non-archived surveys and one member (the caller); it deletes that membership, then the organization. **Step 11 moves every survey first** and has no such precondition.                                                                                                                                                                                                                                    | none                          |

New concepts can be added without breaking readers:

- Extra **Azure Table properties** on result rows are ignored by every reader (they read only
  `result`, `happendat`, `ipaddress`, `clientid`, `id`). **[C]** the site's survey request code.
  Pick names that cannot clash with question names, because `getResult` looks up question names
  among row properties. **[C]** the site's results data code
- Extra **SQL columns** would be read (`select *`) and written back by legacy code, which is
  harmless, but they are a schema change owned by the site team. A writer that sends a property with
  no matching column fails, because every property becomes a column in the INSERT. **[C]**
  the site's SQL access code;
  **[I]** for "harmless".
- New **blob containers** (history snapshots with metadata, per-user views, respondent files) are
  invisible to legacy code. **[C]** (legacy code addresses containers by fixed names only) So far the
  new containers are `my-surveys-files` (section 3.9) and `my-surveys-views` (section 3.10, Step 9).

## 6. Directory (D12)

Users, projects, members and roles all live in the **Azure SQL users database**
(the site's users database connection string secret), not in Azure Table storage and not in the ASP.NET Identity database.
**[C]** the site's user storage code,
the site's event storage code

| Need                          | Table and columns                                                                                           | Code                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| User by ID                    | `Users` where `id` = `sub`                                                                                  | the site's user storage code                                         |
| User by email (add member)    | `Users` where `email` = lower-cased input                                                                   | the site's user storage code, the site's account-management handlers |
| Projects of a user            | `OrganizationUsers` where `userid` = user, then `Organizations` by `organizationid`                         | the site's user storage code                                         |
| Members of a project          | `OrganizationUsers` where `organizationid` = project, joined to `Users` in code (missing users are skipped) | the site's user storage code                                         |
| Role                          | `OrganizationUsers.role` (`admin` / `user`)                                                                 | the site's project model                                             |
| Surveys of Personal / project | `Surveys` where `userid` = user ID / project ID, filtered by `isarchived` in code                           | the site's user storage code                                         |

How a user is identified: the auth server's UserInfo returns `sub` = `id` = the `Users.id` GUID and
`email`. **[C]** the sign-in server's OAuth handlers. The current site and
API resolve the signed-in user by email (`User.Identity.Name`), not by ID. **[C]**
the site's service handlers,
the old API's surveys handlers

Legacy permission rules the new app must reproduce or consciously change:

- A user may open a survey when `Surveys.userid` is their ID, when they are a member of the project
  whose ID is `Surveys.userid` (any role), or when they are a site admin. **[C]**
  the site's service handlers, the old API's surveys handlers
- The list shows modify actions when the user's role in the current scope is `admin` (always true for
  Personal) **or** the user is the survey's `creatorid`. **[C]**
  the site's My Surveys models. The spec says "any
  member may modify"; Step 4 keeps the legacy rule, and the product owner is to confirm it
  ([ADR 0009](../adr/0009-survey-permissions-follow-legacy.md), gap 12).
- The legacy UI cannot move a project survey back to Personal: the Personal entry has no action.
  **[C]** the site's My Surveys row menu markup
- **Every** project mutation (rename, delete, add a member, remove a member, change a role) needs the caller to
  be an admin of the project, so a plain member cannot even leave. Removing or demoting the only admin is
  refused. Deleting a project is allowed only when it has no **non-archived** survey (archived ones are not
  counted, so they stay behind pointing at the deleted project) and the caller is its only member. **[C]**
  the site's account-management handlers, the site's user storage code
  (whose archived filter defaults to false). Refusals of the delete and several
  no-ops answer HTTP 200 with `{}` and no message; the role string a client sends is stored without
  validation (only `admin`, compared without regard to case, has a meaning); and the lists of projects and
  members are read with no `ORDER BY`, so their order is the database's. Step 11 departs from each of these
  ([ADR 0017](../adr/0017-projects-and-members.md); section 5.3).
- Deleting a survey from the site works only when `Surveys.userid` is the caller (or for a site
  admin), so project surveys cannot be deleted from the legacy list; the private API instead
  requires the `admin` role. Neither checks that the survey is archived. **[C]**
  the site's service handlers,
  the old API's surveys handlers
- Deleting an account deletes the user's personal surveys and their results, but leaves their
  `OrganizationUsers` rows. **[C]** the site's survey event code

### 6.1 Sign-in server: `auth.surveyjs.io`

The legacy sign-in server is a plain **OAuth 2.0** authorization server with a UserInfo endpoint, in
the style of GitHub or Slack. It is not a full OpenID provider. **[C]**
the sign-in server's OAuth handlers

| Item      | What it does                                                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metadata  | RFC 8414 at `/.well-known/oauth-authorization-server` only. No `openid-configuration`, no `jwks_uri`. Advertised scopes: `profile`, `email`                                                                |
| Authorize | `/OAuth/Authorize`: `response_type=code` only; `state` required; PKCE optional, but only `S256`. `scope` is stored as sent, not checked; `nonce` is stored but never returned                              |
| Token     | `/OAuth/Token`: `authorization_code` only; client secret by form post or HTTP Basic; checks the client, the redirect URI and the PKCE verifier. Answers an **opaque** access token, with **no `id_token`** |
| UserInfo  | `/OAuth/UserInfo` (bearer token): `sub` and `id` (both the `Users.id` GUID), `email`, `name` (the display name, else the email), `scope`                                                                   |
| Logout    | `/OAuth/Logout` (the `end_session_endpoint`): signs out of the auth server, then returns to `post_logout_redirect_uri` if it is registered for `client_id`                                                 |
| Revoke    | `/OAuth/Revoke` (RFC 7009), client-authenticated                                                                                                                                                           |

My Surveys therefore signs in with `OIDC_DISCOVERY=oauth-authorization-server` (the default):
authorization code with PKCE S256 and `state`, then the identity from UserInfo. The
`openid-configuration` mode exists for a real OpenID provider. There, an ID token is required and
checked (with a `nonce`) only when the scopes also include `openid`; without `openid` no nonce is sent
and no ID token is expected.

## 7. How `api.surveyjs.io` reads results and inline files

The public controller is mounted at both `public/Survey` and `public/v1/Survey`; the private one at
`private/Surveys` and `private/v1/Surveys`. **[C]** the old API's survey handlers,
the old API's surveys handlers (its route attributes)

| Endpoint                                          | Code path                                                                                                                                                                                                                                                                                 | Data read                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET getSurvey?surveyId=`                         | the old API's survey handlers → the site's survey request code → the site's survey storage code. No publish check. 400 when the blob is empty.                                                                                                                                            | Blob `surveyjson/{surveyId}`                                                       |
| `GET getSurveyAndIsCompleted`                     | the old API's survey handlers → the site's completion check and JSON read. Answers `{ survey, isCompleted: "no" / "partial" / "completed" }`.                                                                                                                                             | `Surveys` by `id`; `SurveyCompletion{surveyId}` row = client ID; `surveyjson` blob |
| `POST post`                                       | the old API's survey handlers → the site's survey request code: look up `Surveys` by `postid`, sanitize the string, the post-result event. No publish check.                                                                                                                              | Writes `post{postId}` (+ `SurveyCompletion`)                                       |
| `POST upload`                                     | the old API's survey handlers → the site's results storage code                                                                                                                                                                                                                           | Writes share `files`                                                               |
| `GET getResult?resultId=&name=`                   | the site's survey request code → `Surveys` by `resultid` → the published JSON read → all rows of `post{postId}` → the site's results data code (parses each `result`, merges by client ID) → counts values of question `name`. Cached 60 min in release builds.                           | `{ AnswersCount, QuestionResult, FirstResultAt, LastResultAt, ResultCount }`       |
| `GET isCompleted?resultId=&clientId=`             | the site's survey request code                                                                                                                                                                                                                                                            | `Surveys` by `resultid`; `SurveyCompletion` row                                    |
| `GET private/Surveys/getSurveyPublicResults/{id}` | the old API's surveys handlers: requires `allowaccessresult`. The results enumeration without full access: `InstanceId` nulled, columns limited by `surveyresultpermissions` / `surveyresultcolumns`. Streamed as `{ Data, ResultCount }`.                                                | `post{postId}`, layout blobs                                                       |
| `GET private/Surveys/getSurveyResults/{id}`       | the old API's surveys handlers: private, full access. Without `take`: streamed. With `take` (1–1000): Azure continuation token, or a numeric skip when a date filter is used or any row has a client ID.                                                                                  | `post{postId}`                                                                     |
| `GET private/Surveys/getSurveyDemoResults`        | the old API's surveys handlers, used by the results page. The limited JSON result: the first 1,000 rows in storage order.                                                                                                                                                                 | `post{postId}`                                                                     |
| `GET private/Surveys/exportSurveyResults`         | the old API's surveys handlers → the old API's results export code: `csv` → the full result calculation (columns from the site's results data code; arrays and objects serialized as JSON text); any other format, `xlsx` included, → JSON via the full JSON result with full access off. | `post{postId}`, layout blobs                                                       |

Row shape returned by the JSON readers: the parsed `result` object plus `HappendAt`, `IPAddress` (if
stored), `ClientId` (if stored) and `InstanceId`. **[C]** the site's survey request code

All paths above are **[C]** from the old API's survey handlers,
the old API's surveys handlers, the site's survey request code,
the site's results data code, the old API's results export code and
the old API's streamed results code.

**How a file answer is stored and read back.**

- Stored: as part of the `result` JSON string. From the surveyjs.io run page it is a Form Library file
  value with an inline data URL in `content`. **[C]** for "part of the string" (3.6), **[I]** for the
  data URL (3.9).
- Size: limited by the 65,536-character client check and the 32K-character Azure property limit
  (3.6). There is no server-side size check. **[C]** the old API's survey handlers
- Read back: every reader parses the string into dictionaries and lists and returns the values as
  they are. No code looks at `content`, `data:` or the file value's shape. **[C]**
  the site's integer converter,
  the site's survey request code; repository-wide search finds no `data:` handling in result code.
- `getResult` on a file question counts the key/value pairs inside the file objects, so its output is
  already meaningless for file questions. **[C]** the site's results data code
- The only file-aware code checks string values that start with `dxsimage:` or `dxsfile:` and marks
  the column as an image or file link. Its HTML renderer has no caller. **[C]**
  the site's results data code (unused), the site's results data code
- The browser results page (SurveyJS Dashboard and Table) renders the values client-side. **[C]**
  the site's results page

**Calls of the smoke test (Step 14).** `pnpm smoke:legacy` ([smoke test](../operations/smoke-test.md)) reads these.
All are `GET`; the paths also work with `v1` after `public` or `private`. **[C]**
the old API's survey handlers, the old API's surveys handlers

| Call                                            | Parameters                                                     | Answer                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `public/Survey/getSurvey`                       | `surveyId`                                                     | The `surveyjson` text; 400 when there is none                                    |
| `public/Survey/getResult`                       | `resultId`, `name`                                             | `{ AnswersCount, QuestionResult, FirstResultAt, LastResultAt, ResultCount }`     |
| `public/Survey/isCompleted`                     | `resultId`, `clientId`                                         | The string `no`, `partial` or `completed`                                        |
| `private/Surveys/getActive` (`getArchive`)      | `accessKey`; `ownerId` (optional)                              | The active (archived) `Survey` records of the owner                              |
| `private/Surveys/getSurveyInfo`                 | `accessKey`, `surveyId`; `ownerId` (optional)                  | `{ Info: Survey, Json }`, `Json` HTML-encoded (not used)                         |
| `private/Surveys/getHistoryPoint[/{id}]`        | `accessKey`, `id`, `pointId`                                   | The point's JSON; 400 when not allowed or empty                                  |
| `private/Surveys/getSurveyResults[/{id}]`       | `accessKey`, `id`; `from`, `till`, `take`, `continuationToken` | `{ Data, ResultCount }` (with `take`: one page and `ContinuationToken`)          |
| `private/Surveys/getSurveyPublicResults[/{id}]` | `id`; `from`, `till`                                           | `{ Data, ResultCount }`, no key; 400 unless `allowaccessresult`                  |
| `private/Surveys/getIsPublished[/{id}]`         | `accessKey`, `id`                                              | `IsPublished ?? false` and a `publishid`: false after a plain publish (not used) |

- **The access key** is the query parameter `accessKey` and nothing else (or the site's cookie). An unknown key or a
  blocked user fails, and the error text quotes the key: `The accessKey '…' is incorrect.` A client must never print
  a legacy error text. **[C]** the old API's API-key check, the old API's surveys handlers
- **`ownerId`**: a project id lists the project's surveys only when the key's user has an `OrganizationUsers` row in
  it; otherwise the user's own list comes back, with no error. **[C]** the old API's surveys handlers
- **Access to one survey** (`getHistoryPoint`, `getSurveyResults`, `getIsPublished`): its owner, a member of its
  project, or a site admin. **[C]** the old API's surveys handlers
- **The record's JSON** uses the property names of the site's survey model, in this form: `Id`, `Name`,
  `IsArchived`, `UserId`, `CreatorId`, `PostId`, `ResultId`, `PublishId`, `IsPublished` (`null` while the flag is
  empty), `UseCookies`, `UpdatedOn`, `CreatedAt`, `AllowAccessResult`, `StoreIPAddress`, `Theme` (the stored text),
  `Json`. **[C]** the site's survey model
- **No project read.** No call lists projects or members (`changeOrganization` only moves a survey), so the smoke test
  cannot read a project delete back. **[C]** the old API's surveys handlers

## 8. D11 verdict

**Yes, with conditions.** Respondent files can be stored as URLs in place of inline content without
breaking `api.surveyjs.io` readers.

Evidence:

1. Results are an opaque JSON string in one property; every reader parses and passes values through
   without inspecting file content. **[C]** the site's survey request code; the site's integer converter; the old API's results export code
2. References in results already exist in legacy data: the legacy `upload` endpoint stores the bytes
   in the `files` share and returns a `dxsimage:`/`dxsfile:` reference for the client to keep in the
   answer. **[C]** the old API's survey handlers
3. Nothing reads `content` as base64, and `getResult` output for file questions is unchanged in kind.
   **[C]** section 7

Conditions:

| #   | Condition                                                                                                                                                                                                                                                                                          | Why                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Keep the Form Library value shape `[{ "name", "type", "content" }]` and put an **absolute HTTPS URL** in `content`.                                                                                                                                                                                | The SurveyJS Dashboard, Table and Form Library (display mode) treat `content` as a link or image source. **[I]**                                          |
| 2   | The URL must work **without our session**: unguessable and long-lived (or permanent), like the legacy editor-asset URL `private/Surveys/files?name=`, which serves bytes with no auth. (The public `image?filePath=` and `file?filePath=` actions likely do not serve bytes in the port; see 3.9.) | Legacy API clients, exports and the old results page only get the URL. **[C]** for the legacy URLs being unauthenticated, **[I]** for client needs.       |
| 3   | Write result rows **directly** to `post{postId}`, not through legacy `POST post`.                                                                                                                                                                                                                  | The old post handler runs an HTML sanitizer over the string, which may HTML-encode `&` in URLs. **[C]** for the sanitizer call, **[I]** for the encoding. |
| 4   | Clean up files ourselves.                                                                                                                                                                                                                                                                          | Legacy delete paths (`deleteResult`, `deleteAllResults`, survey delete, account delete) do not touch files. **[C]** 3.9                                   |
| 5   | Accept that consumers who decode `content` as a data URL will see a URL.                                                                                                                                                                                                                           | External integrations are outside this code. Only usage data or customers can tell. **[I]**                                                               |

What would break if the conditions are not met: links that need a cookie would show broken images in
exports and in the old results page; sanitized URLs with `&amp;` would 404; deleted results would
leave orphaned files. Nothing in the code depends on a storage copy for this verdict; a storage copy
would only tell us how many existing results hold `dxsimage:` references or very large data URLs
(section 11).

## 9. Mapping to the domain

Contract field names come from `contract/openapi.yaml` (`components.schemas`).

### 9.1 Survey (`Survey`)

| Legacy                                                               | Domain                            | Rule                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Surveys.id`                                                         | `id`                              | As is.                                                                                                                                                                                                                                                                                       |
| `Surveys.name`                                                       | `name`                            | As is (max 200 in SQL).                                                                                                                                                                                                                                                                      |
| `Surveys.userid`                                                     | `projectId`                       | The project ID when `userid` is an `Organizations.id`; `null` when it is a user ID (Personal).                                                                                                                                                                                               |
| `Surveys.userid` (Personal)                                          | owner (internal)                  | The owning user for Personal surveys.                                                                                                                                                                                                                                                        |
| `Surveys.creatorid`                                                  | (internal)                        | Needed for the legacy `canModify` rule.                                                                                                                                                                                                                                                      |
| `Surveys.ispublished`                                                | `published`                       | `false` only when 0. `NULL` → `true`, as the old run page ran it (the old list hid "Run"). Step 14, ADR 0014 S1; earlier steps read `NULL` as `false`.                                                                                                                                       |
| `Surveys.isarchived`                                                 | `archived`                        | 1 → `true`.                                                                                                                                                                                                                                                                                  |
| `Surveys.createdat`                                                  | `createdAt`                       | Treat as UTC **[I]**: written from `DateTime.Now` with no conversion, so it is UTC only on a UTC server (App Service default); see gap 9.                                                                                                                                                    |
| `Surveys.timestamp`                                                  | `updatedAt`                       | UTC.                                                                                                                                                                                                                                                                                         |
| `Surveys.postid`                                                     | `postId`                          | As is.                                                                                                                                                                                                                                                                                       |
| `Surveys.resultid`                                                   | `resultId`                        | As is.                                                                                                                                                                                                                                                                                       |
| `Surveys.allowaccessresult`                                          | `settings.publicResults`          | 1 → `true`.                                                                                                                                                                                                                                                                                  |
| `Surveys.storeipaddress`                                             | `settings.storeRespondentIp`      | `1` → `true`.                                                                                                                                                                                                                                                                                |
| role + `creatorid`                                                   | `permissions.canModify`           | Legacy: `admin` in scope, or user is `creatorid` (section 6).                                                                                                                                                                                                                                |
| blob `surveyjson/{id}`                                               | `SurveyDefinition`                | Parse JSON; `{}` when missing.                                                                                                                                                                                                                                                               |
| `Surveys.theme`                                                      | `SurveyTheme`                     | Parse JSON; `{}` when empty.                                                                                                                                                                                                                                                                 |
| `Surveys.usecookies`                                                 | (none yet)                        | "Limit to one response" lives in the survey JSON in the new app; keep reading this flag for parity.                                                                                                                                                                                          |
| blob `surveyjsonhistory/{id}/{pointId}` `LastModified`               | `HistoryEntry.at`                 | `user` = `null` for all legacy entries.                                                                                                                                                                                                                                                      |
| blobs `surveyresultsummarystate/{id}`, `surveyresulttablestate/{id}` | `ViewState` (`summary`, `table`)  | **Decided in Step 9** (per user): a user's view is read from the container `my-surveys-views`; until the user saves or resets, the survey's blob is returned as stored (section 3.10).                                                                                                       |
| blob `surveyresultpermissions/{id}`                                  | `settings.privateResultQuestions` | **Decided in Step 10 (R1):** the names of the elements with `isPublic` false; any other element is public. Read with the old defaults, written for the private ones only (section 3.10). `getSurvey`, `updateSurvey`, `createSurvey` and `cloneSurvey` carry it; `listSurveys` items do not. |

### 9.2 Response (`SurveyResponse`, `ResultStats`)

| Legacy (`post{postId}` row)      | Domain                                                     | Rule                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id` / `RowKey` (InstanceId)     | `id`                                                       | As is.                                                                                                                                                                                                                                                                                                                                     |
| `happendat` (HappendAt)          | `submittedAt`                                              | UTC (the Table writer converts to UTC). **[C]**                                                                                                                                                                                                                                                                                            |
| `result`                         | `data`                                                     | `JSON.parse`; may contain HTML entities from the sanitizer (section 11).                                                                                                                                                                                                                                                                   |
| `clientid`                       | `clientId`                                                 | Optional.                                                                                                                                                                                                                                                                                                                                  |
| `ipaddress`                      | `respondentIp`                                             | Optional; present only on rows written while the setting was on (and by pre-port code).                                                                                                                                                                                                                                                    |
| `ispartialcompleted`             | `partial`                                                  | Missing → `false`.                                                                                                                                                                                                                                                                                                                         |
| count / min / max `happendat`    | `ResultStats.count`, `firstSubmittedAt`, `lastSubmittedAt` | Full scan of the table; legacy merges rows with the same client ID before counting (merge rules differ by path, see 3.6). **Step 8:** `count` is the number of rows, with no merging. **Step 9 decided: no merging** in `listResults` either, one stored row is one response ([ADR 0015](../adr/0015-results-summary-table-and-views.md)). |
| new row (Step 8)                 | `NewResponse`                                              | `id` is the response id, `submittedAt` the server clock, `data` is stored as compact JSON text (at most 32,768 UTF-16 code units), `clientId` and `respondentIp` only when given. See 3.6.                                                                                                                                                 |
| `SurveyCompletion{surveyId}` row | `CompletionState` (`none`, `partial`, `completed`)         | No row: `none`. `ispartialcompleted` true: `partial`. Otherwise `completed`. Written on every response with a client ID. See 3.7.                                                                                                                                                                                                          |

### 9.3 Project (`Project`)

| Legacy                                                  | Domain        | Rule                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Organizations.id`                                      | `id`          | As is.                                                                                                                                                                                                                                                                                                                                                                       |
| `Organizations.name`                                    | `name`        | As is.                                                                                                                                                                                                                                                                                                                                                                       |
| none                                                    | `ownerId`     | No column. The user of the `OrganizationUsers` row whose `id` equals the organization ID (the creator's row); `null` when there is no such row. **Creator only since Step 11**: the earlier fallbacks (earliest admin, earliest member) are gone, and a role change made on surveyjs.io replaces the creator's row, so `ownerId` then becomes `null` (ADR 0017, R2). **[I]** |
| `OrganizationUsers.role` (current user)                 | `role`        | Lower-case.                                                                                                                                                                                                                                                                                                                                                                  |
| count of `OrganizationUsers` rows                       | `memberCount` | Count rows for the project.                                                                                                                                                                                                                                                                                                                                                  |
| creator row `happendat`, else `Organizations.happendat` | `createdAt`   | `Organizations.happendat` moves on rename (3.12), so prefer the creator's membership row. Both are server local time; treat as UTC **[I]** (gap 9).                                                                                                                                                                                                                          |

### 9.4 Member (`Member`) and user (`CurrentUser`)

| Legacy                     | Domain                    | Rule                |
| -------------------------- | ------------------------- | ------------------- |
| `OrganizationUsers.userid` | `Member.userId`           | As is.              |
| `Users.displayname`        | `Member.displayName`      | Join on `Users.id`. |
| `Users.email`              | `Member.email`            | As is.              |
| `OrganizationUsers.role`   | `Member.role`             | Lower-case.         |
| `Users.id`                 | `CurrentUser.id`          | Equals OIDC `sub`.  |
| `Users.displayname`        | `CurrentUser.displayName` | Fallback: email.    |
| `Users.email`              | `CurrentUser.email`       | As is.              |
| none                       | `CurrentUser.avatarUrl`   | `null`.             |
| `UserLicenses` (3.15)      | `CurrentUser.notices`     | Licence rule, 3.15. |

### 9.5 Files (`StoredFile`)

| Legacy                             | Domain                                | Rule                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Share `surveyfiles`, name `{guid}` | editor asset `id`; `url` = legacy URL | Read only; size from the share; no content type or name stored.                                                                                                              |
| Share `files`, name `{guid}{ext}`  | respondent file (legacy)              | Read only; content type from the extension.                                                                                                                                  |
| Container `my-surveys-files`       | `StoredFile` for new uploads          | Blob `{surveyId}/{fileId}`: the survey ID is in the name, the content type is the blob's own, the size is its length; metadata `kind`, `name` (URI-encoded) and `createdat`. |

## 10. Replica plan

A local offline replica needs **Azurite and a SQL Server container**.

| Need                                              | Local tool                                                   | Why                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Azure Table (surveys log, results, completion)    | Azurite Table service                                        | Section 3.5–3.8.                                                                                                                                  |
| Azure Blob (definitions, history, layouts)        | Azurite Blob service                                         | Section 3.2–3.4, 3.10. Use **append blobs** to match legacy writers.                                                                              |
| Azure Queue                                       | not needed                                                   | No queue is used (2.2).                                                                                                                           |
| Azure Files (`surveyfiles`, `files`, `tempfiles`) | **Not available in Azurite** **[I]**                         | Fixtures for legacy files need another approach: serve them from a stub behind the FileStore interface, or skip legacy file reads in the replica. |
| Users database                                    | SQL Server 2022 container (`mcr.microsoft.com/mssql/server`) | `Users`, `Surveys`, `Organizations`, `OrganizationUsers` are SQL tables (6). Azure SQL Edge was retired in 2025, so do not use it. **[I]**        |

One Azurite account can host all three storage accounts' objects: their table and container names do
not collide. **[I]** (names in this page). Separate accounts (Azurite `AZURITE_ACCOUNTS`) are also
possible if we want to test three connection strings.

The replica must create:

| Kind                                       | Name                                                                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL tables                                 | `Users`, `Surveys`, `Organizations`, `OrganizationUsers` (columns as in sections 3.1, 3.11–3.13), `UserLicenses` and `LicenseTransfers` (3.15)                                            |
| Azure tables (surveys account)             | `surveys`                                                                                                                                                                                 |
| Azure tables (results account), per survey | `post{postId without dashes}`, `SurveyCompletion{surveyId without dashes}`, optionally `postdelete{postId without dashes}`                                                                |
| Blob containers (surveys account)          | `surveyjson`, `surveytext`, `surveyjsonhistory`, `surveyresulttablestate`, `surveyresultsummarystate`, `surveyresultpermissions`, `surveyresultcolumns`, optionally `surveypublishedjson` |
| File shares (if emulated)                  | `surveyfiles` (surveys account), `files` (results account)                                                                                                                                |

SQL indexes from the site's SQL constraints script: `users_email_idx`, `users_dxid_idx`,
`users_accesskey_idx` on `Users`, and `organizationusers_userid_idx`,
`organizationusers_organizationid_idx` on `OrganizationUsers`. **[C]** The same file adds foreign keys
from `OrganizationUsers` to `Organizations` and `Users`; keep them in the replica so fixtures stay
consistent. **[C]**

Use the full Users column list from production (section 11) rather than the site's SQL schema script, so that rows our
provider writes stay writable by legacy code.

## 11. Gaps and open questions

| #   | Question                                                                                                                                                                                                                                                        | Why it matters                                                                                                                     | Who can answer                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | The port is the reference; since when has it written production data, and which rows were written by the pre-port code?                                                                                                                                         | IP capture and history naming differ between the two (3.4, 3.6).                                                                   | Site team / DevOps                        |
| 2   | Are the site's connection string secrets for the surveys, results and users-content stores three accounts or one? Same region?                                                                                                                                  | Provider configuration and least-privilege credentials.                                                                            | DevOps                                    |
| 3   | Is the site's users database connection string secret the same database as `ConnectionStrings:Default`?                                                                                                                                                         | Directory credentials and schema ownership.                                                                                        | DevOps                                    |
| 4   | Real column list of `Users`, `Surveys`, `Organizations`, `OrganizationUsers` (`INFORMATION_SCHEMA.COLUMNS`), indexes, and any triggers.                                                                                                                         | the site's SQL schema script is incomplete (3.11); lookups by `postid` / `resultid` have no index in the site's SQL schema script. | DBA / DevOps                              |
| 5   | What blob names exist in `surveyjsonhistory` (`{surveyId}/{pointId}` vs root `{pointId}`)? By the code, both: new surveys got root `{pointId}` blobs before the site's fix (3.4).                                                                               | History import and display (3.4).                                                                                                  | A read-only storage copy                  |
| 6   | Are `&`, `<`, `>` stored HTML-encoded in `result` strings?                                                                                                                                                                                                      | Correct `data` for the new API (3.6).                                                                                              | A storage copy, or a test post to staging |
| 7   | How many result rows contain `dxsimage:` / `dxsfile:` values or near-limit data URLs? Largest `result` size?                                                                                                                                                    | Legacy file migration and D11 rollout.                                                                                             | A storage copy                            |
| 8   | Data volume: number of surveys, users, projects; rows per `post…` table (largest).                                                                                                                                                                              | Paging, statistics and sorting strategy (results are not stored in submission order).                                              | DevOps / storage metrics                  |
| 9   | What time zone do the servers run in, and do old rows hold UTC or local time? Applies to Table `happendat` and to the SQL dates `Surveys.createdat`, `Organizations.happendat`, `OrganizationUsers.happendat` (written from `DateTime.Now` with no conversion). | `submittedAt`, `createdAt` correctness.                                                                                            | DevOps; a storage copy                    |
| 10  | Do external customers rely on base64 `content` in exported or API results?                                                                                                                                                                                      | D11 condition 5.                                                                                                                   | Support / product                         |
| 11  | Do rows with an unexpected `surveyid`, missing `postid`, or empty tables named `surveyresult…` exist?                                                                                                                                                           | Fixture realism and the inspector CLI.                                                                                             | A storage copy                            |
| 12  | Should the new app keep the legacy `canModify` rule (admin or creator) or the spec's "any member"?                                                                                                                                                              | Permissions parity (6).                                                                                                            | Product owner (Step 4 or 5)               |
| 13  | Are orphaned `OrganizationUsers` rows (deleted users) common?                                                                                                                                                                                                   | Member lists and `memberCount`.                                                                                                    | A storage copy                            |
| 14  | Do the public `image?filePath=` and `file?filePath=` actions return file bytes in the port as deployed, or a JSON-serialized response object?                                                                                                                   | Whether legacy respondent-file links (`dxsimage:`/`dxsfile:`) still work; how we serve them.                                       | A request against staging; site team      |

**Partial answers from production** (`pnpm inspect:legacy-schema`, 2026-10-22; [runbook, step 1](../operations.md#step-1-internal-use-on-production-data-read-only-first)):

- **4:** `Surveys` has no triggers; `Surveys.theme` is `varchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS`; `Surveys.ispublished` is a nullable `tinyint` with no default. The other tables, columns and indexes are still open.
- **8:** most surveys have an empty `ispublished`. Users, projects and the rows per `post…` table are still open.
