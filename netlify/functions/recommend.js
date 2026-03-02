// Netlify serverless function to proxy OpenRouter API calls
// This keeps the API key hidden on the server side

exports.handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    // CORS headers
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
    };

    try {
        const body = JSON.parse(event.body);
        const { systemPrompt, userMessage } = body;

        if (!systemPrompt || !userMessage) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: "Missing systemPrompt or userMessage" })
            };
        }

        // API key from Netlify environment variable (set in Netlify dashboard)
        const API_KEY = process.env.OPENROUTER_API_KEY;
        if (!API_KEY) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: "API key not configured" })
            };
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: "google/gemini-2.0-flash-001",
                max_tokens: 8192,
                temperature: 0.85,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage }
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({ error: `API error: ${response.status}`, details: errorText })
            };
        }

        const data = await response.json();
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(data)
        };

    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};
