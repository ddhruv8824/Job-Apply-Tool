export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

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

export async function callLlm(messages: LlmMessage[]): Promise<string> {
  const apiKey = requiredEnvironmentVariable("GEMINI_API_KEY");
  
  let systemInstruction: any = undefined;
  const contents: any[] = [];
  
  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = { parts: [{ text: msg.content }] };
    } else {
      contents.push({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }]
      });
    }
  }

  let response: Response;
  try {
    await waitForRequestWindow();
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent", {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction,
        contents,
        generationConfig: { temperature: 0 }
      }),
      signal: AbortSignal.timeout(60_000),
    });
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  } catch (error) {
    throw new Error(
      `Could not reach Gemini: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const payload = (await response.json().catch(() => ({}))) as GeminiResponse;

  if (!response.ok) {
    const apiMessage = payload.error?.message?.trim();
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Gemini API authentication failed. Check GEMINI_API_KEY. ${apiMessage || ""}`);
    }
    if (response.status === 429) {
      throw new Error(`Gemini rate limit reached. ${apiMessage || ""}`);
    }
    throw new Error(`Gemini request failed with HTTP ${response.status}. ${apiMessage || ""}`);
  }

  const content = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!content) throw new Error("Gemini response did not contain message content.");
  return content;
}
