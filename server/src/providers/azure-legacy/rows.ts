/** Legacy rows as a typed reader returns them. Property names are the lower-case legacy names. */

/** SQL `Surveys` (layout section 3.1). */
export interface LegacySurveyRow {
  id: string;
  name: string;
  userid: string;
  creatorid: string;
  postid: string;
  resultid: string;
  createdat: Date;
  timestamp: Date;
  ispublished: number | null;
  isarchived: number | null;
  allowaccessresult: number | null;
  storeipaddress: string | null;
  usecookies: number | null;
}

/** SQL `Users` (layout section 3.11), only the columns My Surveys needs. */
export interface LegacyUserRow {
  id: string;
  email: string;
  displayname: string | null;
  blocked: number | null;
}

/** SQL `Organizations` (layout section 3.12). */
export interface LegacyOrganizationRow {
  id: string;
  name: string;
}

/** SQL `OrganizationUsers` (layout section 3.13). */
export interface LegacyOrganizationUserRow {
  organizationid: string;
  userid: string;
  role: string;
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
