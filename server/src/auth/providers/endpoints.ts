/** Graph API version Facebook sign-in calls. */
export const FACEBOOK_GRAPH_VERSION = "v23.0";

export interface GithubEndpoints {
  readonly authorize: string;
  readonly token: string;
  /** The REST API base, without a trailing slash. */
  readonly api: string;
}

export interface FacebookEndpoints {
  readonly authorize: string;
  /** The Graph API base (with the version), without a trailing slash. */
  readonly graph: string;
}

/** The real GitHub endpoints, or the OAuth stub's (`OAUTH_STUB_URL`, development and tests). */
export function githubEndpoints(stubUrl: string | null): GithubEndpoints {
  if (stubUrl !== null) {
    return {
      authorize: `${stubUrl}/github/login/oauth/authorize`,
      token: `${stubUrl}/github/login/oauth/access_token`,
      api: `${stubUrl}/github-api`,
    };
  }
  return {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    api: "https://api.github.com",
  };
}

export function facebookEndpoints(stubUrl: string | null): FacebookEndpoints {
  if (stubUrl !== null) {
    return {
      authorize: `${stubUrl}/facebook/dialog/oauth`,
      graph: `${stubUrl}/facebook-graph`,
    };
  }
  return {
    authorize: `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`,
    graph: `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}`,
  };
}

/** Google's OpenID issuer (discovery is at `<issuer>/.well-known/openid-configuration`). */
export function googleIssuer(stubUrl: string | null): string {
  return stubUrl !== null ? `${stubUrl}/google` : "https://accounts.google.com";
}
