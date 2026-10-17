# Images and files in your survey

In the [editor](designing-a-survey.md) you can add pictures and videos to a survey by choosing a file
from your computer. The file is stored on the server and the survey uses a link to it. Before this
version the Creator kept such a picture inside the survey text; now the text holds only the link.

## Where you can upload

- **Image question**: click **Image** in the toolbox, select the question and click its **Choose Image**
  button. The same works for a video, with the **Video** content mode.
- **Image choices**: in an Image Picker question, add a choice and choose a file for it.
- **Survey logo**: the **Logo** setting of the survey.
- **Theme background images**: the background image settings in the **Themes** tab.

Choose one file at a time. If you choose several, only the first one is uploaded.

## Allowed types

| Kind   | Types                                   |
| ------ | --------------------------------------- |
| Images | PNG, JPEG, GIF, WebP, AVIF, BMP and SVG |
| Videos | MP4, WebM and Ogg                       |

The server looks at what is inside the file, not at its name. A PDF, a MOV video or a HEIC picture is
refused with the message "This file type cannot be uploaded. Use a PNG, JPEG, GIF, WebP, AVIF, BMP or
SVG image, or an MP4, WebM or Ogg video." An empty file is refused too.

## How much you can store

A survey can store up to **50 MB** of files in total (the server setting
`LIMIT_MAX_ASSET_BYTES_PER_SURVEY`). When a file does not fit, the editor shows a notification:

> A survey can store up to 50 MB of files in total. This file was not uploaded.

The number in the message is the limit of your server. The survey is not changed.

**Files stay until the survey is deleted.** Replacing an image or clearing it in the editor does not
free its space: the old file is still stored, and still counts. Only deleting the survey frees the space. Copying
the survey does not help: the copy gets copies of the same files.

## Other messages

| Message                                                            | When                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| You cannot change this survey. The file was not uploaded.          | You can only see the survey. (A read-only editor has no upload at all.) |
| This survey is no longer available. The file was not uploaded.     | The survey was deleted or moved out of your reach                       |
| Your session has ended. Sign in again, then upload the file again. | You were signed out                                                     |
| The file was not uploaded. Please try again.                       | Anything else, for example a network error                              |

## Copies of a survey

When you [clone a survey](managing-a-survey.md), its files are copied too. The copy has its own files and
its own links, so deleting the original does not break the copy. The copy starts with the same amount of
used space as the original.

## Who can see the files

**A file link is public.** Anyone who has the link can open the file, without signing in. The links are
long and cannot be guessed, but they are not secret once you share a survey: people who run the survey see
the pictures, and anyone they pass the link to can too. Do not upload a file you would not show to every
respondent.

Pictures open in the browser. Videos are offered as a download when you open the link directly, and
still play inside the survey.

## Surveys made on the old site

Images of surveys made on the old surveyjs.io site keep their old links
(`https://api.surveyjs.io/private/Surveys/files?name=...`). They keep working while that site runs. They
are not counted against the limit, and they are not copied when you clone the survey. New uploads use the
new links.

## When you delete a survey

[Deleting a survey](managing-a-survey.md) deletes its files too. A browser may still show a copy of a
picture it has already loaded, for up to an hour.
