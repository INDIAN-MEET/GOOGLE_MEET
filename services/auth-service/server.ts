// Must be first: OpenTelemetry patches libraries as they load.
import './src/observability/tracing.js';

import app from './src/app.js';
import { PORT } from './src/config/env.js';
import logger from './src/utils/logger.js';

app.listen(PORT, () => {
  logger.info(`Auth Service running on port https://localhost:${PORT}`);
});