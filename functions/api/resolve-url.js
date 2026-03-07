export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const response = await fetch(targetUrl, { redirect: 'follow' });
        return new Response(JSON.stringify({ url: response.url }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to resolve URL' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
