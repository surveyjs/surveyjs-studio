# Licensing

The SurveyJS Studio application source code, its dependencies, and the commercial components included in the official self-hosted Docker image are covered by separate terms. See the [MIT License](../../LICENSE), the [SurveyJS commercial licensing terms](https://surveyjs.io/licensing), and the [Docker Image Terms](../../DOCKER-IMAGE-TERMS.md).

## Application source code

The SurveyJS Studio application source code is licensed under the [MIT License](../../LICENSE). You may copy, modify, build, and distribute that code under the MIT terms. Dependencies retain their own licenses.

## SurveyJS packages

The Studio web app uses five SurveyJS packages at the same version.

| Package                | License    | Role in Studio                               |
| ---------------------- | ---------- | -------------------------------------------- |
| `survey-core`          | MIT        | Form Library's form model and logic          |
| `survey-react-ui`      | MIT        | Form Library's React renderer                |
| `survey-creator-core`  | Commercial | Survey Creator's form editor logic           |
| `survey-creator-react` | Commercial | Survey Creator's React interface             |
| `survey-analytics`     | Commercial | SurveyJS Dashboard for results visualization |

Studio does not use SurveyJS PDF Generator (`survey-pdf`). If you add it to your own build, production use requires a SurveyJS license that covers PDF Generator.

## Official self-hosted Docker image

You can run the official self-hosted Docker image (mode 2b) free of charge, including in production, under the [Docker Image Terms](../../DOCKER-IMAGE-TERMS.md). The free image terms place no limits on the number of users, surveys, or responses.

- Run the official image as supplied. You may configure it through documented settings, such as your instance name, logo, accent color, domain, and URLs.
- Keep the **Powered by SurveyJS** attribution visible. The included key hides the license warning in Survey Creator and SurveyJS Dashboard, while Studio continues to display the Powered by SurveyJS attribution.

To hide the **Powered by SurveyJS** attribution in the official image, set `SURVEYJS_LICENSE_KEY` to your own key under a license that permits white-label use, then set `BRANDING=off`.

## Custom builds

If you deploy Studio from a build you create from source, production use of Survey Creator or SurveyJS Dashboard requires a [SurveyJS developer license](https://surveyjs.io/licensing) that covers the components you use. This applies even if you package your build as a Docker image or keep the **Powered by SurveyJS** attribution visible.

## License keys and branding settings

| Setting                      | What it does                                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SURVEYJS_LICENSE_KEY`       | Supplies your own SurveyJS key. Studio passes the key to the browser through `/config`.                                                                                |
| `SURVEYJS_IMAGE_LICENSE_KEY` | Supplies the official image’s included key. Studio uses it when `SURVEYJS_LICENSE_KEY` is unset.                                                                       |
| `BRANDING=on`                | Displays **Powered by SurveyJS**. This is the default.                                                                                                                 |
| `BRANDING=off`               | Hides **Powered by SurveyJS**. The server requires `SURVEYJS_LICENSE_KEY` to be set to a key different from the included image key before it starts with this setting. |

Studio checks that a separate key is configured when you set `BRANDING=off`. The SurveyJS libraries validate the key. The `/config` response exposes `branding.poweredBy`, which tells the browser whether to display the **Powered by SurveyJS** attribution.

See [Branding and the licence key](branding.md#powered-by-surveyjs-and-the-licence-key) for configuration examples and the startup error message. See [ADR 0027](../adr/0027-branding-and-the-licence-key.md) for the design decisions.

## Third-party notices

Both the hosted and self-hosted images list the licenses of their bundled dependencies in `/app/THIRD_PARTY_NOTICES.md`. The build generates this file from the installed packages. If you build your own image from a fork, the same build step generates notices for the dependencies in your build.
