#!/usr/bin/env node
import { bootstrap } from './bootstrap.js';
import { logError } from './common.js';

bootstrap(process.cwd()).catch((err) => {
  logError('bootstrap', err.message);
  console.error(err);
  process.exit(1);
});
