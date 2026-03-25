const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/cleanup') {
      return new Response('Not Found', { status: 404 });
    }

    try {
      const formData = await request.formData();
      const imageFile = formData.get('image_file');
      const maskFile = formData.get('mask_file');

      if (!imageFile || !maskFile) {
        return new Response(JSON.stringify({ error: 'Missing image_file or mask_file' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      // Forward to ClipDrop API
      const clipdropForm = new FormData();
      clipdropForm.append('image_file', imageFile);
      clipdropForm.append('mask_file', maskFile);

      const response = await fetch('https://clipdrop-api.co/cleanup/v1', {
        method: 'POST',
        headers: {
          'x-api-key': env.CLIPDROP_API_KEY,
        },
        body: clipdropForm,
      });

      if (!response.ok) {
        const errText = await response.text();
        return new Response(JSON.stringify({ error: `ClipDrop API error: ${response.status}`, detail: errText }), {
          status: response.status,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const resultBuffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'image/png';

      return new Response(resultBuffer, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': contentType,
          'Content-Disposition': 'attachment; filename="result.png"',
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  },
};
