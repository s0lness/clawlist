#!/usr/bin/env node
import { down } from './docker.js';
import { logError } from './common.js';

down(process.cwd()).catch((err) => {
  logError('down', err.message);
  console.error(err);
  process.exit(1);
});
