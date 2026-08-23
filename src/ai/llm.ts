export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type GroqChatCompletion = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

// Profile/matching prompts are larger than the health check. Spacing requests
// prevents sequential jobs from exhausting Groq's rolling token window.
const MIN_REQUEST_INTERVAL_MS = 20_000;
let nextRequestAt = 0;

async function waitForRequestWindow(): Promise<void> {
  const delay = nextRequestAt - Date.now();
  if (delay > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function chatCompletionsEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/chat/completions")
    ? path
    : `${path}/chat/completions`;
  return url.toString();
}

/** Calls the configured Groq model and returns its first text response. */
export async function callLlm(messages: LlmMessage[]): Promise<string> {
  const apiKey = requiredEnvironmentVariable("GROQ_API_KEY");
  const baseUrl = requiredEnvironmentVariable("GROQ_BASE_URL");
  const model = requiredEnvironmentVariable("GROQ_MODEL");

  let response: Response;
  try {
    await waitForRequestWindow();
    response = await fetch(chatCompletionsEndpoint(baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, messages, temperature: 0 }),
      signal: AbortSignal.timeout(60_000),
    });
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  } catch (error) {
    throw new Error(
      `Could not reach Groq: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const payload = (await response.json().catch(() => ({}))) as GroqChatCompletion;

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Groq request failed with HTTP 401. Check GROQ_API_KEY.");
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const detail = payload.error?.message?.trim();
      throw new Error(
        "Groq rate limit reached." +
          (retryAfter ? ` Retry after ${retryAfter} seconds.` : "") +
          (detail ? ` ${detail}` : "")
      );
    }

    const apiMessage = payload.error?.message?.trim();
    throw new Error(
      `Groq request failed with HTTP ${response.status}.` +
        (apiMessage ? ` ${apiMessage}` : "")
    );
  }

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Groq response did not contain message content.");
  return content;
}
