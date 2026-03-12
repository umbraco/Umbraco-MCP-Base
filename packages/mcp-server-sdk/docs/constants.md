# Umbraco Constants Reference

Well-known IDs used across Umbraco APIs. Import from `@umbraco-cms/mcp-server-sdk/constants`.

```typescript
import { BLANK_UUID, IMAGE_MEDIA_TYPE_ID } from "@umbraco-cms/mcp-server-sdk/constants";
```

## BLANK_UUID

```typescript
const BLANK_UUID = "00000000-0000-0000-0000-000000000000";
```

Used as the parent ID for root-level items (content at root, media at root, etc.).

## Media Type IDs

| Constant | Value | Umbraco Type |
|----------|-------|-------------|
| `FOLDER_MEDIA_TYPE_ID` | `f38bd2d7-65d0-48e6-95dc-87ce06ec2d3d` | Folder |
| `IMAGE_MEDIA_TYPE_ID` | `cc07b313-0843-4aa8-bbda-871c8da728c8` | Image |
| `FILE_MEDIA_TYPE_ID` | `4c52d8ab-54e6-40cd-999c-7a5f24903e4d` | File |
| `VIDEO_MEDIA_TYPE_ID` | `f6c515bb-653c-4bdc-821c-987729ebe327` | Video |
| `AUDIO_MEDIA_TYPE_ID` | `a5ddeee0-8fd8-4cee-a658-6f1fcdb00de3` | Audio |
| `ARTICLE_MEDIA_TYPE_ID` | `a43e3414-9599-4230-a7d3-943a21b20122` | Article |
| `VECTOR_GRAPHICS_MEDIA_TYPE_ID` | `c4b1efcf-a9d5-41c4-9621-e9d273b52a9c` | SVG |

### Media Type Names

String constants matching the Umbraco type names:

| Constant | Value |
|----------|-------|
| `MEDIA_TYPE_FOLDER` | `"Folder"` |
| `MEDIA_TYPE_IMAGE` | `"Image"` |
| `MEDIA_TYPE_FILE` | `"File"` |
| `MEDIA_TYPE_VIDEO` | `"Video"` |
| `MEDIA_TYPE_AUDIO` | `"Audio"` |
| `MEDIA_TYPE_ARTICLE` | `"Article"` |
| `MEDIA_TYPE_VECTOR_GRAPHICS` | `"SVG"` |

### Lookup Map

`STANDARD_MEDIA_TYPES` maps media type names to their IDs:

```typescript
import { STANDARD_MEDIA_TYPES } from "@umbraco-cms/mcp-server-sdk/constants";

const imageTypeId = STANDARD_MEDIA_TYPES["Image"];
// "cc07b313-0843-4aa8-bbda-871c8da728c8"
```

## User Group IDs

| Constant | Value |
|----------|-------|
| `TRANSLATORS_USER_GROUP_ID` | `F2012E4C-D232-4BD1-8EAE-4384032D97D8` |
| `WRITERS_USER_GROUP_ID` | `9fc2a16f-528c-46d6-a014-75bf4ec2480c` |

## Data Type IDs

| Constant | Value | Property Editor |
|----------|-------|----------------|
| `TextString_DATA_TYPE_ID` | `0cc0eba1-9960-42c9-bf9b-60e150b429ae` | Text String |
| `MEDIA_PICKER_DATA_TYPE_ID` | `4309a3ea-0d78-4329-a06c-c80b036af19a` | Media Picker |
| `MEMBER_PICKER_DATA_TYPE_ID` | `1ea2e01f-ebd8-4ce1-8d71-6b1149e63548` | Member Picker |
| `TAG_DATA_TYPE_ID` | `b6b73142-b9c1-4bf8-a16d-e1c23320b549` | Tags |

## Member Type IDs

| Constant | Value |
|----------|-------|
| `Default_Memeber_TYPE_ID` | `d59be02f-1df9-4228-aa1e-01917d806cda` |

## Reference

| Source File | Contains |
|-------------|----------|
| `src/constants/constants.ts` | All constant definitions |
