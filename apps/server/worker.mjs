// Development worker entry. Production runs the compiled worker directly.
import { register } from 'tsx/esm/api';
register();
await import('./src/job-worker.ts');
