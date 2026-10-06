'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Private single-file publication only. The sibling temp shares the destination
// filesystem and has no logical-state suffix. No unlink/copy fallback is safe.
module.exports = function publishFile(filename, bytes) {
  const temporary = path.join(path.dirname(filename), `.moxley-publish-${randomUUID()}.tmp`);
  let descriptor;
  let owned = false;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    owned = true;
    fs.writeFileSync(descriptor, bytes);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filename);
    owned = false;
  } finally {
    // Cleanup is best effort and must not replace the original platform error.
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
    if (owned) {
      try { fs.unlinkSync(temporary); } catch {}
    }
  }
};
