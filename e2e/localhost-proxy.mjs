import http from 'node:http';

const targetHost = process.env.TARGET_HOST;
if (!targetHost) throw new Error('TARGET_HOST is required');

http.createServer((request, response) => {
  const upstream = http.request({
    hostname: targetHost,
    port: 3000,
    path: request.url,
    method: request.method,
    headers: request.headers,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on('error', (error) => {
    response.writeHead(502, { 'content-type': 'text/plain' });
    response.end(`upstream failure: ${error.message}`);
  });
  request.pipe(upstream);
}).listen(8080, '127.0.0.1');
