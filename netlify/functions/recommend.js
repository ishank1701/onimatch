// Netlify serverless function to proxy OpenRouter API calls
// API key is stored as environment variable — never exposed to browser

exports.handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "POST, OPTIONS"
            },
            body: ""
        };
    }

    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
    };

    try {
        const body = JSON.parse(event.body);
        const { systemPrompt, userMessage } = body;

        if (!systemPrompt || !userMessage) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing systemPrompt or userMessage" }) };
        }

        const API_KEY = process.env.OPENROUTER_API_KEY;
        if (!API_KEY) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: "API key not configured" }) };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000); // 25s timeout

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            signal: controller.signal,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`,
                "HTTP-Referer": "https://onimatch.netlify.app",
                "X-Title": "ONIMATCH"
            },
            body: JSON.stringify({
                model: "google/gemini-2.0-flash-001",
                max_tokens: 4096,
                temperature: 0.85,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage }
                ]
            })
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text();
            return { statusCode: response.status, headers, body: JSON.stringify({ error: `API error: ${response.status}`, details: errorText }) };
        }

        const data = await response.json();
        return { statusCode: 200, headers, body: JSON.stringify(data) };

    } catch (error) {
        if (error.name === 'AbortError') {
            return { statusCode: 504, headers, body: JSON.stringify({ error: "Request timed out" }) };
        }
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};
