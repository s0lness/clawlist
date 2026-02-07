#!/usr/bin/env node
import { up } from './docker.js';
import { logError } from './common.js';

up(process.cwd()).catch((err) => {
  logError('up', err.message);
  console.error(err);
  process.exit(1);
});
