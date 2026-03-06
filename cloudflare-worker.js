// ============================================================
//  SILVER PDF/WORD — Cloudflare Worker Proxy
//  Deploy this at: https://workers.cloudflare.com (free plan)
//  Then set WORKER_URL in silver-pdf-word.html to your worker URL
// ============================================================

const PUBLIC_KEY = 'project_public_4deb450d3651865f9d49e3d161e96e89_k4m3E23f82917a56403975bdc87b713ab5bf4';
const SECRET_KEY = 'secret_key_d822859db8ff00e2360eca22e25c2b4a_m6ntPe498880345b34eb04d461822a640c457';

// ── CORS HEADERS ──
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── JWT HELPERS ──
function b64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlBytes(arr) {
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function makeJWT() {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now     = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: PUBLIC_KEY, iat: now, nbf: now, exp: now + 7200 }));
  const input   = header + '.' + payload;
  const key     = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return input + '.' + b64urlBytes(new Uint8Array(sig));
}

// ── MAIN HANDLER ──
export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    try {
      // POST /convert  { tool, fileName, fileBase64 }
      if (url.pathname === '/convert' && request.method === 'POST') {
        const { tool, fileName, fileBase64 } = await request.json();

        // 1. Generate JWT
        const token = await makeJWT();

        // 2. Start task
        const startRes = await fetch(`https://api.ilovepdf.com/v1/start/${tool}`, {
          headers: { Authorization: 'Bearer ' + token },
        });
        if (!startRes.ok) throw new Error('Start failed: ' + startRes.status);
        const { server, task } = await startRes.json();

        // 3. Upload file
        const fileBytes = Uint8Array.from(atob(fileBase64), c => c.charCodeAt(0));
        const form = new FormData();
        form.append('task', task);
        form.append('file', new Blob([fileBytes]), fileName);
        const uploadRes = await fetch(`https://${server}/v1/upload`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
          body: form,
        });
        if (!uploadRes.ok) throw new Error('Upload failed: ' + uploadRes.status);
        const { server_filename } = await uploadRes.json();

        // 4. Process
        const processRes = await fetch(`https://${server}/v1/process`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ task, tool, files: [{ server_filename, filename: fileName }] }),
        });
        if (!processRes.ok) {
          const e = await processRes.json().catch(() => ({}));
          throw new Error('Process failed: ' + (e.message || processRes.status));
        }

        // 5. Download
        const dlRes = await fetch(`https://${server}/v1/download/${task}`, {
          headers: { Authorization: 'Bearer ' + token },
        });
        if (!dlRes.ok) throw new Error('Download failed: ' + dlRes.status);

        const blob = await dlRes.arrayBuffer();
        const ct   = dlRes.headers.get('content-type') || 'application/octet-stream';

        return new Response(blob, {
          status: 200,
          headers: { ...CORS, 'Content-Type': ct },
        });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  },
};
