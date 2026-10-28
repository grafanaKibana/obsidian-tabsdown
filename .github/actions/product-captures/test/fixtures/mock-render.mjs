import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

/** Record the actual renderer arguments in a test-owned output instead of creating artwork. */
export async function renderOutput({theme,output,destination}) {
  assert.equal(theme,output.theme,'The CLI must dispatch the resolved output theme');
  await fs.writeFile(destination,theme);
}
