export type HttpBasicAuth = {
  username?: string;
  password: string;
};

export type HttpJsonClientOptions = {
  auth?: HttpBasicAuth;
  timeoutMs?: number;
  defaultHeaders?: HeadersInit;
};

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly statusText?: string,
    public readonly url?: string,
    public readonly body?: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}


export class JsonParseError extends Error {
  constructor(
    message: string,
    public readonly url?: string,
    public readonly body?: string
  ) {
    super(message);
    this.name = "JsonParseError";
  }
}


export class HttpJsonClient {
  private readonly base: URL;
  private readonly auth?: HttpBasicAuth;
  private readonly timeoutMs: number;
  private readonly defaultHeaders?: HeadersInit;

  constructor(baseUrl: string, options: HttpJsonClientOptions = {}) {
    this.base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    this.auth = options.auth;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.defaultHeaders = options.defaultHeaders;
  }

  private buildHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(this.defaultHeaders);
    if (extra) {
      const extraHeaders = new Headers(extra);
      extraHeaders.forEach((value, key) => headers.set(key, value));
    }

    if (this.auth) {
      const username = this.auth.username ?? "";
      const encoded = Buffer.from(`${username}:${this.auth.password}`).toString("base64");
      headers.set("Authorization", `Basic ${encoded}`);
    }

    return headers;
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): URL {
    const url = new URL(path, this.base);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  async get(
    path: string,
    options?: {
      query?: Record<string, string | number | boolean | undefined>;
      headers?: HeadersInit;
      signal?: AbortSignal;
    }
  ): Promise<Response> {
    const url = this.buildUrl(path, options?.query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const signal = options?.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;

    try {
      return await fetch(url, {
        method: "GET",
        headers: this.buildHeaders(options?.headers),
        signal,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown network error";
      throw new HttpError(`GET ${url.toString()} failed: ${message}`, undefined, undefined, url.toString());
    } finally {
      clearTimeout(timeout);
    }
  }

  async getText(
    path: string,
    options?: {
      query?: Record<string, string | number | boolean | undefined>;
      headers?: HeadersInit;
      signal?: AbortSignal;
      requireOk?: boolean;
    }
  ): Promise<string> {
    const response = await this.get(path, options);
    const body = await response.text();

    if (options?.requireOk !== false && !response.ok) {
      throw new HttpError(
        `GET ${response.url} returned HTTP ${response.status}`,
        response.status,
        response.statusText,
        response.url,
        body
      );
    }

    return body;
  }

  async getJson<T>(
    path: string,
    options?: {
      query?: Record<string, string | number | boolean | undefined>;
      headers?: HeadersInit;
      signal?: AbortSignal;
      requireOk?: boolean;
    }
  ): Promise<T> {
    const response = await this.get(path, options);
    const body = await response.text();

    if (options?.requireOk !== false && !response.ok) {
      throw new HttpError(
        `GET ${response.url} returned HTTP ${response.status}`,
        response.status,
        response.statusText,
        response.url,
        body
      );
    }

    if (!body.trim()) {
      throw new JsonParseError(`Empty response body from ${response.url}`, response.url, body);
    }

    try {
      return JSON.parse(body) as T;
    } catch {
      throw new JsonParseError(`Invalid JSON returned from ${response.url}`, response.url, body);
    }
  }
}