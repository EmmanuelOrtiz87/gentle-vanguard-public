import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSync } from '../../src/core/run-command.js';

test('XTTS HTTP requests cannot exchange output audio during concurrent synthesis', () => {
  // Execute the real HTTP wrapper with a deterministic model double; no model download.
  const code = String.raw`
import runpy, threading, tempfile, os, time, concurrent.futures, urllib.request
module = runpy.run_path('scripts/xtts-server.py', run_name='xtts_test')
handler = module['Handler']
paths = []
class Model:
    def tts_to_file(self, text, speaker_wav, language, file_path, **kwargs):
        assert kwargs.get('max_ref_len', 10) >= 30, 'Reference is truncated before the owner finishes speaking'
        assert kwargs.get('gpt_cond_len', 12) >= 30, 'Prosody conditioning ignores most of a 30-second sample'
        paths.append(file_path)
        with open(file_path, 'wb') as output:
            output.write(text.encode())
        time.sleep(0.2)
handler.do_POST.__globals__['_tts'] = Model()
server = module['ThreadingHTTPServer'](('127.0.0.1', 0), handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
def synthesize(text):
    payload = ('--audit\r\nContent-Disposition: form-data; name="text"\r\n\r\n' + text + '\r\n--audit--\r\n').encode().replace(b'\\r\\n', b'\r\n')
    request = urllib.request.Request('http://127.0.0.1:' + str(server.server_port) + '/tts', data=payload,
        headers={'Content-Type':'multipart/form-data; boundary=audit'})
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.read().decode()
try:
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        actual = list(pool.map(synthesize, ['first narration', 'second narration']))
    assert actual == ['first narration', 'second narration'], actual
    assert len(set(paths)) == 2, paths
    assert all(os.path.isabs(path) for path in paths), paths
finally:
    server.shutdown()
    server.server_close()
`;
  const result = runSync('python', ['-c', code], { timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
