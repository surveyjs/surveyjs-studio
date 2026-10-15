/**
 * Legacy rows as a typed reader returns them. Property names are the lower-case legacy names.
 * Nullable SQL columns are typed nullable: production rows may hold NULL in any of them.
 */

/** SQL `Surveys` (layout section 3.1). */
export interface LegacySurveyRow {
  id: string;
  name: string | null;
  userid: string | null;
  creatorid: string | null;
  postid: string | null;
  resultid: string | null;
  createdat: Date | null;
  timestamp: Date | null;
  ispublished: number | null;
  isarchived: number | null;
  allowaccessresult: number | null;
  storeipaddress: string | null;
  usecookies: number | null;
}

/** SQL `Users` (layout section 3.11), only the columns My Surveys needs. */
export interface LegacyUserRow {
  id: string;
  email: string | null;
  displayname: string | null;
  blocked: number | null;
}

/** SQL `Organizations` (layout section 3.12). */
export interface LegacyOrganizationRow {
  id: string;
  name: string | null;
}

/** SQL `OrganizationUsers` (layout section 3.13). */
export interface LegacyOrganizationUserRow {
  id: string;
  organizationid: string;
  userid: string;
  role: string | null;
}

/** Azure table `post{postId}` entity (layout section 3.6). */
export interface LegacyResultEntity {
  id: string;
  happendat: Date;
  result: string;
  clientid?: string;
  ipaddress?: string;
  ispartialcompleted?: boolean;
}
