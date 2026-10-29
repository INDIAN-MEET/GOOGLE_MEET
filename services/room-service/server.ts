// Must be first: OpenTelemetry patches libraries as they load.
import './src/observability/tracing.js';

import app from './src/app.js';
import { PORT } from './src/config/env.js';

app.listen(PORT, () => {
  console.log(`Room Service running on port ${PORT}`);
});