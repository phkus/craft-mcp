// Quick test to see raw Craft API response for collections
const http = require('http');

const fetchData = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'fetchBlocks',
    arguments: {
      document: 'Dissertation Sources',
      maxDepth: 2
    }
  }
});

// First initialize
const initData = JSON.stringify({
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0' }
  }
});

const makeRequest = (data) => {
  return new Promise((resolve, reject) => {
    // Use the production MCP endpoint
    const req = http.request({
      hostname: 'craft-mcp.phkus.workers.dev',
      port: 80,
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
};

(async () => {
  console.log('Initializing...');
  await makeRequest(initData);

  console.log('\nFetching Dissertation Sources blocks...\n');
  const result = await makeRequest(fetchData);
  console.log(JSON.stringify(result, null, 2));
})().catch(console.error);
