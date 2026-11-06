# Licensing

What you may do with this repository and the image, and which parts need a SurveyJS licence. The decisions are D2 and
D20 in [the product idea](../../idea.md). For the binding terms, read
[surveyjs.io/licensing](https://surveyjs.io/licensing). This page is a guide, not the licence.

## The repository's code is MIT

The code written for this repository is under the MIT licence ([LICENSE](../../LICENSE)). You may clone it, change it
and build on it.

## The SurveyJS packages

The web app uses five SurveyJS packages, all at the same version. They have their own licences.

| Package                | Licence    | What it is                         | When you need a licence                    |
| ---------------------- | ---------- | ---------------------------------- | ------------------------------------------ |
| `survey-core`          | MIT        | The Form Library's model           | Never                                      |
| `survey-react-ui`      | MIT        | The Form Library's React renderer  | Never                                      |
| `survey-creator-core`  | Commercial | The survey editor (Survey Creator) | In a build of your own (mode 3); see below |
| `survey-creator-react` | Commercial | Survey Creator's React UI          | In a build of your own (mode 3); see below |
| `survey-analytics`     | Commercial | The results Dashboard              | In a build of your own (mode 3); see below |

The app does not use the PDF Generator (`survey-pdf`). It is commercial too, so if you add it in a fork, it needs a
licence of its own.

## The free image

The free Docker image (mode 2b) is free for anyone, with no limit on users, surveys or responses. It includes the
commercial components above, and you may use it with them (D2). Two conditions apply:

- **You run the image as it is.** Configuration is allowed: the name, logo, colours, domain, URLs and limits. A change
  to its code makes your instance mode 3 (D20).
- **"Powered by SurveyJS" stays visible.** The image carries a SurveyJS key made for this use. It is valid only while
  the branding shows. A paid SurveyJS licence removes the branding.

## Mode 3: your own fork

If you change the code, for example with a shell of your own, you are building on the commercial components. Survey
Creator and the Dashboard need a SurveyJS licence for that. Ask SurveyJS which licence fits your product, and read the
terms at [surveyjs.io/licensing](https://surveyjs.io/licensing). A fork that keeps the free image's key and drops the
branding is not covered by it.

## The licence key in the app

| Setting                      | What it does                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `SURVEYJS_LICENSE_KEY`       | Your own SurveyJS key. The browser gets it from `/config`, as any key in a web page is public. |
| `SURVEYJS_IMAGE_LICENSE_KEY` | The image's own key, built into it. The app uses it when `SURVEYJS_LICENSE_KEY` is not set.    |
| `BRANDING=on`                | The default: "Powered by SurveyJS" shows.                                                      |
| `BRANDING=off`               | Hides the mark. The server refuses to start unless `SURVEYJS_LICENSE_KEY` is your own key.     |

The app does not read keys. The SurveyJS libraries check what a key allows, and that check is the real one. So
`/config.branding` reports `poweredBy`, whether the mark shows, and not the `required` and `removable` flags the first
spec described. [Branding](branding.md#powered-by-surveyjs-and-the-licence-key) has the settings and the start-up
message. [ADR 0027](../adr/0027-branding-and-the-licence-key.md) has the reasons.

## Third-party notices

The image lists the licences of the dependencies it ships in `/app/THIRD_PARTY_NOTICES.md`. The build writes it from
the installed packages, so it matches the image. If you build your own image from a fork, the same build step writes
the notice for your dependencies.
