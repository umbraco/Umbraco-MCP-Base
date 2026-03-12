# API Call Helpers & HTTP Client

How tools interact with Umbraco APIs through the SDK's helper functions and HTTP client.

## API Call Helpers

The SDK provides helper functions that handle the common pattern of: call API → check status → return result or throw error.

### `executeGetApiCall<T, TClient>`

For GET requests returning a single item. Returns `createToolResult(data)` on success, throws `UmbracoApiError` on failure.

```typescript
import { executeGetApiCall, CAPTURE_RAW_HTTP_RESPONSE } from "@umbraco-cms/mcp-server-sdk";

const result = await executeGetApiCall<ResponseType, MyApiClient>(
  (client) => client.getItem(id, CAPTURE_RAW_HTTP_RESPONSE)
);
```

### `executeGetItemsApiCall<T, TClient>`

For GET requests returning collections. Same as `executeGetApiCall` but wraps the response as `{ items: data }`.

```typescript
import { executeGetItemsApiCall, CAPTURE_RAW_HTTP_RESPONSE } from "@umbraco-cms/mcp-server-sdk";

const result = await executeGetItemsApiCall<ResponseType, MyApiClient>(
  (client) => client.listItems({ skip, take }, CAPTURE_RAW_HTTP_RESPONSE)
);
```

### `executeVoidApiCall<TClient>`

For DELETE, PUT, POST operations that don't return a body. Returns a success result on 2xx, throws on failure.

```typescript
import { executeVoidApiCall, CAPTURE_RAW_HTTP_RESPONSE } from "@umbraco-cms/mcp-server-sdk";

const result = await executeVoidApiCall<MyApiClient>(
  (client) => client.deleteItem(id, CAPTURE_RAW_HTTP_RESPONSE)
);
```

### `executeVoidApiCallWithOptions<TClient>`

Extended version with customization options:

```typescript
import { executeVoidApiCallWithOptions, CAPTURE_RAW_HTTP_RESPONSE } from "@umbraco-cms/mcp-server-sdk";

const result = await executeVoidApiCallWithOptions<MyApiClient>(
  (client) => client.publishItem(id, CAPTURE_RAW_HTTP_RESPONSE),
  {
    successMessage: "Item published successfully",
    acceptedStatusCodes: [202],  // Treat 202 as success too
    transformError: (error) => ({ ...error, title: "Publish failed" }),
  }
);
```

### Options Reference

```typescript
interface ApiCallOptions<T> {
  void?: boolean;                           // Don't include response data
  successMessage?: string;                  // Custom success text
  acceptedStatusCodes?: number[];           // Extra success codes (beyond 200-299)
  transformError?: (error) => ProblemDetails;  // Modify error before returning
  transformData?: (data: T) => unknown;     // Transform success data
}
```

### How All Helpers Work Internally

1. Call `getApiClient()` to get the configured client instance
2. Execute the API call function with `CAPTURE_RAW_HTTP_RESPONSE`
3. Check response status (2xx = success, else error)
4. On success: return `createToolResult(data)`
5. On failure: throw `UmbracoApiError(problemDetails)` — caught by `withStandardDecorators`

## `CAPTURE_RAW_HTTP_RESPONSE`

**Always pass this** as the second argument to API client methods:

```typescript
const CAPTURE_RAW_HTTP_RESPONSE = {
  returnFullResponse: true,      // Return full AxiosResponse, not just data
  validateStatus: () => true,    // Don't throw on non-2xx status codes
};
```

Without it, Axios throws on 4xx/5xx responses instead of returning them, which prevents the helpers from extracting ProblemDetails error information.

## ProblemDetails Handling

Umbraco APIs return errors as [RFC 7807 Problem Details](https://www.rfc-editor.org/rfc/rfc7807):

```typescript
interface ProblemDetails {
  type?: string;       // URI identifying the problem type
  title?: string;      // Short summary
  status?: number;     // HTTP status code
  detail?: string;     // Explanation for this occurrence
  instance?: string;   // URI for this specific occurrence
  [key: string]: unknown;  // Additional properties
}
```

The `UmbracoApiError` class wraps ProblemDetails and is automatically caught by `withErrorHandling` (part of `withStandardDecorators`), which converts it to a proper MCP error result.

```typescript
import { UmbracoApiError } from "@umbraco-cms/mcp-server-sdk";

// Throw manually when doing custom response handling
throw new UmbracoApiError({
  status: 409,
  title: "Conflict",
  detail: "Item already exists",
});
```

## HTTP Client

### Singleton Client

The SDK provides a pre-configured Axios instance with OAuth client credentials:

```typescript
import {
  UmbracoAxios,
  initializeUmbracoAxios,
  UmbracoManagementClient,
} from "@umbraco-cms/mcp-server-sdk";

// Initialize once at startup
initializeUmbracoAxios({
  baseUrl: "https://my-umbraco.com",
  clientId: "my-client",
  clientSecret: "my-secret",
});

// UmbracoAxios is a standard Axios instance, now configured
// UmbracoManagementClient is an Orval mutator that uses UmbracoAxios
```

### API Client Provider

Tools use `getApiClient()` to get the configured client. Set it up once:

```typescript
import { configureApiClient } from "@umbraco-cms/mcp-server-sdk";
import { getMyAPI } from "./api/generated/myApi.js";

// Connect your Orval-generated client to the SDK helpers
configureApiClient(() => getMyAPI());
```

Then in tools:

```typescript
import { getApiClient } from "@umbraco-cms/mcp-server-sdk";

const client = getApiClient<MyApiClient>();
const response = await client.someMethod(args, CAPTURE_RAW_HTTP_RESPONSE);
```

### Custom Client Factory (Advanced)

For scenarios needing multiple Axios instances (e.g., connecting to different APIs):

```typescript
import { createUmbracoAxiosClient } from "@umbraco-cms/mcp-server-sdk";

const { client, initialize, mutator } = createUmbracoAxiosClient({
  tokenPath: "/custom/token/endpoint",
  rejectUnauthorized: false,     // For self-signed certs
  enableLogging: true,           // Log requests
});

initialize({ baseUrl, clientId, clientSecret });
```

## Reference

| Source File | Contains |
|-------------|----------|
| `src/helpers/api-call-helpers.ts` | All `execute*ApiCall` functions, `CAPTURE_RAW_HTTP_RESPONSE`, `configureApiClient`, `getApiClient` |
| `src/http/umbraco-axios-client.ts` | `UmbracoAxios`, `initializeUmbracoAxios`, `UmbracoManagementClient` |
| `src/http/umbraco-axios-factory.ts` | `createUmbracoAxiosClient` |
| `src/types/problem-details.ts` | `ProblemDetails` interface |
