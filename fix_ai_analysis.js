// The prompt is failing to produce the expected output format which is then sanitized.
// I need to update the backend/server.js to make the prompt more robust to the model output.
// Instead of relying on a strict HTML template, I should probably encourage the model to be more structured and update the parser to be more lenient.

// Actually, looking at the server.js:
// const systemPrompt = getSystemPrompt(language);
// const userPrompt = ...;

// I should check getSystemPrompt implementation.
