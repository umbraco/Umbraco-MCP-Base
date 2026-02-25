export interface SwaggerEndpoint {
  url: string;
  name: string;
}

const KNOWN_API_NAMES = [
  "management",
  "delivery",
  "commerce",
  "forms",
  "deploy",
  "workflow",
];

export async function discoverSwaggerEndpoints(
  baseUrl: string
): Promise<SwaggerEndpoint[]> {
  const base = baseUrl.replace(/\/+$/, "");

  // The Swagger UI config is in index.js, not embedded in the HTML
  const sources = [
    `${base}/umbraco/swagger/index.js`,
    `${base}/umbraco/swagger/`,
    `${base}/umbraco/swagger/index.html`,
  ];

  for (const url of sources) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) continue;

      const text = await response.text();
      const endpoints = parseSwaggerUiHtml(text, baseUrl);

      if (endpoints.length > 0) {
        return endpoints;
      }
    } catch {
      // Try next source
    }
  }

  return fallbackProbe(baseUrl);
}

export function parseSwaggerUiHtml(
  html: string,
  baseUrl: string
): SwaggerEndpoint[] {
  // Umbraco's Swagger UI embeds a configObject with urls array
  // Pattern: configObject = JSON.parse('{"urls":[...]}')
  const configMatch = html.match(
    /configObject\s*=\s*JSON\.parse\(\s*'([^']+)'\s*\)/
  );

  if (configMatch) {
    try {
      const config = JSON.parse(configMatch[1]);
      if (Array.isArray(config.urls)) {
        return config.urls.map(
          (entry: { url: string; name: string }) => ({
            url: toAbsoluteUrl(entry.url, baseUrl),
            name: entry.name,
          })
        );
      }
    } catch {
      // Fall through to next pattern
    }
  }

  // Alternative: look for urls array directly in script tags
  const urlsMatch = html.match(/"urls"\s*:\s*(\[[^\]]+\])/);
  if (urlsMatch) {
    try {
      const urls = JSON.parse(urlsMatch[1]);
      if (Array.isArray(urls)) {
        return urls.map((entry: { url: string; name: string }) => ({
          url: toAbsoluteUrl(entry.url, baseUrl),
          name: entry.name,
        }));
      }
    } catch {
      // Fall through
    }
  }

  return [];
}

function toAbsoluteUrl(relativeOrAbsolute: string, baseUrl: string): string {
  if (
    relativeOrAbsolute.startsWith("http://") ||
    relativeOrAbsolute.startsWith("https://")
  ) {
    return relativeOrAbsolute;
  }

  const base = baseUrl.replace(/\/+$/, "");
  const swaggerBase = `${base}/umbraco/swagger`;
  const relative = relativeOrAbsolute.replace(/^\/+/, "");
  return `${swaggerBase}/${relative}`;
}

async function fallbackProbe(baseUrl: string): Promise<SwaggerEndpoint[]> {
  const found: SwaggerEndpoint[] = [];

  for (const name of KNOWN_API_NAMES) {
    const url = `${baseUrl.replace(/\/+$/, "")}/umbraco/swagger/${name}/swagger.json`;
    try {
      const response = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        found.push({
          url,
          name: `Umbraco ${name.charAt(0).toUpperCase() + name.slice(1)} API`,
        });
      }
    } catch {
      // Skip unreachable endpoints
    }
  }

  return found;
}
