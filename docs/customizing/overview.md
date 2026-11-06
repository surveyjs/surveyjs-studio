# Customizing My Surveys

My Surveys runs in several modes from one build. This page tells you which mode you are in, what you can change by
configuration alone, and when a change means you are building your own copy (mode 3). The modes and their decisions
are in [the product idea](../../idea.md#30-deployment-modes-2026-10-19).

## The modes

| Mode                     | What it is                                                                        | Storage                                      | Users and sign-in                           | Shell               |
| ------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------- | ------------------- |
| **1.1 to 1.3** Hosted    | `studio.surveyjs.io`, run by SurveyJS                                             | The surveyjs.io data, later the app's own    | surveyjs.io users                           | `surveyjs-site`     |
| **2a** Sandbox           | A static site where anyone tries every feature on demo data kept in their browser | The visitor's browser                        | Pick a listed account                       | A demo banner       |
| **2b** Free Docker image | A self-hosted service you can run in production as it is                          | SQLite or PostgreSQL, files on disk or in S3 | Local accounts, with optional OAuth sign-in | `self-hosted`       |
| **3** Custom development | Your own fork, with your own shell, storage, sign-in and features                 | Any provider you write                       | Local, OAuth, or both                       | Any shell you write |

This folder is for modes 2b and 3. To run the image, see [Self-hosting](../self-hosting.md).

## Configuration or code

The free image is for use in production without changes to its code. **Configuration is always allowed.** A code
change makes it mode 3.

| You want to                                           | How                                                  | Mode |
| ----------------------------------------------------- | ---------------------------------------------------- | ---- |
| Change the instance's name, logo or accent colour     | `BRAND_NAME`, `BRAND_LOGO_URL`, `BRAND_ACCENT_COLOR` | 2b   |
| Link your terms and privacy pages                     | `TERMS_URL`, `PRIVACY_URL`                           | 2b   |
| Choose the domain and the public address              | `PUBLIC_BASE_URL` and your reverse proxy             | 2b   |
| Add Google, GitHub or Facebook sign-in                | `AUTH_METHODS` and the provider's keys               | 2b   |
| Set limits, retention and the database or file store  | Environment variables                                | 2b   |
| Hide "Powered by SurveyJS"                            | `BRANDING=off` with your own SurveyJS licence key    | 2b   |
| Write a shell with your own header, footer and layout | A code change in a fork                              | 3    |
| Store data in a database the image does not support   | A new storage provider                               | 3    |
| Add a feature, a page or an API endpoint              | A code change in a fork                              | 3    |

Every variable is in [Operations](../operations.md). Mode 3 needs SurveyJS licences for the commercial components, as
[Licensing](licensing.md) explains.

## The customizing pages

| Page                      | Read it to                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------- |
| [Branding](branding.md)   | Set the name, logo and colours, and know what "Powered by SurveyJS" and the key do |
| [Signing in](sign-in.md)  | Add Google, GitHub, Facebook or surveyjs.io sign-in                                |
| [Shells](shells.md)       | Write a shell of your own, from an example that CI builds and tests                |
| [Providers](providers.md) | Add a storage provider or a SQL dialect, and run the suite that proves it works    |
| [Porting](porting.md)     | Check that another back-end, or a build of your own, speaks the same API           |
| [Licensing](licensing.md) | See what is MIT, what needs a SurveyJS licence, and how the free image's key works |
