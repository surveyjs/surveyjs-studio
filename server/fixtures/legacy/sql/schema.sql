-- Replica schema for the legacy My Surveys SQL tables (T-SQL).
-- Written for this repository from docs/architecture/legacy-data-layout.md
-- (sections 3.1, 3.11, 3.12, 3.13 and the replica plan in section 10).
-- Columns and types follow the layout document; the extra Users columns are the
-- ones the legacy writer adds (section 3.11) and are typed by inference.

CREATE TABLE Users (
  id                   uniqueidentifier NOT NULL,
  email                varchar(200)     NULL,
  displayname          nvarchar(max)    NULL,
  blocked              tinyint          NULL,
  accesskey            varchar(200)     NULL,
  dxid                 varchar(200)     NULL,
  oldemail             varchar(200)     NULL,
  passwordhash         varchar(max)     NULL,
  emailconfirmed       tinyint          NULL,
  phonenumberconfirmed tinyint          NULL,
  lockoutenddate       datetime         NULL,
  lockoutcount         int              NULL,
  twofactorenabled     tinyint          NULL,
  allowmarketingemails tinyint          NULL,
  timestamp            datetime         NULL,
  CONSTRAINT users_pk PRIMARY KEY (id)
);
CREATE INDEX users_email_idx ON Users (email);
CREATE INDEX users_dxid_idx ON Users (dxid);
CREATE INDEX users_accesskey_idx ON Users (accesskey);

CREATE TABLE Surveys (
  id                uniqueidentifier NOT NULL,
  name              nvarchar(200)    NULL,
  userid            uniqueidentifier NULL,
  creatorid         uniqueidentifier NULL,
  postid            uniqueidentifier NULL,
  resultid          uniqueidentifier NULL,
  createdat         datetime         NULL,
  timestamp         datetime         NULL,
  ispublished       tinyint          NULL,
  isarchived        tinyint          NULL,
  allowaccessresult tinyint          NULL,
  storeipaddress    varchar(200)     NULL,
  usecookies        tinyint          NULL,
  theme             varchar(max)     NULL,
  publishid         uniqueidentifier NULL,
  legacytheme       varchar(max)     NULL,
  CONSTRAINT surveys_pk PRIMARY KEY (id)
);
-- The surveys_*_idx indexes below are our additions for the replica. Layout section 10 does not
-- list them and production may not have them (layout section 11, question 4).
-- Lists are "where userid = @p"; lookups by postid, resultid and publishid.
CREATE INDEX surveys_userid_idx ON Surveys (userid);
CREATE INDEX surveys_postid_idx ON Surveys (postid);
CREATE INDEX surveys_resultid_idx ON Surveys (resultid);
CREATE INDEX surveys_publishid_idx ON Surveys (publishid);

CREATE TABLE Organizations (
  id        uniqueidentifier NOT NULL,
  name      nvarchar(max)    NULL,
  type      varchar(max)     NULL,
  happendat datetime         NULL,
  timestamp datetime         NULL,
  ipaddress varchar(max)     NULL,
  CONSTRAINT organizations_pk PRIMARY KEY (id)
);

CREATE TABLE OrganizationUsers (
  id             uniqueidentifier NOT NULL,
  organizationid uniqueidentifier NOT NULL,
  userid         uniqueidentifier NOT NULL,
  role           varchar(max)     NULL,
  type           varchar(max)     NULL,
  name           nvarchar(max)    NULL,
  happendat      datetime         NULL,
  timestamp      datetime         NULL,
  ipaddress      varchar(max)     NULL,
  CONSTRAINT organizationusers_pk PRIMARY KEY (id),
  CONSTRAINT organizationusers_organization_fk FOREIGN KEY (organizationid) REFERENCES Organizations (id),
  CONSTRAINT organizationusers_user_fk FOREIGN KEY (userid) REFERENCES Users (id)
);
CREATE INDEX organizationusers_userid_idx ON OrganizationUsers (userid);
CREATE INDEX organizationusers_organizationid_idx ON OrganizationUsers (organizationid);

-- Licence tables (layout section 3.15): only the columns that decide the licence-expiry
-- notice, plus product and count to make the rows readable. Production has many more
-- (billing, invoice and company fields); My Surveys does not read them.
CREATE TABLE UserLicenses (
  id              uniqueidentifier NOT NULL,
  userid          uniqueidentifier NULL,
  parentlicenseid uniqueidentifier NULL,
  expirationdate  datetime         NULL,
  product         int              NULL,
  count           int              NULL,
  timestamp       datetime         NULL,
  CONSTRAINT userlicenses_pk PRIMARY KEY (id)
);
-- Our addition for the replica: the licence list is "where userid = @p".
CREATE INDEX userlicenses_userid_idx ON UserLicenses (userid);

CREATE TABLE LicenseTransfers (
  id        uniqueidentifier NOT NULL,
  licenseid uniqueidentifier NULL,
  userid    uniqueidentifier NULL,
  count     int              NULL,
  happendat datetime         NULL,
  timestamp datetime         NULL,
  CONSTRAINT licensetransfers_pk PRIMARY KEY (id)
);
-- Our addition for the replica: transfers are listed "where userid = @p".
CREATE INDEX licensetransfers_userid_idx ON LicenseTransfers (userid);
