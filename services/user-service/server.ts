import app from './src/app.js';
import { PORT } from './src/config/env.js';
import logger from './src/utils/logger.js';

app.listen(PORT, () => logger.info(`User Service running on port http://localhost:${PORT}`));