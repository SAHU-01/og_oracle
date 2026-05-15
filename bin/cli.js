#!/usr/bin/env node
const path = require('path');
const { spawn } = require('child_process');

// The dist directory where the compiled files live
const oracleScript = path.join(__dirname, '../dist/src/oracle.js');

// Pass all CLI arguments to the compiled oracle script
const args = process.argv.slice(2);
const child = spawn('node', [oracleScript, ...args], {
  stdio: 'inherit',
  env: process.env
});

child.on('exit', (code) => {
  process.exit(code);
});
