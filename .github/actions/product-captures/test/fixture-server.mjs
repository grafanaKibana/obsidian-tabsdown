import http from 'node:http';

const port=Number(process.argv[2]);
http.createServer((request,response)=>{
  // This lazy image can never finish decoding if a viewport capture incorrectly waits for it.
  if(request.url==='/offscreen-never.png')return;
  response.setHeader('Content-Type','text/html');
  response.end('<!doctype html><html><style>body{font:32px system-ui;background:#edf2ec;color:#193123;padding:40px}button,input{font:inherit}</style><h1 id="ready">Capture fixture</h1><input aria-label="Demo" value="initial"><button onclick="document.querySelector(\'h1\').textContent=\'Updated scene\'">Update scene</button><img loading="lazy" src="/offscreen-never.png" alt="Offscreen below" width="320" height="180" style="position:absolute;top:10000px;left:0"><img loading="lazy" src="/offscreen-never.png" alt="Offscreen right" width="320" height="180" style="position:absolute;left:10000px;top:0"></html>');
}).listen(port,'127.0.0.1');
