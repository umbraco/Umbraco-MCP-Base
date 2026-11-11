export const BLANK_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * The Management API endpoint reporting the running Umbraco's version. This is
 * the only server endpoint that carries it — `server/status` and
 * `server/configuration` are anonymous but version-free, and this one requires
 * authentication.
 */
export const SERVER_INFORMATION_PATH =
  "/umbraco/management/api/v1/server/information";

//Umbraco CMS User Group IDs
export const TRANSLATORS_USER_GROUP_ID = "F2012E4C-D232-4BD1-8EAE-4384032D97D8";
export const WRITERS_USER_GROUP_ID = "9fc2a16f-528c-46d6-a014-75bf4ec2480c";

//Umbraco CMS Member Type IDs
export const Default_Memeber_TYPE_ID = "d59be02f-1df9-4228-aa1e-01917d806cda";

// Umbraco CMS DataType IDs
//
// These are the keys a *fresh* Umbraco install seeds. They are not guaranteed
// on every site: a site upgraded from an older Umbraco version (or one whose
// data types were recreated) can carry different keys. Use them for tests and
// fixtures against a fresh install; look the data type up via the Management
// API (e.g. `GET /umbraco/management/api/v1/item/data-type/search`) when the
// value has to be right on an arbitrary site.

/** Textstring data type key — **fresh-install only**, see the note above. */
export const TextString_DATA_TYPE_ID = "0cc0eba1-9960-42c9-bf9b-60e150b429ae";
/** Media Picker data type key — **fresh-install only**, see the note above. */
export const MEDIA_PICKER_DATA_TYPE_ID = "4309a3ea-0d78-4329-a06c-c80b036af19a";
/** Member Picker data type key — **fresh-install only**, see the note above. */
export const MEMBER_PICKER_DATA_TYPE_ID = "1ea2e01f-ebd8-4ce1-8d71-6b1149e63548";
/** Tags data type key — **fresh-install only**, see the note above. */
export const TAG_DATA_TYPE_ID = "b6b73142-b9c1-4bf8-a16d-e1c23320b549";

// Media Type IDs
//
// These are the keys a *fresh* Umbraco install seeds. Sites upgraded from older
// Umbraco versions use different keys for the same media types (e.g. File
// `0de4a970-…` instead of `4c52d8ab-…`), so posting one of these to such a site
// fails with a 404. Resolve the id at runtime by alias with
// `resolveMediaTypeId(MEDIA_TYPE_ALIASES.Folder)` instead: aliases are stable
// across installs even when keys are not.

/**
 * Folder media type key on a **fresh install only**.
 * @deprecated Not valid on upgraded sites. Use `resolveMediaTypeId()` with the
 * matching `MEDIA_TYPE_ALIASES` entry to get the connected site's id.
 */
export const FOLDER_MEDIA_TYPE_ID = "f38bd2d7-65d0-48e6-95dc-87ce06ec2d3d";
/**
 * Image media type key on a **fresh install only**.
 * @deprecated Not valid on upgraded sites. Use `resolveMediaTypeId()` with the
 * matching `MEDIA_TYPE_ALIASES` entry to get the connected site's id.
 */
export const IMAGE_MEDIA_TYPE_ID = "cc07b313-0843-4aa8-bbda-871c8da728c8";
/**
 * File media type key on a **fresh install only**.
 * @deprecated Not valid on upgraded sites. Use `resolveMediaTypeId()` with the
 * matching `MEDIA_TYPE_ALIASES` entry to get the connected site's id.
 */
export const FILE_MEDIA_TYPE_ID = "4c52d8ab-54e6-40cd-999c-7a5f24903e4d";
/**
 * Video media type key on a **fresh install only**.
 * @deprecated Not valid on upgraded sites. Use `resolveMediaTypeId()` with the
 * matching `MEDIA_TYPE_ALIASES` entry to get the connected site's id.
 */
export const VIDEO_MEDIA_TYPE_ID = "f6c515bb-653c-4bdc-821c-987729ebe327";
/**
 * Audio media type key on a **fresh install only**.
 * @deprecated Not valid on upgraded sites. Use `resolveMediaTypeId()` with the
 * matching `MEDIA_TYPE_ALIASES` entry to get the connected site's id.
 */
export const AUDIO_MEDIA_TYPE_ID = "a5ddeee0-8fd8-4cee-a658-6f1fcdb00de3";
/**
 * Article media type key on a **fresh install only**.
 * @deprecated Not valid on upgraded sites. Use `resolveMediaTypeId()` with the
 * matching `MEDIA_TYPE_ALIASES` entry to get the connected site's id.
 */
export const ARTICLE_MEDIA_TYPE_ID = "a43e3414-9599-4230-a7d3-943a21b20122";
/**
 * Vector Graphics (SVG) media type key on a **fresh install only**.
 * @deprecated Not valid on upgraded sites. Use `resolveMediaTypeId()` with the
 * matching `MEDIA_TYPE_ALIASES` entry to get the connected site's id.
 */
export const VECTOR_GRAPHICS_MEDIA_TYPE_ID = "c4b1efcf-a9d5-41c4-9621-e9d273b52a9c";

// Media Type Names - as they appear in Umbraco
export const MEDIA_TYPE_FOLDER = "Folder";
export const MEDIA_TYPE_IMAGE = "Image";
export const MEDIA_TYPE_FILE = "File";
export const MEDIA_TYPE_VIDEO = "Video";
export const MEDIA_TYPE_AUDIO = "Audio";
export const MEDIA_TYPE_ARTICLE = "Article";
export const MEDIA_TYPE_VECTOR_GRAPHICS = "SVG";

/**
 * Media type aliases Umbraco seeds on every install (mirrors
 * `Umbraco.Cms.Core.Constants.Conventions.MediaTypes`). Unlike the keys above,
 * these are the same on fresh and upgraded sites. Note the built-in Video,
 * Audio, Article and SVG types have `umbracoMedia…` aliases that differ from
 * their names.
 *
 * Pass one to `resolveMediaTypeId()` to get the connected site's id.
 */
export const MEDIA_TYPE_ALIASES = {
  Folder: "Folder",
  Image: "Image",
  File: "File",
  Video: "umbracoMediaVideo",
  Audio: "umbracoMediaAudio",
  Article: "umbracoMediaArticle",
  VectorGraphics: "umbracoMediaVectorGraphics",
} as const;

/**
 * Media type name → fresh-install key.
 * @deprecated The keys are only valid on a fresh install. Use
 * `resolveMediaTypeId()` with a `MEDIA_TYPE_ALIASES` entry instead.
 */
export const STANDARD_MEDIA_TYPES: Record<string, string> = {
  [MEDIA_TYPE_FOLDER]: FOLDER_MEDIA_TYPE_ID,
  [MEDIA_TYPE_IMAGE]: IMAGE_MEDIA_TYPE_ID,
  [MEDIA_TYPE_FILE]: FILE_MEDIA_TYPE_ID,
  [MEDIA_TYPE_VIDEO]: VIDEO_MEDIA_TYPE_ID,
  [MEDIA_TYPE_AUDIO]: AUDIO_MEDIA_TYPE_ID,
  [MEDIA_TYPE_ARTICLE]: ARTICLE_MEDIA_TYPE_ID,
  [MEDIA_TYPE_VECTOR_GRAPHICS]: VECTOR_GRAPHICS_MEDIA_TYPE_ID,
};
