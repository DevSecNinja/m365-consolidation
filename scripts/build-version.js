import { writeFileSync } from 'node:fs';

const sha = process.env.GITHUB_SHA || process.env.COMMIT_SHA || 'local';
writeFileSync('version.json', `${JSON.stringify({ sha, builtAt: new Date().toISOString() }, null, 2)}\n`);
console.log(`Wrote version.json for ${sha}`);
